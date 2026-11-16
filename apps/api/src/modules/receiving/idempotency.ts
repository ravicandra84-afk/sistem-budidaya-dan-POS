import { createHash } from "node:crypto";

const decimalFields = new Set([
  "purchase_capital",
  "shipping_capital",
  "weight_sample_per_500",
]);

function normalize(value: unknown, key?: string): unknown {
  if (value === null) return undefined;
  if (typeof value === "string" && key && decimalFields.has(key)) {
    return value.includes(".")
      ? value.replace(/0+$/, "").replace(/\.$/, "")
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([entryKey, entryValue]) => {
          const normalized = normalize(entryValue, entryKey);
          return normalized === undefined ? [] : [[entryKey, normalized]];
        }),
    );
  }
  return value;
}

export function hashBusinessPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalize(payload)))
    .digest("hex");
}

export function isUuidV4(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}
