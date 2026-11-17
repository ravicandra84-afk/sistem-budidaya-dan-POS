import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { getLocalTestDatabaseUrl } from "../prisma/runtime-env";

dotenv.config({ path: resolve(__dirname, "../../../.env"), quiet: true });

const args = process.argv.slice(2);
if (args[0] !== "migrate" || args[1] !== "deploy") {
  throw new Error(
    "Only additive Prisma migrate deploy is allowed for pfi_test.",
  );
}

const testDatabaseUrl = getLocalTestDatabaseUrl();
const prismaCliPath = require.resolve("prisma/build/index.js");
const result = spawnSync(
  process.execPath,
  [prismaCliPath, ...args, "--schema", "prisma/schema.prisma"],
  {
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      MIGRATION_DATABASE_URL: testDatabaseUrl,
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error("Unable to start Prisma test database migration.");
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
