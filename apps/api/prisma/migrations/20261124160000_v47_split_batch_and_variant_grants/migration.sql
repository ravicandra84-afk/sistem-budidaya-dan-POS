-- Permit catalog managers to update the additive variant label column.
GRANT UPDATE ("variant_label") ON TABLE "products" TO "pfi_app_runtime";

-- Keep active batch products unique by normalized species, size, and variant.
CREATE UNIQUE INDEX IF NOT EXISTS "products_active_batch_species_size_variant_key"
    ON "products" (
        LOWER(TRIM("species")),
        LOWER(TRIM("size_label")),
        COALESCE(LOWER(TRIM("variant_label")), '')
    )
    WHERE "tracking_mode" = 'BATCH_TRACKED' AND "is_active" = true;
DROP INDEX IF EXISTS "products_active_batch_species_size_key";

-- Group per-batch ledger rows into one logical checkout without altering legacy columns.
ALTER TABLE "fish_sales"
    ADD COLUMN IF NOT EXISTS "checkout_group_id" UUID NULL;
CREATE INDEX IF NOT EXISTS "fish_sales_checkout_group_id_idx"
    ON "fish_sales" ("checkout_group_id");