import {
  BATCH_STATUSES,
  FISH_SIZES,
  USER_ROLES,
  receiveFishSchema,
  voidIncomingFishSchema,
} from "@pfi/shared";

const validReceiving = {
  species_id: "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2",
  entry_date: "2026-11-17",
  quantity: 500,
  purchase_capital: "2500000.00",
  shipping_capital: "150000.00",
  fish_size: "3-5 cm",
};

describe("V4.5 shared domain constants", () => {
  it("exposes only the approved roles, batch statuses, and fish sizes", () => {
    expect(USER_ROLES).toEqual([
      "Owner",
      "Admin Operasional",
      "Kepala Budidaya",
    ]);
    expect(BATCH_STATUSES).toEqual(["active", "completed", "voided"]);
    expect(FISH_SIZES).toEqual([
      "2-4 cm",
      "3-5 cm",
      "4-6 cm",
      "5-7 cm",
      "6-8 cm",
      "7-9 cm",
      "8-10 cm",
      "9-11 cm",
      "10-12 cm",
    ]);
  });
});

describe("V4.5 receiving Zod schema", () => {
  it("accepts a complete payload and an omitted or null optional sample", () => {
    expect(receiveFishSchema.parse(validReceiving)).toMatchObject(
      validReceiving,
    );
    expect(
      receiveFishSchema.parse({
        ...validReceiving,
        weight_sample_per_500: null,
      }).weight_sample_per_500,
    ).toBeNull();
    expect(
      receiveFishSchema.parse({
        ...validReceiving,
        weight_sample_per_500: "485.50",
      }).weight_sample_per_500,
    ).toBe("485.50");
  });

  it.each([1, 1_000_000])("accepts quantity boundary %s", (quantity) => {
    expect(
      receiveFishSchema.safeParse({ ...validReceiving, quantity }).success,
    ).toBe(true);
  });

  it.each([0, 1_000_001, 1.5])("rejects invalid quantity %s", (quantity) => {
    expect(
      receiveFishSchema.safeParse({ ...validReceiving, quantity }).success,
    ).toBe(false);
  });

  it("accepts zero and maximum capital, and rejects values above the cap", () => {
    expect(
      receiveFishSchema.safeParse({
        ...validReceiving,
        purchase_capital: "0.00",
        shipping_capital: "9999999999.00",
      }).success,
    ).toBe(true);
    expect(
      receiveFishSchema.safeParse({
        ...validReceiving,
        purchase_capital: "10000000000.00",
      }).success,
    ).toBe(false);
  });

  it.each(["0.01", "100000.00"])(
    "accepts sample-weight boundary %s",
    (weight) => {
      expect(
        receiveFishSchema.safeParse({
          ...validReceiving,
          weight_sample_per_500: weight,
        }).success,
      ).toBe(true);
    },
  );

  it.each(["0", "100000.01", "1.001"])(
    "rejects invalid sample weight %s",
    (weight) => {
      expect(
        receiveFishSchema.safeParse({
          ...validReceiving,
          weight_sample_per_500: weight,
        }).success,
      ).toBe(false);
    },
  );

  it("rejects malformed dates, unsupported sizes, and additional fields", () => {
    expect(
      receiveFishSchema.safeParse({ ...validReceiving, entry_date: "2026-02-30" })
        .success,
    ).toBe(false);
    expect(
      receiveFishSchema.safeParse({ ...validReceiving, fish_size: "1-2 cm" })
        .success,
    ).toBe(false);
    expect(
      receiveFishSchema.safeParse({ ...validReceiving, injected: true }).success,
    ).toBe(false);
  });

  it("requires all mandatory fields", () => {
    expect(receiveFishSchema.safeParse({ quantity: 500 }).success).toBe(false);
  });
});

describe("V4.5 Receiving VOID Zod schema", () => {
  it("trims a non-empty reason and rejects empty or unknown fields", () => {
    expect(voidIncomingFishSchema.parse({ reason: "  Koreksi  " })).toEqual({
      reason: "Koreksi",
    });
    expect(voidIncomingFishSchema.safeParse({ reason: "   " }).success).toBe(
      false,
    );
    expect(
      voidIncomingFishSchema.safeParse({ reason: "Koreksi", extra: true })
        .success,
    ).toBe(false);
  });
});