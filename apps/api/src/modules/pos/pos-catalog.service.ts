import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateProductCategoryInput,
  CreateProductInput,
  ProductCatalogListQuery,
  PosPricesListQuery,
  UpdateProductCategoryInput,
  UpdateSalePriceInput,
  UpdateProductInput,
  CreateSalePriceInput,
} from "@pfi/shared";
import type { AuthenticatedUser } from "../../common/auth/jwt-auth.guard";
import { ApiException } from "../../common/http/api-exception";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { loadApiEnvironment } from "../../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { hashBusinessPayload, isUuidV4 } from "../receiving/idempotency";

type CachedResponse = {
  status: "success";
  message: string;
  data: unknown;
};

type Mutation = (transaction: Prisma.TransactionClient) => Promise<unknown>;

type CatalogBatchRow = {
  batch_id: string;
  batch_code: string;
  species_name: string;
  fish_size: string;
  current_stock: bigint;
  sale_readiness: string;
};

const productInclude = { category: true } satisfies Prisma.ProductInclude;
type ProductWithCategory = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

class ExistingCatalogIdempotencyKeyError extends Error {}

function normalizeCatalogMatchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*-\s*/g, "-");
}

function legacyFishProductSku(speciesCode: string, fishSize: string): string {
  const sizeCode = fishSize.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  return `FISH-${speciesCode.toUpperCase()}-${sizeCode}`;
}

@Injectable()
export class PosCatalogService {
  private readonly lockTimeout: string;
  private readonly transactionTimeout: number;

  constructor(private readonly prisma: PrismaService) {
    const lockTimeoutMs = loadApiEnvironment().DB_LOCK_TIMEOUT_MS;
    this.lockTimeout = `${lockTimeoutMs}ms`;
    this.transactionTimeout = lockTimeoutMs + 5_000;
  }

