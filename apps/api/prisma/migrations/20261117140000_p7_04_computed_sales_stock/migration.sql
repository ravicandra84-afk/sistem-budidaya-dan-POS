-- P7-04 computes valid stock from receipts and non-VOID sales without persisting an editable balance.
CREATE OR REPLACE FUNCTION "calculate_batch_stock"("target_batch_id" UUID)
RETURNS BIGINT
LANGUAGE SQL
VOLATILE
AS $$
    SELECT
        COALESCE((
            SELECT SUM("receipt"."quantity")::BIGINT
            FROM "incoming_fish" AS "receipt"
            LEFT JOIN "incoming_fish_voids" AS "receipt_void"
                ON "receipt_void"."incoming_fish_id" = "receipt"."id"
            WHERE "receipt"."batch_id" = "target_batch_id"
                AND "receipt_void"."id" IS NULL
        ), 0)
        - COALESCE((
            SELECT SUM("sale"."quantity")::BIGINT
            FROM "fish_sales" AS "sale"
            LEFT JOIN "fish_sale_voids" AS "sale_void"
                ON "sale_void"."sale_id" = "sale"."id"
            WHERE "sale"."batch_id" = "target_batch_id"
                AND "sale_void"."id" IS NULL
        ), 0)
$$;
COMMENT ON FUNCTION "calculate_batch_stock"(UUID) IS 'Returns valid receipt quantity less active, non-VOID sale quantity; does not store stock.';
REVOKE ALL PRIVILEGES ON FUNCTION "calculate_batch_stock"(UUID) FROM PUBLIC;
-- Runtime services and triggers require the computed stock function; no public execute grant is retained.
GRANT EXECUTE ON FUNCTION "calculate_batch_stock"(UUID) TO pfi_app_runtime;

-- Status guard permits only stock-consistent lifecycle changes and never reactivates a voided batch.
CREATE OR REPLACE FUNCTION "guard_batch_status_transition"() RETURNS trigger AS $$
DECLARE
    computed_stock BIGINT;
    has_sales BOOLEAN;
BEGIN
    IF NEW."status" = OLD."status" THEN
        RETURN NEW;
    END IF;

    IF OLD."status" = 'voided' THEN
        RAISE EXCEPTION 'A voided batch cannot change status'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'completed' THEN
        computed_stock := "calculate_batch_stock"(NEW."id");
        IF computed_stock <> 0 THEN
            RAISE EXCEPTION 'Cannot complete batch with non-zero computed stock'
                USING ERRCODE = '23514';
        END IF;
        IF OLD."status" = 'active' THEN
            RETURN NEW;
        END IF;
    END IF;

    IF NEW."status" = 'active' AND OLD."status" = 'completed' THEN
        computed_stock := "calculate_batch_stock"(NEW."id");
        IF computed_stock <= 0 THEN
            RAISE EXCEPTION 'Cannot reactivate batch without positive computed stock'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."status" = 'voided' AND OLD."status" = 'active' THEN
        SELECT EXISTS (
            SELECT 1 FROM "fish_sales" WHERE "batch_id" = NEW."id"
        ) INTO has_sales;
        IF has_sales THEN
            RAISE EXCEPTION 'Cannot VOID a batch that has sale history'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Invalid batch status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION "guard_batch_status_transition"() IS 'Enforces stock-consistent active/completed transitions and permanent voided status.';

-- Recreate the existing status trigger so its lifecycle rules use the updated stock function.
DROP TRIGGER IF EXISTS "batches_status_transition_guard" ON "batches";
CREATE TRIGGER "batches_status_transition_guard"
BEFORE UPDATE OF "status" ON "batches"
FOR EACH ROW EXECUTE FUNCTION "guard_batch_status_transition"();
COMMENT ON TRIGGER "batches_status_transition_guard" ON "batches" IS 'Allows only stock-consistent lifecycle changes and rejects reactivation from voided.';

-- Lock and validate the batch before each sale insert to serialize competing writers and prevent overselling.
CREATE FUNCTION "lock_and_validate_sale_batch"() RETURNS trigger AS $$
DECLARE
    batch_status VARCHAR(20);
    available_stock BIGINT;
