# PFI — Project AI Agent Instructions

> **Document role:** project-wide coding-agent rules for Pisciculture Farm Indonesia (PFI).
>
> **Applies to:** GitHub Copilot Agent in VS Code and any agent that supports the `AGENTS.md` convention.
>
> **Synchronization rule:** `GEMINI.md` must contain the same project rules for Gemini Code Assist. `.github/copilot-instructions.md` is the Copilot entry point and must direct the agent to this file. When these rules change, update the Gemini copy and the Copilot entry point in the same change.
>
> **Important:** This document does not select a single final framework from the approved stack candidates, nor does it replace `master_blueprint_api_contract_pfi_main.md`, `prd.md`, `architecture.md`, or `implementation_plan.md`.

---

## 1. Project identity and mission

The product is the internal **Pisciculture Farm Indonesia (PFI) Operational Management System**.

The current MVP scope is limited to:

1. **Fish Receiving and Batch Management:** record incoming fish, automatically create one batch for each valid receipt, display receipt/batch data, and support receiving VOID under Master Blueprint V4.5.
2. **Fish Out / Cashier POS:** sell fish from eligible batches, manage species-and-size prices, record full payment by cash or transfer, maintain sales history, VOID a complete sale, and print/reprint thermal receipts under the approved POS business rules.

Do not expand the MVP into a general ERP, accounting system, CRM, or complete aquaculture platform.

## 2. Required project documents

Before implementing or changing behavior, locate and read the relevant sections of these project documents. They may be in the repository root or a documented `docs/` directory; search the repository instead of assuming their location.

- `master_blueprint_api_contract_pfi_main.md` — Single Source of Truth (SSOT) for the V4.5 receiving module and the approved business/technical status of the POS extension.
- `prd.md` — product requirements, user roles, pages, user flows, validation, error behavior, and acceptance criteria.
- `architecture.md` — system architecture, relational database schema, transaction flows, device/printing strategy, and owner-approved architecture decisions.
- `implementation_plan.md` — ordered phases, task IDs, dependencies, gates, and task-level acceptance criteria.

If a required document is missing, report that fact. Do not reconstruct missing requirements from memory or invent a replacement contract.

### 2.1 Source-of-truth hierarchy

When documents or code appear to disagree, use this order:

1. The product owner's latest explicit written decision.
2. Master Blueprint V4.5 for Receiving, Batch, and Receiving VOID.
3. Explicitly confirmed POS business decisions in the approved POS extension.
4. `prd.md` for product behavior, pages, user flows, and acceptance criteria.
5. `architecture.md` for system structure, schema design, concurrency/security boundaries, and owner-approved technical decisions.
6. `implementation_plan.md` for task ordering and execution boundaries.
7. Existing code and UI are evidence of the current implementation, not permission to override the requirements above.

If a conflict is found, stop only the affected work. Report the exact conflicting statements, their document sections or Requirement IDs, the impact, and the decision needed. Do not choose a side silently.

### 2.2 Requirement status labels

Preserve these labels wherever they appear:

- `LOCKED — V4.5`: approved receiving/batch/receiving-VOID rules. Do not change without explicit approval.
- `LOCKED — BUSINESS`: confirmed POS business behavior. Do not change the business behavior.
- `APPROVED — OWNER`: architectural or technical decision explicitly approved by the product owner (see `architecture.md`). Ready to be locked into final API/DDL contracts where applicable.
- `PROPOSED — TECHNICAL`: a technical proposal, not yet an approved implementation contract.
- `TBD — NEEDS DECISION`: unresolved. Do not fill it with a guess.
- `OUT OF SCOPE`: not part of the current MVP. Do not implement it without an approved scope change.

A locked business rule does not automatically make a proposed table, API payload, library, or printer implementation final.

## 3. Technology stack: what is and is not approved

### 3.1 Confirmed technology and platform constraints

