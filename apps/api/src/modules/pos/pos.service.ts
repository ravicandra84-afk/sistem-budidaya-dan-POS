import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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

type LockedSplitBatch = LockedBatch & { current_stock: bigint };

type LockedProduct = {
  id: string;
  sku: string;
  name: string;
  tracking_mode: "BATCH_TRACKED" | "NON_BATCH";
  species: string | null;
  size_label: string | null;
  variant_label: string | null;
  unit: string;
  unit_price: Prisma.Decimal;
  stock_quantity: Prisma.Decimal | null;
  is_active: boolean;
  category_is_active: boolean;
};

type SaleSequence = { last_number: bigint };
type SaleGroupPageRow = {
  group_id: string;
  created_at: Date;
  sale_ids: string[];
  has_checkout_group: boolean;
  total_items: bigint;
};

class ExistingIdempotencyKeyError extends Error {}

function normalizeCatalogMatchValue(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-");
}

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

function nameWithVariant(
  name: string | null,
  variant: string | null,
): string | null {
  const normalizedVariant = variant?.trim();
  return name && normalizedVariant ? `${name} ${normalizedVariant}` : name;
}

function normalizeSaleMatchValue(value: string | null): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\s*-\s*/g, "-");
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
                   "product"."species", "product"."size_label", "product"."variant_label", "product"."unit",
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

          if (input.batch_allocations !== undefined) {
            return this.createSplitBatchSale(
              transaction,
              actor,
              input,
              request,
              product,
              idempotencyRow.id,
            );
          }

          const quantity = new Prisma.Decimal(input.quantity.toString());
          if (
            product.tracking_mode === "BATCH_TRACKED" &&
            (!Number.isInteger(input.quantity) || input.quantity < 1)
          ) {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "INVALID_PAYLOAD",
              "Kuantitas BATCH_TRACKED harus berupa bilangan bulat minimal 1.",
            );
          }
          if (
            product.tracking_mode === "NON_BATCH" &&
            (!quantity.greaterThan(0) || quantity.decimalPlaces() > 2)
          ) {
            throw new ApiException(
              HttpStatus.UNPROCESSABLE_ENTITY,
              "INVALID_PAYLOAD",
              "Kuantitas NON_BATCH harus lebih dari 0 dengan maksimal dua desimal.",
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
              normalizeCatalogMatchValue(product.species) !==
                normalizeCatalogMatchValue(batch.species_name) ||
              normalizeCatalogMatchValue(product.size_label) !==
                normalizeCatalogMatchValue(batch.fish_size)
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

          const totalPrice = unitPrice.mul(quantity).toDecimalPlaces(2);
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
          if (quantity.greaterThan(availableQuantity)) {
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
              quantity,
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
                quantity: sale.quantity.toNumber(),
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
                ...this.mapReceipt({
                  createdAt,
                  batchSpeciesName: batch?.species_name ?? null,
                  batchFishSize: batch?.fish_size ?? null,
                  productName: product.name,
                  productSku: product.sku,
                  productUnit: product.unit,
                  quantity: sale.quantity,
                  unitPrice,
                  totalPrice,
                  paymentMethod: sale.paymentMethod,
                  cashierName: actor.name,
                }),
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

  private async createSplitBatchSale(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    input: CreateSaleInput,
    request: RequestWithId,
    product: LockedProduct,
    idempotencyRowId: string,
  ): Promise<CachedResponse> {
    const allocations = input.batch_allocations ?? [];
    if (
      product.tracking_mode !== "BATCH_TRACKED" ||
      allocations.length === 0 ||
      input.batch_id != null
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_PAYLOAD",
        "batch_allocations hanya berlaku untuk produk BATCH_TRACKED dan tidak dapat digabung dengan batch_id.",
      );
    }

    const requestedQuantity = allocations.reduce(
      (total, allocation) => total + allocation.quantity,
      0,
    );
    if (
      !Number.isInteger(input.quantity) ||
      requestedQuantity !== input.quantity ||
      allocations.some((allocation) => allocation.quantity < 1) ||
      new Set(allocations.map((allocation) => allocation.batch_id)).size !==
        allocations.length
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_PAYLOAD",
        "Jumlah total harus sama dengan alokasi batch yang unik dan positif.",
      );
    }

    const batchIds = allocations.map((allocation) => allocation.batch_id);
    const lockedBatches = await transaction.$queryRaw<
      LockedSplitBatch[]
    >(Prisma.sql`
      SELECT "batch"."id", "batch"."batch_code", "batch"."status",
             "batch"."sale_readiness", "batch"."species_id",
             "species"."species_name", "receipt"."fish_size",
             "calculate_batch_stock"("batch"."id") AS current_stock
      FROM "batches" AS "batch"
      INNER JOIN "fish_species" AS "species"
        ON "species"."id" = "batch"."species_id"
      INNER JOIN "incoming_fish" AS "receipt"
        ON "receipt"."batch_id" = "batch"."id"
      WHERE "batch"."id" IN (${Prisma.join(
        batchIds.map((batchId) => Prisma.sql`${batchId}::uuid`),
      )})
      ORDER BY "batch"."id"
      FOR UPDATE OF "batch"
    `);
    const batchById = new Map(lockedBatches.map((batch) => [batch.id, batch]));
    if (batchById.size !== allocations.length) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "BATCH_NOT_FOUND",
        "Satu atau lebih batch alokasi tidak ditemukan.",
      );
    }

    for (const allocation of allocations) {
      const batch = batchById.get(allocation.batch_id)!;
      if (batch.status !== "active") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "BATCH_NOT_ACTIVE",
          "Semua batch alokasi harus berstatus active.",
        );
      }
      if (batch.sale_readiness !== "SIAP_JUAL") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "BATCH_NOT_READY",
          "Semua batch alokasi harus berstatus SIAP_JUAL.",
        );
      }
      if (
        normalizeCatalogMatchValue(product.species) !==
          normalizeCatalogMatchValue(batch.species_name) ||
        normalizeCatalogMatchValue(product.size_label) !==
          normalizeCatalogMatchValue(batch.fish_size)
      ) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_PAYLOAD",
          "Setiap batch harus sesuai dengan spesies dan ukuran produk.",
        );
      }
      const remainingStock = Number(batch.current_stock);
      if (remainingStock < allocation.quantity) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "INSUFFICIENT_STOCK",
          "Stok salah satu batch tidak mencukupi alokasinya.",
          { batch_id: batch.id, available_quantity: remainingStock },
        );
      }
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
    const quantity = new Prisma.Decimal(input.quantity.toString());
    const totalPrice = unitPrice.mul(quantity).toDecimalPlaces(2);
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
    if (cashReceived !== null && cashReceived.lessThan(totalPrice)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_PAYLOAD",
        "Uang diterima tidak boleh kurang dari total pembayaran.",
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
    const saleCount = BigInt(allocations.length);
    const [sequence] = await transaction.$queryRaw<SaleSequence[]>`
      UPDATE "sale_daily_sequences"
      SET "last_number" = "last_number" + ${saleCount}
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

    const checkoutGroupId = randomUUID();
    const firstNumber = sequence.last_number - saleCount + 1n;
    const saleRows: Array<{ id: string; sale_code: string; created_at: Date }> =
      [];
    for (const [index, allocation] of allocations.entries()) {
      const lineTotal = unitPrice
        .mul(new Prisma.Decimal(allocation.quantity))
        .toDecimalPlaces(2);
      const lineChange =
        changeAmount === null
          ? null
          : index === 0
            ? changeAmount
            : new Prisma.Decimal(0);
      const lineCashReceived =
        cashReceived === null ? null : lineTotal.plus(lineChange ?? 0);
      const saleId = index === 0 ? checkoutGroupId : randomUUID();
      const saleNumber = firstNumber + BigInt(index);
      const saleCode = `PFI-SAL-${saleDate.replaceAll("-", "")}-${saleNumber.toString().padStart(3, "0")}`;
      const [saleRow] = await transaction.$queryRaw<
        Array<{ id: string; sale_code: string; created_at: Date }>
      >`
        INSERT INTO "fish_sales" (
          "id", "sale_code", "batch_id", "product_id", "quantity", "unit_price",
          "total_price", "payment_method", "cash_received", "change_amount",
          "created_by", "checkout_group_id"
        ) VALUES (
          ${saleId}::uuid, ${saleCode}, ${allocation.batch_id}::uuid, ${product.id}::uuid,
          ${allocation.quantity}::numeric, ${unitPrice.toString()}::numeric,
          ${lineTotal.toString()}::numeric, ${input.payment_method},
          ${lineCashReceived?.toString() ?? null}::numeric,
          ${lineChange?.toString() ?? null}::numeric,
          ${actor.id}::uuid, ${checkoutGroupId}::uuid
        )
        RETURNING "id", "sale_code", "created_at"
      `;
      saleRows.push(saleRow!);
      await transaction.auditLog.create({
        data: {
          requestId: request.requestId,
          actorId: actor.id,
          action: "CREATE_SALE",
          entityType: "fish_sales",
          entityId: saleId,
          ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
        },
      });
    }

    const productDisplayName = product.variant_label
      ? `${product.name} ${product.variant_label}`
      : product.name;
    const speciesDisplayName = product.species
      ? `${product.species}${product.variant_label ? ` ${product.variant_label}` : ""}`
      : productDisplayName;
    const createdAt = saleRows[0]!.created_at;
    const response: CachedResponse = {
      status: "success",
      message: "Penjualan berhasil dicatat.",
      data: {
        sale: {
          id: checkoutGroupId,
          sale_code: saleRows[0]!.sale_code,
          checkout_group_id: checkoutGroupId,
          sold_at: createdAt.toISOString(),
          product_id: product.id,
          product_sku: product.sku,
          product_name: productDisplayName,
          species_name: speciesDisplayName,
          fish_size: product.size_label,
          unit: product.unit,
          quantity: input.quantity,
          unit_price: unitPrice.toNumber(),
          total_payment: totalPrice.toNumber(),
          total_price: totalPrice.toNumber(),
          total_amount: totalPrice.toNumber(),
          payment_method: input.payment_method,
          cash_received: cashReceived?.toNumber() ?? null,
          change_amount: changeAmount?.toNumber() ?? null,
          change_due: changeAmount?.toNumber() ?? null,
          batch_allocations: allocations.map((allocation) => ({
            batch_id: allocation.batch_id,
            quantity: allocation.quantity,
          })),
          created_by: actor.id,
          cashier_name: actor.name,
          created_at: createdAt.toISOString(),
          status: "active",
        },
        receipt: {
          ...this.mapReceipt({
            createdAt,
            batchSpeciesName: speciesDisplayName,
            batchFishSize: product.size_label,
            productName: productDisplayName,
            productSku: product.sku,
            productUnit: product.unit,
            quantity,
            unitPrice,
            totalPrice,
            paymentMethod: input.payment_method,
            cashierName: actor.name,
          }),
        },
      },
    };

    await transaction.$executeRaw`
      UPDATE "idempotency_keys"
      SET "status" = 'completed', "response_status" = 201,
          "response_body" = ${JSON.stringify(response)}::jsonb,
          "completed_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${idempotencyRowId}::uuid
    `;
    return response;
  }

  async listSales(query: PosSalesListQuery, requestId: string) {
    const startDate = query.startDate ? new Date(query.startDate) : null;
    const endDate = query.endDate ? new Date(query.endDate) : null;
    const activeOnly = query.status === "active";
    const voidedOnly = query.status === "voided";
    const skip = (query.page - 1) * query.limit;
    const [countRows, groups] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ total_items: bigint }>>`
        WITH grouped AS (
          SELECT COALESCE("sale"."checkout_group_id", "sale"."id") AS group_id,
                 COUNT(*) AS row_count,
                 COUNT("sale_void"."sale_id") AS void_count
          FROM "fish_sales" AS "sale"
          LEFT JOIN "fish_sale_voids" AS "sale_void"
            ON "sale_void"."sale_id" = "sale"."id"
          WHERE (${startDate}::timestamptz IS NULL OR "sale"."created_at" >= ${startDate}::timestamptz)
            AND (${endDate}::timestamptz IS NULL OR "sale"."created_at" <= ${endDate}::timestamptz)
          GROUP BY COALESCE("sale"."checkout_group_id", "sale"."id")
        )
        SELECT COUNT(*) AS total_items
        FROM grouped
        WHERE (${!activeOnly} OR void_count = 0)
          AND (${!voidedOnly} OR void_count = row_count)
      `,
      this.prisma.$queryRaw<SaleGroupPageRow[]>`
        WITH grouped AS (
          SELECT COALESCE("sale"."checkout_group_id", "sale"."id") AS group_id,
                 MIN("sale"."created_at") AS created_at,
                 ARRAY_AGG(
                   "sale"."id"
                   ORDER BY ("sale"."id" = "sale"."checkout_group_id") DESC, "sale"."id"
                 ) AS sale_ids,
                 BOOL_OR("sale"."checkout_group_id" IS NOT NULL) AS has_checkout_group,
                 COUNT(*) AS row_count,
                 COUNT("sale_void"."sale_id") AS void_count
          FROM "fish_sales" AS "sale"
          LEFT JOIN "fish_sale_voids" AS "sale_void"
            ON "sale_void"."sale_id" = "sale"."id"
          WHERE (${startDate}::timestamptz IS NULL OR "sale"."created_at" >= ${startDate}::timestamptz)
            AND (${endDate}::timestamptz IS NULL OR "sale"."created_at" <= ${endDate}::timestamptz)
          GROUP BY COALESCE("sale"."checkout_group_id", "sale"."id")
        )
        SELECT group_id, created_at, sale_ids, has_checkout_group,
               COUNT(*) OVER() AS total_items
        FROM grouped
        WHERE (${!activeOnly} OR void_count = 0)
          AND (${!voidedOnly} OR void_count = row_count)
        ORDER BY created_at DESC, group_id DESC
        OFFSET ${skip} LIMIT ${query.limit}
      `,
    ]);
    const saleIds = [...new Set(groups.flatMap((group) => group.sale_ids))];
    const sales =
      saleIds.length === 0
        ? []
        : await this.prisma.fishSale.findMany({
            where: { id: { in: saleIds } },
            include: saleInclude,
          });
    const salesById = new Map(sales.map((sale) => [sale.id, sale]));
    const items = groups.map((group) => {
      const members = group.sale_ids
        .map((saleId) => salesById.get(saleId))
        .filter((sale): sale is SaleWithRelations => sale !== undefined);
      return group.has_checkout_group
        ? this.mapGroupedSale(members, group.group_id)
        : this.mapSale(members[0]!);
    });
    const totalItems = Number(
      groups[0]?.total_items ?? countRows[0]?.total_items ?? 0n,
    );

    return {
      status: "success" as const,
      message: "Daftar penjualan berhasil dimuat.",
      data: {
        items,
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
    const [group] = await this.prisma.$queryRaw<
      Array<{ checkout_group_id: string | null }>
    >`
      SELECT "checkout_group_id" FROM "fish_sales" WHERE "id" = ${saleId}::uuid
    `;
    const data = group?.checkout_group_id
      ? this.mapGroupedSale(
          await this.loadCheckoutGroupSales(group.checkout_group_id),
          group.checkout_group_id,
        )
      : this.mapSale(sale);
    return {
      status: "success" as const,
      message: "Detail penjualan berhasil dimuat.",
      data,
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
    const [group] = await this.prisma.$queryRaw<
      Array<{ checkout_group_id: string | null }>
    >`
      SELECT "checkout_group_id" FROM "fish_sales" WHERE "id" = ${saleId}::uuid
    `;
    const sales = group?.checkout_group_id
      ? await this.loadCheckoutGroupSales(group.checkout_group_id)
      : [sale];
    const primarySale =
      sales.find((item) => item.id === group?.checkout_group_id) ?? sales[0]!;
    if (sales.some((item) => item.createdBy !== actor.id)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        "FORBIDDEN",
        "Cetak ulang hanya diizinkan untuk pembuat transaksi.",
      );
    }
    if (sales.some((item) => item.void)) {
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
        ...this.mapReceipt({
          createdAt: primarySale.createdAt,
          batchSpeciesName: nameWithVariant(
            primarySale.batch?.species.speciesName ?? null,
            primarySale.product?.variantLabel ?? null,
          ),
          batchFishSize: primarySale.batch?.incomingFish?.fishSize ?? null,
          productName: nameWithVariant(
            primarySale.product?.name ?? null,
            primarySale.product?.variantLabel ?? null,
          ),
          productSku: primarySale.product?.sku ?? null,
          productUnit: primarySale.product?.unit ?? null,
          quantity: sales.reduce(
            (total, item) => total.plus(item.quantity),
            new Prisma.Decimal(0),
          ),
          unitPrice: primarySale.unitPrice,
          totalPrice: sales.reduce(
            (total, item) => total.plus(item.totalPrice),
            new Prisma.Decimal(0),
          ),
          paymentMethod: primarySale.paymentMethod,
          cashierName: primarySale.creator.name,
        }),
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
              checkout_group_id: string | null;
            }>
          >`
            SELECT "id", "batch_id", "product_id", "checkout_group_id"
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

          if (saleReference.checkout_group_id) {
            const response = await this.voidCheckoutGroup(
              transaction,
              saleReference.checkout_group_id,
              actor,
              request,
            );
            await transaction.$executeRaw`
              UPDATE "idempotency_keys"
              SET "status" = 'completed', "response_status" = 200,
                  "response_body" = ${JSON.stringify(response)}::jsonb,
                  "completed_at" = CURRENT_TIMESTAMP
              WHERE "id" = ${idempotencyRow.id}::uuid
            `;
            return response;
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

  private async voidCheckoutGroup(
    transaction: Prisma.TransactionClient,
    checkoutGroupId: string,
    actor: AuthenticatedUser,
    request: RequestWithId,
  ): Promise<CachedResponse> {
    const sales = await transaction.$queryRaw<
      Array<{ id: string; batch_id: string | null; product_id: string | null }>
    >`
      SELECT "id", "batch_id", "product_id"
      FROM "fish_sales"
      WHERE "checkout_group_id" = ${checkoutGroupId}::uuid
      ORDER BY "batch_id", "id"
    `;
    if (sales.length === 0) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "SALE_NOT_FOUND",
        "Transaksi penjualan tidak ditemukan.",
      );
    }

    const productIds = [
      ...new Set(
        sales
          .map((sale) => sale.product_id)
          .filter((productId): productId is string => productId !== null),
      ),
    ].sort();
    for (const productId of productIds) {
      const [lockedProduct] = await transaction.$queryRaw<
        Array<{ id: string }>
      >`
        SELECT "id" FROM "products" WHERE "id" = ${productId}::uuid FOR UPDATE
      `;
      if (!lockedProduct) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          "PRODUCT_NOT_FOUND",
          "Produk transaksi tidak ditemukan.",
        );
      }
    }

    const batchIds = [
      ...new Set(
        sales
          .map((sale) => sale.batch_id)
          .filter((batchId): batchId is string => batchId !== null),
      ),
    ].sort();
    const batches =
      batchIds.length === 0
        ? []
        : await transaction.$queryRaw<Array<{ id: string; status: string }>>(
            Prisma.sql`
              SELECT "id", "status" FROM "batches"
              WHERE "id" IN (${Prisma.join(
                batchIds.map((batchId) => Prisma.sql`${batchId}::uuid`),
              )})
              ORDER BY "id"
              FOR UPDATE
            `,
          );
    if (batches.length !== batchIds.length) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "BATCH_NOT_FOUND",
        "Satu atau lebih batch transaksi tidak ditemukan.",
      );
    }
    if (batches.some((batch) => batch.status === "voided")) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "BATCH_NOT_ACTIVE",
        "Penjualan dari batch yang telah di-VOID tidak dapat dibatalkan.",
      );
    }

    for (const sale of sales) {
      const [lockedSale] = await transaction.$queryRaw<
        Array<{ sale_id: string; batch_id: string | null }>
      >`
        SELECT "sale_id", "batch_id"
        FROM "lock_fish_sale_for_update"(${sale.id}::uuid)
      `;
      if (!lockedSale) {
        throw new ApiException(
          HttpStatus.NOT_FOUND,
          "SALE_NOT_FOUND",
          "Satu atau lebih baris penjualan tidak ditemukan.",
        );
      }
    }

    const existingVoids = await transaction.$queryRaw<
      Array<{ sale_id: string }>
    >(Prisma.sql`
      SELECT "sale_id" FROM "fish_sale_voids"
      WHERE "sale_id" IN (${Prisma.join(
        sales.map((sale) => Prisma.sql`${sale.id}::uuid`),
      )})
    `);
    if (existingVoids.length > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        "SALE_ALREADY_VOIDED",
        "Transaksi penjualan sudah di-VOID.",
      );
    }

    const voidedRows: Array<{ saleId: string; voidedAt: Date }> = [];
    for (const sale of sales) {
      const voided = await transaction.fishSaleVoid.create({
        data: { saleId: sale.id, voidedBy: actor.id },
      });
      voidedRows.push({ saleId: sale.id, voidedAt: voided.voidedAt });
      await transaction.auditLog.create({
        data: {
          requestId: request.requestId,
          actorId: actor.id,
          action: "VOID_SALE",
          entityType: "fish_sales",
          entityId: sale.id,
          ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
        },
      });
    }

    const updatedBatches =
      batchIds.length === 0
        ? []
        : await transaction.$queryRaw<Array<{ id: string; status: string }>>(
            Prisma.sql`
              SELECT "id", "status" FROM "batches"
              WHERE "id" IN (${Prisma.join(
                batchIds.map((batchId) => Prisma.sql`${batchId}::uuid`),
              )})
              ORDER BY "id"
            `,
          );
    const response: CachedResponse = {
      status: "success",
      message: "Transaksi penjualan berhasil di-VOID.",
      data: {
        sale_id: checkoutGroupId,
        checkout_group_id: checkoutGroupId,
        voided_sale_ids: sales.map((sale) => sale.id),
        status: "voided",
        voided_at:
          voidedRows
            .find((row) => row.saleId === checkoutGroupId)
            ?.voidedAt.toISOString() ?? voidedRows[0]!.voidedAt.toISOString(),
        voided_by: actor.id,
        batch_statuses: updatedBatches,
      },
    };
    return response;
  }

  private mapReceipt(input: {
    createdAt: Date;
    batchSpeciesName: string | null;
    batchFishSize: string | null;
    productName: string | null;
    productSku: string | null;
    productUnit: string | null;
    quantity: Prisma.Decimal | number;
    unitPrice: Prisma.Decimal | number;
    totalPrice: Prisma.Decimal | number;
    paymentMethod: string;
    cashierName: string;
  }) {
    return {
      company_name: companyName,
      transaction_date_time: formatReceiptDateTime(input.createdAt),
      species_name: input.batchSpeciesName ?? input.productName ?? "",
      fish_size: input.batchFishSize ?? input.productSku ?? "",
      quantity: Number(input.quantity),
      unit: input.productUnit ?? "",
      unit_price: Number(input.unitPrice),
      total_payment: Number(input.totalPrice),
      payment_method: input.paymentMethod,
      cashier_name: input.cashierName,
    };
  }

  private async loadCheckoutGroupSales(
    checkoutGroupId: string,
  ): Promise<SaleWithRelations[]> {
    const members = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "fish_sales"
      WHERE "checkout_group_id" = ${checkoutGroupId}::uuid
      ORDER BY "id"
    `;
    if (members.length === 0) return [];
    return this.prisma.fishSale.findMany({
      where: { id: { in: members.map((member) => member.id) } },
      include: saleInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  private mapGroupedSale(sales: SaleWithRelations[], checkoutGroupId: string) {
    const primary =
      sales.find((sale) => sale.id === checkoutGroupId) ?? sales[0];
    if (!primary) {
      throw new Error("Checkout group has no sale rows.");
    }
    const quantity = sales.reduce(
      (total, sale) => total.plus(sale.quantity),
      new Prisma.Decimal(0),
    );
    const totalPrice = sales.reduce(
      (total, sale) => total.plus(sale.totalPrice),
      new Prisma.Decimal(0),
    );
    const cashReceived = sales.some((sale) => sale.cashReceived === null)
      ? null
      : sales.reduce(
          (total, sale) => total.plus(sale.cashReceived!),
          new Prisma.Decimal(0),
        );
    const changeAmount = sales.some((sale) => sale.changeAmount === null)
      ? null
      : sales.reduce(
          (total, sale) => total.plus(sale.changeAmount!),
          new Prisma.Decimal(0),
        );
    return {
      ...this.mapSale(primary, false),
      id: checkoutGroupId,
      checkout_group_id: checkoutGroupId,
      batch_id: null,
      batch_allocations: sales.map((sale) => ({
        batch_id: sale.batchId,
        quantity: sale.quantity.toNumber(),
      })),
      product_name: nameWithVariant(
        primary.product?.name ?? null,
        primary.product?.variantLabel ?? null,
      ),
      species_name: nameWithVariant(
        primary.batch?.species.speciesName ?? primary.product?.name ?? null,
        primary.product?.variantLabel ?? null,
      ),
      quantity: quantity.toNumber(),
      total_price: totalPrice.toNumber(),
      total_amount: totalPrice.toNumber(),
      cash_received: cashReceived?.toNumber() ?? null,
      change_amount: changeAmount?.toNumber() ?? null,
      change_due: changeAmount?.toNumber() ?? null,
      status: sales.some((sale) => sale.void) ? "voided" : "active",
    };
  }

  private mapSale(sale: SaleWithRelations, includeBatchCode = true) {
    const batch = sale.batch;
    const product = sale.product;
    return {
      id: sale.id,
      sale_code: sale.saleCode,
      created_at: sale.createdAt.toISOString(),
      sold_at: sale.createdAt.toISOString(),
      batch_id: sale.batchId,
      ...(includeBatchCode ? { batch_code: batch?.batchCode ?? null } : {}),
      product_id: sale.productId,
      product_sku: product?.sku ?? null,
      product_name: nameWithVariant(
        product?.name ?? null,
        product?.variantLabel ?? null,
      ),
      variant_label: product?.variantLabel ?? null,
      tracking_mode: product?.trackingMode ?? "BATCH_TRACKED",
      species_id: batch?.species.id ?? null,
      species_code: batch?.species.speciesCode ?? null,
      species_name: nameWithVariant(
        batch?.species.speciesName ?? product?.name ?? null,
        product?.variantLabel ?? null,
      ),
      fish_size:
        batch?.incomingFish?.fishSize ??
        product?.sizeLabel ??
        product?.unit ??
        null,
      quantity: sale.quantity,
      unit_price: Number(sale.unitPrice),
      total_price: Number(sale.totalPrice),
      total_amount: Number(sale.totalPrice),
      total_payment: Number(sale.totalPrice),
      payment_method: sale.paymentMethod,
      cash_received:
        sale.cashReceived === null ? null : Number(sale.cashReceived),
      change_amount:
        sale.changeAmount === null ? null : Number(sale.changeAmount),
      created_by: { id: sale.creator.id, name: sale.creator.name },
      cashier_name: sale.creator.name,
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
