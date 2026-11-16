import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getLocalMigrationUrl } from "../prisma/runtime-env";

const databaseSuite = process.env.RUN_V45_DB_TESTS === "1" ? describe : describe.skip;
const rollbackFixtureMessage = "Rollback V4.5 test fixtures";

databaseSuite("V4.5 PostgreSQL guards", () => {
  const prisma = new PrismaClient({ datasources: { db: { url: getLocalMigrationUrl() } } });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a batch that has no receipt when the transaction commits", async () => {
    const userId = randomUUID();

    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.user.create({
          data: {
            id: userId,
            name: "V4.5 database test",
            email: `${userId}@pfi.test`,
            passwordHash: "test-hash",
            role: "Owner",
          },
        });
        await transaction.batch.create({
          data: {
            batchCode: "PFI-BCH-20000101-001",
            status: "active",
            species: {
              connect: {
                speciesCode: "LELE",
              },
            },
            creator: {
              connect: {
                id: userId,
              },
            },
          },
        });
      }),
    ).rejects.toThrow();
  });

  it("blocks receipt updates and deletes while rolling back the fixture", async () => {
    const fixtureId = randomUUID();

    await expect(
      prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            id: fixtureId,
            name: "V4.5 database test",
            email: `${fixtureId}@pfi.test`,
            passwordHash: "test-hash",
            role: "Owner",
          },
        });
        const batch = await transaction.batch.create({
          data: {
            batchCode: "PFI-BCH-20000101-002",
            status: "active",
            species: {
              connect: {
                speciesCode: "LELE",
              },
            },
            creator: {
              connect: {
                id: user.id,
              },
            },
          },
        });
        const receipt = await transaction.incomingFish.create({
          data: {
            batchId: batch.id,
            entryDate: new Date("2000-01-01T00:00:00.000Z"),
            quantity: 1,
            purchaseCapital: new Prisma.Decimal("0.00"),
            shippingCapital: new Prisma.Decimal("0.00"),
            fishSize: "2-4 cm",
            createdBy: user.id,
          },
        });

        await transaction.$executeRaw`SAVEPOINT receipt_update_probe`;
        await expect(
          transaction.$executeRaw`UPDATE "incoming_fish" SET "quantity" = 2 WHERE "id" = ${receipt.id}::uuid`,
        ).rejects.toThrow();
        await transaction.$executeRaw`ROLLBACK TO SAVEPOINT receipt_update_probe`;

        await transaction.$executeRaw`SAVEPOINT receipt_delete_probe`;
        await expect(
          transaction.$executeRaw`DELETE FROM "incoming_fish" WHERE "id" = ${receipt.id}::uuid`,
        ).rejects.toThrow();
        await transaction.$executeRaw`ROLLBACK TO SAVEPOINT receipt_delete_probe`;

        throw new Error(rollbackFixtureMessage);
      }),
    ).rejects.toThrow(rollbackFixtureMessage);
  });

  it("rejects a future entry date in the Asia/Jakarta business timezone", async () => {
    const userId = randomUUID();
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    await expect(
      prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            id: userId,
            name: "V4.5 database test",
            email: `${userId}@pfi.test`,
            passwordHash: "test-hash",
            role: "Owner",
          },
        });
        const batch = await transaction.batch.create({
          data: {
            batchCode: "PFI-BCH-20000101-003",
            status: "active",
            species: {
              connect: {
                speciesCode: "LELE",
              },
            },
            creator: {
              connect: {
                id: user.id,
              },
            },
          },
        });

        await transaction.incomingFish.create({
          data: {
            batchId: batch.id,
            entryDate: futureDate,
            quantity: 1,
            purchaseCapital: new Prisma.Decimal("0.00"),
            shippingCapital: new Prisma.Decimal("0.00"),
            fishSize: "2-4 cm",
            createdBy: user.id,
          },
        });
      }),
    ).rejects.toThrow();
  });

  it("does not reactivate a voided batch", async () => {
    const fixtureId = randomUUID();

    await expect(
      prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            id: fixtureId,
            name: "V4.5 database test",
            email: `${fixtureId}@pfi.test`,
            passwordHash: "test-hash",
            role: "Owner",
          },
        });
        const batch = await transaction.batch.create({
          data: {
            batchCode: "PFI-BCH-20000101-004",
            status: "active",
            species: {
              connect: {
                speciesCode: "LELE",
              },
            },
            creator: {
              connect: {
                id: user.id,
              },
            },
          },
        });
        await transaction.incomingFish.create({
          data: {
            batchId: batch.id,
            entryDate: new Date("2000-01-01T00:00:00.000Z"),
            quantity: 1,
            purchaseCapital: new Prisma.Decimal("0.00"),
            shippingCapital: new Prisma.Decimal("0.00"),
            fishSize: "2-4 cm",
            createdBy: user.id,
          },
        });
        await transaction.batch.update({ where: { id: batch.id }, data: { status: "voided" } });

        await transaction.$executeRaw`SAVEPOINT status_transition_probe`;
        await expect(
          transaction.$executeRaw`UPDATE "batches" SET "status" = 'active' WHERE "id" = ${batch.id}::uuid`,
        ).rejects.toThrow();
        await transaction.$executeRaw`ROLLBACK TO SAVEPOINT status_transition_probe`;

        throw new Error(rollbackFixtureMessage);
      }),
    ).rejects.toThrow(rollbackFixtureMessage);
  });
});