export const PAYMENT_METHODS = ["cash", "transfer"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const POS_SALE_STATUSES = ["active", "voided"] as const;
export type PosSaleStatus = (typeof POS_SALE_STATUSES)[number];

export const POS_ERROR_CODES = [
  "PRICE_NOT_CONFIGURED",
  "PRICE_CHANGED",
  "INSUFFICIENT_STOCK",
  "BATCH_NOT_ACTIVE",
  "BATCH_NOT_FOUND",
  "IDEMPOTENCY_MISMATCH",
  "INVALID_IDEMPOTENCY_KEY",
  "SALE_NOT_FOUND",
  "SALE_ALREADY_VOIDED",
  "PRICE_ALREADY_EXISTS",
  "PRICE_NOT_FOUND",
  "RECEIPT_NOT_AVAILABLE",
] as const;

export type PosErrorCode = (typeof POS_ERROR_CODES)[number];
