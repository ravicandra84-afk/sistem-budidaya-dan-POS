import { z } from "zod";
import { FISH_SIZES } from "../domain/fish";

const decimalString = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/);

function cents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export const receiveFishSchema = z
  .object({
    species_id: z.uuid(),
    entry_date: z.iso.date(),
    quantity: z.number().int().min(1).max(1_000_000),
    purchase_capital: decimalString.refine(
      (value) => cents(value) <= 999_999_999_900n,
    ),
    shipping_capital: decimalString.refine(
      (value) => cents(value) <= 999_999_999_900n,
    ),
    weight_sample_per_500: decimalString
      .refine((value) => cents(value) >= 1n && cents(value) <= 10_000_000n)
      .nullish(),
    fish_size: z.enum(FISH_SIZES),
  })
  .strict();

export const voidIncomingFishSchema = z
  .object({ reason: z.string().trim().min(1) })
  .strict();

export type ReceiveFishInput = z.infer<typeof receiveFishSchema>;
export type VoidIncomingFishInput = z.infer<typeof voidIncomingFishSchema>;
