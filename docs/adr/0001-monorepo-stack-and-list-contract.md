# ADR 0001: Monorepo Stack and List Contract

- Status: APPROVED — OWNER
- Date: 2026-11-16
- Scope: application foundation and V4.5 list query behavior

## Context

The repository previously contained the product specifications but no application source, package manifests, or database migrations. The owner selected the implementation stack and resolved the MVP list defaults while preserving the existing V4.5 and POS gates.

## Decisions

1. Use an npm-workspaces monorepo with `apps/api`, `apps/web`, and `packages/shared`.
2. Use Node.js + TypeScript, NestJS for the REST API, Next.js App Router for the web client, Prisma with PostgreSQL and parameterized raw SQL where row locks or custom DDL are required, Tailwind CSS, Zod plus class-validator, and Jest + Supertest.
3. Keep role labels exactly as specified by V4.5: `Owner`, `Admin Operasional`, and `Kepala Budidaya`. The `Kasir` role and all POS schema/API changes remain behind Gate V4.5 and Gate POS; this ADR does not authorize POS DDL or API implementation.
4. Provision the initial local `Owner` through a CLI seed command using credentials from the ignored local `.env`. There is no public registration endpoint. If the email already exists, provisioning makes no changes to its password, role, or other account fields. Account lifecycle administration remains unresolved.
5. For list queries, default `page` to `1`, `limit` to `20`, and cap `limit` at `100`. Accept `startDate` and `endDate` as ISO 8601 timestamps with an explicit UTC marker or offset. Apply inclusive bounds to the entity's primary transaction timestamp; V4.5 `incoming_fish` has `created_at` and does not define `received_at`.
6. Apply `status` filters only where the entity has an approved status enum. V4.5 batch status values remain exactly `active`, `completed`, and `voided`; do not invent status values for entities without a status field.
7. Default list ordering is newest first (`DESC`) by the primary transaction timestamp, with `id DESC` as a stable tie-breaker for pagination.
8. Grant the runtime role `INSERT` on `batches` and `batch_daily_sequences`, as required by the V4.5 atomic creation and sequence initialization flow. Keep `batches.status` and `batch_daily_sequences.last_number` as the only columns eligible for runtime updates; do not grant mutation rights on append-only transaction or audit tables.
9. Keep POS DDL and POS API implementation blocked until Gate V4.5 and the applicable POS decisions (`TBD-03`, `TBD-04`, and `TBD-06`) are resolved. Printer investigation does not authorize final integration.

## Consequences

- Shared pagination schemas may represent the approved query defaults, but POS request/response contracts remain provisional until `TBD-04` is closed.
- The local `Owner` provisioning command requires explicit non-placeholder environment values and reports missing configuration without printing secrets.
- The migration must verify the target database and existing schema before applying DDL; it must not reset or drop user data.
- Search and arbitrary sorting are not approved by this ADR.

## Verification

- V4.5 role, status, schema, and transaction invariants remain unchanged.
- V4.5 migration and seed are exercised against the explicitly configured local `pfi_db` only.
- No POS tables or POS endpoints are introduced under this ADR.
