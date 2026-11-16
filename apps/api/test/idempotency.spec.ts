import { hashBusinessPayload } from "../src/modules/receiving/idempotency";

describe("V4.5 idempotency payload normalization", () => {
  it("treats omitted and null optional fields as identical", () => {
    expect(hashBusinessPayload({ quantity: 5, sample: null })).toBe(
      hashBusinessPayload({ quantity: 5 }),
    );
  });

  it("normalizes decimal trailing zeros without losing meaningful fractional digits", () => {
    expect(hashBusinessPayload({ purchase_capital: "2500000.00" })).toBe(
      hashBusinessPayload({ purchase_capital: "2500000" }),
    );
    expect(hashBusinessPayload({ weight_sample_per_500: "485.50" })).toBe(
      hashBusinessPayload({ weight_sample_per_500: "485.5" }),
    );
  });

  it("sorts object keys recursively while preserving array order", () => {
    expect(hashBusinessPayload({ nested: { b: 2, a: 1 }, ids: [1, 2] })).toBe(
      hashBusinessPayload({ ids: [1, 2], nested: { a: 1, b: 2 } }),
    );
    expect(hashBusinessPayload({ ids: [1, 2] })).not.toBe(
      hashBusinessPayload({ ids: [2, 1] }),
    );
  });
});