- Database engine: **PostgreSQL 13 or newer** (`LOCKED — V4.5`).
- Authentication: verified **JWT** (`LOCKED — V4.5`).
- Authorization: **RBAC**, one role per user for the MVP (`LOCKED — V4.5`).
- Transaction integrity: **ACID** transactions (`LOCKED — V4.5`).
- Mutation idempotency: **UUIDv4 `Idempotency-Key`** according to the relevant API contract (`LOCKED — V4.5`).
- Business timezone: **`Asia/Jakarta` (UTC+7)** (`LOCKED — V4.5`).
- Architecture style and approved stack: Decoupled Client-Server REST API using Node.js + TypeScript, NestJS, Next.js App Router, Prisma with parameterized raw SQL, Zod + class-validator, Tailwind CSS + shadcn/ui, and Jest + Supertest. See ADR 0001.

### 3.2 Stack decisions locked by ADR 0001

The product owner selected this stack in `docs/adr/0001-monorepo-stack-and-list-contract.md`:

- npm workspaces: `apps/api`, `apps/web`, and `packages/shared`.
- NestJS + TypeScript backend and Next.js App Router frontend.
- Prisma with PostgreSQL and parameterized raw SQL for locking/custom DDL.
- Zod + class-validator, Tailwind CSS + shadcn/ui, and Jest + Supertest.

The API documentation generator, hosting/deployment target, and CI vendor remain unselected. Do not infer these choices or replace the approved stack without explicit approval.

### 3.3 Dependency and library policy

- Prefer existing dependencies over adding another library that solves the same problem.
- Do not introduce deprecated, end-of-life, abandoned, or known-vulnerable libraries.
- Before adding a dependency, verify that it is maintained, compatible with the repository's runtime and framework versions, appropriately licensed, and necessary for the assigned task.
- Explain the reason and alternatives for a new production dependency.
- Do not install an unpinned `latest` major version or perform broad dependency upgrades as unrelated cleanup.
- Do not add a dependency solely to avoid writing a small, clear utility function.
- Keep lockfiles in sync with the package manager already used by the repository.

## 4. Repository inspection and structure rules

- Treat the current repository as the implementation reality. Inspect it before editing.
- Do not invent folder paths, modules, endpoints, scripts, or files.
- Follow the existing architecture and naming conventions. If there is no established convention, propose one before creating a large structure.
- Keep business rules in the appropriate domain/service layer rather than duplicating them in UI components or HTTP controllers.
- Keep HTTP transport, business/domain logic, persistence, and UI responsibilities separated according to the actual stack.
- Reuse existing API clients, validators, error types, authorization helpers, logging, and test fixtures.
- Avoid unrelated refactors, formatting churn, mass renames, generated-file edits, and drive-by dependency upgrades.
- Do not move or rename project files unless the assigned task requires it and the impact is documented.

### 4.1 Naming conventions

Use these domain/database/API conventions unless the approved contract or existing repository requires a more specific compatible convention:

- Database table and column identifiers: `snake_case`.
- Existing V4.5 table names must remain exact: `users`, `fish_species`, `batch_daily_sequences`, `batches`, `incoming_fish`, `incoming_fish_voids`, `idempotency_keys`, and `audit_logs`.
- Preserve exact domain field names, enum values, role names, status values, and API paths defined in the blueprint.
- API version prefix: `/api/v1` where specified by the contract.
- Do not rename domain terms (for example `incoming_fish`, `fish_size`, `entry_date`, `created_by`) for stylistic preference.
- For language-specific files, follow the naming and casing convention already present in that codebase. Do not impose TypeScript, JavaScript, Python, or framework naming rules on a repository that does not use that language.

## 5. Non-negotiable engineering principles

1. **Correctness before convenience.** A working-looking screen is not complete if backend or database invariants can be bypassed.
2. **Backend is authoritative.** Frontend validation improves UX but is never a security or data-integrity boundary.
3. **Database integrity matters.** Use appropriate constraints, foreign keys, unique indexes, checks, triggers, and least-privilege runtime access as defined by the approved design.
4. **Atomic mutations.** A business mutation, its idempotency record, sequence allocation, and required audit record must be committed or rolled back together where the contract requires it.
5. **Append-only history.** Do not edit or delete committed receiving, sales, VOID, or audit history to correct a transaction. Use the approved reversal/VOID workflow.
6. **No manual stock editing.** Stock is computed from valid business transactions; it is not an editable input field.
7. **Concurrency must be safe.** Recheck stock and batch status inside the database transaction while holding the required batch lock.
8. **Least privilege.** Check authorization on every protected backend operation and restrict database runtime privileges.
9. **No hidden business assumptions.** Ask for a product-owner decision when a TBD blocks implementation.
10. **No false completion claims.** Report tests and commands exactly as executed, including failures and tests not run.

