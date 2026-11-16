-- V4.5 baseline schema. This migration is additive and must not be used to reset an existing database.

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
-- Uniqueness is case-insensitive without requiring a database extension.
CREATE UNIQUE INDEX "idx_users_email_lower" ON "users" (LOWER("email"));
-- Only V4.5 roles may be stored before the POS role extension passes its gate.
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('Owner', 'Admin Operasional', 'Kepala Budidaya'));

CREATE TABLE "fish_species" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "species_code" VARCHAR(50) NOT NULL,
    "species_name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fish_species_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fish_species_species_code_key" UNIQUE ("species_code")
);
-- Species lookup and seed identifiers must remain unique.

CREATE TABLE "batch_daily_sequences" (
    "entry_date" DATE NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "batch_daily_sequences_pkey" PRIMARY KEY ("entry_date"),
    CONSTRAINT "batch_daily_sequences_last_number_check" CHECK ("last_number" BETWEEN 0 AND 999)
);
-- Batch sequence is global per entry date and bounded by the V4.5 999 limit.

CREATE TABLE "batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_code" VARCHAR(50) NOT NULL,
    "species_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "batches_batch_code_key" UNIQUE ("batch_code"),
    CONSTRAINT "batches_species_id_fkey" FOREIGN KEY ("species_id") REFERENCES "fish_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "batches_status_check" CHECK ("status" IN ('active', 'completed', 'voided')),
    CONSTRAINT "batches_batch_code_format_check" CHECK ("batch_code" ~ '^PFI-BCH-[0-9]{8}-[0-9]{3}$')
);
-- Foreign keys prevent orphan batches and preserve referenced master records.
-- Status and code checks preserve the exact V4.5 state values and code format.
CREATE INDEX "idx_batches_status_created_at_id" ON "batches" ("status", "created_at" DESC, "id" DESC);
-- This index supports status filtering and stable newest-first batch lists.
CREATE INDEX "idx_batches_created_at_id" ON "batches" ("created_at" DESC, "id" DESC);
-- This index supports stable newest-first batch lists without a status filter.

CREATE TABLE "incoming_fish" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purchase_capital" NUMERIC(18,2) NOT NULL,
    "shipping_capital" NUMERIC(18,2) NOT NULL,
    "weight_sample_per_500" NUMERIC(12,2),
    "fish_size" VARCHAR(20) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incoming_fish_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "incoming_fish_batch_id_key" UNIQUE ("batch_id"),
    CONSTRAINT "incoming_fish_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incoming_fish_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incoming_fish_quantity_check" CHECK ("quantity" BETWEEN 1 AND 1000000),
    CONSTRAINT "incoming_fish_purchase_capital_check" CHECK ("purchase_capital" BETWEEN 0 AND 9999999999.00),
    CONSTRAINT "incoming_fish_shipping_capital_check" CHECK ("shipping_capital" BETWEEN 0 AND 9999999999.00),
    CONSTRAINT "incoming_fish_weight_sample_per_500_check" CHECK ("weight_sample_per_500" IS NULL OR "weight_sample_per_500" BETWEEN 0.01 AND 100000.00),
    CONSTRAINT "incoming_fish_fish_size_check" CHECK ("fish_size" IN ('2-4 cm', '3-5 cm', '4-6 cm', '5-7 cm', '6-8 cm', '7-9 cm', '8-10 cm', '9-11 cm', '10-12 cm'))
);
-- Unique batch_id enforces at most one receipt per batch; the deferred trigger below enforces at least one.
-- Foreign keys and value checks enforce valid actor, quantity, capital, sample weight, and official size.
CREATE INDEX "idx_incoming_fish_created_at_id" ON "incoming_fish" ("created_at" DESC, "id" DESC);
-- This index supports the approved received-at list ordering and date range filters.
CREATE INDEX "idx_incoming_fish_entry_date_created_at" ON "incoming_fish" ("entry_date", "created_at" DESC);
-- This index supports filtering by business entry date while retaining newest-first order.

CREATE TABLE "incoming_fish_voids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incoming_fish_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "voided_by" UUID NOT NULL,
    "voided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incoming_fish_voids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "incoming_fish_voids_incoming_fish_id_key" UNIQUE ("incoming_fish_id"),
    CONSTRAINT "incoming_fish_voids_incoming_fish_id_fkey" FOREIGN KEY ("incoming_fish_id") REFERENCES "incoming_fish"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incoming_fish_voids_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "incoming_fish_voids_reason_check" CHECK ("reason" <> '' AND TRIM("reason") <> '')
);
-- A unique receipt reference permits one VOID only; foreign keys and reason check retain reversal integrity.

CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "idempotency_keys_status_check" CHECK ("status" IN ('processing', 'completed')),
    CONSTRAINT "idempotency_keys_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$')
);
-- The composite unique key scopes retries to one actor, endpoint, and UUIDv4 key.
CREATE UNIQUE INDEX "idx_idempotency_user_endpoint_key" ON "idempotency_keys" ("user_id", "endpoint", "idempotency_key");

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" VARCHAR(255) NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "reason" TEXT,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_action_check" CHECK ("action" IN ('CREATE_ENTRY', 'VOID_ENTRY'))
);
-- V4.5 audit actions remain unchanged; POS actions require the POS gate and a later migration.
CREATE INDEX "idx_audit_logs_created_at_id" ON "audit_logs" ("created_at" DESC, "id" DESC);
-- This index supports newest-first audit lists and date range filtering.
CREATE INDEX "idx_audit_logs_action_created_at" ON "audit_logs" ("action", "created_at" DESC);
-- This index supports filtering V4.5 audit actions by time.

-- A deferred check enforces at least one receipt per batch at transaction commit.
CREATE FUNCTION "enforce_batch_has_receipt"() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "incoming_fish" WHERE "batch_id" = NEW."id") THEN
        RAISE EXCEPTION 'Batch % must have exactly one incoming_fish record', NEW."id"
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The initially deferred constraint allows batch and receipt insertion in one atomic transaction.
CREATE CONSTRAINT TRIGGER "batches_require_receipt_at_commit"
AFTER INSERT ON "batches"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_batch_has_receipt"();

-- This trigger rejects mutation/deletion of committed append-only history.
CREATE FUNCTION "reject_historical_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Table %.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

-- Receipt, reversal, and audit records are immutable after insertion.
CREATE TRIGGER "incoming_fish_immutable"
BEFORE UPDATE OR DELETE ON "incoming_fish"
FOR EACH ROW EXECUTE FUNCTION "reject_historical_mutation"();

CREATE TRIGGER "incoming_fish_voids_immutable"
BEFORE UPDATE OR DELETE ON "incoming_fish_voids"
FOR EACH ROW EXECUTE FUNCTION "reject_historical_mutation"();

CREATE TRIGGER "audit_logs_immutable"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "reject_historical_mutation"();

-- Batch status transitions are limited to the V4.5 and approved stock lifecycle.
CREATE FUNCTION "guard_batch_status_transition"() RETURNS trigger AS $$
BEGIN
    IF NEW."status" = OLD."status" THEN
        RETURN NEW;
    END IF;

    IF (OLD."status" = 'active' AND NEW."status" IN ('completed', 'voided'))
        OR (OLD."status" = 'completed' AND NEW."status" = 'active') THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Invalid batch status transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "batches_status_transition_guard"
BEFORE UPDATE OF "status" ON "batches"
FOR EACH ROW EXECUTE FUNCTION "guard_batch_status_transition"();

-- Revoke inherited PUBLIC access before granting the least-privilege runtime role.
REVOKE ALL PRIVILEGES ON TABLE "users", "fish_species", "batch_daily_sequences", "batches", "incoming_fish", "incoming_fish_voids", "idempotency_keys", "audit_logs" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION "enforce_batch_has_receipt"() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION "reject_historical_mutation"() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION "guard_batch_status_transition"() FROM PUBLIC;

-- Runtime needs schema lookup only; migration DDL remains on MIGRATION_DATABASE_URL.
GRANT USAGE ON SCHEMA public TO pfi_app_runtime;
-- User and species data are read-only to the application runtime.
GRANT SELECT ON TABLE "users", "fish_species" TO pfi_app_runtime;
-- Sequence initialization and increments are limited to the V4.5 sequence row and counter.
GRANT SELECT, INSERT ON TABLE "batch_daily_sequences" TO pfi_app_runtime;
GRANT UPDATE ("last_number") ON TABLE "batch_daily_sequences" TO pfi_app_runtime;
-- Batch creation is required by the atomic receipt flow; only status may later be updated.
GRANT SELECT, INSERT ON TABLE "batches" TO pfi_app_runtime;
GRANT UPDATE ("status") ON TABLE "batches" TO pfi_app_runtime;
-- Receipts and VOID reversals are append-only for runtime clients.
GRANT SELECT, INSERT ON TABLE "incoming_fish", "incoming_fish_voids" TO pfi_app_runtime;
-- Idempotency state may be finalized, but its identity and payload hash stay immutable.
GRANT SELECT, INSERT ON TABLE "idempotency_keys" TO pfi_app_runtime;
GRANT UPDATE ("status", "response_status", "response_body", "completed_at") ON TABLE "idempotency_keys" TO pfi_app_runtime;
-- Audit history is readable and appendable but never mutable by runtime clients.
GRANT SELECT, INSERT ON TABLE "audit_logs" TO pfi_app_runtime;