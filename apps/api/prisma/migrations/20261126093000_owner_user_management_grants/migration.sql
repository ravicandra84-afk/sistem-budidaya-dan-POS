-- Owner-managed user lifecycle: grant only the fields required by the API.
GRANT INSERT ("name", "email", "password_hash", "role", "is_active"),
      UPDATE ("name", "email", "password_hash", "role", "is_active")
ON TABLE "users" TO "pfi_app_runtime";

-- Preserve all approved V4.5/V4.6 audit actions and add Owner account actions.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check";
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_action_check"
    CHECK ("action" IN (
        'CREATE_ENTRY', 'VOID_ENTRY',
        'CREATE_SALE_PRICE', 'UPDATE_SALE_PRICE',
        'CREATE_SALE', 'VOID_SALE',
        'UPDATE_BATCH_SALE_READINESS',
        'CREATE_PRODUCT_CATEGORY', 'UPDATE_PRODUCT_CATEGORY', 'ARCHIVE_PRODUCT_CATEGORY',
        'CREATE_PRODUCT', 'UPDATE_PRODUCT', 'ARCHIVE_PRODUCT',
        'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED',
        'USER_REACTIVATED', 'USER_PASSWORD_RESET'
    ));
COMMENT ON CONSTRAINT "audit_logs_action_check" ON "audit_logs"
IS 'Preserves V4.5/V4.6 audit actions and allows Owner-managed user lifecycle actions.';