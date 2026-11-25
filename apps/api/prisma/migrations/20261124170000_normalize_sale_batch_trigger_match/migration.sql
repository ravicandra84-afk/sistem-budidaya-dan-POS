-- Normalize catalog species and size before validating a batch-tracked sale.
CREATE OR REPLACE FUNCTION "lock_and_validate_sale_batch"() RETURNS trigger AS $$
DECLARE
    product_tracking_mode "ProductTrackingMode";
    product_is_active BOOLEAN;
    category_is_active BOOLEAN;
    product_species VARCHAR(100);
    product_size VARCHAR(20);
    product_unit_price NUMERIC(12,2);
    product_stock NUMERIC(12,2);
    batch_status VARCHAR(20);
    batch_sale_readiness "SaleReadiness";
    batch_species VARCHAR(100);
    batch_size VARCHAR(20);
    available_stock BIGINT;
BEGIN
    IF NEW."product_id" IS NULL THEN
        RAISE EXCEPTION 'A V4.6 sale requires a catalog product'
            USING ERRCODE = '23514';
    END IF;

    SELECT "product"."tracking_mode", "product"."is_active", "category"."is_active",
           "product"."species", "product"."size_label", "product"."unit_price",
           "product"."stock_quantity"
    INTO product_tracking_mode, product_is_active, category_is_active,
         product_species, product_size, product_unit_price, product_stock
    FROM "products" AS "product"
    INNER JOIN "product_categories" AS "category"
        ON "category"."id" = "product"."category_id"
    WHERE "product"."id" = NEW."product_id"
    FOR UPDATE OF "product";

    IF NOT FOUND OR NOT product_is_active OR NOT category_is_active THEN
        RAISE EXCEPTION 'Sale product or category is inactive or missing'
            USING ERRCODE = '23514';
    END IF;
    IF product_unit_price <> NEW."unit_price" THEN
        RAISE EXCEPTION 'Sale snapshot price does not match the locked product price'
            USING ERRCODE = '23514';
    END IF;

    IF product_tracking_mode = 'NON_BATCH' THEN
        IF NEW."batch_id" IS NOT NULL THEN
            RAISE EXCEPTION 'Non-batch sale must not reference a batch'
                USING ERRCODE = '23514';
        END IF;
        IF product_stock IS NULL OR NEW."quantity"::NUMERIC > product_stock THEN
            RAISE EXCEPTION 'Non-batch sale exceeds computed product stock'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF product_tracking_mode <> 'BATCH_TRACKED' OR NEW."batch_id" IS NULL THEN
        RAISE EXCEPTION 'Batch-tracked sale requires a batch reference'
            USING ERRCODE = '23514';
    END IF;

    SELECT "batch"."status", "batch"."sale_readiness", "species"."species_name", "receipt"."fish_size"
    INTO batch_status, batch_sale_readiness, batch_species, batch_size
    FROM "batches" AS "batch"
    INNER JOIN "fish_species" AS "species" ON "species"."id" = "batch"."species_id"
    INNER JOIN "incoming_fish" AS "receipt" ON "receipt"."batch_id" = "batch"."id"
    WHERE "batch"."id" = NEW."batch_id"
    FOR UPDATE OF "batch";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale batch does not exist'
            USING ERRCODE = '23503';
    END IF;
    IF batch_status <> 'active' OR batch_sale_readiness <> 'SIAP_JUAL' THEN
        RAISE EXCEPTION 'Sale batch must be active and SIAP_JUAL'
            USING ERRCODE = '23514';
    END IF;
    IF LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(product_species), '\s+', ' ', 'g'), '\s*-\s*', '-', 'g'))
           <> LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(batch_species), '\s+', ' ', 'g'), '\s*-\s*', '-', 'g'))
       OR LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(product_size), '\s+', ' ', 'g'), '\s*-\s*', '-', 'g'))
           <> LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(batch_size), '\s+', ' ', 'g'), '\s*-\s*', '-', 'g')) THEN
                RAISE EXCEPTION 'Sale batch species/size does not match the product'
            USING ERRCODE = '23514';
    END IF;

    available_stock := "calculate_batch_stock"(NEW."batch_id");
    IF NEW."quantity"::BIGINT > available_stock THEN
        RAISE EXCEPTION 'Sale quantity exceeds computed batch stock'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION "lock_and_validate_sale_batch"() IS 'Locks a product and, for batch-tracked sales, its batch; validates active/readiness, normalized product match, price, and stock.';
REVOKE ALL PRIVILEGES ON FUNCTION "lock_and_validate_sale_batch"() FROM PUBLIC;