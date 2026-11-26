# Supabase Production Provisioning for PFI API

This is a DBA/operator procedure aligned with [the V4.5 operational runbook](v45-operational-runbook.md), the approved V4.6 migrations, and the Vercel API entrypoint. It is not authorization to run a production change. Confirm the target, approved release, backup/restore readiness, operator access, and maintenance window first. This repository does not select backup retention, RPO/RTO, or cutover policy; have the owner decide those before go-live.

Never put credentials in this document, source control, command arguments, terminal history, or logs. Store the migration and runtime secrets separately in the approved secret manager. The local `db:provision-runtime-role` helper remains restricted to loopback `pfi_db`; do not use it for Supabase.

## 1. Create the Locked Runtime Role

Connect to the intended Supabase production database using a DBA credential and the Direct Connection endpoint on port `5432`. Before running migrations, create the runtime role without login or elevated privileges. This guarded block creates it if absent and stops if an existing role has unsafe attributes; it never repairs an existing role silently.

```sql
DO $bootstrap$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'pfi_app_runtime'
  ) THEN
    CREATE ROLE pfi_app_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
      NOBYPASSRLS NOINHERIT;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'pfi_app_runtime'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole
        OR rolreplication OR rolbypassrls OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'Existing pfi_app_runtime role has unsafe attributes; stop and review';
  END IF;
END
$bootstrap$;
```

Do not grant role memberships to `pfi_app_runtime`. Prisma migrations apply the approved, granular object grants to this role. Do not grant ownership, schema-wide `ALL`, or administrator privileges.

## 2. Deploy Approved Migrations Over Direct Connection

Use the separately controlled migration credential and the Supabase Direct Connection URL (port `5432`) in `MIGRATION_DATABASE_URL`. Verify the host, database, project, pending migration list, backup, and approval before deployment. Do not use the runtime credential or a pooler URL for migration DDL.

From the repository root, the approved wrapper command is:

```sh
npm run db:migrate:deploy --workspace @pfi/api
```

Run this only in the approved production change window with the secret injected by the operator's secret-management mechanism. Never paste the credential into the command. Do not run `db:provision-runtime-role` against Supabase, `prisma migrate reset`, `prisma db push`, or migration SQL manually. Stop and investigate if deploy reports an error; do not mark a failed migration rolled back by assumption.

## 3. Verify Role, Grants, and Protected Triggers

Run these checks as the DBA/migration operator after migration deployment and before enabling runtime login. Expected results: role is still `NOLOGIN` and non-privileged; no roles are inherited through membership; the table and column privilege reports match the grants defined by the approved migrations; both named triggers report `ENABLED`.

Role attributes and memberships:

```sql
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls, rolinherit
FROM pg_roles
WHERE rolname = 'pfi_app_runtime';

SELECT granted.rolname AS inherited_role
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
WHERE membership.member = 'pfi_app_runtime'::regrole;
```

Effective table privileges for every current public table/view:

```sql
SELECT namespace.nspname AS schema_name, relation.relname AS object_name,
       privilege.privilege_name,
       has_table_privilege(
         'pfi_app_runtime',
         format('%I.%I', namespace.nspname, relation.relname),
         privilege.privilege_name
       ) AS granted
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))
  AS privilege(privilege_name)
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY object_name, privilege.privilege_name;
```

Effective column privileges for every current public column:

```sql
SELECT table_name, column_name,
       has_column_privilege(
         'pfi_app_runtime', format('%I.%I', table_schema, table_name),
         column_name, 'SELECT'
       ) AS can_select,
       has_column_privilege(
         'pfi_app_runtime', format('%I.%I', table_schema, table_name),
         column_name, 'INSERT'
       ) AS can_insert,
       has_column_privilege(
         'pfi_app_runtime', format('%I.%I', table_schema, table_name),
         column_name, 'UPDATE'
       ) AS can_update,
       has_column_privilege(
         'pfi_app_runtime', format('%I.%I', table_schema, table_name),
         column_name, 'REFERENCES'
       ) AS can_reference
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

The effective reports must show the V4.5/V4.6 grants intended by the migrations and no unapproved writes. In particular, runtime must not have table-level `UPDATE` or `DELETE` on `fish_sales`; it must not have `UPDATE`/`DELETE` on append-only sales, receiving, VOID, or audit history. Review every `true` in the reports against the migration SQL; do not add grants to make an application error disappear.

Verify both protected triggers are present and enabled:

```sql
WITH expected(trigger_name, table_name) AS (
  VALUES ('batches_status_transition_guard', 'batches'),
         ('fish_sales_immutable', 'fish_sales')
)
SELECT expected.trigger_name, expected.table_name,
       CASE
         WHEN trigger.oid IS NULL THEN 'MISSING'
         WHEN trigger.tgenabled IN ('O', 'A') THEN 'ENABLED'
         WHEN trigger.tgenabled = 'R' THEN 'REPLICA ONLY'
         ELSE 'DISABLED'
       END AS trigger_status
