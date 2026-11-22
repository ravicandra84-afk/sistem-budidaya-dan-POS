/*
    Original generated warnings (superseded by the explicit rename/cast below; no values are dropped):

  - You are about to drop the column `total_amount` on the `fish_sales` table. All the data in the column will be lost.
  - You are about to alter the column `unit_price` on the `fish_sales` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Decimal(12,2)`.
  - You are about to alter the column `cash_received` on the `fish_sales` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Decimal(14,2)`.
  - You are about to alter the column `change_amount` on the `fish_sales` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Decimal(14,2)`.
  - Added the required column `total_price` to the `fish_sales` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SaleReadiness" AS ENUM ('BELUM_SIAP', 'SIAP_JUAL');

-- CreateEnum
CREATE TYPE "ProductTrackingMode" AS ENUM ('BATCH_TRACKED', 'NON_BATCH');

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "sale_readiness" "SaleReadiness" NOT NULL DEFAULT 'BELUM_SIAP';

ALTER TABLE "fish_sales" RENAME COLUMN "total_amount" TO "total_price";
ALTER TABLE "fish_sales"
    ADD COLUMN "product_id" UUID,
    ALTER COLUMN "batch_id" DROP NOT NULL,
    ALTER COLUMN "unit_price" TYPE DECIMAL(12,2) USING "unit_price"::DECIMAL(12,2),
    ALTER COLUMN "total_price" TYPE DECIMAL(14,2) USING "total_price"::DECIMAL(14,2),
    ALTER COLUMN "cash_received" TYPE DECIMAL(14,2) USING "cash_received"::DECIMAL(14,2),
    ALTER COLUMN "change_amount" TYPE DECIMAL(14,2) USING "change_amount"::DECIMAL(14,2);

ALTER TABLE "fish_sales" RENAME CONSTRAINT "fish_sales_total_amount_check" TO "fish_sales_total_price_check";
ALTER TABLE "fish_sales" DROP CONSTRAINT "fish_sales_unit_price_check";
ALTER TABLE "fish_sales"
    ADD CONSTRAINT "fish_sales_unit_price_check"
        CHECK ("unit_price" > 0 AND "unit_price" <= 10000000.00);
COMMENT ON CONSTRAINT "fish_sales_unit_price_check" ON "fish_sales" IS 'V4.6 snapshot unit price is positive and at most Rp10,000,000.00.';
COMMENT ON CONSTRAINT "fish_sales_total_price_check" ON "fish_sales" IS 'Stored total price equals quantity multiplied by the decimal snapshot unit price.';

-- CreateTable
CREATE TABLE "batch_sale_readiness_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "from_readiness" "SaleReadiness",
    "to_readiness" "SaleReadiness" NOT NULL,
    "changed_by" UUID NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_sale_readiness_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "requires_batch" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "tracking_mode" "ProductTrackingMode" NOT NULL,
    "species" VARCHAR(100),
    "size_label" VARCHAR(20),
    "unit" VARCHAR(20) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "stock_quantity" DECIMAL(12,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_batch_sale_readiness_histories_batch_id_created_at" ON "batch_sale_readiness_histories"("batch_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_batch_sale_readiness_histories_changed_by" ON "batch_sale_readiness_histories"("changed_by");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_name_key" ON "product_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_code_key" ON "product_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "idx_products_category_id" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "idx_products_active_tracking_mode" ON "products"("is_active", "tracking_mode");

-- CreateIndex
CREATE INDEX "idx_batches_status_sale_readiness" ON "batches"("status", "sale_readiness");

-- CreateIndex
CREATE INDEX "idx_fish_sales_product_id" ON "fish_sales"("product_id");

-- AddForeignKey
ALTER TABLE "batch_sale_readiness_histories" ADD CONSTRAINT "batch_sale_readiness_histories_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_sale_readiness_histories" ADD CONSTRAINT "batch_sale_readiness_histories_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fish_sales" ADD CONSTRAINT "fish_sales_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