## 6. Fixed business rules — Receiving and Batch (V4.5)

These requirements are locked by Master Blueprint V4.5. Do not reinterpret them.

### 6.1 Batch identity

- Every valid incoming-fish receipt creates exactly one new batch.
- The relationship between one `incoming_fish` receipt and one `batches` row is exactly 1:1.
- One batch contains exactly one fish species and one fish-size category.
- Do not merge separate receipts into one batch.
- Do not create a batch without its corresponding receipt.
- The initial status of a valid new batch is `active`.

### 6.2 Receiving input constraints

Preserve the approved V4.5 constraints:

- `species_id`: required; it must reference an active species.
- `entry_date`: required; format `YYYY-MM-DD`; it must not be later than the current date in `Asia/Jakarta`.
- `quantity`: required integer from **1 through 1,000,000** fish.
- `purchase_capital`: required monetary value from **0.00 through 9,999,999,999.00** IDR. Do not silently default it to zero.
- `shipping_capital`: required monetary value from **0.00 through 9,999,999,999.00** IDR. Do not silently default it to zero.
- `weight_sample_per_500`: optional grams per 500 fish; if provided, it must be from **0.01 through 100,000.00 grams**.
- `fish_size`: required and must use the approved enum/catalog. The V4.5 sizes are `2-4 cm`, `3-5 cm`, `4-6 cm`, `5-7 cm`, `6-8 cm`, `7-9 cm`, `8-10 cm`, `9-11 cm`, and `10-12 cm`.

Do not change units, bounds, optionality, defaults, or enum values without explicit approval.

### 6.3 Receiving roles and VOID

- **Owner-approved update (2026-11-17):** receiving creation is permitted to `Owner`, `Admin Operasional`, and `Kepala Budidaya`.
- Receiving VOID is permitted to `Owner` and `Admin Operasional`.
- Receiving VOID requires a reason.
- Receiving VOID must be blocked when dependent transactions exist.
- A receiving VOID is recorded separately; do not delete or mutate the original receipt.
- Preserve the V4.5 idempotency, audit, status, and error rules.

### 6.4 Batch status and stock

- Preserve the exact status values: `active`, `completed`, and `voided`.
- Stock is computed from valid incoming quantity minus valid sales minus valid mortalities, according to the available approved modules.
- VOID transactions are excluded from valid stock movement calculations.
- A batch with valid stock of zero is `completed` when the relevant stock-changing module is implemented.
- A `voided` batch must not be reactivated by an unrelated operation.
- The mortality module is outside this MVP. Do not invent mortality forms, endpoints, tables, or user flows. Do not claim mortality deductions are operational when no approved mortality transaction source exists.

## 7. Fixed business rules — Fish Out / Cashier POS

The following business behavior is confirmed. The technical POS design still has unresolved TBD items; see Section 8.

### 7.1 Roles and access

- POS access: `Owner`, `Admin Operasional`, and `Kasir`.
- `Kepala Budidaya` has no POS access.
- All POS roles can view all sales.
- All POS roles can create sales and VOID a complete sale.
- Only `Owner` and `Admin Operasional` can add or edit the price catalog.
- The price catalog cannot be deleted within this MVP.
- Reprinting a receipt is limited to the original sale creator (`created_by`) and only while that sale is not VOID.
- Role `Kasir` is explicitly denied (`Forbidden`) access to audit-log data and the audit-log page (`APPROVED — OWNER`, `TBD-07`). Additionally, `Kepala Budidaya` may view audit-log entries only for Receiving/Batch actions (`CREATE_ENTRY`, `VOID_ENTRY`) and must not see POS audit entries (`CREATE_SALE`, `VOID_SALE`, `CREATE_SALE_PRICE`, `UPDATE_SALE_PRICE`).

