import { PrismaClient } from "@prisma/client";
import { getLocalMigrationUrl } from "./runtime-env";

async function provisionRuntimeRole(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: getLocalMigrationUrl() } } });

  try {
    const [existingRole] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'pfi_app_runtime'
      ) AS exists
    `;

    if (existingRole?.exists) {
      console.log("Runtime role already exists; no role attributes were changed.");
      return;
    }

    await prisma.$executeRaw`CREATE ROLE pfi_app_runtime NOLOGIN`;
    console.log("Created pfi_app_runtime with NOLOGIN; configure its login credential outside migrations.");
  } finally {
    await prisma.$disconnect();
  }
}

provisionRuntimeRole().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Runtime role provisioning failed.");
  process.exitCode = 1;
});