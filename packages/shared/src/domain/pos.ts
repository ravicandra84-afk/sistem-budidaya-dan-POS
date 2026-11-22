export const PAYMENT_METHODS = ["cash", "transfer"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SALE_READINESS_VALUES = ["BELUM_SIAP", "SIAP_JUAL"] as const;
export type SaleReadiness = (typeof SALE_READINESS_VALUES)[number];

export const PRODUCT_TRACKING_MODES = ["BATCH_TRACKED", "NON_BATCH"] as const;
export type ProductTrackingMode = (typeof PRODUCT_TRACKING_MODES)[number];

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
  "PRICE_OUT_OF_RANGE",
  "RECEIPT_NOT_AVAILABLE",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_NOT_ACTIVE",
  "PRODUCT_ALREADY_EXISTS",
  "CATEGORY_NOT_FOUND",
  "CATEGORY_ALREADY_EXISTS",
  "CATEGORY_TRACKING_MODE_MISMATCH",
  "BATCH_NOT_READY",
] as const;

export type PosErrorCode = (typeof POS_ERROR_CODES)[number];
