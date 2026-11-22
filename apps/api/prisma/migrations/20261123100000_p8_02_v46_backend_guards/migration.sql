-- P8-02 enables audited catalog/readiness mutations while preserving all V4.5/P7 audit actions.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check";
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_action_check"
    CHECK ("action" IN (
        'CREATE_ENTRY', 'VOID_ENTRY',
        'CREATE_SALE_PRICE', 'UPDATE_SALE_PRICE',
        'CREATE_SALE', 'VOID_SALE',
        'UPDATE_BATCH_SALE_READINESS',
        'CREATE_PRODUCT_CATEGORY', 'UPDATE_PRODUCT_CATEGORY', 'ARCHIVE_PRODUCT_CATEGORY',
        'CREATE_PRODUCT', 'UPDATE_PRODUCT', 'ARCHIVE_PRODUCT'
    ));
COMMENT ON CONSTRAINT "audit_logs_action_check" ON "audit_logs" IS 'Preserves V4.5/P7 actions and allows audited V4.6 readiness and catalog mutations.';

-- Sales lock the product first. Batch-tracked sales then lock the batch and recheck readiness/stock.
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
    IF product_species <> batch_species OR product_size <> batch_size THEN
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
COMMENT ON FUNCTION "lock_and_validate_sale_batch"() IS 'Locks a product and, for batch-tracked sales, its batch; validates active/readiness, product match, price, and stock.';
REVOKE ALL PRIVILEGES ON FUNCTION "lock_and_validate_sale_batch"() FROM PUBLIC;

-- Batch stock remains computed; non-batch stock is decremented atomically after its immutable sale insert.
CREATE OR REPLACE FUNCTION "complete_batch_after_sale"() RETURNS trigger AS $$
DECLARE
    remaining_stock BIGINT;
BEGIN
    IF NEW."batch_id" IS NULL THEN
        UPDATE "products"
        SET "stock_quantity" = "stock_quantity" - NEW."quantity"::NUMERIC,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = NEW."product_id"
          AND "stock_quantity" >= NEW."quantity"::NUMERIC;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Non-batch sale exceeds product stock'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    remaining_stock := "calculate_batch_stock"(NEW."batch_id");
    IF remaining_stock < 0 THEN
        RAISE EXCEPTION 'Sale would create negative computed stock'
            USING ERRCODE = '23514';
    END IF;

    IF remaining_stock = 0 THEN
        UPDATE "batches"
        SET "status" = 'completed'
        WHERE "id" = NEW."batch_id" AND "status" = 'active';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION "complete_batch_after_sale"() IS 'Decrements non-batch stock or retains the V4.5 batch completion transition after a sale.';
REVOKE ALL PRIVILEGES ON FUNCTION "complete_batch_after_sale"() FROM PUBLIC;

-- VOID locks the same source row as sale creation and restores non-batch stock without changing sale history.
CREATE OR REPLACE FUNCTION "lock_batch_before_sale_void"() RETURNS trigger AS $$
DECLARE
    target_batch_id UUID;
    target_product_id UUID;
    batch_status VARCHAR(20);
BEGIN
    SELECT "batch_id", "product_id"
    INTO target_batch_id, target_product_id
    FROM "fish_sales"
    WHERE "id" = NEW."sale_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF target_batch_id IS NULL THEN
        PERFORM 1 FROM "products" WHERE "id" = target_product_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sale product does not exist'
                USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
    END IF;

    SELECT "status" INTO batch_status
    FROM "batches"
    WHERE "id" = target_batch_id
    FOR UPDATE;

    IF NOT FOUND OR batch_status = 'voided' THEN
        RAISE EXCEPTION 'Cannot VOID a sale from a voided or missing batch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION "lock_batch_before_sale_void"() IS 'Locks the sale product or batch before an append-only sale VOID.';
REVOKE ALL PRIVILEGES ON FUNCTION "lock_batch_before_sale_void"() FROM PUBLIC;

CREATE OR REPLACE FUNCTION "reactivate_batch_after_sale_void"() RETURNS trigger AS $$
DECLARE
    target_batch_id UUID;
    target_product_id UUID;
    target_quantity INTEGER;
    batch_status VARCHAR(20);
    restored_stock BIGINT;
BEGIN
    SELECT "batch_id", "product_id", "quantity"
    INTO target_batch_id, target_product_id, target_quantity
    FROM "fish_sales"
    WHERE "id" = NEW."sale_id";

    IF target_batch_id IS NULL THEN
        UPDATE "products"
        SET "stock_quantity" = "stock_quantity" + target_quantity::NUMERIC,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = target_product_id AND "stock_quantity" IS NOT NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Non-batch product stock could not be restored'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    SELECT "status" INTO batch_status
    FROM "batches"
    WHERE "id" = target_batch_id;
    restored_stock := "calculate_batch_stock"(target_batch_id);
    IF batch_status = 'completed' AND restored_stock > 0 THEN
        UPDATE "batches"
        SET "status" = 'active'
        WHERE "id" = target_batch_id AND "status" = 'completed';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION "reactivate_batch_after_sale_void"() IS 'Restores non-batch product quantity or retains V4.5 completed-to-active restoration for a sale VOID.';
REVOKE ALL PRIVILEGES ON FUNCTION "reactivate_batch_after_sale_void"() FROM PUBLIC;
