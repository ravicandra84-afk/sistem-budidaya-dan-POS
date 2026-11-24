-- P8-02 runtime repair: grant table-level INSERT/SELECT needed by Prisma for catalog mutations.
REVOKE ALL PRIVILEGES ON TABLE "products", "product_categories", "batch_sale_readiness_histories" FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE "products" TO pfi_app_runtime;
GRANT SELECT, INSERT ON TABLE "product_categories" TO pfi_app_runtime;
GRANT SELECT, INSERT ON TABLE "batch_sale_readiness_histories" TO pfi_app_runtime;
GRANT SELECT, INSERT ON TABLE "audit_logs" TO pfi_app_runtime;

-- Keep updates granular and exclude delete/append-only mutations.
GRANT UPDATE ("category_id", "sku", "name", "tracking_mode", "species", "size_label", "unit", "unit_price", "stock_quantity", "is_active", "updated_at") ON TABLE "products" TO pfi_app_runtime;
GRANT UPDATE ("name", "code", "requires_batch", "is_active", "updated_at") ON TABLE "product_categories" TO pfi_app_runtime;
GRANT UPDATE ("sale_readiness") ON TABLE "batches" TO pfi_app_runtime;

COMMENT ON TABLE "products" IS 'V4.6 POS catalog; runtime may select/insert/update permitted columns but cannot delete.';
COMMENT ON TABLE "product_categories" IS 'V4.6 POS category catalog; runtime may select/insert/update permitted columns but cannot delete.';
COMMENT ON TABLE "batch_sale_readiness_histories" IS 'Append-only batch readiness history; runtime may select/insert only.';