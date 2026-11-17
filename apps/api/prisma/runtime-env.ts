import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ path: resolve(__dirname, "../../../.env"), quiet: true });

const migrationUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("postgresql://"));

export function getLocalMigrationUrl(): string {
  const parsed = migrationUrlSchema.safeParse(
    process.env.MIGRATION_DATABASE_URL,
  );

  if (!parsed.success) {
    throw new Error("MIGRATION_DATABASE_URL is missing or invalid.");
  }

  const url = new URL(parsed.data);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (!allowedHosts.has(url.hostname) || databaseName !== "pfi_db") {
    throw new Error(
      "Local database commands are restricted to localhost database pfi_db.",
    );
  }

  return parsed.data;
}

export function getLocalTestDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const parsed = migrationUrlSchema.safeParse(environment.TEST_DATABASE_URL);

  if (!parsed.success) {
    throw new Error("TEST_DATABASE_URL is missing or invalid.");
  }

  const url = new URL(parsed.data);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (!allowedHosts.has(url.hostname) || databaseName !== "pfi_test") {
    throw new Error(
      "Database tests are restricted to localhost database pfi_test.",
    );
  }

  return parsed.data;
}

export function getLocalTestRuntimeDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const testUrl = new URL(getLocalTestDatabaseUrl(environment));
  const parsed = migrationUrlSchema.safeParse(environment.DATABASE_URL);

  if (!parsed.success) {
    throw new Error("DATABASE_URL is missing or invalid.");
  }

  const runtimeUrl = new URL(parsed.data);
  const databaseName = decodeURIComponent(
    runtimeUrl.pathname.replace(/^\//, ""),
  );
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  if (
    !allowedHosts.has(runtimeUrl.hostname) ||
    runtimeUrl.hostname !== testUrl.hostname ||
    runtimeUrl.port !== testUrl.port ||
    databaseName !== "pfi_db" ||
    decodeURIComponent(runtimeUrl.username) !== "pfi_app_runtime"
  ) {
    throw new Error(
      "Test runtime access requires the local pfi_app_runtime role and pfi_test database.",
    );
  }

  runtimeUrl.pathname = testUrl.pathname;
  return runtimeUrl.toString();
}
