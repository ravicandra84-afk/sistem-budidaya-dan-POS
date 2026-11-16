import { PrismaClient } from "@prisma/client";
import { getLocalMigrationUrl } from "./runtime-env";

const species = [
  { speciesCode: "LELE", speciesName: "Lele" },
  { speciesCode: "PATIN", speciesName: "Patin" },
  { speciesCode: "GURAME-MERAH", speciesName: "Gurame Merah" },
  { speciesCode: "GURAME-HITAM", speciesName: "Gurame Hitam" },
  { speciesCode: "NILA-HITAM", speciesName: "Nila Hitam" },
  { speciesCode: "NILA-MERAH", speciesName: "Nila Merah" },
];

async function seedSpecies(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: { db: { url: getLocalMigrationUrl() } },
  });

  try {
    const result = await prisma.fishSpecies.createMany({
      data: species,
      skipDuplicates: true,
    });
    console.log(
      `Species seed complete: ${result.count} inserted; existing rows were unchanged.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

seedSpecies().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Species seed failed.",
  );
  process.exitCode = 1;
});
