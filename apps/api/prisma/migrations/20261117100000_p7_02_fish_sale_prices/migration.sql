-- P7-02 adds the mutable current price catalog without changing V4.5 rows.
CREATE TABLE "fish_sale_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "species_id" UUID NOT NULL,
    "fish_size" VARCHAR(20) NOT NULL,
    "price_per_fish" BIGINT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fish_sale_prices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fish_sale_prices_species_id_fkey" FOREIGN KEY ("species_id") REFERENCES "fish_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fish_sale_prices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fish_sale_prices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fish_sale_prices_fish_size_check" CHECK ("fish_size" IN ('2-4 cm', '3-5 cm', '4-6 cm', '5-7 cm', '6-8 cm', '7-9 cm', '8-10 cm', '9-11 cm', '10-12 cm')),
    CONSTRAINT "fish_sale_prices_price_per_fish_check" CHECK ("price_per_fish" BETWEEN 1 AND 10000000),
    CONSTRAINT "fish_sale_prices_species_id_fish_size_key" UNIQUE ("species_id", "fish_size")
);

-- Document the invariants enforced by the primary, foreign-key, check, and unique constraints.
COMMENT ON CONSTRAINT "fish_sale_prices_pkey" ON "fish_sale_prices" IS 'Stable identifier for a current catalog price.';
COMMENT ON CONSTRAINT "fish_sale_prices_species_id_fkey" ON "fish_sale_prices" IS 'Price catalog references an existing species and prevents deleting referenced species.';
COMMENT ON CONSTRAINT "fish_sale_prices_created_by_fkey" ON "fish_sale_prices" IS 'Creator references an existing user and cannot be deleted while referenced.';
COMMENT ON CONSTRAINT "fish_sale_prices_updated_by_fkey" ON "fish_sale_prices" IS 'Last updater references an existing user and cannot be deleted while referenced.';
COMMENT ON CONSTRAINT "fish_sale_prices_fish_size_check" ON "fish_sale_prices" IS 'Limits catalog prices to the nine V4.5 fish-size categories.';
COMMENT ON CONSTRAINT "fish_sale_prices_price_per_fish_check" ON "fish_sale_prices" IS 'Price is an integer Rupiah amount from 1 through 10,000,000.';
COMMENT ON CONSTRAINT "fish_sale_prices_species_id_fish_size_key" ON "fish_sale_prices" IS 'Only one current catalog price may exist per species and fish size.';

-- Index foreign keys and newest-first catalog queries without storing price history.
CREATE INDEX "idx_fish_sale_prices_created_by" ON "fish_sale_prices" ("created_by");
CREATE INDEX "idx_fish_sale_prices_updated_by" ON "fish_sale_prices" ("updated_by");
CREATE INDEX "idx_fish_sale_prices_created_at_id" ON "fish_sale_prices" ("created_at" DESC, "id" DESC);

-- Extend the V4.5 audit check additively while preserving both V4.5 actions.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check";
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_action_check"
    CHECK ("action" IN ('CREATE_ENTRY', 'VOID_ENTRY', 'CREATE_SALE_PRICE', 'UPDATE_SALE_PRICE'));
COMMENT ON CONSTRAINT "audit_logs_action_check" ON "audit_logs" IS 'Preserves V4.5 actions and allows the approved P7-02 price audit actions.';

-- Runtime may read prices, insert valid catalog rows, and update only mutable price fields.
REVOKE ALL PRIVILEGES ON TABLE "fish_sale_prices" FROM PUBLIC;
GRANT SELECT ON TABLE "fish_sale_prices" TO pfi_app_runtime;
GRANT INSERT ("species_id", "fish_size", "price_per_fish", "created_by", "updated_by")
    ON TABLE "fish_sale_prices" TO pfi_app_runtime;
GRANT UPDATE ("price_per_fish", "updated_by", "updated_at")
    ON TABLE "fish_sale_prices" TO pfi_app_runtime;