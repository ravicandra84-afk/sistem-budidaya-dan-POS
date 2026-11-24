-- P8-FIX-02 stores fractional NON_BATCH quantities without changing sale history.
ALTER TABLE "fish_sales"
    ALTER COLUMN "quantity" TYPE NUMERIC(12,2)
    USING "quantity"::NUMERIC(12,2);

COMMENT ON CONSTRAINT "fish_sales_quantity_check" ON "fish_sales" IS
    'Sale quantity must be greater than zero; mode-specific precision is validated by the API and sale trigger.';

-- Batch-tracked prices are whole Rupiah; NON_BATCH keeps its two-decimal price.
ALTER TABLE "products"
    ADD CONSTRAINT "products_batch_tracked_unit_price_integer_check"
        CHECK ("tracking_mode" <> 'BATCH_TRACKED' OR "unit_price" = trunc("unit_price"));

COMMENT ON CONSTRAINT "products_batch_tracked_unit_price_integer_check" ON "products" IS
    'BATCH_TRACKED product prices must be whole Rupiah; NON_BATCH prices retain NUMERIC(12,2) precision.';

-- Preserve fractional stock when a NON_BATCH sale is VOIDed.
CREATE OR REPLACE FUNCTION "reactivate_batch_after_sale_void"() RETURNS trigger AS $$
DECLARE
    target_batch_id UUID;
    target_product_id UUID;
    target_quantity NUMERIC(12,2);
    batch_status VARCHAR(20);
    restored_stock BIGINT;
BEGIN
    SELECT "batch_id", "product_id", "quantity"
    INTO target_batch_id, target_product_id, target_quantity
    FROM "fish_sales"
    WHERE "id" = NEW."sale_id";

    IF target_batch_id IS NULL THEN
        UPDATE "products"
        SET "stock_quantity" = "stock_quantity" + target_quantity,
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

COMMENT ON FUNCTION "reactivate_batch_after_sale_void"() IS
    'Restores fractional NON_BATCH quantity exactly or preserves V4.5 batch reactivation behavior.';