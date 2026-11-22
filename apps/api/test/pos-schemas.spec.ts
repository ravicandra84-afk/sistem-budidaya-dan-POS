import {
  createSaleSchema,
  createSalePriceSchema,
  createProductCategorySchema,
  createProductSchema,
  PAYMENT_METHODS,
  POS_ERROR_CODES,
  posBatchesListQuerySchema,
  posPricesListQuerySchema,
  posSalesListQuerySchema,
  updateSalePriceSchema,
  updateProductSchema,
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

  it("accepts a product-based sale and two-decimal price while preserving batch-only payloads", () => {
    expect(
      createSaleSchema.safeParse({
        productId: sale.batch_id,
        batchId: sale.batch_id,
        quantity: 2,
        expectedUnitPrice: 1250.5,
        paymentMethod: "cash",
        cashReceived: 3000,
      }).success,
    ).toBe(true);
    expect(
      createSaleSchema.safeParse({
        product_id: sale.batch_id,
        quantity: 1,
        expected_unit_price: 2500.001,
        payment_method: "transfer",
        transfer_confirmed: true,
      }).success,
    ).toBe(false);
    expect(
      createSaleSchema.safeParse({
        quantity: 1,
        expected_unit_price: 2500,
        payment_method: "transfer",
        transfer_confirmed: true,
      }).success,
    ).toBe(false);
  });

  it("validates dynamic categories and product tracking fields", () => {
    expect(
      createProductCategorySchema.safeParse({
        name: "Benih Ikan",
        code: "BENIH-IKAN",
        requiresBatch: true,
      }).success,
    ).toBe(true);
    expect(
      createProductSchema.safeParse({
        categoryId: sale.batch_id,
        sku: "PCK-001",
        name: "Pakan Pelet",
        trackingMode: "NON_BATCH",
        species: null,
        sizeLabel: null,
        unit: "SAK",
        unitPrice: 1250.5,
        stockQuantity: 5,
      }).success,
    ).toBe(true);
    expect(
      updateProductSchema.safeParse({ unit_price: 10_000_000.01 }).success,
    ).toBe(false);
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

  it("validates price pagination and strict create/update payloads", () => {
    expect(posPricesListQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(
      posPricesListQuerySchema.safeParse({ startDate: "2026-11-20T00:00:00Z" })
        .success,
    ).toBe(false);
    expect(
      createSalePriceSchema.safeParse({
        species_id: sale.batch_id,
        fish_size: "3-5 cm",
        price_per_fish: 2500,
      }).success,
    ).toBe(true);
    expect(
      createSalePriceSchema.safeParse({
        species_id: sale.batch_id,
        fish_size: "3-5 cm",
        price_per_fish: 2500.5,
      }).success,
    ).toBe(false);
    expect(
      updateSalePriceSchema.safeParse({ price_per_fish: 2500 }).success,
    ).toBe(true);
    expect(
      updateSalePriceSchema.safeParse({
        price_per_fish: 2500,
        species_id: sale.batch_id,
      }).success,
    ).toBe(false);
    expect(POS_ERROR_CODES).toContain("PRICE_OUT_OF_RANGE");
  });

  it("validates POS batch pagination without transaction-date filters", () => {
    expect(posBatchesListQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
    });
    expect(
      posBatchesListQuerySchema.parse({ page: "2", limit: "100" }),
    ).toEqual({ page: 2, limit: 100 });
    expect(posBatchesListQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(
      posBatchesListQuerySchema.safeParse({
        startDate: "2026-11-20T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
