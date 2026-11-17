-- P7-06 exposes only a narrow row-lock operation so runtime can serialize VOID without UPDATE on append-only sales.
CREATE FUNCTION "lock_fish_sale_for_update"("target_sale_id" UUID)
RETURNS TABLE ("sale_id" UUID, "batch_id" UUID)
LANGUAGE SQL
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT "sale"."id", "sale"."batch_id"
    FROM public."fish_sales" AS "sale"
    WHERE "sale"."id" = "target_sale_id"
    FOR UPDATE OF "sale"
$$;
COMMENT ON FUNCTION "lock_fish_sale_for_update"(UUID) IS 'Locks one append-only sale row for atomic VOID while preserving runtime SELECT/INSERT-only privileges.';

-- Callers can request a sale row lock but cannot create or alter functions in the schema.
REVOKE ALL PRIVILEGES ON FUNCTION "lock_fish_sale_for_update"(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "lock_fish_sale_for_update"(UUID) TO pfi_app_runtime;