### 7.2 Batch selection and quantity

- POS displays only batches with status `active` and computed stock greater than zero.
- A sale uses exactly one batch. Do not combine multiple batches in one sale or receipt.
- Sale unit is `ekor` only.
- Partial sale from a batch is allowed.
- If requested quantity exceeds current stock, cap it to the available stock and ask the cashier to confirm the adjusted quantity.
- Backend must revalidate stock and status at commit time. A UI-only stock check is insufficient.
- Never permit a negative stock balance or concurrent overselling.

### 7.3 Price catalog and snapshot

- Price is defined by the combination of fish species and fish size.
- Price is an integer number of Rupiah per fish; no decimal fraction.
- A missing price blocks the sale.
- The current price must be refreshed and explicitly confirmed before saving the sale.
- The sale stores a snapshot of unit price and total at the time of sale.
- Future catalog changes must not alter historical sale amounts.
- Price history is not part of the confirmed business requirement. Do not create a price-history feature.

### 7.4 Payment

- Payment must be full; only `Tunai` and `Transfer` are in scope.
- For cash, cashier enters the amount received; it must be greater than or equal to the sale total. The system calculates the change.
- For transfer, cashier confirms the funds have been received. A transfer reference number is not required.
- Do not add partial payment, installments, debt, receivables, or other payment methods.

### 7.5 Sales number and transaction history

- Internal sale number format: `PFI-SAL-YYYYMMDD-XXX`.
- Daily numbering has no maximum of 999; the sequence must expand beyond three digits.
- Sale number and batch code are internal and must not be printed on the receipt.
- A committed sale is immutable and remains visible in history after VOID.

### 7.6 Sales VOID

- VOID cancels the whole sale; partial VOID is not allowed.
- Any POS role may VOID a sale that has not already been VOIDed.
- A reason is not required for sales VOID.
- A sale may be VOIDed at any time while it is still not VOIDed, subject to successful validation and transaction processing.
- Record VOID separately. Do not edit or delete the original sale.
- VOID restores the sold quantity to the batch's computed stock.
- If restored valid stock is greater than zero, a previously completed non-voided batch becomes `active` again. Never reactivate a `voided` batch.
- A sale may be VOIDed only once.

### 7.7 Receipt and printing

The printed receipt must contain only the approved information:

1. Company name: Pisciculture Farm Indonesia.
2. Date and time.
3. Fish species.
4. Fish size.
5. Quantity in `ekor`.
6. Price per fish.
7. Total payment.
8. Payment method.
9. Cashier name.

Do not add sale number, batch code, customer information, transfer reference, or other unapproved fields.

- Attempt automatic printing after the sale has successfully committed.
- Printing failure must not roll back or mark the committed sale as failed.
- A user may retry printing using the existing sale; retrying print must not create a new sale.
- Reprint is allowed only for the original creator and only for a non-VOID sale.
- Support receipt layouts for both 58 mm and 80 mm paper.
- Client-side browser printing is `APPROVED — OWNER` in [ADR 0002](docs/adr/0002-pos-gate-architecture.md): CSS layouts for 58 mm and 80 mm with the system print dialog are the baseline. Do not claim compatibility for a specific printer/device combination until GPOS-04 physically tests it. Direct ESC/POS Bluetooth, WebUSB, Web Serial, native wrappers, and print bridges are not part of the approved baseline.

## 8. Decisions tracking: approved vs unresolved (`TBD`)

### 8.1 Decisions resolved by the product owner (`APPROVED — OWNER` in `architecture.md`)

Do not treat these as open blockers; implement them consistently with `architecture.md`:

