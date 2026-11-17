import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ApiException } from "../../common/http/api-exception";
import { RequestWithId } from "../../common/http/request-id.middleware";
import { loadApiEnvironment } from "../../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { DEPENDENT_TRANSACTION_GUARD } from "./dependent-transaction.guard";
import type { DependentTransactionGuard } from "./dependent-transaction.guard";
import { hashBusinessPayload, isUuidV4 } from "./idempotency";
import { ReceiveFishInput, VoidIncomingFishInput } from "./receiving.schemas";

const createEntryEndpoint = "/api/v1/fish-entries";
type Actor = { id: string };

class ExistingIdempotencyKeyError extends Error {}

type CachedResponse = {
  status: "success";
  message: string;
  data: unknown;
};

function currentJakartaDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDecimal(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

@Injectable()
export class ReceivingService {
  private readonly lockTimeout: string;
  private readonly transactionTimeout: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DEPENDENT_TRANSACTION_GUARD)
    private readonly dependentTransactionGuard: DependentTransactionGuard,
  ) {
    const lockTimeoutMs = loadApiEnvironment().DB_LOCK_TIMEOUT_MS;
    this.lockTimeout = `${lockTimeoutMs}ms`;
    this.transactionTimeout = lockTimeoutMs + 5_000;
  }

  async create(
    input: ReceiveFishInput,
    actor: Actor,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    if (input.entry_date > currentJakartaDate()) {
      throw new ApiException(
        422,
        "INVALID_ENTRY_DATE",
        "Tanggal penerimaan tidak boleh di masa depan.",
      );
    }

    const key = idempotencyKey;
    const payloadHash = hashBusinessPayload(input);

    try {
      const body = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT set_config('lock_timeout', ${this.lockTimeout}, true)`;
          const [idempotencyRow] = await transaction.$queryRaw<
            Array<{ id: string }>
          >`
          INSERT INTO "idempotency_keys"
            ("user_id", "endpoint", "idempotency_key", "payload_hash", "status")
          VALUES
            (${actor.id}::uuid, ${createEntryEndpoint}, ${key}::uuid, ${payloadHash}, 'processing')
          ON CONFLICT ("user_id", "endpoint", "idempotency_key") DO NOTHING
          RETURNING "id"
        `;

          if (!idempotencyRow) throw new ExistingIdempotencyKeyError();

          const species = await transaction.fishSpecies.findUnique({
            where: { id: input.species_id },
            select: { id: true, isActive: true },
          });
          if (!species?.isActive) {
            throw new ApiException(
              422,
              "SPECIES_NOT_ACTIVE",
              "Spesies tidak aktif atau tidak ditemukan.",
            );
          }

          await transaction.$executeRaw`
          INSERT INTO "batch_daily_sequences" ("entry_date", "last_number")
          VALUES (${input.entry_date}::date, 0)
          ON CONFLICT ("entry_date") DO NOTHING
        `;

          const [lockedSequence] = await transaction.$queryRaw<
            Array<{ last_number: number }>
          >`
          SELECT "last_number"
          FROM "batch_daily_sequences"
          WHERE "entry_date" = ${input.entry_date}::date
          FOR UPDATE
        `;
          if (!lockedSequence || lockedSequence.last_number >= 999) {
            throw new ApiException(
              422,
              "BATCH_SEQUENCE_EXHAUSTED",
              "Nomor batch harian telah mencapai batas.",
            );
          }

          const [sequence] = await transaction.$queryRaw<
            Array<{ last_number: number }>
          >`
          UPDATE "batch_daily_sequences"
          SET "last_number" = "last_number" + 1
          WHERE "entry_date" = ${input.entry_date}::date AND "last_number" < 999
          RETURNING "last_number"
        `;
          if (!sequence) {
            throw new ApiException(
              422,
              "BATCH_SEQUENCE_EXHAUSTED",
              "Nomor batch harian telah mencapai batas.",
            );
          }

          const batch = await transaction.batch.create({
            data: {
              batchCode: `PFI-BCH-${input.entry_date.replaceAll("-", "")}-${String(sequence.last_number).padStart(3, "0")}`,
              speciesId: species.id,
              status: "active",
              createdBy: actor.id,
            },
          });
          const incomingFish = await transaction.incomingFish.create({
            data: {
              batchId: batch.id,
              entryDate: new Date(`${input.entry_date}T00:00:00.000Z`),
              quantity: input.quantity,
              purchaseCapital: new Prisma.Decimal(input.purchase_capital),
              shippingCapital: new Prisma.Decimal(input.shipping_capital),
              weightSamplePer500:
                input.weight_sample_per_500 == null
                  ? null
                  : new Prisma.Decimal(input.weight_sample_per_500),
              fishSize: input.fish_size,
              createdBy: actor.id,
            },
          });

          await transaction.auditLog.create({
            data: {
              requestId: request.requestId,
              actorId: actor.id,
              action: "CREATE_ENTRY",
              entityType: "incoming_fish",
              entityId: incomingFish.id,
              ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
            },
          });

          const response: CachedResponse = {
            status: "success",
            message: "Penerimaan ikan berhasil dicatat dan Batch telah dibuat.",
            data: {
              batch: {
                id: batch.id,
                batch_code: batch.batchCode,
                status: batch.status,
              },
              incoming_fish: {
                id: incomingFish.id,
                entry_date: input.entry_date,
                quantity: incomingFish.quantity,
                purchase_capital: formatDecimal(incomingFish.purchaseCapital),
                shipping_capital: formatDecimal(incomingFish.shippingCapital),
                weight_sample_per_500: incomingFish.weightSamplePer500
                  ? formatDecimal(incomingFish.weightSamplePer500)
                  : null,
                fish_size: incomingFish.fishSize,
              },
            },
          };

          await transaction.$executeRaw`
          UPDATE "idempotency_keys"
          SET "status" = 'completed', "response_status" = 201,
              "response_body" = ${JSON.stringify(response)}::jsonb,
              "completed_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${idempotencyRow.id}::uuid
        `;

          return response;
        },
        { timeout: this.transactionTimeout },
      );

      return {
        ...body,
        meta: { idempotency_status: "executed", request_id: request.requestId },
      };
    } catch (error) {
      if (error instanceof ExistingIdempotencyKeyError) {
        return this.loadCachedResponse(
          actor.id,
          createEntryEndpoint,
          key,
          payloadHash,
          request.requestId,
        );
      }
      throw error;
    }
  }

  async void(
    batchId: string,
    input: VoidIncomingFishInput,
    actor: Actor,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    const key = idempotencyKey;
    const endpoint = `/api/v1/fish-entries/${batchId}/void`;
    const payloadHash = hashBusinessPayload({
      batch_id: batchId,
      reason: input.reason,
    });

    try {
      const body = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`SELECT set_config('lock_timeout', ${this.lockTimeout}, true)`;
          const [idempotencyRow] = await transaction.$queryRaw<
            Array<{ id: string }>
          >`
          INSERT INTO "idempotency_keys"
            ("user_id", "endpoint", "idempotency_key", "payload_hash", "status")
          VALUES
            (${actor.id}::uuid, ${endpoint}, ${key}::uuid, ${payloadHash}, 'processing')
          ON CONFLICT ("user_id", "endpoint", "idempotency_key") DO NOTHING
          RETURNING "id"
        `;

          if (!idempotencyRow) throw new ExistingIdempotencyKeyError();

          const [batch] = await transaction.$queryRaw<
            Array<{ id: string; batch_code: string; status: string }>
          >`
          SELECT "id", "batch_code", "status"
          FROM "batches"
          WHERE "id" = ${batchId}::uuid
          FOR UPDATE
        `;
          if (!batch)
            throw new ApiException(
              404,
              "BATCH_NOT_FOUND",
              "Batch tidak ditemukan.",
            );
          if (batch.status !== "active") {
            throw new ApiException(
              409,
              "BATCH_NOT_ACTIVE",
              "Batch tidak berstatus active.",
            );
          }

          if (
            await this.dependentTransactionGuard.hasDependentTransactions(
              transaction,
              batchId,
            )
          ) {
            throw new ApiException(
              409,
              "HAS_DEPENDENT_TRANSACTIONS",
              "Batch memiliki transaksi turunan dan tidak dapat di-VOID.",
            );
          }

          const incomingFish = await transaction.incomingFish.findUnique({
            where: { batchId },
            select: { id: true },
          });
          if (!incomingFish)
            throw new ApiException(
              404,
              "BATCH_NOT_FOUND",
              "Data penerimaan tidak ditemukan.",
            );

          await transaction.incomingFishVoid.create({
            data: {
              incomingFishId: incomingFish.id,
              reason: input.reason,
              voidedBy: actor.id,
            },
          });
          await transaction.batch.update({
            where: { id: batchId },
            data: { status: "voided" },
          });
          await transaction.auditLog.create({
            data: {
              requestId: request.requestId,
              actorId: actor.id,
              action: "VOID_ENTRY",
              entityType: "incoming_fish",
              entityId: incomingFish.id,
              reason: input.reason,
              ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
            },
          });

          const response: CachedResponse = {
            status: "success",
            message: "Transaksi penerimaan ikan berhasil di-VOID.",
            data: {
              batch_id: batch.id,
              batch_code: batch.batch_code,
              status: "voided",
            },
          };
          await transaction.$executeRaw`
          UPDATE "idempotency_keys"
          SET "status" = 'completed', "response_status" = 200,
              "response_body" = ${JSON.stringify(response)}::jsonb,
              "completed_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${idempotencyRow.id}::uuid
        `;
          return response;
        },
        { timeout: this.transactionTimeout },
      );

      return {
        ...body,
        meta: { idempotency_status: "executed", request_id: request.requestId },
      };
    } catch (error) {
      if (error instanceof ExistingIdempotencyKeyError) {
        return this.loadCachedResponse(
          actor.id,
          endpoint,
          key,
          payloadHash,
          request.requestId,
        );
      }
      throw error;
    }
  }

  private assertIdempotencyKey(key: string | undefined): asserts key is string {
    if (!isUuidV4(key)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key harus berupa UUIDv4.",
      );
    }
  }

  private async loadCachedResponse(
    userId: string,
    endpoint: string,
    key: string,
    payloadHash: string,
    requestId: string,
  ) {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: {
        userId_endpoint_idempotencyKey: {
          userId,
          endpoint,
          idempotencyKey: key,
        },
      },
    });

    if (!existing || existing.payloadHash !== payloadHash) {
      throw new ApiException(
        409,
        "IDEMPOTENCY_MISMATCH",
        "Idempotency-Key telah digunakan dengan payload berbeda.",
      );
    }
    if (existing.status !== "completed" || !existing.responseBody) {
      throw new ApiException(
        409,
        "IDEMPOTENCY_IN_PROGRESS",
        "Permintaan dengan Idempotency-Key ini sedang diproses.",
      );
    }

    const cached = existing.responseBody as unknown as CachedResponse;
    return {
      ...cached,
      meta: { idempotency_status: "cached", request_id: requestId },
    };
  }
}
