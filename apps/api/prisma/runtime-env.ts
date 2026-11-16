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
