import { PrismaClient } from "@prisma/client";
import { getLocalTestDatabaseUrl } from "../prisma/runtime-env";

const species = [
  { speciesCode: "LELE", speciesName: "Lele" },
  { speciesCode: "PATIN", speciesName: "Patin" },
  { speciesCode: "GURAME-MERAH", speciesName: "Gurame Merah" },
  { speciesCode: "GURAME-HITAM", speciesName: "Gurame Hitam" },
  { speciesCode: "NILA-HITAM", speciesName: "Nila Hitam" },
  { speciesCode: "NILA-MERAH", speciesName: "Nila Merah" },
];

async function seedTestDatabase(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: getLocalTestDatabaseUrl() } },
  });

  try {
    const result = await prisma.fishSpecies.createMany({
      data: species,
      skipDuplicates: true,
    });
    console.log(
      `Test species seed complete: ${result.count} inserted; existing rows were unchanged.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

seedTestDatabase().catch(() => {
  console.error("Test database species seed failed.");
  process.exitCode = 1;
});