BEGIN
    SELECT "status" INTO batch_status
    FROM "batches"
    WHERE "id" = NEW."batch_id"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale batch does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF batch_status <> 'active' THEN
        RAISE EXCEPTION 'Sale batch must be active'
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
COMMENT ON FUNCTION "lock_and_validate_sale_batch"() IS 'Locks a batch and rejects sales on inactive or insufficient-stock batches.';

CREATE TRIGGER "fish_sales_lock_and_validate_batch"
BEFORE INSERT ON "fish_sales"
FOR EACH ROW EXECUTE FUNCTION "lock_and_validate_sale_batch"();
COMMENT ON TRIGGER "fish_sales_lock_and_validate_batch" ON "fish_sales" IS 'Serializes sale inserts on the batch row and prevents overselling.';

-- Close a batch when the inserted sale consumes its final fish.
CREATE FUNCTION "complete_batch_after_sale"() RETURNS trigger AS $$
DECLARE
    remaining_stock BIGINT;
BEGIN
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
COMMENT ON FUNCTION "complete_batch_after_sale"() IS 'Marks an active batch completed when a committed sale reduces computed stock to zero.';

CREATE TRIGGER "fish_sales_update_batch_status"
AFTER INSERT ON "fish_sales"
FOR EACH ROW EXECUTE FUNCTION "complete_batch_after_sale"();
COMMENT ON TRIGGER "fish_sales_update_batch_status" ON "fish_sales" IS 'Completes a batch after its final stock is sold.';

-- Lock the associated batch before a sale VOID and reject VOID on a permanently voided batch.
CREATE FUNCTION "lock_batch_before_sale_void"() RETURNS trigger AS $$
DECLARE
    target_batch_id UUID;
    batch_status VARCHAR(20);
BEGIN
    SELECT "batch_id" INTO target_batch_id
    FROM "fish_sales"
    WHERE "id" = NEW."sale_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale does not exist'
            USING ERRCODE = '23503';
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
COMMENT ON FUNCTION "lock_batch_before_sale_void"() IS 'Locks the sale batch and prevents sale VOID on a permanently voided batch.';

CREATE TRIGGER "fish_sale_voids_lock_batch"
BEFORE INSERT ON "fish_sale_voids"
FOR EACH ROW EXECUTE FUNCTION "lock_batch_before_sale_void"();
COMMENT ON TRIGGER "fish_sale_voids_lock_batch" ON "fish_sale_voids" IS 'Serializes sale VOID against sale and receiving operations on the same batch.';

-- Reactivate a completed batch when a sale VOID restores positive computed stock.
CREATE FUNCTION "reactivate_batch_after_sale_void"() RETURNS trigger AS $$
DECLARE
    target_batch_id UUID;
    batch_status VARCHAR(20);
    restored_stock BIGINT;
BEGIN
    SELECT "batch_id" INTO target_batch_id
    FROM "fish_sales"
    WHERE "id" = NEW."sale_id";

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
COMMENT ON FUNCTION "reactivate_batch_after_sale_void"() IS 'Reactivates a completed batch only when a sale VOID restores positive computed stock.';

CREATE TRIGGER "fish_sale_voids_update_batch_status"
AFTER INSERT ON "fish_sale_voids"
FOR EACH ROW EXECUTE FUNCTION "reactivate_batch_after_sale_void"();
COMMENT ON TRIGGER "fish_sale_voids_update_batch_status" ON "fish_sale_voids" IS 'Restores active status after a sale VOID makes stock positive.';

-- Trigger functions are invoked by PostgreSQL triggers; clients cannot call them directly.
REVOKE ALL PRIVILEGES ON FUNCTION "lock_and_validate_sale_batch"() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION "complete_batch_after_sale"() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION "lock_batch_before_sale_void"() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION "reactivate_batch_after_sale_void"() FROM PUBLIC;

-- The runtime role needs to read sales for dependent-transaction checks and computed stock.
GRANT SELECT ON TABLE "fish_sales", "fish_sale_voids" TO pfi_app_runtime;