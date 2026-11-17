export const USER_ROLES = [
  "Owner",
  "Admin Operasional",
  "Kepala Budidaya",
  "Kasir",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const POS_ROLES = [
  "Owner",
  "Admin Operasional",
  "Kasir",
] as const satisfies readonly UserRole[];

export const PRICE_MANAGEMENT_ROLES = [
  "Owner",
  "Admin Operasional",
] as const satisfies readonly UserRole[];
