export const USER_ROLES = [
  "Owner",
  "Admin Operasional",
  "Kepala Budidaya",
] as const;

export type UserRole = (typeof USER_ROLES)[number];
