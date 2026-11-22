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
const v46SaleEndpoint = "/api/v1/sales";
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
  sale_readiness: "BELUM_SIAP" | "SIAP_JUAL";
  species_id: string;
  species_name: string;
  fish_size: string;
};

type LockedProduct = {
  id: string;
  sku: string;
  name: string;
  tracking_mode: "BATCH_TRACKED" | "NON_BATCH";
  species: string | null;
  size_label: string | null;
  unit: string;
  unit_price: Prisma.Decimal;
  stock_quantity: Prisma.Decimal | null;
  is_active: boolean;
  category_is_active: boolean;
};

type SaleSequence = { last_number: bigint };

class ExistingIdempotencyKeyError extends Error {}

const saleInclude = {
  batch: {
    include: {
      species: { select: { id: true, speciesCode: true, speciesName: true } },
      incomingFish: { select: { fishSize: true } },
    },
  },
  product: { include: { category: true } },
  creator: { select: { id: true, name: true } },
  void: { include: { actor: { select: { id: true, name: true } } } },
} satisfies Prisma.FishSaleInclude;
const productInclude = { category: true } satisfies Prisma.ProductInclude;

type SaleWithRelations = Prisma.FishSaleGetPayload<{
  include: typeof saleInclude;
}>;
type ProductWithCategory = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

