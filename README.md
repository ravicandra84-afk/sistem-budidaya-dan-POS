# PFI Operational System

Internal operational system for fish receiving, batch management, and POS, implemented under the approved V4.5 and POS gates.

## Local setup

Requirements: Node.js 22.12+, npm 11, and PostgreSQL 13+.

1. Copy `.env.example` to `.env`. Replace every `CHANGE_ME` value and use only local PostgreSQL credentials and a generated JWT secret. Use database `pfi_db`; keep the migration connection separate from the application runtime connection.
2. Install workspace dependencies with `npm install`.
3. Generate the Prisma client with `npm run db:generate`.
4. Create the local `pfi_app_runtime` role as `NOLOGIN` with `npm run db:provision-runtime-role`, then provision its login credential outside repository files. The migration role must be allowed to create schema objects and grant privileges.
5. Apply additive V4.5 migrations with `npm run db:migrate:deploy`.
6. Seed official fish species with `npm run db:seed:species`.
7. Set `SEED_INITIAL_OWNER_NAME`, `SEED_INITIAL_OWNER_EMAIL`, and `SEED_INITIAL_OWNER_PASSWORD` in local `.env`, then run `npm run db:provision-owner`. Existing accounts are not changed.

Development migration, seed, and Owner provisioning commands reject non-local hosts and databases other than `pfi_db`. The test migration command and PostgreSQL test suites are separately restricted to localhost `pfi_test`; never point them at `pfi_db` or production.

## Development workflow

1. Create a short-lived branch from `main`. Use `feat/<task-id>-<name>`, `fix/<task-id>-<name>`, `docs/<task-id>-<name>`, or `chore/<task-id>-<name>`.
2. Start the API and web app in separate terminals from the repository root with `npm run dev --workspace @pfi/api` and `npm run dev --workspace @pfi/web`. The API listens on port 4000 and the web app on port 3000 by default.
3. Before opening a pull request, run the checks below that apply to the change. Include the exact commands and results in the PR; do not report checks that were not run.
4. Open a pull request against `main` with the task ID, scope, relevant requirements, verification results, and any migration or environment impact. Request a peer review; merge only after approval and applicable checks pass. Do not commit directly to `main`.

The repository does not yet select a CI vendor, so these checks are currently run by the developer rather than claimed as enforced CI gates. Keep branches small and delete them after merge.

## Environment separation

| Environment       | Configuration                                                                                                                                | Database and credentials                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local development | An untracked root `.env` copied from `.env.example`; use `NODE_ENV=development` and localhost URLs.                                          | `pfi_db`; local-only `MIGRATION_DATABASE_URL` and `DATABASE_URL`. Provision the initial Owner only with local credentials.                                               |
| Automated tests   | Use `TEST_DATABASE_URL` from the local `.env`; test database scripts enforce localhost and `pfi_test`.                                       | `pfi_test` only. Never run test cleanup or test migrations against development, staging, or production data.                                                             |
| Staging           | Inject environment variables through the chosen hosting/platform's secret configuration; do not copy the development `.env`.                 | Use a dedicated staging database and credentials, separate from local and production. Hosting/deployment is not selected by this repository yet.                         |
| Production        | Inject environment variables through the chosen hosting/platform's secret configuration; do not store a production `.env` in the repository. | Use production-only credentials. Expose the migration connection only to the controlled migration step; the running API receives the least-privilege runtime connection. |

`.env` and `.env.*` files are ignored by Git; `.env.example` is the only tracked environment template. Never place real secrets in the template, logs, pull requests, or committed files. The web app's `NEXT_PUBLIC_API_BASE_URL` is public build configuration, not a secret. Deployment-specific URLs, secret storage, and CI remain subject to the deployment/CI decision.

## Standard checks

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run db:test:migrate --workspace @pfi/api` (applies additive migrations only to local `pfi_test`)
- `npm run db:test:seed --workspace @pfi/api` (idempotently seeds official species only to local `pfi_test`)
- `RUN_V45_DB_TESTS=1 npm run test --workspace @pfi/api -- --runInBand` (local `pfi_test` only; fixtures are cleaned after the suite)

The API uses `DATABASE_URL` at runtime. Prisma migrations, local seed commands, and initial Owner provisioning use `MIGRATION_DATABASE_URL`; credentials must be supplied through `.env` and must never be committed.

## Scope gates

The initial schema contains only the eight V4.5 tables. POS tables, DDL, and APIs remain blocked until Gate V4.5 and the applicable Gate POS decisions are complete. See [ADR 0001](docs/adr/0001-monorepo-stack-and-list-contract.md).
