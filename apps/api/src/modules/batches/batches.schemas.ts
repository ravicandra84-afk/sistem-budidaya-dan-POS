import { z } from "zod";

const saleReadinessValues = ["BELUM_SIAP", "SIAP_JUAL"] as const;

export const saleReadinessInputSchema = z
  .object({
    saleReadiness: z.enum(saleReadinessValues).optional(),
    sale_readiness: z.enum(saleReadinessValues).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.saleReadiness !== undefined) !==
      (input.sale_readiness !== undefined),
    { message: "Kirim tepat satu field saleReadiness atau sale_readiness." },
  )
  .transform((input) => ({
    sale_readiness: input.saleReadiness ?? input.sale_readiness!,
    ...(input.note !== undefined ? { note: input.note } : {}),
  }));

export type SaleReadinessInput = z.infer<typeof saleReadinessInputSchema>;
