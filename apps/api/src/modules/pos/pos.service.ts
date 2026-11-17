import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CreateSaleInput } from "@pfi/shared";
import type { PosSalesListQuery, VoidSaleInput } from "@pfi/shared";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { ApiException } from "../../common/http/api-exception";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { loadApiEnvironment } from "../../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { hashBusinessPayload, isUuidV4 } from "../receiving/idempotency";

const createSaleEndpoint = "/api/v1/pos/sales";
const companyName = "Pisciculture Farm Indonesia";

type CachedResponse = {
  status: "success";
  message: string;
  data: unknown;
};

type LockedBatch = {
  id: string;
  batch_code: string;
  status: string;
  species_id: string;
  species_name: string;
  fish_size: string;
};

type SaleSequence = { last_number: bigint };
type PriceRow = { price_per_fish: bigint };

class ExistingIdempotencyKeyError extends Error {}

const saleInclude = {
  batch: {
    include: {
      species: { select: { id: true, speciesCode: true, speciesName: true } },
      incomingFish: { select: { fishSize: true } },
    },
  },
  creator: { select: { id: true, name: true } },
  void: { include: { actor: { select: { id: true, name: true } } } },
} satisfies Prisma.FishSaleInclude;

type SaleWithRelations = Prisma.FishSaleGetPayload<{
  include: typeof saleInclude;
}>;

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

function formatReceiptDateTime(value: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(value);
}

@Injectable()
export class PosService {
  private readonly lockTimeout: string;
  private readonly transactionTimeout: number;

  constructor(private readonly prisma: PrismaService) {
    const lockTimeoutMs = loadApiEnvironment().DB_LOCK_TIMEOUT_MS;
    this.lockTimeout = `${lockTimeoutMs}ms`;
    this.transactionTimeout = lockTimeoutMs + 5_000;
  }

