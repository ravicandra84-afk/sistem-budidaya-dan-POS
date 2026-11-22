import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BatchListQuery } from "@pfi/shared";
import { ApiException } from "../../common/http/api-exception";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { loadApiEnvironment } from "../../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { hashBusinessPayload, isUuidV4 } from "../receiving/idempotency";
import { calculateBatchStock } from "./batch-stock";
import type { SaleReadinessInput } from "./batches.schemas";

const readinessEndpoint = (batchId: string) =>
  `/api/v1/batches/${batchId}/sale-readiness`;

type CachedResponse = {
  status: "success";
  message: string;
  data: unknown;
};

type LockedBatchReadiness = {
  id: string;
  status: string;
  sale_readiness: "BELUM_SIAP" | "SIAP_JUAL";
};

class ExistingReadinessIdempotencyKeyError extends Error {}

@Injectable()
export class BatchesService {
  private readonly lockTimeout: string;
  private readonly transactionTimeout: number;

  constructor(private readonly prisma: PrismaService) {
    const lockTimeoutMs = loadApiEnvironment().DB_LOCK_TIMEOUT_MS;
    this.lockTimeout = `${lockTimeoutMs}ms`;
    this.transactionTimeout = lockTimeoutMs + 5_000;
  }

  async list(query: BatchListQuery) {
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
      ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
    };
    const where: Prisma.BatchWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [totalItems, batches] = await this.prisma.$transaction([
      this.prisma.batch.count({ where }),
      this.prisma.batch.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          species: {
            select: { id: true, speciesCode: true, speciesName: true },
          },
          incomingFish: { include: { void: { select: { id: true } } } },
          saleReadinessHistories: {
            orderBy: { createdAt: "desc" },
            include: { actor: { select: { id: true, name: true } } },
          },
        },
      }),
    ]);

    return {
      status: "success" as const,
      message: "Daftar batch berhasil dimuat.",
      data: {
        items: batches.map((batch) => ({
          batch: {
            id: batch.id,
            batch_code: batch.batchCode,
            status: batch.status,
            sale_readiness: batch.saleReadiness,
            current_stock: calculateBatchStock({
              receivedQuantity: batch.incomingFish?.quantity ?? 0,
              receiptVoided: batch.incomingFish?.void !== null,
            }),
            created_at: batch.createdAt.toISOString(),
          },
          species: {
            id: batch.species.id,
            species_code: batch.species.speciesCode,
            species_name: batch.species.speciesName,
          },
          incoming_fish: batch.incomingFish
            ? this.mapIncomingFish(batch.incomingFish)
            : null,
          sale_readiness_histories: batch.saleReadinessHistories.map(
            (history) => this.mapSaleReadinessHistory(history),
          ),
        })),
        pagination: {
          page: query.page,
          limit: query.limit,
          totalItems,
          totalPages: Math.ceil(totalItems / query.limit),
        },
      },
    };
  }

  async getById(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        species: { select: { id: true, speciesCode: true, speciesName: true } },
        incomingFish: { include: { void: { select: { id: true } } } },
        saleReadinessHistories: {
          orderBy: { createdAt: "desc" },
          include: { actor: { select: { id: true, name: true } } },
        },
      },
    });
    if (!batch)
      throw new ApiException(404, "BATCH_NOT_FOUND", "Batch tidak ditemukan.");

    return {
      status: "success" as const,
      message: "Detail batch berhasil dimuat.",
      data: {
        batch: {
          id: batch.id,
          batch_code: batch.batchCode,
          status: batch.status,
          sale_readiness: batch.saleReadiness,
          current_stock: calculateBatchStock({
            receivedQuantity: batch.incomingFish?.quantity ?? 0,
            receiptVoided: batch.incomingFish?.void !== null,
          }),
          created_at: batch.createdAt.toISOString(),
        },
        species: {
          id: batch.species.id,
          species_code: batch.species.speciesCode,
          species_name: batch.species.speciesName,
        },
        incoming_fish: batch.incomingFish
          ? this.mapIncomingFish(batch.incomingFish)
          : null,
        sale_readiness_histories: batch.saleReadinessHistories.map((history) =>
          this.mapSaleReadinessHistory(history),
        ),
      },
    };
  }

  async setSaleReadiness(
    batchId: string,
    input: SaleReadinessInput,
    actor: AuthenticatedUser,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    if (!isUuidV4(idempotencyKey)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_IDEMPOTENCY_KEY",
        "Header Idempotency-Key harus berupa UUIDv4.",
      );
    }

    const endpoint = readinessEndpoint(batchId);
    const payloadHash = hashBusinessPayload({ batch_id: batchId, ...input });
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
              (${actor.id}::uuid, ${endpoint}, ${idempotencyKey}::uuid, ${payloadHash}, 'processing')
            ON CONFLICT ("user_id", "endpoint", "idempotency_key") DO NOTHING
            RETURNING "id"
          `;
          if (!idempotencyRow) throw new ExistingReadinessIdempotencyKeyError();

          const [batch] = await transaction.$queryRaw<LockedBatchReadiness[]>`
            SELECT "id", "status", "sale_readiness"
            FROM "batches"
            WHERE "id" = ${batchId}::uuid
            FOR UPDATE
          `;
          if (!batch) {
            throw new ApiException(
              HttpStatus.NOT_FOUND,
              "BATCH_NOT_FOUND",
              "Batch tidak ditemukan.",
            );
          }
          if (batch.status !== "active") {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "BATCH_NOT_ACTIVE",
              "Kesiapan jual hanya dapat diubah pada batch active.",
            );
          }

          if (batch.sale_readiness !== input.sale_readiness) {
            await transaction.batch.update({
              where: { id: batchId },
              data: { saleReadiness: input.sale_readiness },
            });
            await transaction.batchSaleReadinessHistory.create({
              data: {
                batchId,
                fromReadiness: batch.sale_readiness,
                toReadiness: input.sale_readiness,
                changedBy: actor.id,
                note: input.note ?? null,
              },
            });
            await transaction.auditLog.create({
              data: {
                requestId: request.requestId,
                actorId: actor.id,
                action: "UPDATE_BATCH_SALE_READINESS",
                entityType: "batches",
                entityId: batchId,
                oldValues: { sale_readiness: batch.sale_readiness },
                newValues: { sale_readiness: input.sale_readiness },
                reason: input.note ?? null,
                ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
              },
            });
          }

          const response: CachedResponse = {
            status: "success",
            message: "Kesiapan jual batch berhasil diperbarui.",
            data: {
              batch_id: batchId,
              sale_readiness: input.sale_readiness,
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
      if (error instanceof ExistingReadinessIdempotencyKeyError) {
        return this.loadCachedReadinessResponse(
          actor.id,
          idempotencyKey,
          payloadHash,
          endpoint,
          request.requestId,
        );
      }
      throw error;
    }
  }

  private mapIncomingFish(
    incomingFish: Prisma.IncomingFishGetPayload<{
      include: { void: { select: { id: true } } };
    }>,
  ) {
    return {
      id: incomingFish.id,
      entry_date: incomingFish.entryDate.toISOString().slice(0, 10),
      quantity: incomingFish.quantity,
      purchase_capital: incomingFish.purchaseCapital.toFixed(2),
      shipping_capital: incomingFish.shippingCapital.toFixed(2),
      weight_sample_per_500:
        incomingFish.weightSamplePer500?.toFixed(2) ?? null,
      fish_size: incomingFish.fishSize,
      created_at: incomingFish.createdAt.toISOString(),
      voided: incomingFish.void !== null,
    };
  }

  private mapSaleReadinessHistory(
    history: Prisma.BatchSaleReadinessHistoryGetPayload<{
      include: { actor: { select: { id: true; name: true } } };
    }>,
  ) {
    return {
      id: history.id,
      from_readiness: history.fromReadiness,
      to_readiness: history.toReadiness,
      changed_by: { id: history.actor.id, name: history.actor.name },
      note: history.note,
      created_at: history.createdAt.toISOString(),
    };
  }

  private async loadCachedReadinessResponse(
    actorId: string,
    idempotencyKey: string,
    payloadHash: string,
    endpoint: string,
    requestId: string,
  ) {
    const record = await this.prisma.idempotencyKey.findUnique({
      where: {
        userId_endpoint_idempotencyKey: {
          userId: actorId,
          endpoint,
          idempotencyKey,
        },
      },
      select: { payloadHash: true, status: true, responseBody: true },
    });
    if (!record || record.status !== "completed" || !record.responseBody) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "DATABASE_UNAVAILABLE",
        "Hasil perubahan belum dapat dipastikan. Ulangi request dengan key yang sama.",
      );
    }
    if (record.payloadHash !== payloadHash) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "IDEMPOTENCY_MISMATCH",
        "Idempotency-Key telah digunakan dengan payload berbeda.",
      );
    }
    return {
      ...(record.responseBody as unknown as CachedResponse),
      meta: { idempotency_status: "cached", request_id: requestId },
    };
  }
}
