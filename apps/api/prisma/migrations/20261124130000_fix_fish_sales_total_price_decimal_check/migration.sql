-- Allow two-decimal quantities while validating the persisted monetary total.
ALTER TABLE "fish_sales" DROP CONSTRAINT IF EXISTS "fish_sales_total_price_check";
ALTER TABLE "fish_sales" ADD CONSTRAINT "fish_sales_total_price_check"
  CHECK ("total_price" = ROUND("quantity" * "unit_price", 2));