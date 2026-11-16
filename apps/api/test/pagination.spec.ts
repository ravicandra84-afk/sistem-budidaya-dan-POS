import { batchListQuerySchema, paginationQuerySchema } from "@pfi/shared";

describe("approved list query contract", () => {
  it("applies the approved defaults", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it("rejects limits above the approved maximum", () => {
    expect(paginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("accepts only official batch statuses", () => {
    expect(batchListQuerySchema.safeParse({ status: "active" }).success).toBe(
      true,
    );
    expect(batchListQuerySchema.safeParse({ status: "void" }).success).toBe(
      false,
    );
  });

  it("rejects an inverted date range", () => {
    expect(
      paginationQuerySchema.safeParse({
        startDate: "2026-11-16T00:00:00Z",
        endDate: "2026-11-15T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
