-- P7-01 adds the approved POS role while preserving every V4.5 role.
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";
ALTER TABLE "users"
    ADD CONSTRAINT "users_role_check"
    CHECK ("role" IN ('Owner', 'Admin Operasional', 'Kepala Budidaya', 'Kasir'));
COMMENT ON CONSTRAINT "users_role_check" ON "users" IS 'Allows all V4.5 roles and the approved Kasir POS role.';