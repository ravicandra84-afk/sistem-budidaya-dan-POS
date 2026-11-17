-- P7-03 adds immutable sale history, reversal records, and the unbounded daily sale sequence.
CREATE TABLE "sale_daily_sequences" (
    "sale_date" DATE NOT NULL,
    "last_number" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "sale_daily_sequences_pkey" PRIMARY KEY ("sale_date"),
    CONSTRAINT "sale_daily_sequences_last_number_check" CHECK ("last_number" >= 0)
);
COMMENT ON CONSTRAINT "sale_daily_sequences_pkey" ON "sale_daily_sequences" IS 'Provides one global sale sequence row per Jakarta business date.';
COMMENT ON CONSTRAINT "sale_daily_sequences_last_number_check" ON "sale_daily_sequences" IS 'Prevents the daily sale counter from becoming negative.';

CREATE TABLE "fish_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sale_code" VARCHAR(50) NOT NULL,
    "batch_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "payment_method" VARCHAR(20) NOT NULL,
    "cash_received" BIGINT,
    "change_amount" BIGINT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fish_sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fish_sales_sale_code_key" UNIQUE ("sale_code"),
    CONSTRAINT "fish_sales_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fish_sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fish_sales_sale_code_format_check" CHECK ("sale_code" ~ '^PFI-SAL-[0-9]{8}-[0-9]{3,}$'),
    CONSTRAINT "fish_sales_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "fish_sales_unit_price_check" CHECK ("unit_price" BETWEEN 1 AND 10000000),
    CONSTRAINT "fish_sales_total_amount_check" CHECK ("total_amount" = "quantity"::BIGINT * "unit_price"),
    CONSTRAINT "fish_sales_payment_method_check" CHECK ("payment_method" IN ('cash', 'transfer')),
    CONSTRAINT "fish_sales_payment_fields_check" CHECK (
        ("payment_method" = 'cash'
            AND "cash_received" IS NOT NULL
            AND "cash_received" >= "total_amount"
            AND "change_amount" = "cash_received" - "total_amount")
        OR
        ("payment_method" = 'transfer'
            AND "cash_received" IS NULL
            AND "change_amount" IS NULL)
    )
);
COMMENT ON CONSTRAINT "fish_sales_pkey" ON "fish_sales" IS 'Stable identifier for an immutable sale record.';
COMMENT ON CONSTRAINT "fish_sales_sale_code_key" ON "fish_sales" IS 'Ensures each internal sale number is unique and never reused.';
COMMENT ON CONSTRAINT "fish_sales_batch_id_fkey" ON "fish_sales" IS 'Sale references an existing batch and prevents deleting a referenced batch.';
COMMENT ON CONSTRAINT "fish_sales_created_by_fkey" ON "fish_sales" IS 'Sale creator references an existing user and cannot be deleted while referenced.';
COMMENT ON CONSTRAINT "fish_sales_sale_code_format_check" ON "fish_sales" IS 'Enforces the internal PFI-SAL date and minimum-three-digit sequence format.';
COMMENT ON CONSTRAINT "fish_sales_quantity_check" ON "fish_sales" IS 'A sale must contain a positive integer number of fish.';
COMMENT ON CONSTRAINT "fish_sales_unit_price_check" ON "fish_sales" IS 'Snapshot unit price is integer Rupiah from 1 through 10,000,000.';
COMMENT ON CONSTRAINT "fish_sales_total_amount_check" ON "fish_sales" IS 'Stored total must equal quantity multiplied by snapshot unit price.';
COMMENT ON CONSTRAINT "fish_sales_payment_method_check" ON "fish_sales" IS 'Only cash and transfer payment methods are supported.';
COMMENT ON CONSTRAINT "fish_sales_payment_fields_check" ON "fish_sales" IS 'Cash requires received amount and exact change; transfer requires both cash fields to be NULL.';

CREATE TABLE "fish_sale_voids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sale_id" UUID NOT NULL,
    "voided_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fish_sale_voids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fish_sale_voids_sale_id_key" UNIQUE ("sale_id"),
    CONSTRAINT "fish_sale_voids_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "fish_sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fish_sale_voids_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