  async createSale(
    actor: AuthenticatedUser,
    input: CreateSaleInput,
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
              (${actor.id}::uuid, ${createSaleEndpoint}, ${idempotencyKey}::uuid, ${payloadHash}, 'processing')
            ON CONFLICT ("user_id", "endpoint", "idempotency_key") DO NOTHING
            RETURNING "id"
          `;

          if (!idempotencyRow) throw new ExistingIdempotencyKeyError();

          const [batch] = await transaction.$queryRaw<LockedBatch[]>`
            SELECT
              "batch"."id",
              "batch"."batch_code",
              "batch"."status",
              "batch"."species_id",
              "species"."species_name",
              "receipt"."fish_size"
            FROM "batches" AS "batch"
            INNER JOIN "fish_species" AS "species"
              ON "species"."id" = "batch"."species_id"
            INNER JOIN "incoming_fish" AS "receipt"
              ON "receipt"."batch_id" = "batch"."id"
            WHERE "batch"."id" = ${input.batch_id}::uuid
            FOR UPDATE OF "batch"
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
              HttpStatus.CONFLICT,
              "BATCH_NOT_ACTIVE",
              "Batch tidak berstatus active.",
            );
          }

          const [stockRow] = await transaction.$queryRaw<
            Array<{ current_stock: bigint }>
          >`
            SELECT "calculate_batch_stock"(${batch.id}::uuid) AS current_stock
          `;
          const availableQuantity = Number(stockRow?.current_stock ?? 0n);
          if (input.quantity > availableQuantity) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "INSUFFICIENT_STOCK",
              "Stok batch berubah dan tidak mencukupi jumlah yang diminta.",
              { available_quantity: availableQuantity },
            );
          }

          const [price] = await transaction.$queryRaw<PriceRow[]>`
            SELECT "price_per_fish"
            FROM "fish_sale_prices"
            WHERE "species_id" = ${batch.species_id}::uuid
              AND "fish_size" = ${batch.fish_size}
            FOR UPDATE
          `;
          if (!price) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "PRICE_NOT_CONFIGURED",
              "Harga jual untuk spesies dan ukuran ini belum tersedia.",
            );
          }

          const unitPrice = Number(price.price_per_fish);
          if (input.expected_unit_price !== unitPrice) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "PRICE_CHANGED",
              "Harga jual berubah. Perbarui dan konfirmasikan harga terbaru.",
              { unit_price: unitPrice },
            );
          }

          const totalAmount = BigInt(input.quantity) * price.price_per_fish;
          const cashReceived =
            input.payment_method === "cash"
              ? BigInt(input.cash_received)
              : null;
          if (
            input.payment_method === "cash" &&
            cashReceived! < totalAmount
          ) {
            throw new ApiException(
              HttpStatus.BAD_REQUEST,
              "INVALID_PAYLOAD",
              "Uang diterima tidak boleh kurang dari total pembayaran.",
            );
          }
          const changeAmount =
            cashReceived === null ? null : cashReceived - totalAmount;

          const saleDate = currentJakartaDate();
          await transaction.$executeRaw`
            INSERT INTO "sale_daily_sequences" ("sale_date", "last_number")
            VALUES (${saleDate}::date, 0)
            ON CONFLICT ("sale_date") DO NOTHING
          `;
          const [sequence] = await transaction.$queryRaw<SaleSequence[]>`
            UPDATE "sale_daily_sequences"
            SET "last_number" = "last_number" + 1
            WHERE "sale_date" = ${saleDate}::date
            RETURNING "last_number"
          `;
          if (!sequence) {
            throw new ApiException(
              HttpStatus.INTERNAL_SERVER_ERROR,
              "INTERNAL_SERVER_ERROR",
              "Nomor penjualan tidak dapat dialokasikan.",
            );
          }

          const saleCode = `PFI-SAL-${saleDate.replaceAll("-", "")}-${sequence.last_number.toString().padStart(3, "0")}`;
          const sale = await transaction.fishSale.create({
            data: {
              saleCode,
              batchId: batch.id,
              quantity: input.quantity,
              unitPrice: price.price_per_fish,
              totalAmount,
              paymentMethod: input.payment_method,
              cashReceived,
              changeAmount,
              createdBy: actor.id,
            },
          });

          await transaction.auditLog.create({
            data: {
              requestId: request.requestId,
              actorId: actor.id,
              action: "CREATE_SALE",
              entityType: "fish_sales",
              entityId: sale.id,
              ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
            },
          });

          const createdAt = sale.createdAt;
          const response: CachedResponse = {
            status: "success",
            message: "Penjualan berhasil dicatat.",
            data: {
              sale: {
                id: sale.id,
                sale_code: sale.saleCode,
                batch_id: batch.id,
                batch_code: batch.batch_code,
                species_id: batch.species_id,
                species_name: batch.species_name,
                fish_size: batch.fish_size,
                quantity: sale.quantity,
                unit_price: unitPrice,
                total_amount: Number(totalAmount),
                payment_method: sale.paymentMethod,
                cash_received: cashReceived === null ? null : Number(cashReceived),
                change_amount: changeAmount === null ? null : Number(changeAmount),
                created_by: actor.id,
                cashier_name: actor.name,
                created_at: createdAt.toISOString(),
                status: "active",
              },
              receipt: {
                company_name: companyName,
                transaction_date_time: formatReceiptDateTime(createdAt),
                species_name: batch.species_name,
                fish_size: batch.fish_size,
                quantity: sale.quantity,
                unit_price: unitPrice,
                total_payment: Number(totalAmount),
                payment_method: sale.paymentMethod,
                cashier_name: actor.name,
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
          idempotencyKey,
          payloadHash,
          request.requestId,
        );
      }
      throw error;
    }
  }

  async listSales(query: PosSalesListQuery) {
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
      ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
    };
    const statusFilter: Prisma.FishSaleWhereInput["void"] =
      query.status === "active"
        ? { is: null }
        : query.status === "voided"
          ? { isNot: null }
          : undefined;
    const where: Prisma.FishSaleWhereInput = {
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(statusFilter !== undefined ? { void: statusFilter } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [totalItems, sales] = await this.prisma.$transaction([
      this.prisma.fishSale.count({ where }),
      this.prisma.fishSale.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: saleInclude,
      }),
    ]);

    return {
      status: "success" as const,
      message: "Daftar penjualan berhasil dimuat.",
      data: {
        items: sales.map((sale) => this.mapSale(sale)),
        pagination: {
          page: query.page,
          limit: query.limit,
          totalItems,
          totalPages: Math.ceil(totalItems / query.limit),
        },
      },
    };
  }

  async getSale(saleId: string) {
    const sale = await this.prisma.fishSale.findUnique({
      where: { id: saleId },
      include: saleInclude,
    });
    if (!sale) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "SALE_NOT_FOUND",
        "Transaksi penjualan tidak ditemukan.",
      );
    }
    return {
      status: "success" as const,
      message: "Detail penjualan berhasil dimuat.",
      data: this.mapSale(sale),
    };
  }

  async voidSale(
    saleId: string,
    _input: VoidSaleInput,
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

    const endpoint = `/api/v1/pos/sales/${saleId}/void`;
    const payloadHash = hashBusinessPayload({ sale_id: saleId });
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
          if (!idempotencyRow) throw new ExistingIdempotencyKeyError();

          const [saleReference] = await transaction.$queryRaw<
            Array<{ id: string; batch_id: string }>
          >`
            SELECT "id", "batch_id"
            FROM "fish_sales"
            WHERE "id" = ${saleId}::uuid
          `;
          if (!saleReference) {
            throw new ApiException(
              HttpStatus.NOT_FOUND,
              "SALE_NOT_FOUND",
              "Transaksi penjualan tidak ditemukan.",
            );
          }

          const [batch] = await transaction.$queryRaw<
            Array<{ id: string; status: string }>
          >`
            SELECT "id", "status"
            FROM "batches"
            WHERE "id" = ${saleReference.batch_id}::uuid
            FOR UPDATE
          `;
          if (!batch) {
            throw new ApiException(
              HttpStatus.NOT_FOUND,
              "BATCH_NOT_FOUND",
              "Batch transaksi tidak ditemukan.",
            );
          }
          if (batch.status === "voided") {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "BATCH_NOT_ACTIVE",
              "Penjualan dari batch yang telah di-VOID tidak dapat dibatalkan.",
            );
          }

          const [sale] = await transaction.$queryRaw<
            Array<{ sale_id: string; batch_id: string }>
          >`
            SELECT "sale_id", "batch_id"
            FROM "lock_fish_sale_for_update"(${saleId}::uuid)
          `;
          if (!sale) {
            throw new ApiException(
              HttpStatus.NOT_FOUND,
              "SALE_NOT_FOUND",
              "Transaksi penjualan tidak ditemukan.",
            );
          }

          const existingVoid = await transaction.fishSaleVoid.findUnique({
            where: { saleId },
            select: { id: true },
          });
          if (existingVoid) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "SALE_ALREADY_VOIDED",
              "Transaksi penjualan sudah di-VOID.",
            );
          }

          const saleVoid = await transaction.fishSaleVoid.create({
            data: { saleId, voidedBy: actor.id },
          });
          const [updatedBatch] = await transaction.$queryRaw<
            Array<{ status: string }>
          >`
            SELECT "status" FROM "batches" WHERE "id" = ${sale.batch_id}::uuid
          `;

          await transaction.auditLog.create({
            data: {
              requestId: request.requestId,
              actorId: actor.id,
              action: "VOID_SALE",
              entityType: "fish_sales",
              entityId: saleId,
              ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
            },
          });

          const response: CachedResponse = {
            status: "success",
            message: "Transaksi penjualan berhasil di-VOID.",
            data: {
              sale_id: saleId,
              status: "voided",
              voided_at: saleVoid.voidedAt.toISOString(),
              voided_by: actor.id,
              batch_status: updatedBatch?.status ?? batch.status,
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
          idempotencyKey,
          payloadHash,
          request.requestId,
          endpoint,
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "SALE_ALREADY_VOIDED",
          "Transaksi penjualan sudah di-VOID.",
        );
      }
      throw error;
    }
  }

  private mapSale(sale: SaleWithRelations) {
    return {
      id: sale.id,
      sale_code: sale.saleCode,
      created_at: sale.createdAt.toISOString(),
      batch_id: sale.batchId,
      batch_code: sale.batch.batchCode,
      species_id: sale.batch.species.id,
      species_code: sale.batch.species.speciesCode,
      species_name: sale.batch.species.speciesName,
      fish_size: sale.batch.incomingFish?.fishSize ?? null,
      quantity: sale.quantity,
      unit_price: Number(sale.unitPrice),
      total_amount: Number(sale.totalAmount),
      payment_method: sale.paymentMethod,
      cash_received: sale.cashReceived === null ? null : Number(sale.cashReceived),
      change_amount: sale.changeAmount === null ? null : Number(sale.changeAmount),
      created_by: { id: sale.creator.id, name: sale.creator.name },
      status: sale.void ? "voided" : "active",
      voided_at: sale.void?.voidedAt.toISOString() ?? null,
      voided_by: sale.void
        ? { id: sale.void.actor.id, name: sale.void.actor.name }
        : null,
    };
  }

  private async loadCachedResponse(
    actorId: string,
    idempotencyKey: string,
    payloadHash: string,
    requestId: string,
    endpoint = createSaleEndpoint,
  ) {
    const record = await this.prisma.idempotencyKey.findUnique({
      where: {
        userId_endpoint_idempotencyKey: {
          userId: actorId,
          endpoint,
          idempotencyKey,
        },
      },
      select: {
        payloadHash: true,
        status: true,
        responseBody: true,
      },
    });

    if (!record || record.status !== "completed" || !record.responseBody) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "DATABASE_UNAVAILABLE",
        "Hasil transaksi belum dapat dipastikan. Ulangi request dengan key yang sama.",
      );
    }
    if (record.payloadHash !== payloadHash) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "IDEMPOTENCY_MISMATCH",
        "Idempotency-Key telah digunakan dengan payload berbeda.",
      );
    }

    const response = record.responseBody as unknown as CachedResponse;
    return {
      ...response,
      meta: { idempotency_status: "cached", request_id: requestId },
    };
  }
}