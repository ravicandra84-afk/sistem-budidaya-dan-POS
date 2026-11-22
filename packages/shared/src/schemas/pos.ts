import { z } from "zod";
import { FISH_SIZES } from "../domain/fish";
import {
  POS_SALE_STATUSES,
  PRODUCT_TRACKING_MODES,
  SALE_READINESS_VALUES,
} from "../domain/pos";
import { paginationQuerySchema } from "./pagination";

const money2 = (minimum: number, maximum: number) =>
  z
    .number()
    .finite()
    .min(minimum)
    .max(maximum)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8);

function normalizeAliases(
  value: unknown,
  aliases: Record<string, string>,
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const normalized = { ...value } as Record<string, unknown>;
  for (const [camelCase, snakeCase] of Object.entries(aliases)) {
    if (camelCase in normalized) {
      if (snakeCase in normalized) return value;
      normalized[snakeCase] = normalized[camelCase];
      delete normalized[camelCase];
    }
  }
  return normalized;
}

const saleBase = {
  batch_id: z.uuid().nullable().optional(),
  product_id: z.uuid().optional(),
  quantity: z.number().int().min(1).max(1_000_000),
  expected_unit_price: money2(0.01, 10_000_000),
};

const saleAliases = {
  batchId: "batch_id",
  productId: "product_id",
  expectedUnitPrice: "expected_unit_price",
  paymentMethod: "payment_method",
  cashReceived: "cash_received",
  transferConfirmed: "transfer_confirmed",
};

const createSaleBodySchema = z.discriminatedUnion("payment_method", [
  z
    .object({
      ...saleBase,
      payment_method: z.literal("cash"),
      cash_received: money2(0, 999_999_999_999.99),
    })
    .strict()
    .refine(
      (input) => input.product_id !== undefined || input.batch_id != null,
    ),
  z
    .object({
      ...saleBase,
      payment_method: z.literal("transfer"),
      transfer_confirmed: z.literal(true),
    })
    .strict()
    .refine(
      (input) => input.product_id !== undefined || input.batch_id != null,
    ),
]);

export const createSaleSchema = z.preprocess(
  (value) => normalizeAliases(value, saleAliases),
  createSaleBodySchema,
);

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const posSalesListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(POS_SALE_STATUSES).optional(),
});

export type PosSalesListQuery = z.infer<typeof posSalesListQuerySchema>;

export const posPricesListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type PosPricesListQuery = z.infer<typeof posPricesListQuerySchema>;

export const posBatchesListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type PosBatchesListQuery = z.infer<typeof posBatchesListQuerySchema>;

export const createSalePriceSchema = z
  .object({
    species_id: z.uuid(),
    fish_size: z.enum(FISH_SIZES),
    price_per_fish: z.number().int(),
  })
  .strict();

export type CreateSalePriceInput = z.infer<typeof createSalePriceSchema>;

export const updateSalePriceSchema = z
  .object({ price_per_fish: z.number().int() })
  .strict();

export type UpdateSalePriceInput = z.infer<typeof updateSalePriceSchema>;

const categoryFields = {
  name: z.string().trim().min(1).max(100).optional(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/)
    .optional(),
  requires_batch: z.boolean().optional(),
  is_active: z.boolean().optional(),
};

const categoryAliases = {
  requiresBatch: "requires_batch",
  isActive: "is_active",
};

export const createProductCategorySchema = z.preprocess(
  (value) => normalizeAliases(value, categoryAliases),
  z
    .object({
      name: z.string().trim().min(1).max(100),
      code: z
        .string()
        .trim()
        .min(1)
        .max(50)
        .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/),
      requires_batch: z.boolean(),
      is_active: z.boolean().optional(),
    })
    .strict(),
);
export type CreateProductCategoryInput = z.infer<
  typeof createProductCategorySchema
>;

export const updateProductCategorySchema = z.preprocess(
  (value) => normalizeAliases(value, categoryAliases),
  z
    .object(categoryFields)
    .strict()
    .refine((input) => Object.keys(input).length > 0),
);
export type UpdateProductCategoryInput = z.infer<
  typeof updateProductCategorySchema
>;

const productAliases = {
  categoryId: "category_id",
  trackingMode: "tracking_mode",
  sizeLabel: "size_label",
  unitPrice: "unit_price",
  stockQuantity: "stock_quantity",
  isActive: "is_active",
};

const productFields = {
  category_id: z.uuid(),
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  tracking_mode: z.enum(PRODUCT_TRACKING_MODES),
  species: z.string().trim().min(1).max(100).nullable(),
  size_label: z.string().trim().min(1).max(20).nullable(),
  unit: z.string().trim().min(1).max(20),
  unit_price: money2(0.01, 10_000_000),
  stock_quantity: money2(0, 999_999_999_999.99).nullable(),
  is_active: z.boolean().optional(),
};

export const createProductSchema = z.preprocess(
  (value) => normalizeAliases(value, productAliases),
  z.object(productFields).strict(),
);
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.preprocess(
  (value) => normalizeAliases(value, productAliases),
  z
    .object({
      category_id: productFields.category_id.optional(),
      sku: productFields.sku.optional(),
      name: productFields.name.optional(),
      tracking_mode: productFields.tracking_mode.optional(),
      species: productFields.species.optional(),
      size_label: productFields.size_label.optional(),
      unit: productFields.unit.optional(),
      unit_price: productFields.unit_price.optional(),
      stock_quantity: productFields.stock_quantity.optional(),
      is_active: productFields.is_active,
    })
    .strict()
    .refine((input) => Object.keys(input).length > 0),
);
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productCatalogListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ProductCatalogListQuery = z.infer<
  typeof productCatalogListQuerySchema
>;

export const saleReadinessValueSchema = z.enum(SALE_READINESS_VALUES);

export const voidSaleSchema = z.object({}).strict();
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;