COMMENT ON CONSTRAINT "fish_sale_voids_pkey" ON "fish_sale_voids" IS 'Stable identifier for an immutable sale reversal.';
COMMENT ON CONSTRAINT "fish_sale_voids_sale_id_key" ON "fish_sale_voids" IS 'Allows at most one full-sale VOID record per sale.';
COMMENT ON CONSTRAINT "fish_sale_voids_sale_id_fkey" ON "fish_sale_voids" IS 'VOID references an existing sale and prevents deleting a sale with reversal history.';
COMMENT ON CONSTRAINT "fish_sale_voids_voided_by_fkey" ON "fish_sale_voids" IS 'VOID actor references an existing user and cannot be deleted while referenced.';

-- Index foreign keys and newest-first history queries.
CREATE INDEX "idx_fish_sales_batch_id" ON "fish_sales" ("batch_id");
CREATE INDEX "idx_fish_sales_created_by" ON "fish_sales" ("created_by");
CREATE INDEX "idx_fish_sales_created_at_id" ON "fish_sales" ("created_at" DESC, "id" DESC);
CREATE INDEX "idx_fish_sale_voids_voided_by" ON "fish_sale_voids" ("voided_by");

-- Reuse the V4.5 append-only exception function for committed sale and VOID history.
CREATE TRIGGER "fish_sales_immutable"
BEFORE UPDATE OR DELETE ON "fish_sales"
FOR EACH ROW EXECUTE FUNCTION "reject_historical_mutation"();
COMMENT ON TRIGGER "fish_sales_immutable" ON "fish_sales" IS 'Rejects updates and deletes to committed sale history.';

CREATE TRIGGER "fish_sale_voids_immutable"
BEFORE UPDATE OR DELETE ON "fish_sale_voids"
FOR EACH ROW EXECUTE FUNCTION "reject_historical_mutation"();
COMMENT ON TRIGGER "fish_sale_voids_immutable" ON "fish_sale_voids" IS 'Rejects updates and deletes to committed sale VOID history.';

-- Preserve every V4.5 and P7-02 action while adding sale creation and VOID actions.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_action_check";
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_action_check"
    CHECK ("action" IN (
        'CREATE_ENTRY', 'VOID_ENTRY',
        'CREATE_SALE_PRICE', 'UPDATE_SALE_PRICE',
        'CREATE_SALE', 'VOID_SALE'
    ));
COMMENT ON CONSTRAINT "audit_logs_action_check" ON "audit_logs" IS 'Preserves V4.5 and price audit actions and allows P7-03 sale actions.';

-- Revoke PUBLIC access and keep runtime away from schema DDL and destructive table operations.
REVOKE ALL PRIVILEGES ON TABLE "sale_daily_sequences", "fish_sales", "fish_sale_voids" FROM PUBLIC;
-- The runtime role receives no schema CREATE privilege; migrations use the separate migration role.
REVOKE CREATE ON SCHEMA public FROM pfi_app_runtime;

-- Runtime reads the sale sequence and inserts its key/counter; only the counter may be updated.
GRANT SELECT ON TABLE "sale_daily_sequences" TO pfi_app_runtime;
GRANT INSERT ("sale_date", "last_number") ON TABLE "sale_daily_sequences" TO pfi_app_runtime;
GRANT UPDATE ("last_number") ON TABLE "sale_daily_sequences" TO pfi_app_runtime;

-- Runtime may read and append sales, but cannot update or delete immutable sale history.
GRANT SELECT ON TABLE "fish_sales" TO pfi_app_runtime;
GRANT INSERT ("sale_code", "batch_id", "quantity", "unit_price", "total_amount", "payment_method", "cash_received", "change_amount", "created_by") ON TABLE "fish_sales" TO pfi_app_runtime;

-- Runtime may read and append VOID records, but cannot update or delete reversal history.
GRANT SELECT ON TABLE "fish_sale_voids" TO pfi_app_runtime;
GRANT INSERT ("sale_id", "voided_by") ON TABLE "fish_sale_voids" TO pfi_app_runtime;