type PosBatchRow = {
  batch_id: string;
  batch_code: string;
  status: string;
  sale_readiness: "BELUM_SIAP" | "SIAP_JUAL";
  species_id: string;
  species_code: string;
  species_name: string;
  fish_size: string;
  current_stock: bigint;
  unit_price: Prisma.Decimal | null;
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

  createV46Sale(
    actor: AuthenticatedUser,
    input: CreateSaleInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    return this.createSale(
      actor,
      input,
      idempotencyKey,
      request,
      v46SaleEndpoint,
    );
  }

  async createSale(
    actor: AuthenticatedUser,
    input: CreateSaleInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
    endpoint = createSaleEndpoint,
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
              (${actor.id}::uuid, ${endpoint}, ${idempotencyKey}::uuid, ${payloadHash}, 'processing')
            ON CONFLICT ("user_id", "endpoint", "idempotency_key") DO NOTHING
            RETURNING "id"
          `;

          if (!idempotencyRow) throw new ExistingIdempotencyKeyError();

          let batch: LockedBatch | undefined;
          let productId = input.product_id ?? null;
          if (!productId && input.batch_id) {
            [batch] = await transaction.$queryRaw<LockedBatch[]>`
              SELECT "batch"."id", "batch"."batch_code", "batch"."status",
                     "batch"."sale_readiness", "batch"."species_id",
                     "species"."species_name", "receipt"."fish_size"
              FROM "batches" AS "batch"
              INNER JOIN "fish_species" AS "species"
                ON "species"."id" = "batch"."species_id"
              INNER JOIN "incoming_fish" AS "receipt"
                ON "receipt"."batch_id" = "batch"."id"
              WHERE "batch"."id" = ${input.batch_id}::uuid
            `;
            if (!batch) {
              throw new ApiException(
                HttpStatus.NOT_FOUND,
                "BATCH_NOT_FOUND",
                "Batch tidak ditemukan.",
              );
            }
            const [legacyProduct] = await transaction.$queryRaw<
              Array<{ id: string }>
            >`
              SELECT "product"."id"
              FROM "products" AS "product"
              INNER JOIN "product_categories" AS "category"
                ON "category"."id" = "product"."category_id"
              WHERE "product"."tracking_mode" = 'BATCH_TRACKED'
                AND "product"."is_active" = true
                AND "category"."is_active" = true
                AND "product"."species" = ${batch.species_name}
                AND "product"."size_label" = ${batch.fish_size}
              ORDER BY "product"."created_at" DESC, "product"."id" DESC
              LIMIT 1
            `;
            productId = legacyProduct?.id ?? null;
          }
          if (!productId) {
            if (input.batch_id) {
              throw new ApiException(
                HttpStatus.CONFLICT,
                "PRICE_NOT_CONFIGURED",
                "Produk katalog untuk spesies dan ukuran batch ini belum tersedia.",
              );
            }
            throw new ApiException(
              HttpStatus.BAD_REQUEST,
              "INVALID_PAYLOAD",
              "product_id wajib kecuali batch_id dipakai oleh klien V4.5.",
            );
          }

          const [product] = await transaction.$queryRaw<LockedProduct[]>`
            SELECT "product"."id", "product"."sku", "product"."name", "product"."tracking_mode",
                   "product"."species", "product"."size_label", "product"."unit",
                   "product"."unit_price", "product"."stock_quantity",
                   "product"."is_active", "category"."is_active" AS category_is_active
            FROM "products" AS "product"
            INNER JOIN "product_categories" AS "category"
              ON "category"."id" = "product"."category_id"
            WHERE "product"."id" = ${productId}::uuid
            FOR UPDATE OF "product"
          `;
          if (!product) {
            throw new ApiException(
              HttpStatus.NOT_FOUND,
              "PRODUCT_NOT_FOUND",
              "Produk katalog tidak ditemukan.",
            );
          }
          if (!product.is_active || !product.category_is_active) {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "PRODUCT_NOT_ACTIVE",
              "Produk atau kategori sudah tidak aktif.",
            );
          }

          if (product.tracking_mode === "BATCH_TRACKED") {
            if (!input.batch_id) {
              throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVALID_PAYLOAD",
                "batch_id wajib untuk produk BATCH_TRACKED.",
              );
            }
            [batch] = await transaction.$queryRaw<LockedBatch[]>`
              SELECT "batch"."id", "batch"."batch_code", "batch"."status",
                     "batch"."sale_readiness", "batch"."species_id",
                     "species"."species_name", "receipt"."fish_size"
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
            if (batch.sale_readiness !== "SIAP_JUAL") {
              throw new ApiException(
                HttpStatus.UNPROCESSABLE_ENTITY,
                "BATCH_NOT_READY",
                "Batch belum berstatus SIAP_JUAL.",
              );
            }
            if (
              product.species !== batch.species_name ||
              product.size_label !== batch.fish_size
            ) {
              throw new ApiException(
                HttpStatus.UNPROCESSABLE_ENTITY,
                "INVALID_PAYLOAD",
                "Batch tidak sesuai dengan spesies dan ukuran produk.",
              );
            }
          } else if (input.batch_id != null) {
            throw new ApiException(
              HttpStatus.BAD_REQUEST,
              "INVALID_PAYLOAD",
              "batch_id harus null untuk produk NON_BATCH.",
            );
          }

          const unitPrice = new Prisma.Decimal(product.unit_price);
          if (!unitPrice.equals(input.expected_unit_price.toString())) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "PRICE_CHANGED",
              "Harga jual berubah. Perbarui dan konfirmasikan harga terbaru.",
              { unit_price: unitPrice.toNumber() },
            );
          }

          const totalPrice = unitPrice.mul(input.quantity).toDecimalPlaces(2);
          if (totalPrice.greaterThan("999999999999.99")) {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "INVALID_PAYLOAD",
              "Total pembayaran melebihi kapasitas kolom total_price.",
            );
          }
          const cashReceived =
            input.payment_method === "cash"
              ? new Prisma.Decimal(input.cash_received.toString())
              : null;
          if (
            input.payment_method === "cash" &&
            cashReceived!.lessThan(totalPrice)
          ) {
            throw new ApiException(
              HttpStatus.BAD_REQUEST,
              "INVALID_PAYLOAD",
              "Uang diterima tidak boleh kurang dari total pembayaran.",
            );
          }
          const availableQuantity =
            product.tracking_mode === "BATCH_TRACKED"
              ? Number(
                  (
                    await transaction.$queryRaw<
                      Array<{ current_stock: bigint }>
                    >`
                      SELECT "calculate_batch_stock"(${batch!.id}::uuid) AS current_stock
                    `
                  )[0]?.current_stock ?? 0n,
                )
              : (product.stock_quantity?.toNumber() ?? 0);
          if (input.quantity > availableQuantity) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "INSUFFICIENT_STOCK",
              "Stok berubah dan tidak mencukupi jumlah yang diminta.",
              { available_quantity: availableQuantity },
            );
          }
          const changeAmount =
            cashReceived === null
              ? null
              : cashReceived.minus(totalPrice).toDecimalPlaces(2);

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
              batchId: batch?.id ?? null,
              productId: product.id,
              quantity: input.quantity,
              unitPrice,
              totalPrice,
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
                batch_id: batch?.id ?? null,
                batch_code: batch?.batch_code ?? null,
                product_id: product.id,
                product_sku: product.sku,
                product_name: product.name,
                species_id: batch?.species_id ?? null,
                species_name: batch?.species_name ?? product.name,
                fish_size: batch?.fish_size ?? product.unit,
                quantity: sale.quantity,
                unit_price: unitPrice.toNumber(),
                total_price: totalPrice.toNumber(),
                total_amount: totalPrice.toNumber(),
                payment_method: sale.paymentMethod,
                cash_received:
                  cashReceived === null ? null : cashReceived.toNumber(),
                change_amount:
                  changeAmount === null ? null : changeAmount.toNumber(),
                created_by: actor.id,
                cashier_name: actor.name,
                created_at: createdAt.toISOString(),
                status: "active",
              },
              receipt: {
                company_name: companyName,
                transaction_date_time: formatReceiptDateTime(createdAt),
                species_name: batch?.species_name ?? product.sku,
                fish_size: batch?.fish_size ?? product.unit,
                quantity: sale.quantity,
                unit_price: unitPrice.toNumber(),
                total_payment: totalPrice.toNumber(),
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
          endpoint,
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
        species_name:
          sale.batch?.species.speciesName ?? sale.product?.name ?? null,
        fish_size:
          sale.batch?.incomingFish?.fishSize ??
          sale.product?.sizeLabel ??
          sale.product?.unit ??
          null,
        quantity: sale.quantity,
        unit_price: Number(sale.unitPrice),
        total_payment: Number(sale.totalPrice),
        payment_method: sale.paymentMethod,
        cashier_name: sale.creator.name,
      },
      meta: { request_id: requestId },
    };
  }

  async listPrices(query: PosPricesListQuery, requestId: string) {
    const skip = (query.page - 1) * query.limit;
    const where: Prisma.ProductWhereInput = {
      trackingMode: "BATCH_TRACKED",
      isActive: true,
      category: { isActive: true },
    };
    const [totalItems, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: productInclude,
      }),
    ]);
    const speciesNames = [
      ...new Set(
        products
          .map((product) => product.species)
          .filter((value): value is string => value !== null),
      ),
    ];
    const species = await this.prisma.fishSpecies.findMany({
      where: { speciesName: { in: speciesNames } },
      select: { id: true, speciesCode: true, speciesName: true },
    });
    const speciesByName = new Map(
      species.map((item) => [item.speciesName, item]),
    );

    return {
      status: "success" as const,
      message: "Daftar harga berhasil dimuat.",
      data: {
        items: products.map((product) => {
          const fishSpecies = product.species
            ? speciesByName.get(product.species)
            : undefined;
          return {
            id: product.id,
            species_id: fishSpecies?.id ?? null,
            species_code: fishSpecies?.speciesCode ?? null,
            species_name: product.species,
            fish_size: product.sizeLabel,
            price_per_fish: product.unitPrice.toNumber(),
            created_at: product.createdAt.toISOString(),
            updated_at: product.updatedAt.toISOString(),
            updated_by: null,
          };
        }),
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
          AND "batch"."sale_readiness" = 'SIAP_JUAL'
          AND "calculate_batch_stock"("batch"."id") > 0
      `,
      this.prisma.$queryRaw<PosBatchRow[]>`
        SELECT
          "batch"."id" AS batch_id,
          "batch"."batch_code" AS batch_code,
          "batch"."status" AS status,
          "batch"."sale_readiness" AS sale_readiness,
          "species"."id" AS species_id,
          "species"."species_code" AS species_code,
          "species"."species_name" AS species_name,
          "receipt"."fish_size" AS fish_size,
          "calculate_batch_stock"("batch"."id") AS current_stock,
          "product"."unit_price" AS unit_price
        FROM "batches" AS "batch"
        INNER JOIN "fish_species" AS "species"
          ON "species"."id" = "batch"."species_id"
        INNER JOIN "incoming_fish" AS "receipt"
          ON "receipt"."batch_id" = "batch"."id"
        LEFT JOIN LATERAL (
          SELECT "candidate"."unit_price"
          FROM "products" AS "candidate"
          INNER JOIN "product_categories" AS "category"
            ON "category"."id" = "candidate"."category_id"
          WHERE "candidate"."tracking_mode" = 'BATCH_TRACKED'
            AND "candidate"."is_active" = true
            AND "category"."is_active" = true
            AND "candidate"."species" = "species"."species_name"
            AND "candidate"."size_label" = "receipt"."fish_size"
          LIMIT 1
        ) AS "product" ON true
        WHERE "batch"."status" = 'active'
          AND "batch"."sale_readiness" = 'SIAP_JUAL'
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
        "batch"."sale_readiness" AS sale_readiness,
        "species"."id" AS species_id,
        "species"."species_code" AS species_code,
        "species"."species_name" AS species_name,
        "receipt"."fish_size" AS fish_size,
        "calculate_batch_stock"("batch"."id") AS current_stock,
        "product"."unit_price" AS unit_price
      FROM "batches" AS "batch"
      INNER JOIN "fish_species" AS "species"
        ON "species"."id" = "batch"."species_id"
      INNER JOIN "incoming_fish" AS "receipt"
        ON "receipt"."batch_id" = "batch"."id"
      LEFT JOIN LATERAL (
        SELECT "candidate"."unit_price"
        FROM "products" AS "candidate"
        INNER JOIN "product_categories" AS "category"
          ON "category"."id" = "candidate"."category_id"
        WHERE "candidate"."tracking_mode" = 'BATCH_TRACKED'
          AND "candidate"."is_active" = true
          AND "category"."is_active" = true
          AND "candidate"."species" = "species"."species_name"
          AND "candidate"."size_label" = "receipt"."fish_size"
        LIMIT 1
      ) AS "product" ON true
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
    if (batch.sale_readiness !== "SIAP_JUAL") {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "BATCH_NOT_READY",
        "Batch belum berstatus SIAP_JUAL.",
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
            Array<{
              id: string;
              batch_id: string | null;
              product_id: string | null;
            }>
          >`
            SELECT "id", "batch_id", "product_id"
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

          if (saleReference.product_id) {
            const [lockedProduct] = await transaction.$queryRaw<
              Array<{ id: string }>
            >`
              SELECT "id" FROM "products"
              WHERE "id" = ${saleReference.product_id}::uuid
              FOR UPDATE
            `;
            if (!lockedProduct) {
              throw new ApiException(
                HttpStatus.NOT_FOUND,
                "PRODUCT_NOT_FOUND",
                "Produk transaksi tidak ditemukan.",
              );
            }
          }

          let batch: { id: string; status: string } | null = null;
          if (saleReference.batch_id) {
            const [lockedBatch] = await transaction.$queryRaw<
              Array<{ id: string; status: string }>
            >`
              SELECT "id", "status"
              FROM "batches"
              WHERE "id" = ${saleReference.batch_id}::uuid
              FOR UPDATE
            `;
            if (!lockedBatch) {
              throw new ApiException(
                HttpStatus.NOT_FOUND,
                "BATCH_NOT_FOUND",
                "Batch transaksi tidak ditemukan.",
              );
            }
            if (lockedBatch.status === "voided") {
              throw new ApiException(
                HttpStatus.CONFLICT,
                "BATCH_NOT_ACTIVE",
                "Penjualan dari batch yang telah di-VOID tidak dapat dibatalkan.",
              );
            }
            batch = lockedBatch;
          } else if (!saleReference.product_id) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "SALE_NOT_FOUND",
              "Penjualan tidak memiliki produk atau batch yang valid.",
            );
          }

          const [sale] = await transaction.$queryRaw<
            Array<{ sale_id: string; batch_id: string | null }>
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
          const [updatedBatch] = sale.batch_id
            ? await transaction.$queryRaw<Array<{ status: string }>>`
                SELECT "status" FROM "batches" WHERE "id" = ${sale.batch_id}::uuid
              `
            : [];
          const [updatedProduct] =
            sale.batch_id === null && saleReference.product_id
              ? await transaction.$queryRaw<
                  Array<{ stock_quantity: Prisma.Decimal | null }>
                >`
                  SELECT "stock_quantity" FROM "products" WHERE "id" = ${saleReference.product_id}::uuid
                `
              : [];

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
              batch_status: updatedBatch?.status ?? batch?.status ?? null,
              product_stock_quantity:
                updatedProduct?.stock_quantity?.toNumber() ?? null,
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
    const batch = sale.batch;
    const product = sale.product;
    return {
      id: sale.id,
      sale_code: sale.saleCode,
      created_at: sale.createdAt.toISOString(),
      batch_id: sale.batchId,
      batch_code: batch?.batchCode ?? null,
      product_id: sale.productId,
      product_sku: product?.sku ?? null,
      product_name: product?.name ?? null,
      tracking_mode: product?.trackingMode ?? "BATCH_TRACKED",
      species_id: batch?.species.id ?? null,
      species_code: batch?.species.speciesCode ?? null,
      species_name: batch?.species.speciesName ?? product?.name ?? null,
      fish_size:
        batch?.incomingFish?.fishSize ??
        product?.sizeLabel ??
        product?.unit ??
        null,
      quantity: sale.quantity,
      unit_price: Number(sale.unitPrice),
      total_price: Number(sale.totalPrice),
      total_amount: Number(sale.totalPrice),
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

  private mapPosBatch(batch: PosBatchRow) {
    return {
      batch: {
        id: batch.batch_id,
        batch_code: batch.batch_code,
        status: batch.status,
        sale_readiness: batch.sale_readiness,
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
