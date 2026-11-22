-- P8-01 seeds the V4.6 catalog after its tables exist; the legacy price table remains available to P8-02.
INSERT INTO "product_categories" ("name", "code", "requires_batch")
VALUES
    ('Benih Ikan', 'BENIH-IKAN', true),
    ('Produk Umum', 'PRODUK-UMUM', false)
ON CONFLICT DO NOTHING;

-- Preserve current species/size prices as batch-tracked products without changing their source rows.
INSERT INTO "products" (
    "category_id", "sku", "name", "tracking_mode", "species", "size_label",
    "unit", "unit_price", "stock_quantity", "is_active", "created_at", "updated_at"
)
SELECT
    "category"."id",
    'FISH-' || upper("species"."species_code") || '-' || regexp_replace(upper("price"."fish_size"), '[^A-Z0-9]+', '-', 'g'),
    "species"."species_name" || ' ' || "price"."fish_size",
    'BATCH_TRACKED',
    "species"."species_name",
    "price"."fish_size",
    'EKOR',
    "price"."price_per_fish"::DECIMAL(12,2),
    NULL,
    true,
    "price"."created_at",
    "price"."updated_at"
FROM "fish_sale_prices" AS "price"
JOIN "fish_species" AS "species" ON "species"."id" = "price"."species_id"
JOIN "product_categories" AS "category"
    ON "category"."code" = 'BENIH-IKAN' AND "category"."requires_batch" = true
ON CONFLICT ("sku") DO NOTHING;

-- Prisma 6.19.3 cannot represent partial indexes; keep this active-pair invariant in SQL.
CREATE UNIQUE INDEX "products_active_batch_species_size_key"
    ON "products" ("species", "size_label")
    WHERE "tracking_mode" = 'BATCH_TRACKED' AND "is_active" = true;

-- Enforce product price, tracking attributes, and the required sales relationship.
ALTER TABLE "products"
    ADD CONSTRAINT "products_unit_price_check"
        CHECK ("unit_price" > 0 AND "unit_price" <= 10000000.00),
    ADD CONSTRAINT "products_tracking_fields_check"
        CHECK (
            ("tracking_mode" = 'BATCH_TRACKED' AND "species" IS NOT NULL AND "size_label" IS NOT NULL AND "stock_quantity" IS NULL)
            OR
            ("tracking_mode" = 'NON_BATCH' AND "species" IS NULL AND "size_label" IS NULL)
        );
COMMENT ON CONSTRAINT "products_unit_price_check" ON "products" IS 'Product unit price is greater than zero and at most Rp10,000,000.00.';
COMMENT ON CONSTRAINT "products_tracking_fields_check" ON "products" IS 'Batch-tracked products require species and size and have no direct stock; non-batch products have no batch attributes.';
ALTER TABLE "fish_sales"
    ADD CONSTRAINT "fish_sales_product_or_batch_check"
        CHECK ("product_id" IS NOT NULL OR "batch_id" IS NOT NULL);
COMMENT ON CONSTRAINT "fish_sales_product_or_batch_check" ON "fish_sales" IS 'Retains a product or legacy batch reference; mode-specific requirements are enforced by the V4.6 sale service.';
COMMENT ON COLUMN "fish_sales"."total_price" IS 'V4.6 decimal total snapshot; migrated in place from the V4.5 total_amount column.';

-- Keep category requires_batch and product tracking mode consistent at the database boundary.
CREATE FUNCTION "enforce_product_tracking_category"() RETURNS trigger AS $$
DECLARE
    category_requires_batch BOOLEAN;
BEGIN
    SELECT "requires_batch" INTO category_requires_batch
    FROM "product_categories"
    WHERE "id" = NEW."category_id";

    IF NOT FOUND OR category_requires_batch <> (NEW."tracking_mode" = 'BATCH_TRACKED') THEN
        RAISE EXCEPTION 'Product tracking mode must match category requires_batch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION "enforce_product_tracking_category"() IS 'Requires product tracking mode to match the selected category.';
CREATE TRIGGER "products_tracking_category_guard"
BEFORE INSERT OR UPDATE OF "category_id", "tracking_mode" ON "products"
FOR EACH ROW EXECUTE FUNCTION "enforce_product_tracking_category"();
COMMENT ON TRIGGER "products_tracking_category_guard" ON "products" IS 'Prevents batch/non-batch mode from diverging from category configuration.';
REVOKE ALL PRIVILEGES ON FUNCTION "enforce_product_tracking_category"() FROM PUBLIC;

-- Keep readiness history append-only using the established V4.5 immutable-row guard.
CREATE TRIGGER "batch_sale_readiness_histories_immutable"
BEFORE UPDATE OR DELETE ON "batch_sale_readiness_histories"
FOR EACH ROW EXECUTE FUNCTION "reject_historical_mutation"();
COMMENT ON TRIGGER "batch_sale_readiness_histories_immutable" ON "batch_sale_readiness_histories" IS 'Rejects updates and deletes to batch sale-readiness history.';
COMMENT ON COLUMN "batches"."sale_readiness" IS 'Commercial readiness separate from the V4.5 active/completed/voided lifecycle.';
COMMENT ON TABLE "batch_sale_readiness_histories" IS 'Append-only audit trail for sale-readiness changes; actor authorization is enforced by the API.';
COMMENT ON TABLE "product_categories" IS 'Mutable POS categories; archive through is_active instead of deletion.';
COMMENT ON TABLE "products" IS 'Mutable POS catalog; batch stock is computed while non-batch stock is stored directly.';

-- Grant only the DML required by the API; no runtime DELETE is granted.
REVOKE ALL PRIVILEGES ON TABLE "batch_sale_readiness_histories", "product_categories", "products" FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE "batch_sale_readiness_histories" TO pfi_app_runtime;
GRANT UPDATE ("sale_readiness") ON TABLE "batches" TO pfi_app_runtime;
GRANT USAGE ON TYPE "SaleReadiness", "ProductTrackingMode" TO pfi_app_runtime;
GRANT SELECT ON TABLE "product_categories", "products" TO pfi_app_runtime;
GRANT INSERT ("name", "code", "requires_batch", "is_active", "updated_at") ON TABLE "product_categories" TO pfi_app_runtime;
GRANT UPDATE ("name", "code", "requires_batch", "is_active", "updated_at") ON TABLE "product_categories" TO pfi_app_runtime;
GRANT INSERT ("category_id", "sku", "name", "tracking_mode", "species", "size_label", "unit", "unit_price", "stock_quantity", "is_active", "updated_at") ON TABLE "products" TO pfi_app_runtime;
GRANT UPDATE ("category_id", "sku", "name", "tracking_mode", "species", "size_label", "unit", "unit_price", "stock_quantity", "is_active", "updated_at") ON TABLE "products" TO pfi_app_runtime;
GRANT INSERT ("product_id") ON TABLE "fish_sales" TO pfi_app_runtime;
