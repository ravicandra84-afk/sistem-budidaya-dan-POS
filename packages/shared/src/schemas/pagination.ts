import { z } from "zod";
import { BATCH_STATUSES } from "../domain/fish";

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    startDate: z.iso.datetime({ offset: true }).optional(),
    endDate: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    ({ startDate, endDate }) =>
      !startDate || !endDate || Date.parse(startDate) <= Date.parse(endDate),
    {
      path: ["endDate"],
      message: "endDate must be on or after startDate",
    },
  );

export const batchListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(BATCH_STATUSES).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type BatchListQuery = z.infer<typeof batchListQuerySchema>;
