# PFI Operational System

Internal operational system for fish receiving, batch management, and POS, implemented under the approved V4.5 and POS gates.

## Local setup

Requirements: Node.js 22.12+, npm 11, and PostgreSQL 13+.

1. Copy `.env.example` to `.env` and set local PostgreSQL connection strings and a random JWT secret. Use database `pfi_db`; keep the migration connection separate from the application runtime connection.
2. Install workspace dependencies with `npm install`.
3. Generate the Prisma client with `npm run db:generate`.
4. Create the local `pfi_app_runtime` role as `NOLOGIN` with `npm run db:provision-runtime-role`, then provision its login credential outside repository files. The migration role must be allowed to create schema objects and grant privileges.
5. Apply additive V4.5 migrations with `npm run db:migrate:deploy`.
6. Seed official fish species with `npm run db:seed:species`.
7. Set `SEED_INITIAL_OWNER_NAME`, `SEED_INITIAL_OWNER_EMAIL`, and `SEED_INITIAL_OWNER_PASSWORD` in local `.env`, then run `npm run db:provision-owner`. Existing accounts are not changed.

Local database commands reject non-local hosts and databases other than `pfi_db`. Do not point development, migration, seed, or test commands at production.

## Checks

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `RUN_V45_DB_TESTS=1 npm run test --workspace @pfi/api -- --runInBand` (local `pfi_db` only; fixtures roll back)

The API uses `DATABASE_URL` at runtime. Prisma migrations, local seed commands, and initial Owner provisioning use `MIGRATION_DATABASE_URL`; credentials must be supplied through `.env` and must never be committed.

## Scope gates

The initial schema contains only the eight V4.5 tables. POS tables, DDL, and APIs remain blocked until Gate V4.5 and the applicable Gate POS decisions are complete. See [ADR 0001](docs/adr/0001-monorepo-stack-and-list-contract.md).