  async listCategories(query: ProductCatalogListQuery, requestId: string) {
    const skip = (query.page - 1) * query.limit;
    const [totalItems, categories] = await this.prisma.$transaction([
      this.prisma.productCategory.count(),
      this.prisma.productCategory.findMany({
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    ]);

    return {
      status: "success" as const,
      message: "Daftar kategori berhasil dimuat.",
      data: {
        items: categories.map((category) => this.mapCategory(category)),
        pagination: this.pagination(query, totalItems),
      },
      meta: { request_id: requestId },
    };
  }

  async listLegacyPrices(query: PosPricesListQuery, requestId: string) {
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
      ...new Set(products.flatMap((product) => product.species ?? [])),
    ];
    const speciesRows = await this.prisma.fishSpecies.findMany({
      where: { speciesName: { in: speciesNames } },
      select: { id: true, speciesCode: true, speciesName: true },
    });
    const speciesByName = new Map(
      speciesRows.map((species) => [species.speciesName, species]),
    );

    return {
      status: "success" as const,
      message: "Daftar harga berhasil dimuat.",
      data: {
        items: products.map((product) =>
          this.mapLegacyPrice(
            product,
            product.species
              ? (speciesByName.get(product.species) ?? null)
              : null,
            null,
          ),
        ),
        pagination: this.pagination(query, totalItems),
      },
      meta: { request_id: requestId },
    };
  }

  async createLegacyPrice(
    actor: AuthenticatedUser,
    input: CreateSalePriceInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    this.assertPriceInRange(input.price_per_fish, "BATCH_TRACKED");
    const species = await this.prisma.fishSpecies.findUnique({
      where: { id: input.species_id },
      select: {
        id: true,
        speciesCode: true,
        speciesName: true,
        isActive: true,
      },
    });
    if (!species?.isActive) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "INVALID_PAYLOAD",
        "Spesies aktif tidak ditemukan.",
      );
    }
    const category = await this.prisma.productCategory.findUnique({
      where: { code: "BENIH-IKAN" },
    });
    if (!category?.isActive || !category.requiresBatch) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "CATEGORY_NOT_FOUND",
        "Kategori Benih Ikan tidak aktif.",
      );
    }

    return this.mutate(
      actor,
      idempotencyKey,
      "/api/v1/pos/prices",
      input,
      request,
      201,
      "Harga jual berhasil ditambahkan.",
      "PRICE_ALREADY_EXISTS",
      "Harga untuk kombinasi spesies dan ukuran ini sudah tersedia.",
      async (transaction) => {
        const existing = await transaction.product.findFirst({
          where: {
            trackingMode: "BATCH_TRACKED",
            isActive: true,
            species: species.speciesName,
            sizeLabel: input.fish_size,
          },
          include: productInclude,
        });
        if (existing) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            "PRICE_ALREADY_EXISTS",
            "Harga untuk kombinasi spesies dan ukuran ini sudah tersedia.",
          );
        }
        const product = await transaction.product.create({
          data: {
            categoryId: category.id,
            sku: legacyFishProductSku(species.speciesCode, input.fish_size),
            name: `${species.speciesName} ${input.fish_size}`,
            trackingMode: "BATCH_TRACKED",
            species: species.speciesName,
            sizeLabel: input.fish_size,
            unit: "EKOR",
            unitPrice: new Prisma.Decimal(input.price_per_fish.toString()),
            stockQuantity: null,
          },
          include: productInclude,
        });
        await transaction.auditLog.create({
          data: {
            requestId: request.requestId,
            actorId: actor.id,
            action: "CREATE_SALE_PRICE",
            entityType: "products",
            entityId: product.id,
            ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
          },
        });
        return this.mapLegacyPrice(product, species, actor);
      },
    );
  }

  async updateLegacyPrice(
    priceId: string,
    actor: AuthenticatedUser,
    input: UpdateSalePriceInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    this.assertPriceInRange(input.price_per_fish, "BATCH_TRACKED");
    const endpoint = `/api/v1/pos/prices/${priceId}`;
    return this.mutate(
      actor,
      idempotencyKey,
      endpoint,
      { price_id: priceId, ...input },
      request,
      200,
      "Harga jual berhasil diperbarui.",
      "PRICE_ALREADY_EXISTS",
      "Harga untuk kombinasi spesies dan ukuran ini sudah tersedia.",
      async (transaction) => {
        let product = await transaction.product.findUnique({
          where: { id: priceId },
          include: productInclude,
        });
        if (!product) {
          const legacyPrice = await transaction.fishSalePrice.findUnique({
            where: { id: priceId },
            include: { species: true },
          });
          if (legacyPrice) {
            product = await transaction.product.findFirst({
              where: {
                trackingMode: "BATCH_TRACKED",
                species: legacyPrice.species.speciesName,
                sizeLabel: legacyPrice.fishSize,
              },
              include: productInclude,
            });
          }
        }
        if (
          !product ||
          !product.isActive ||
          product.trackingMode !== "BATCH_TRACKED"
        ) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            "PRICE_NOT_FOUND",
            "Produk harga ikan tidak ditemukan.",
          );
        }

        const [locked] = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "products" WHERE "id" = ${product.id}::uuid FOR UPDATE
        `;
        if (!locked) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            "PRICE_NOT_FOUND",
            "Produk harga ikan tidak ditemukan.",
          );
        }
        const updated = await transaction.product.update({
          where: { id: product.id },
          data: {
            unitPrice: new Prisma.Decimal(input.price_per_fish.toString()),
          },
          include: productInclude,
        });
        const species = updated.species
          ? await transaction.fishSpecies.findFirst({
              where: { speciesName: updated.species },
              select: { id: true, speciesCode: true, speciesName: true },
            })
          : null;
        await transaction.auditLog.create({
          data: {
            requestId: request.requestId,
            actorId: actor.id,
            action: "UPDATE_SALE_PRICE",
            entityType: "products",
            entityId: updated.id,
            ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
          },
        });
        return this.mapLegacyPrice(updated, species, actor);
      },
    );
  }

  async createCategory(
    actor: AuthenticatedUser,
    input: CreateProductCategoryInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    return this.mutate(
      actor,
      idempotencyKey,
      "/api/v1/pos/categories",
      input,
      request,
      201,
      "Kategori berhasil dibuat.",
      "CATEGORY_ALREADY_EXISTS",
      "Nama atau kode kategori sudah digunakan.",
      async (transaction) => {
        const category = await transaction.productCategory.create({
          data: {
            name: input.name,
            code: input.code,
            requiresBatch: input.requires_batch,
            isActive: input.is_active ?? true,
          },
        });
        await this.recordAudit(
          transaction,
          actor,
          request,
          "CREATE_PRODUCT_CATEGORY",
          "product_categories",
          category.id,
          null,
          this.mapCategory(category),
        );
        return this.mapCategory(category);
      },
    );
  }

  async updateCategory(
    categoryId: string,
    actor: AuthenticatedUser,
    input: UpdateProductCategoryInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    const endpoint = `/api/v1/pos/categories/${categoryId}`;
    return this.mutate(
      actor,
      idempotencyKey,
      endpoint,
      { category_id: categoryId, ...input },
      request,
      200,
      input.is_active === false
        ? "Kategori berhasil diarsipkan."
        : "Kategori berhasil diperbarui.",
      "CATEGORY_ALREADY_EXISTS",
      "Nama atau kode kategori sudah digunakan.",
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "product_categories"
          WHERE "id" = ${categoryId}::uuid
          FOR UPDATE
        `;
        const current = await transaction.productCategory.findUnique({
          where: { id: categoryId },
        });
        if (!current) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            "CATEGORY_NOT_FOUND",
            "Kategori tidak ditemukan.",
          );
        }

        const nextRequiresBatch = input.requires_batch ?? current.requiresBatch;
        if (nextRequiresBatch !== current.requiresBatch) {
          const incompatibleProducts = await transaction.product.count({
            where: {
              categoryId,
              trackingMode: nextRequiresBatch ? "NON_BATCH" : "BATCH_TRACKED",
            },
          });
          if (incompatibleProducts > 0) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              "CATEGORY_TRACKING_MODE_MISMATCH",
              "Mode kategori tidak dapat diubah selama masih ada produk dengan mode yang berbeda.",
            );
          }
        }

        const updated = await transaction.productCategory.update({
          where: { id: categoryId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.requires_batch !== undefined
              ? { requiresBatch: input.requires_batch }
              : {}),
            ...(input.is_active !== undefined
              ? { isActive: input.is_active }
              : {}),
          },
        });
        await this.recordAudit(
          transaction,
          actor,
          request,
          input.is_active === false
            ? "ARCHIVE_PRODUCT_CATEGORY"
            : "UPDATE_PRODUCT_CATEGORY",
          "product_categories",
          categoryId,
          this.mapCategory(current),
          this.mapCategory(updated),
        );
        return this.mapCategory(updated);
      },
    );
  }

  async listProducts(query: ProductCatalogListQuery, requestId: string) {
    const skip = (query.page - 1) * query.limit;
    const [totalItems, products] = await this.prisma.$transaction([
      this.prisma.product.count(),
      this.prisma.product.findMany({
        skip,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: productInclude,
      }),
    ]);

    return {
      status: "success" as const,
      message: "Daftar produk berhasil dimuat.",
      data: {
        items: products.map((product) => this.mapProduct(product)),
        pagination: this.pagination(query, totalItems),
      },
      meta: { request_id: requestId },
    };
  }

  async createProduct(
    actor: AuthenticatedUser,
    input: CreateProductInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    this.assertPriceInRange(input.unit_price, input.tracking_mode);
    return this.mutate(
      actor,
      idempotencyKey,
      "/api/v1/pos/products",
      input,
      request,
      201,
      "Produk berhasil dibuat.",
      "PRODUCT_ALREADY_EXISTS",
      "SKU atau produk aktif dengan spesies dan ukuran ini sudah digunakan.",
      async (transaction) => {
        const category = await transaction.productCategory.findUnique({
          where: { id: input.category_id },
        });
        if (!category || !category.isActive) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "CATEGORY_NOT_FOUND",
            "Kategori aktif tidak ditemukan.",
          );
        }
        this.assertProductMode(input, category.requiresBatch);
        const product = await transaction.product.create({
          data: this.productCreateData(input),
          include: productInclude,
        });
        await this.recordAudit(
          transaction,
          actor,
          request,
          "CREATE_PRODUCT",
          "products",
          product.id,
          null,
          this.mapProduct(product),
        );
        return this.mapProduct(product);
      },
    );
  }

  async updateProduct(
    productId: string,
    actor: AuthenticatedUser,
    input: UpdateProductInput,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    const endpoint = `/api/v1/pos/products/${productId}`;
    return this.mutate(
      actor,
      idempotencyKey,
      endpoint,
      { product_id: productId, ...input },
      request,
      200,
      input.is_active === false
        ? "Produk berhasil diarsipkan."
        : "Produk berhasil diperbarui.",
      "PRODUCT_ALREADY_EXISTS",
      "SKU atau produk aktif dengan spesies dan ukuran ini sudah digunakan.",
      async (transaction) => {
        const [locked] = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "products" WHERE "id" = ${productId}::uuid FOR UPDATE
        `;
        if (!locked) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            "PRODUCT_NOT_FOUND",
            "Produk tidak ditemukan.",
          );
        }
        const current = await transaction.product.findUnique({
          where: { id: productId },
          include: productInclude,
        });
        if (!current) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            "PRODUCT_NOT_FOUND",
            "Produk tidak ditemukan.",
          );
        }

        const categoryId = input.category_id ?? current.categoryId;
        const category = await transaction.productCategory.findUnique({
          where: { id: categoryId },
        });
        if (!category || !category.isActive) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "CATEGORY_NOT_FOUND",
            "Kategori aktif tidak ditemukan.",
          );
        }
        const merged = this.mergeProduct(current, input);
        this.assertPriceInRange(merged.unit_price, merged.tracking_mode);
        this.assertProductMode(merged, category.requiresBatch);
        const updated = await transaction.product.update({
          where: { id: productId },
          data: this.productCreateData(
            merged,
            input.variant_label !== undefined,
          ),
          include: productInclude,
        });
        await this.recordAudit(
          transaction,
          actor,
          request,
          input.is_active === false ? "ARCHIVE_PRODUCT" : "UPDATE_PRODUCT",
          "products",
          productId,
          this.mapProduct(current),
          this.mapProduct(updated),
        );
        return this.mapProduct(updated);
      },
    );
  }

  async archiveProduct(
    productId: string,
    actor: AuthenticatedUser,
    idempotencyKey: string | undefined,
    request: RequestWithId,
  ) {
    const endpoint = `/api/v1/pos/products/${productId}`;
    return this.mutate(
      actor,
      idempotencyKey,
      endpoint,
      { product_id: productId, is_active: false },
      request,
      200,
      "Produk berhasil diarsipkan.",
      "PRODUCT_ALREADY_EXISTS",
      "Produk tidak dapat diarsipkan.",
      async (transaction) => {
        const product = await transaction.product.findUnique({
          where: { id: productId },
          include: productInclude,
        });
        if (!product) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            "PRODUCT_NOT_FOUND",
            "Produk tidak ditemukan.",
          );
        }
        const updated = await transaction.product.update({
          where: { id: productId },
          data: { isActive: false },
          include: productInclude,
        });
        await this.recordAudit(
          transaction,
          actor,
          request,
          "ARCHIVE_PRODUCT",
          "products",
          productId,
          this.mapProduct(product),
          this.mapProduct(updated),
        );
        return this.mapProduct(updated);
      },
    );
  }

  async getSellableCatalog(requestId: string) {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, category: { isActive: true } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      include: productInclude,
    });
    const batchRows = await this.prisma.$queryRaw<CatalogBatchRow[]>`
      SELECT
        "batch"."id" AS batch_id,
        "batch"."batch_code" AS batch_code,
        "batch"."sale_readiness" AS sale_readiness,
        "species"."species_name" AS species_name,
        "receipt"."fish_size" AS fish_size,
        "calculate_batch_stock"("batch"."id") AS current_stock
      FROM "batches" AS "batch"
      INNER JOIN "fish_species" AS "species"
        ON "species"."id" = "batch"."species_id"
      INNER JOIN "incoming_fish" AS "receipt"
        ON "receipt"."batch_id" = "batch"."id"
      WHERE "batch"."status" = 'active'
        AND "batch"."sale_readiness" = 'SIAP_JUAL'
        AND "calculate_batch_stock"("batch"."id") > 0
      ORDER BY "batch"."created_at" DESC, "batch"."id" DESC
    `;
    const items = products.map((product) => {
      if (product.trackingMode === "BATCH_TRACKED") {
        const normalizedSpecies = product.species
          ? normalizeCatalogMatchValue(product.species)
          : null;
        const normalizedSize = product.sizeLabel
          ? normalizeCatalogMatchValue(product.sizeLabel)
          : null;
        const readyBatches =
          normalizedSpecies && normalizedSize
            ? batchRows.filter(
                (batch) =>
                  normalizeCatalogMatchValue(batch.species_name) ===
                    normalizedSpecies &&
                  normalizeCatalogMatchValue(batch.fish_size) ===
                    normalizedSize,
              )
            : [];
        const availableStock = readyBatches.reduce(
          (total, batch) => total + Number(batch.current_stock),
          0,
        );
        return {
          ...this.mapProduct(product),
          available_stock: availableStock,
          stock_quantity: availableStock,
          batches: readyBatches.map((batch) => ({
            id: batch.batch_id,
            batch_id: batch.batch_id,
            batch_code: batch.batch_code,
            current_stock: Number(batch.current_stock),
            remaining_stock: Number(batch.current_stock),
            sale_readiness: batch.sale_readiness,
            species_name: batch.species_name,
            size_label: batch.fish_size,
          })),
        };
      }
      const stock = product.stockQuantity?.toNumber() ?? 0;
      return {
        ...this.mapProduct(product),
        available_stock: stock,
        stock_quantity: stock,
        batches: [],
      };
    });

    return {
      status: "success" as const,
      message: "Katalog siap jual berhasil dimuat.",
      data: { items },
      meta: { request_id: requestId },
    };
  }

  private async mutate(
    actor: AuthenticatedUser,
    idempotencyKey: string | undefined,
    endpoint: string,
    payload: unknown,
    request: RequestWithId,
    responseStatus: number,
    message: string,
    conflictCode: string,
    conflictMessage: string,
    operation: Mutation,
  ) {
    if (!isUuidV4(idempotencyKey)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_IDEMPOTENCY_KEY",
        "Header Idempotency-Key harus berupa UUIDv4.",
      );
    }
    const payloadHash = hashBusinessPayload(payload);
    try {
      const response = await this.prisma.$transaction(
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
          if (!idempotencyRow) throw new ExistingCatalogIdempotencyKeyError();

          const data = await operation(transaction);
          const body: CachedResponse = { status: "success", message, data };
          await transaction.$executeRaw`
            UPDATE "idempotency_keys"
            SET "status" = 'completed', "response_status" = ${responseStatus},
                "response_body" = ${JSON.stringify(body)}::jsonb,
                "completed_at" = CURRENT_TIMESTAMP
            WHERE "id" = ${idempotencyRow.id}::uuid
          `;
          return body;
        },
        { timeout: this.transactionTimeout },
      );
      return {
        ...response,
        meta: { idempotency_status: "executed", request_id: request.requestId },
      };
    } catch (error) {
      if (error instanceof ExistingCatalogIdempotencyKeyError) {
        return this.loadCachedResponse(
          actor.id,
          idempotencyKey,
          payloadHash,
          endpoint,
          request.requestId,
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" ||
          (error.code === "P2010" && error.meta?.code === "23505"))
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          conflictCode,
          conflictMessage,
        );
      }
      throw error;
    }
  }

  private async loadCachedResponse(
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

  private async recordAudit(
    transaction: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    request: RequestWithId,
    action: string,
    entityType: string,
    entityId: string,
    oldValues: Prisma.InputJsonValue | null,
    newValues: Prisma.InputJsonValue | null,
  ) {
    await transaction.auditLog.create({
      data: {
        requestId: request.requestId,
        actorId: actor.id,
        action,
        entityType,
        entityId,
        oldValues: oldValues ?? Prisma.JsonNull,
        newValues: newValues ?? Prisma.JsonNull,
        ipAddress: request.socket.remoteAddress?.slice(0, 45) ?? null,
      },
    });
  }

  private assertProductMode(
    product: {
      tracking_mode: "BATCH_TRACKED" | "NON_BATCH";
      species: string | null;
      size_label: string | null;
      stock_quantity: number | null;
    },
    categoryRequiresBatch: boolean,
  ) {
    if (product.tracking_mode === "BATCH_TRACKED") {
      if (
        !categoryRequiresBatch ||
        !product.species?.trim() ||
        !product.size_label?.trim() ||
        product.stock_quantity !== null
      ) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "CATEGORY_TRACKING_MODE_MISMATCH",
          "Produk BATCH_TRACKED memerlukan kategori batch, spesies, ukuran, dan stock_quantity null.",
        );
      }
      return;
    }
    if (
      categoryRequiresBatch ||
      product.species !== null ||
      product.size_label !== null ||
      product.stock_quantity === null ||
      product.stock_quantity < 0
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "CATEGORY_TRACKING_MODE_MISMATCH",
        "Produk NON_BATCH memerlukan kategori non-batch, species/size null, dan stok tidak negatif.",
      );
    }
  }

  private assertPriceInRange(
    price: number,
    trackingMode: "BATCH_TRACKED" | "NON_BATCH",
  ): void {
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      price > 10_000_000 ||
      Math.abs(price * 100 - Math.round(price * 100)) >= 1e-8 ||
      (trackingMode === "BATCH_TRACKED" && !Number.isInteger(price))
    ) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "PRICE_OUT_OF_RANGE",
        trackingMode === "BATCH_TRACKED"
          ? "Harga BATCH_TRACKED harus bilangan bulat lebih dari Rp0 dan paling banyak Rp10.000.000."
          : "Harga NON_BATCH harus lebih dari Rp0,00 dan paling banyak Rp10.000.000,00 dengan maksimal dua desimal.",
      );
    }
  }

  private productCreateData(
    input: CreateProductInput,
    includeVariantLabel = true,
  ) {
    return {
      categoryId: input.category_id,
      sku: input.sku,
      name: input.name,
      trackingMode: input.tracking_mode,
      species: input.species,
      sizeLabel: input.size_label,
      ...(includeVariantLabel
        ? { variantLabel: input.variant_label?.trim() || null }
        : {}),
      unit: input.unit,
      unitPrice: new Prisma.Decimal(input.unit_price.toString()),
      stockQuantity:
        input.stock_quantity === null
          ? null
          : new Prisma.Decimal(input.stock_quantity.toString()),
      ...(input.is_active !== undefined ? { isActive: input.is_active } : {}),
    };
  }

  private mergeProduct(
    current: ProductWithCategory,
    input: UpdateProductInput,
  ): CreateProductInput {
    return {
      category_id: input.category_id ?? current.categoryId,
      sku: input.sku ?? current.sku,
      name: input.name ?? current.name,
      tracking_mode: input.tracking_mode ?? current.trackingMode,
      species: input.species === undefined ? current.species : input.species,
      size_label:
        input.size_label === undefined ? current.sizeLabel : input.size_label,
      variant_label:
        input.variant_label === undefined
          ? current.variantLabel
          : input.variant_label,
      unit: input.unit ?? current.unit,
      unit_price: input.unit_price ?? current.unitPrice.toNumber(),
      stock_quantity:
        input.stock_quantity === undefined
          ? (current.stockQuantity?.toNumber() ?? null)
          : input.stock_quantity,
      is_active: input.is_active ?? current.isActive,
    };
  }

  private mapCategory(category: Prisma.ProductCategoryGetPayload<object>) {
    return {
      id: category.id,
      name: category.name,
      code: category.code,
      requires_batch: category.requiresBatch,
      is_active: category.isActive,
      created_at: category.createdAt.toISOString(),
      updated_at: category.updatedAt.toISOString(),
    };
  }

  private mapLegacyPrice(
    product: ProductWithCategory,
    species: { id: string; speciesCode: string; speciesName: string } | null,
    updater: { id: string; name: string } | null,
  ) {
    return {
      id: product.id,
      species_id: species?.id ?? null,
      species_code: species?.speciesCode ?? null,
      species_name: product.species,
      fish_size: product.sizeLabel,
      price_per_fish: product.unitPrice.toNumber(),
      created_at: product.createdAt.toISOString(),
      updated_at: product.updatedAt.toISOString(),
      updated_by: updater ? { id: updater.id, name: updater.name } : null,
    };
  }

  private mapProduct(product: ProductWithCategory) {
    return {
      id: product.id,
      category_id: product.categoryId,
      category_name: product.category.name,
      sku: product.sku,
      name: product.name,
      tracking_mode: product.trackingMode,
      species: product.species,
      size_label: product.sizeLabel,
      variant_label: product.variantLabel,
      unit: product.unit,
      unit_price: product.unitPrice.toNumber(),
      stock_quantity: product.stockQuantity?.toNumber() ?? null,
      is_active: product.isActive,
      created_at: product.createdAt.toISOString(),
      updated_at: product.updatedAt.toISOString(),
    };
  }

  private pagination(query: ProductCatalogListQuery, totalItems: number) {
    return {
      page: query.page,
      limit: query.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / query.limit),
    };
  }
}