- `TBD-01` (`APPROVED — OWNER`): maximum allowed price per fish is **Rp 10,000,000** (integer Rupiah without decimals, enforced at validation and database layers).
- `TBD-02` (`APPROVED — OWNER`, ADR 0002 amendment): price creation is recorded as `CREATE_SALE_PRICE` and price update as `UPDATE_SALE_PRICE`, storing actor (`actor_id`) and timestamp (`created_at`) only (`old_values = NULL`, `new_values = NULL`); no price-history feature is built.
- `TBD-05` (`APPROVED — OWNER`): daily global sales sequence uses table `sale_daily_sequences` (`sale_date DATE PRIMARY KEY`, `last_number BIGINT NOT NULL CHECK (last_number >= 0)`) with minimum 3-digit zero-padding (`001`–`999`) expanding automatically beyond 999 (`1000`, `1001`, ...).
- `TBD-06` — Audit Actions (`APPROVED — OWNER`, ADR 0002 amendment): POS audit action names are `CREATE_SALE`, `VOID_SALE`, `CREATE_SALE_PRICE`, and `UPDATE_SALE_PRICE`.
- `TBD-07` (`APPROVED — OWNER`): role `Kasir` is explicitly denied (`Forbidden`) access to audit-log endpoints and UI pages.
- `TBD-03` (`APPROVED — OWNER`, ADR 0002): browser print CSS 58/80 mm and system print dialog are the approved baseline; physical printer/device verification remains required at GPOS-04.
- `TBD-04` (`APPROVED — OWNER`, ADR 0002): normative POS API routes, payloads, response envelopes, errors, pagination/filtering, idempotency, and RBAC are in `docs/pos-api-contract.md`.
- `TBD-06` DDL/runtime (`APPROVED — OWNER`, ADR 0002): four-table schema, computed stock extension, triggers, dependent transaction guard, audit actions, indexes, and granular `pfi_app_runtime` grants are approved for later implementation.

### 8.2 Remaining unresolved decisions (`TBD — NEEDS DECISION` — never guess)

Treat the following remaining open items as implementation blockers when they affect the assigned task:

- `TBD-08` (partially resolved in ADR 0001): local initial `Owner` provisioning by idempotent CLI from `.env` is approved. Account deactivation, role changes, password reset, and user administration remain unresolved.
- `TBD-09` (base behavior approved in ADR 0001): `page=1`, `limit=20` (maximum 100), ISO 8601 `startDate`/`endDate` on the primary transaction timestamp, official status values only, and newest-first ordering. Search and additional sort options remain unresolved.

Do not code around an open `TBD` by inventing a default. You may investigate options and produce an ADR or recommendation, clearly marked `PROPOSED`, but wait for the product owner's decision before treating it as approved.

## 9. API, database, and transaction safety

### 9.1 Authentication and authorization

- Verify JWT on the backend using the approved auth configuration.
- Derive user identity and actor fields from verified token claims, never from client-supplied actor IDs.
- Enforce RBAC on every protected API operation. Hiding a button is not authorization.
- Use least-privilege database roles and parameterized database operations.
- Never hardcode credentials, keys, signing secrets, or production connection strings.

### 9.2 Idempotency

- Mutating endpoints use UUIDv4 `Idempotency-Key` as specified by the module contract.
- Same key + same normalized payload must not create a duplicate; return the stored/cached outcome as specified.
- Same key + different payload must be rejected as an idempotency mismatch.
- Follow the V4.5 policy for validation failures before database transaction start; do not invent a new key-consumption policy.
- Generate and persist idempotency outcomes atomically with the associated business mutation where the contract requires it.

### 9.3 ACID, locking, and audit

- Mutations that affect a batch must lock the relevant batch row using the approved locking pattern (V4.5 specifies `SELECT ... FOR UPDATE`) and recheck status/stock within the transaction.
- Keep sequence allocation, idempotency, business data, and required audit records in the same atomic transaction when specified.
- If audit persistence fails for a mutation that requires audit, roll back the business transaction.
- Handle lock timeout, deadlock, database outage, and concurrency conflicts explicitly. Never report success before commit.
- Do not run direct SQL updates that bypass the approved business service, triggers, or database privileges.

### 9.4 Database changes and migrations

- PostgreSQL 13+ is mandatory.
- Inspect current schema and migrations before creating new ones.
- Use the repository's existing migration tool and naming convention; do not introduce another migration framework without approval.
- Migrations must be reviewed for data safety, constraints, indexes, triggers, and privilege implications.
- Do not use destructive schema operations or reset a database containing user data without explicit approval and a verified backup/restore plan.
- Never run migrations, seed scripts, destructive maintenance, or test cleanup against production unless the user has explicitly authorized that exact operation.
- Keep schema names, table names, enum values, constraints, and indexes aligned with the approved blueprint.
- Do not implement POS tables as final schema until the POS technical gate has been passed.

