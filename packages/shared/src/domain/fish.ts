export const FISH_SIZES = [
  "2-4 cm",
  "3-5 cm",
  "4-6 cm",
  "5-7 cm",
  "6-8 cm",
  "7-9 cm",
  "8-10 cm",
  "9-11 cm",
  "10-12 cm",
] as const;

export type FishSize = (typeof FISH_SIZES)[number];

export const BATCH_STATUSES = ["active", "completed", "voided"] as const;

export type BatchStatus = (typeof BATCH_STATUSES)[number];
