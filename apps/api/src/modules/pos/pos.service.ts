import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateSaleInput,
  CreateSalePriceInput,
  PosBatchesListQuery,
  PosPricesListQuery,
  PosSalesListQuery,
  UpdateSalePriceInput,
  VoidSaleInput,
} from "@pfi/shared";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { ApiException } from "../../common/http/api-exception";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { loadApiEnvironment } from "../../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { hashBusinessPayload, isUuidV4 } from "../receiving/idempotency";

const createSaleEndpoint = "/api/v1/pos/sales";
const pricesEndpoint = "/api/v1/pos/prices";
const companyName = "PT. Pisciculture Farm Indonesia";

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

const priceInclude = {
  species: { select: { id: true, speciesCode: true, speciesName: true } },
  updater: { select: { id: true, name: true } },
} satisfies Prisma.FishSalePriceInclude;

type PriceWithRelations = Prisma.FishSalePriceGetPayload<{
  include: typeof priceInclude;
}>;

type PosBatchRow = {
  batch_id: string;
  batch_code: string;
  status: string;
  species_id: string;
  species_code: string;
  species_name: string;
  fish_size: string;
  current_stock: bigint;
  unit_price: bigint | null;
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

function formatReceiptDateTime(value: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
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
          if (input.payment_method === "cash" && cashReceived! < totalAmount) {
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
                cash_received:
                  cashReceived === null ? null : Number(cashReceived),
                change_amount:
                  changeAmount === null ? null : Number(changeAmount),
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

  async listSales(query: PosSalesListQuery, requestId: string) {
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
      meta: { request_id: requestId },
    };
  }

  async getSale(saleId: string, requestId: string) {
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
      meta: { request_id: requestId },
    };
  }

  async getReceipt(
    saleId: string,
    actor: AuthenticatedUser,
    requestId: string,
  ) {
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
    if (sale.createdBy !== actor.id) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "FORBIDDEN",
        "Cetak ulang hanya diizinkan untuk pembuat transaksi.",
      );
    }
    if (sale.void) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "RECEIPT_NOT_AVAILABLE",
        "Struk transaksi yang sudah di-VOID tidak tersedia.",
      );
    }

    return {
      status: "success" as const,
      message: "Data struk berhasil dimuat.",
      data: {
        company_name: companyName,
        transaction_date_time: formatReceiptDateTime(sale.createdAt),
        species_name: sale.batch.species.speciesName,
        fish_size: sale.batch.incomingFish?.fishSize ?? null,
        quantity: sale.quantity,
        unit_price: Number(sale.unitPrice),
        total_payment: Number(sale.totalAmount),
        payment_method: sale.paymentMethod,
        cashier_name: sale.creator.name,
      },
      meta: { request_id: requestId },
    };
  }

  async listPrices(query: PosPricesListQuery, requestId: string) {
    const skip = (query.page - 1) * query.limit;
    const where: Prisma.FishSalePriceWhereInput = {};
    const [totalItems, prices] = await this.prisma.$transaction([
      this.prisma.fishSalePrice.count({ where }),
      this.prisma.fishSalePrice.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: priceInclude,
      }),
    ]);

    return {
      status: "success" as const,
      message: "Daftar harga berhasil dimuat.",
      data: {
        items: prices.map((price) => this.mapPrice(price)),
        pagination: {
          page: query.page,
          limit: query.limit,
          totalItems,
          totalPages: Math.ceil(totalItems / query.limit),
        },
      },
      meta: { request_id: requestId },
    };
  }

  async listPosBatches(query: PosBatchesListQuery, requestId: string) {
    const skip = (query.page - 1) * query.limit;
    const [countRows, batches] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ total_items: bigint }>>`
        SELECT COUNT(*) AS total_items
        FROM "batches" AS "batch"
        INNER JOIN "incoming_fish" AS "receipt"
          ON "receipt"."batch_id" = "batch"."id"
        WHERE "batch"."status" = 'active'
          AND "calculate_batch_stock"("batch"."id") > 0
      `,
      this.prisma.$queryRaw<PosBatchRow[]>`
        SELECT
          "batch"."id" AS batch_id,
          "batch"."batch_code" AS batch_code,
          "batch"."status" AS status,
          "species"."id" AS species_id,
          "species"."species_code" AS species_code,
          "species"."species_name" AS species_name,
          "receipt"."fish_size" AS fish_size,
          "calculate_batch_stock"("batch"."id") AS current_stock,
          "price"."price_per_fish" AS unit_price
        FROM "batches" AS "batch"
        INNER JOIN "fish_species" AS "species"
          ON "species"."id" = "batch"."species_id"
        INNER JOIN "incoming_fish" AS "receipt"
          ON "receipt"."batch_id" = "batch"."id"
        LEFT JOIN "fish_sale_prices" AS "price"
          ON "price"."species_id" = "batch"."species_id"
          AND "price"."fish_size" = "receipt"."fish_size"
        WHERE "batch"."status" = 'active'
          AND "calculate_batch_stock"("batch"."id") > 0
        ORDER BY "batch"."created_at" DESC, "batch"."id" DESC
        OFFSET ${skip} LIMIT ${query.limit}
      `,
    ]);
    const totalItems = Number(countRows[0]?.total_items ?? 0n);

    return {
      status: "success" as const,
      message: "Daftar batch POS berhasil dimuat.",
      data: {
        items: batches.map((batch) => this.mapPosBatch(batch)),
        pagination: {
          page: query.page,
          limit: query.limit,
          totalItems,
          totalPages: Math.ceil(totalItems / query.limit),
        },
      },
      meta: { request_id: requestId },
    };
  }

  async getPosBatch(batchId: string, requestId: string) {
    const [batch] = await this.prisma.$queryRaw<PosBatchRow[]>`
      SELECT
        "batch"."id" AS batch_id,
        "batch"."batch_code" AS batch_code,
        "batch"."status" AS status,
        "species"."id" AS species_id,
        "species"."species_code" AS species_code,
        "species"."species_name" AS species_name,
        "receipt"."fish_size" AS fish_size,
        "calculate_batch_stock"("batch"."id") AS current_stock,
        "price"."price_per_fish" AS unit_price
      FROM "batches" AS "batch"
      INNER JOIN "fish_species" AS "species"
        ON "species"."id" = "batch"."species_id"
      INNER JOIN "incoming_fish" AS "receipt"
        ON "receipt"."batch_id" = "batch"."id"
      LEFT JOIN "fish_sale_prices" AS "price"
        ON "price"."species_id" = "batch"."species_id"
        AND "price"."fish_size" = "receipt"."fish_size"
      WHERE "batch"."id" = ${batchId}::uuid
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

    const availableQuantity = Number(batch.current_stock);
    if (availableQuantity <= 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "INSUFFICIENT_STOCK",
        "Stok batch tidak tersedia untuk penjualan.",
        { available_quantity: 0 },
      );
    }

    return {
      status: "success" as const,
      message: "Detail batch POS berhasil dimuat.",
      data: this.mapPosBatch(batch),
      meta: { request_id: requestId },
    };
  }

  async createPrice(
    actor: AuthenticatedUser,
    input: CreateSalePriceInput,
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
    this.assertPriceInRange(input.price_per_fish);

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
              (${actor.id}::uuid, ${pricesEndpoint}, ${idempotencyKey}::uuid, ${payloadHash}, 'processing')
            ON CONFLICT ("user_id", "endpoint", "idempotency_key") DO NOTHING
            RETURNING "id"
          `;
          if (!idempotencyRow) throw new ExistingIdempotencyKeyError();

          const species = await transaction.fishSpecies.findUnique({
            where: { id: input.species_id },
            select: { id: true },
          });
          if (!species) {
            throw new ApiException(
              HttpStatus.BAD_REQUEST,
              "INVALID_PAYLOAD",
              "Spesies tidak ditemukan.",
            );
          }

          const [insertedPrice] = await transaction.$queryRaw<
            Array<{ id: string }>
          >`
            INSERT INTO "fish_sale_prices"
              ("species_id", "fish_size", "price_per_fish", "created_by", "updated_by")
            VALUES
              (${input.species_id}::uuid, ${input.fish_size}, ${BigInt(input.price_per_fish)}, ${actor.id}::uuid, ${actor.id}::uuid)
            RETURNING "id"
          `;
          if (!insertedPrice) {
            throw new ApiException(
              HttpStatus.INTERNAL_SERVER_ERROR,
              "INTERNAL_SERVER_ERROR",
              "Harga jual tidak dapat disimpan.",
            );
          }
          const price = await transaction.fishSalePrice.findUnique({
            where: { id: insertedPrice.id },
            include: priceInclude,
          });
          if (!price) {
            throw new ApiException(
              HttpStatus.INTERNAL_SERVER_ERROR,
              "INTERNAL_SERVER_ERROR",
              "Harga jual tidak dapat dimuat.",
            );
          }
          await transaction.auditLog.create({
            data: {
              requestId: request.requestId,
              actorId: actor.id,
              action: "CREATE_SALE_PRICE",
              entityType: "fish_sale_prices",
              entityId: price.id,
              ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
            },
          });

          const response: CachedResponse = {
            status: "success",
            message: "Harga jual berhasil ditambahkan.",
            data: this.mapPrice(price),
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
          pricesEndpoint,
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" ||
          (error.code === "P2010" && error.meta?.code === "23505"))
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "PRICE_ALREADY_EXISTS",
          "Harga untuk kombinasi spesies dan ukuran ini sudah tersedia.",
        );
      }
      throw error;
    }
  }

  async updatePrice(
    priceId: string,
    actor: AuthenticatedUser,
    input: UpdateSalePriceInput,
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
    this.assertPriceInRange(input.price_per_fish);

    const endpoint = `${pricesEndpoint}/${priceId}`;
    const payloadHash = hashBusinessPayload({
      price_id: priceId,
      ...input,
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
              (${actor.id}::uuid, ${endpoint}, ${idempotencyKey}::uuid, ${payloadHash}, 'processing')
            ON CONFLICT ("user_id", "endpoint", "idempotency_key") DO NOTHING
            RETURNING "id"
          `;
          if (!idempotencyRow) throw new ExistingIdempotencyKeyError();

          const [lockedPrice] = await transaction.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT "id"
            FROM "fish_sale_prices"
            WHERE "id" = ${priceId}::uuid
            FOR UPDATE
          `;
          if (!lockedPrice) {
            throw new ApiException(
              HttpStatus.NOT_FOUND,
              "PRICE_NOT_FOUND",
              "Harga jual tidak ditemukan.",
            );
          }

          const price = await transaction.fishSalePrice.update({
            where: { id: priceId },
            data: {
              pricePerFish: BigInt(input.price_per_fish),
              updatedBy: actor.id,
              updatedAt: new Date(),
            },
            include: priceInclude,
          });
          await transaction.auditLog.create({
            data: {
              requestId: request.requestId,
              actorId: actor.id,
              action: "UPDATE_SALE_PRICE",
              entityType: "fish_sale_prices",
              entityId: price.id,
              ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
            },
          });

          const response: CachedResponse = {
            status: "success",
            message: "Harga jual berhasil diperbarui.",
            data: this.mapPrice(price),
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
      throw error;
    }
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
      cash_received:
        sale.cashReceived === null ? null : Number(sale.cashReceived),
      change_amount:
        sale.changeAmount === null ? null : Number(sale.changeAmount),
      created_by: { id: sale.creator.id, name: sale.creator.name },
      status: sale.void ? "voided" : "active",
      voided_at: sale.void?.voidedAt.toISOString() ?? null,
      voided_by: sale.void
        ? { id: sale.void.actor.id, name: sale.void.actor.name }
        : null,
    };
  }

  private mapPrice(price: PriceWithRelations) {
    return {
      id: price.id,
      species_id: price.species.id,
      species_code: price.species.speciesCode,
      species_name: price.species.speciesName,
      fish_size: price.fishSize,
      price_per_fish: Number(price.pricePerFish),
      created_at: price.createdAt.toISOString(),
      updated_at: price.updatedAt.toISOString(),
      updated_by: { id: price.updater.id, name: price.updater.name },
    };
  }

  private mapPosBatch(batch: PosBatchRow) {
    return {
      batch: {
        id: batch.batch_id,
        batch_code: batch.batch_code,
        status: batch.status,
        current_stock: Number(batch.current_stock),
      },
      species: {
        id: batch.species_id,
        species_code: batch.species_code,
        species_name: batch.species_name,
      },
      fish_size: batch.fish_size,
      unit_price: batch.unit_price === null ? null : Number(batch.unit_price),
    };
  }

  private assertPriceInRange(price: number): void {
    if (!Number.isInteger(price) || price < 1 || price > 10_000_000) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "PRICE_OUT_OF_RANGE",
        "Harga per ekor harus antara Rp1 dan Rp10.000.000.",
      );
    }
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
