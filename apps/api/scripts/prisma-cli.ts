import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../.env"), quiet: true });

const prismaCliPath = require.resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCliPath, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error("Unable to start Prisma CLI.");
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}