FROM expected
LEFT JOIN pg_class relation
  ON relation.relnamespace = 'public'::regnamespace
 AND relation.relname = expected.table_name
LEFT JOIN pg_trigger trigger
  ON trigger.tgrelid = relation.oid
 AND trigger.tgname = expected.trigger_name
 AND NOT trigger.tgisinternal
ORDER BY expected.table_name;
```

Both rows must report `ENABLED`. A missing, disabled, or replica-only guard blocks activation.

## 4. Set the Separate Runtime Password and Enable Login

Only after step 3 passes, set a unique, generated runtime password using the DBA's secure interactive prompt. In `psql`, use `\password pfi_app_runtime`; the password is entered interactively and is not stored in SQL history. Then enable login:

```sql
ALTER ROLE pfi_app_runtime WITH LOGIN;
```

Do not place a password literal in `ALTER ROLE`, SQL files, shell arguments, logs, or chat. Save this password only in the runtime secret store. Re-run the role attribute query from step 3: expect `rolcanlogin = true` and all administrator flags false.

Configure the Vercel production environment with `DATABASE_URL` using the Supabase pooler endpoint and username `pfi_app_runtime.<project_ref>`. The project reference must be 15–32 lowercase ASCII letters or digits. A direct/local runtime URL may use username `pfi_app_runtime`. Never use the Supabase `postgres`/administrator user, a migration owner, or `MIGRATION_DATABASE_URL` as the API runtime credential. Inject `MIGRATION_DATABASE_URL` only into the separately approved migration job, not the deployed API function.

Set `FRONTEND_URL` to the canonical web origin and `CORS_ALLOWED_ORIGINS` to the comma-separated allow-list, for example `https://web.example.com,https://admin.example.com`. Do not use `*`. Configure the same required non-database API secrets in Vercel's Production environment through its secret UI/CLI, not in `vercel.json`; keep Preview secrets and database targets separate from Production.

## 5. Confirm Runtime Cannot Change or Delete Sales

Using a connection authenticated as `pfi_app_runtime` (not `SET ROLE` from a superuser session), run each statement separately in the intended environment. `WHERE false` guarantees no row can be changed even if a privilege was accidentally granted. Each DML statement must fail with `permission denied`; then issue `ROLLBACK` to clear the failed transaction before the next test. If either statement succeeds, stop deployment, revoke/review the unintended grant through a reviewed DBA change, and repeat all verification.

```sql
BEGIN;
UPDATE public.fish_sales SET sale_code = sale_code WHERE false;
ROLLBACK;
```

```sql
BEGIN;
DELETE FROM public.fish_sales WHERE false;
ROLLBACK;
```

These are negative permission checks only; they do not replace the isolated database regression suite. Never test mutations without the false predicate, and never modify the local `pfi_db` runtime-role guard to perform production provisioning.

## Vercel API Deployment Notes

Set the Vercel project Root Directory to `apps/api` and use the repository's npm workspace/lockfile installation. The function entrypoint is `api/index.ts`; `vercel.json` routes only `/api/v1` requests to it and restores that path before Nest routing. The handler initializes and reuses the Express application and does not call `app.listen()`.

The API reads `CORS_ALLOWED_ORIGINS` (comma-separated) and `FRONTEND_URL`; configure exact HTTPS origins for Production. Verify health/read-only routes, authentication, RBAC, request IDs, and a controlled smoke test before opening traffic. Printing/device compatibility, backup/restore rehearsal, target-specific connectivity, and full production smoke tests remain operational gates; they are not verified by local typecheck/build.
