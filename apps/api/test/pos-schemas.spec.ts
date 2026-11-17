import {
  createSaleSchema,
  PAYMENT_METHODS,
  POS_ERROR_CODES,
  posSalesListQuerySchema,
  voidSaleSchema,
} from "@pfi/shared";

describe("POS shared sale contract", () => {
  const sale = {
    batch_id: "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1",
    quantity: 10,
    expected_unit_price: 2500,
  };

  it("exports the approved payment methods and create-sale errors", () => {
    expect(PAYMENT_METHODS).toEqual(["cash", "transfer"]);
    expect(POS_ERROR_CODES).toContain("PRICE_CHANGED");
    expect(POS_ERROR_CODES).toContain("INSUFFICIENT_STOCK");
  });

  it("accepts cash and confirmed transfer payloads", () => {
    expect(
      createSaleSchema.safeParse({
        ...sale,
        payment_method: "cash",
        cash_received: 30000,
      }).success,
    ).toBe(true);
    expect(
      createSaleSchema.safeParse({
        ...sale,
        payment_method: "transfer",
        transfer_confirmed: true,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid quantities, price ranges, payment confirmation, and extra fields", () => {
    expect(
      createSaleSchema.safeParse({
        ...sale,
        quantity: 0,
        payment_method: "cash",
        cash_received: 30000,
      }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({
        ...sale,
        expected_unit_price: 10_000_001,
        payment_method: "cash",
        cash_received: 30000,
      }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({
        ...sale,
        payment_method: "transfer",
        transfer_confirmed: false,
      }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({
        ...sale,
        payment_method: "cash",
        cash_received: 30000,
        total_amount: 25000,
      }).success,
    ).toBe(false);
  });

  it("validates approved sales pagination, dates, status, and empty VOID body", () => {
    expect(posSalesListQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(
      posSalesListQuerySchema.parse({
        page: "2",
        limit: "50",
        status: "voided",
        startDate: "2026-11-17T00:00:00.000Z",
      }),
    ).toMatchObject({ page: 2, limit: 50, status: "voided" });
    expect(posSalesListQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(
      posSalesListQuerySchema.safeParse({ status: "pending" }).success,
    ).toBe(false);
    expect(voidSaleSchema.safeParse({}).success).toBe(true);
    expect(voidSaleSchema.safeParse({ reason: "not allowed" }).success).toBe(
      false,
    );
  });
});