### 9.5 API behavior and error handling

- Preserve approved V4.5 endpoint paths, payload fields, response envelopes, HTTP statuses, and error codes.
- POS endpoints and payloads are locked by ADR 0002 and `docs/pos-api-contract.md`; do not change them without an explicit owner-approved decision.
- Validate input at the UI, backend, and database layers according to each layer's responsibility.
- Return actionable, stable errors; do not expose SQL statements, stack traces, secrets, or internal infrastructure details to end users.
- Never turn a failed or uncertain request into an automatic second business mutation with a new idempotency key.
- Keep printer state separate from sale-commit state.

## 10. Security, privacy, and operational hygiene

- Never commit `.env` files, passwords, API keys, private keys, access tokens, customer credentials, or production database dumps.
- Maintain or update `.env.example` with placeholder names only when appropriate to the existing project.
- Validate and normalize untrusted input on the backend.
- Use parameterized queries; do not interpolate user input into SQL or shell commands.
- Avoid logging credentials, authorization headers, personal information, or full payment secrets.
- Use safe error messages and do not leak whether a sensitive account exists unless the approved UX explicitly requires it.
- Do not weaken CORS, CSP, TLS, cookie, JWT, or database settings to make a local test pass without explaining and obtaining approval for the security impact.
- Do not add analytics, telemetry, external APIs, or data-sharing integrations without approval.

## 11. UI and user-experience rules

- Implement only the pages and behaviors defined in `prd.md` and the approved blueprint.
- Follow PFI's professional aquaculture/business identity and the established design system if one exists in the repository.
- Make layouts responsive for the target devices already defined by the product, while avoiding unapproved platform-specific assumptions.
- Show role-appropriate navigation and actions, but enforce permissions again on the backend.
- Show clear loading, empty, success, validation, and failure states.
- Require confirmation for consequential actions such as receiving VOID, sales VOID, price confirmation, and adjusted quantity confirmation as specified.
- Never display a success state before the server confirms the transaction commit.
- Preserve form values after recoverable validation/network errors where safe; do not silently submit duplicate transactions.
- Do not add dashboard analytics, customer/CRM data, reports, or extra POS convenience features unless explicitly approved.

## 12. Testing and verification requirements

### 12.1 Before and after changes

1. Inspect the current Git status and preserve all pre-existing user changes.
2. Identify the affected tests and available scripts from the actual repository manifests/configuration.
3. Add or update tests for changed behavior.
4. Run the narrowest relevant tests first, then broader tests required by the task.
5. Report the exact commands and actual outcomes. Distinguish `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN`.
6. Do not claim lint, build, migration, integration, security, or performance checks passed unless they were actually executed successfully.

### 12.2 V4.5 regression gate

- The 32 V4.5 test cases `TC-01` through `TC-32` are mandatory for the Receiving/Batch/Receiving-VOID scope.
- POS work must not regress the 32 V4.5 test cases.
- Preserve the V4.5 performance requirement: at least 95% of receiving-save requests must complete within 1.5 seconds at 50 concurrent requests under the staging conditions specified by the blueprint (minimum 2 vCPU, 4 GB RAM, and at least 100,000 database records).
- Do not apply that receiving SLA to POS; the PRD states that a POS performance target has not yet been defined.

### 12.3 POS regression scenarios

Once the POS gate is approved, tests must cover at least:

- Role access and denial for all four roles.
- Missing price and price changes during the cashier flow.
- Price/total snapshot immutability after catalog updates.
- Partial sale, stock boundary, requested quantity above stock, and explicit adjusted-quantity confirmation.
- Concurrent sales on the same batch with no overselling or negative stock.
- Cash received below/equal/above total and calculated change.
- Transfer confirmation and full-payment requirement.
- Idempotent sale retry and same-key/different-payload rejection.
- Atomic rollback if business write or required audit write fails.
- Unique daily sale numbers beyond 999 under concurrent requests.
- Full-sale VOID, repeated VOID rejection, and stock/status restoration.
- Auto-print failure after successful commit, retry print without duplicate sale, creator-only reprint, and no reprint for VOID sales.
- Receipt content and 58 mm / 80 mm formatting on the actual approved printer/device matrix.

