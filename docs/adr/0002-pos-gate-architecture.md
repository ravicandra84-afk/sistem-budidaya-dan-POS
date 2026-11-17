# ADR 0002: POS Gate Architecture

- Status: APPROVED — OWNER
- Date: 2026-11-17
- Scope: Gate POS decisions `TBD-03`, `TBD-04`, and `TBD-06`
- Prerequisite: Gate V4.5 — APPROVED / PASS
- Normative API contract: [POS API Contract](../pos-api-contract.md)

## Context

The POS business rules are approved, but the POS schema, API details, and
printing baseline were gated before implementation. This ADR records the
owner-approved technical decisions. It does not authorize implementation
outside the task sequence in `implementation_plan.md`. The physical printer
and device compatibility matrix remains an acceptance activity for GPOS-04.

Existing V4.5 tables, constraints, and business behavior remain unchanged
except for the explicitly described additive POS extensions. PostgreSQL
remains the source of truth; sale history, sale VOID records, and audit logs
are append-only. Actor identity is taken from verified JWT claims.

## Decisions

### D1 — POS database model (`TBD-06`)

The POS model consists of four tables:

1. `fish_sale_prices`: one current mutable price per `(species_id, fish_size)`;
   `price_per_fish BIGINT CHECK (price_per_fish BETWEEN 1 AND 10000000)`;
   `created_by`, `created_at`, `updated_by`, and `updated_at`. The pair is
   unique and references `fish_species`/`users` with `ON DELETE RESTRICT`.
   No price deletion or price-history table is allowed. Price creation
   writes `CREATE_SALE_PRICE`; price update writes `UPDATE_SALE_PRICE`.
   Both actions record actor/time only; `old_values` and `new_values` remain
   NULL.
2. `sale_daily_sequences`: `sale_date DATE PRIMARY KEY` and
   `last_number BIGINT NOT NULL CHECK (last_number >= 0)`. Allocation is
   atomic and global per Jakarta business date. Sale numbers use
   `PFI-SAL-YYYYMMDD-XXX`, minimum three-digit padding, and expand beyond 999.
3. `fish_sales`: one immutable transaction row for exactly one batch, with
   unique `sale_code`, positive integer `quantity`, integer snapshot
   `unit_price` and `total_amount`, payment method `cash|transfer`, payment
   fields, `created_by`, and `created_at`. `total_amount` equals
   `quantity * unit_price`; cash requires `cash_received >= total_amount` and
   `change_amount = cash_received - total_amount`; transfer has NULL cash and
   change fields. Foreign keys use `ON DELETE RESTRICT`.
4. `fish_sale_voids`: immutable reversal with unique `sale_id`, `voided_by`,
   and `voided_at`. No reason is required. The unique sale reference permits
   at most one VOID per sale.

No sale-item table is needed because one sale contains exactly one batch.
The approved POS audit actions are `CREATE_SALE`, `VOID_SALE`,
`CREATE_SALE_PRICE`, and `UPDATE_SALE_PRICE`. This action split is an
owner-approved amendment to the original ADR 0002 decision that used one
`UPDATE_PRICE` action for both price mutations. The legacy action is not used
for new POS price changes.
The role constraint is extended to include `Kasir`, preserving the existing
three roles and V4.5 audit actions.

### D2 — Computed stock, triggers, and receiving guard (`TBD-06`)

Extend `calculate_batch_stock(UUID)` to return valid receipt quantity minus
quantities from sales without a matching `fish_sale_voids` row. Receiving
VOID records continue to exclude the receipt. `current_stock` remains a
computed API/domain value; it is not a writable stock column or a POS table.
Mortality remains outside the MVP and contributes no implemented movement.

The sale service locks the batch using `SELECT ... FOR UPDATE`, then
revalidates active status, current stock, price, quantity, and payment inside
the transaction. A database insert guard repeats the critical checks and
locks the batch so direct runtime inserts cannot bypass them. The current
price row is locked while validating the snapshot. Sale/VOID status updates
remain in the same ACID transaction: zero stock yields `completed`; a sale
VOID that restores positive stock may return `completed` to `active`; a
`voided` batch is never reactivated. Existing V4.5 status guards remain in
force and must be extended only as needed for these transitions.

Receiving VOID's dependent-transaction guard must query `fish_sales` for any
sale on the batch, including a sale already VOIDed. Sale creation and
receiving VOID use the same batch lock. This serializes the competing writes
and enforces TC-20/TC-28 against real POS rows, not a test-only guard.

`fish_sales`, `fish_sale_voids`, and `audit_logs` reject `UPDATE` and `DELETE`
through both runtime privileges and immutable-row triggers. Required sale,
VOID, price-audit, idempotency, and sequence writes are atomic as applicable.

