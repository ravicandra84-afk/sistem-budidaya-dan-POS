-- Compute stock from V4.5 receipts and receiving VOID; later stock sources remain gated.
CREATE FUNCTION "calculate_batch_stock"("target_batch_id" UUID)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(
        SUM(CASE WHEN "void"."id" IS NULL THEN "receipt"."quantity" ELSE 0 END),
        0
    )::BIGINT
    FROM "incoming_fish" AS "receipt"
    LEFT JOIN "incoming_fish_voids" AS "void"
        ON "void"."incoming_fish_id" = "receipt"."id"
    WHERE "receipt"."batch_id" = "target_batch_id"
$$;

REVOKE ALL PRIVILEGES ON FUNCTION "calculate_batch_stock"(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "calculate_batch_stock"(UUID) TO pfi_app_runtime;

CREATE OR REPLACE FUNCTION "guard_batch_status_transition"() RETURNS trigger AS $$
DECLARE
    computed_stock BIGINT;
BEGIN
    IF NEW."status" = OLD."status" THEN
        RETURN NEW;
    END IF;

    IF NEW."status" = 'completed' THEN
        computed_stock := "calculate_batch_stock"(NEW."id");
        IF computed_stock <> 0 THEN
            RAISE EXCEPTION 'Cannot complete batch with non-zero computed stock'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF (OLD."status" = 'active' AND NEW."status" IN ('completed', 'voided'))
        OR (OLD."status" = 'completed' AND NEW."status" = 'active') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Invalid batch status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;