## 13. Scope protection

The following are outside the current MVP unless the product owner approves a formal scope change:

- Feed usage, feed stock, or feed procurement.
- Mortality entry screens or mortality APIs.
- Pond management.
- Operational expenses or cash-flow management.
- Profit/loss or profit-per-batch reports.
- Accounting/ERP integration.
- Customer profiles or CRM.
- Kilogram-based sales, multi-batch receipts, partial payment, credit, installments, discounts, taxes, promotions, or transfer reference tracking.
- Sale deletion, partial sale VOID, or reprinting a VOID sale.
- UI/API management of fish species master data; V4.5 uses database seeding for the MVP.

Do not create these items as "helpful extras". Record a scope-change proposal instead.

## 14. Required work protocol: one task per session

Follow `implementation_plan.md` strictly.

At the beginning of a coding session:

1. Identify the single assigned Task ID (for example, `P0-01`).
2. Read the task and its dependencies in `implementation_plan.md`.
3. Read the relevant PRD Requirement IDs and Master Blueprint sections.
4. Inspect the current repository, Git status, and relevant files.
5. State the scope, expected files, and verification plan before editing.
6. If a blocker or unresolved decision affects the task, stop the blocked portion and report it. Do not silently substitute a guess.

During the task:

- Work only on the assigned Task ID.
- Do not start dependent phases early.
- Do not bundle unrelated cleanup or additional features.
- Do not modify the PRD, blueprint, implementation plan, or these instructions unless the task explicitly includes documentation changes.
- Preserve unrelated and uncommitted user work.
- Avoid destructive commands and production operations.

At the end of the task, provide a concise report with:

- Task ID and status: `DONE`, `PARTIAL`, or `BLOCKED`.
- Requirement IDs and source-document sections addressed.
- Files created, changed, or deleted.
- Important implementation decisions, with references to approved decisions/ADRs.
- Tests/commands actually executed and their results.
- Tests not run and the reason.
- Remaining blockers, risks, and the next eligible Task ID (do not start it automatically).

A task is not `DONE` merely because code was generated. Its deliverables, acceptance criteria, and required tests must be satisfied.

## 15. Git and change safety

- Inspect `git status` before making changes.
- Do not discard, overwrite, or reformat unrelated user changes.
- Do not run `git reset --hard`, `git clean -fd`, force-push, branch deletion, or history rewriting unless the user explicitly authorizes that exact operation.
- Do not commit, push, deploy, or publish unless explicitly requested.
- Keep changes small, reviewable, and limited to the assigned Task ID.
- Never state that a file was changed unless it exists in the resulting repository diff.

## 16. Definition of Ready and Definition of Done

A task is ready only when:

- It has one Task ID and a clear scope.
- Relevant Requirement IDs are known.
- Dependencies are complete.
- Roles, input rules, successful flow, and failure flow are defined.
- Required API/database impact is known.
- Acceptance criteria and a verification method are available.
- No unresolved TBD blocks the work.

A task is done only when:

- Only the approved scope was implemented.
- Behavior matches the source documents.
- Relevant tests exist and required tests pass.
- Security/RBAC and data integrity are not bypassed.
- No unapproved dependency or feature was added.
- Documentation is updated when required.
- The completion report accurately records actual test results and remaining limitations.

## 17. Expected agent communication

- Use Indonesian for explanations and progress reports unless the product owner requests another language.
- Keep code identifiers and API/database names consistent with the repository and contracts.
- Be explicit when something is `CONFIRMED`, `PROPOSED`, `TBD`, or `NOT VERIFIED`.
- Never pretend to have inspected a file, run a command, executed a migration, tested a printer, or verified production when it did not happen.
- Prefer a small, testable change over a large speculative implementation.

---

**End of PFI project instructions.**