### D3 — Runtime database privileges (`TBD-06`)

The migration role alone owns schema DDL. `pfi_app_runtime` receives no
`CREATE` on schema and no `DELETE` on POS tables. It receives only the
following POS DML, in addition to the already approved V4.5 grants:

- `fish_sale_prices`: `SELECT`; `INSERT` on identity, species, size, price,
  and creator/updater columns; `UPDATE` only on `price_per_fish`,
  `updated_by`, and `updated_at`.
- `sale_daily_sequences`: `SELECT`, `INSERT` on sequence key/value, and
  `UPDATE` only on `last_number`.
- `fish_sales` and `fish_sale_voids`: `SELECT`, `INSERT` only; no update or
  delete privilege.
- `batches`: retain approved `SELECT`/`INSERT` grants and `UPDATE` only on
  `status`.
- `idempotency_keys`: retain column-limited V4.5 updates for completion and
  cached response fields. `audit_logs`: `SELECT`/`INSERT` only, with the
  POS action constraint extended additively.
- `calculate_batch_stock(UUID)`: execute permission for `pfi_app_runtime`;
  no public execute grant beyond the repository's existing policy.

Column grants are not a substitute for backend RBAC. Runtime actions are
authorized by the API for each verified user role.

### D4 — POS API contract (`TBD-04`)

The canonical routes use `/api/v1/pos/*`. Request/response envelopes,
validation, idempotency, list behavior, RBAC, and sanitized error codes are
defined in `docs/pos-api-contract.md`. All mutations require a UUIDv4
`Idempotency-Key`. Business actor fields come only from verified JWT claims.

Lists use ADR 0001 defaults (`page=1`, `limit=20`, maximum `100`, newest
first, `id DESC` tie-breaker). Sales lists accept inclusive ISO 8601
`startDate`/`endDate` bounds and derived status `active|voided`. No search or
arbitrary sort is introduced. POS batch lists are current-stock queries and
do not accept transaction-date filters.

Create-sale requests carry the expected unit price and final confirmed
quantity; the backend recomputes total and change. A stale price or stock
conflict rolls back the idempotency row and returns a safe public detail
needed for refresh. After the cashier reviews and confirms refreshed values,
the client must submit with a fresh UUIDv4 key. An uncertain network result
must be retried with the original key, never as an automatic second sale.

### D5 — Thermal receipt baseline (`TBD-03`)

The approved baseline is client-side browser print with CSS layouts for
58 mm and 80 mm paper, using the system print dialog without an
application-specific printer driver or protocol. Desktop targets include
Linux Pop!\_OS and Windows. The operating system may still require a printer
driver or native printer support; this is not a universal zero-driver
compatibility guarantee. Printing starts only after the sale commit and
never changes the sale result. Retry printing uses the existing sale; it
does not submit a second sale. Mobile/tablet use the system print dialog
where supported.

The receipt contains exactly these nine approved fields: Pisciculture Farm
Indonesia; transaction date/time in `Asia/Jakarta`; species; fish size;
quantity in `ekor`; price per fish; total payment; payment method; cashier
name. It does not contain sale number, batch code, weight, customer data,
transfer reference, VOID reason, or a VOID watermark. VOID sales cannot be
reprinted. Use tabular numerals for quantities and money.

WebUSB, Web Serial, direct ESC/POS Bluetooth, native wrappers, and print
bridges are not part of this baseline. GPOS-04 must test the actual target
printer/device matrix and both paper widths before compatibility is claimed.
The architecture decision is approved; the physical compatibility evidence
is still required and is not implied by this ADR.

## Consequences

- POS design decisions `TBD-03`, `TBD-04`, and `TBD-06` are approved and
  locked by this ADR. The four-table model, stock function behavior, trigger
  invariants, and runtime privileges are approved for later implementation.
  The distinct price audit actions are the latest owner-approved amendment.
- This ADR does not create database objects, API code, UI, or printer
  integrations. Database and API implementation follow the approved task
  sequence and the no-migration/no-code scope of the current review.
- GPOS-04 remains responsible for physical printer/device verification.
  Until that test passes, do not claim support for a specific printer/OS
  combination; the browser print dialog remains the approved fallback.
- V4.5 TC-01 through TC-32 remain mandatory regression coverage. POS-specific
  tests must include database-level dependency guard and concurrent writers.

## Verification Criteria

- The API contract is internally consistent with ADR 0001 pagination and the
  approved POS role/business matrix.
- Database implementation tests the grants and rejects historical mutations
  under `pfi_app_runtime` on PostgreSQL 13+.
- Concurrent sale/sale and sale/receiving-VOID tests use the same locked
  batch row and real POS records.
- Receipt content and 58/80 mm layout are checked, and physical support is
  reported only for tested devices.
