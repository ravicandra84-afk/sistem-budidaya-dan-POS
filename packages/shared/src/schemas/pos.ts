import { z } from "zod";
import { POS_SALE_STATUSES } from "../domain/pos";
import { paginationQuerySchema } from "./pagination";

const saleBase = {
  batch_id: z.uuid(),
  quantity: z.number().int().min(1).max(1_000_000),
  expected_unit_price: z.number().int().min(1).max(10_000_000),
};

export const createSaleSchema = z.discriminatedUnion("payment_method", [
  z
    .object({
      ...saleBase,
      payment_method: z.literal("cash"),
      cash_received: z.number().int().safe().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...saleBase,
      payment_method: z.literal("transfer"),
      transfer_confirmed: z.literal(true),
    })
    .strict(),
]);

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const posSalesListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(POS_SALE_STATUSES).optional(),
});

export type PosSalesListQuery = z.infer<typeof posSalesListQuerySchema>;

export const voidSaleSchema = z.object({}).strict();
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;