-- Add an optional product variant label without rewriting existing catalog or sales rows.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant_label" VARCHAR(80);