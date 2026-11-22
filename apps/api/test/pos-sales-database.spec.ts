import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  getLocalTestDatabaseUrl,
  getLocalTestRuntimeDatabaseUrl,
} from "../prisma/runtime-env";
import { DatabaseDependentTransactionGuard } from "../src/modules/receiving/dependent-transaction.guard";
import { RequestWithId } from "../src/common/http/request-id.middleware";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { ReceivingService } from "../src/modules/receiving/receiving.service";

const databaseSuite =
  process.env.RUN_V45_DB_TESTS === "1" ? describe : describe.skip;
const rollbackFixtureMessage = "Rollback P7-03 test fixtures";

databaseSuite("P7-03 PostgreSQL sale guards", () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: getLocalTestDatabaseUrl() } },
  });
  const runtime = new PrismaClient({
    datasources: { db: { url: getLocalTestRuntimeDatabaseUrl() } },
  });
  const dependentTransactionGuard = new DatabaseDependentTransactionGuard();
  const receivingService = new ReceivingService(
    runtime as unknown as PrismaService,
    dependentTransactionGuard,
  );
  const speciesCode = `P7-03-${randomUUID()}`;
  let speciesId: string;
  let productId: string;
  let fixtureSequence = 0;

  beforeAll(async () => {
    const species = await prisma.fishSpecies.create({
      data: { speciesCode, speciesName: "P7-03 Test" },
      select: { id: true },
    });
    speciesId = species.id;
    const category = await prisma.productCategory.findUniqueOrThrow({
      where: { code: "BENIH-IKAN" },
      select: { id: true },
    });
    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `P7-03-${randomUUID()}`,
        name: "P7-03 Test 3-5 cm",
        trackingMode: "BATCH_TRACKED",
        species: "P7-03 Test",
        sizeLabel: "3-5 cm",
        unit: "EKOR",
        unitPrice: new Prisma.Decimal("2500.00"),
        stockQuantity: null,
      },
      select: { id: true },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.$executeRaw`
      TRUNCATE TABLE
        "audit_logs", "batch_sale_readiness_histories", "fish_sale_voids",
        "fish_sales", "products", "product_categories", "fish_sale_prices",
        "incoming_fish_voids", "incoming_fish", "batches", "idempotency_keys",
        "sale_daily_sequences", "batch_daily_sequences", "users", "fish_species"
      RESTART IDENTITY
    `;
    await runtime.$disconnect();
    await prisma.$disconnect();
  });

  async function createPersistentFixture(): Promise<{
    batchId: string;
    userId: string;
  }> {
    fixtureSequence += 1;
    const userId = randomUUID();
    return prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          id: userId,
          name: "P7-04 runtime test",
          email: `${userId}@pfi.test`,
          passwordHash: "test-hash",
          role: "Kasir",
        },
      });
      const batch = await transaction.batch.create({
        data: {
          batchCode: `PFI-BCH-20000101-${String(fixtureSequence).padStart(3, "0")}`,
          status: "active",
          speciesId,
          createdBy: user.id,
        },
      });
      await transaction.incomingFish.create({
        data: {
          batchId: batch.id,
          entryDate: new Date("2000-01-01T00:00:00.000Z"),
          quantity: 100,
          purchaseCapital: new Prisma.Decimal("0.00"),
          shippingCapital: new Prisma.Decimal("0.00"),
          fishSize: "3-5 cm",
          createdBy: user.id,
        },
      });
      await transaction.batch.update({
        where: { id: batch.id },
        data: { saleReadiness: "SIAP_JUAL" },
      });

      return { batchId: batch.id, userId: user.id };
    });
  }

  async function currentStock(batchId: string): Promise<number> {
    const [result] = await prisma.$queryRaw<Array<{ stock: bigint }>>`
      SELECT "calculate_batch_stock"(${batchId}::uuid) AS stock
    `;
    return Number(result?.stock ?? 0n);
  }

  async function batchStatus(batchId: string): Promise<string> {
    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
      select: { status: true },
    });
    return batch.status;
  }

  async function withFixture(
    operation: (
      transaction: Prisma.TransactionClient,
      batchId: string,
      userId: string,
    ) => Promise<void>,
  ): Promise<void> {
    fixtureSequence += 1;
    const userId = randomUUID();

    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.user.create({
          data: {
            id: userId,
            name: "P7-03 database test",
            email: `${userId}@pfi.test`,
            passwordHash: "test-hash",
            role: "Kasir",
          },
        });
        const batch = await transaction.batch.create({
          data: {
            batchCode: `PFI-BCH-20000101-${String(fixtureSequence).padStart(3, "0")}`,
            status: "active",
            speciesId,
            createdBy: userId,
          },
        });
        await transaction.incomingFish.create({
          data: {
            batchId: batch.id,
            entryDate: new Date("2000-01-01T00:00:00.000Z"),
            quantity: 100,
            purchaseCapital: new Prisma.Decimal("0.00"),
            shippingCapital: new Prisma.Decimal("0.00"),
            fishSize: "3-5 cm",
            createdBy: userId,
          },
        });
        await transaction.batch.update({
          where: { id: batch.id },
          data: { saleReadiness: "SIAP_JUAL" },
        });

        await operation(transaction, batch.id, userId);
        throw new Error(rollbackFixtureMessage);
      }),
    ).rejects.toThrow(rollbackFixtureMessage);
  }

  async function expectRejectedInSavepoint(
    transaction: Prisma.TransactionClient,
    savepoint: string,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    await transaction.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
    await expect(operation()).rejects.toThrow();
    await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  }

  function saleData(
    batchId: string,
    userId: string,
    overrides: Record<string, unknown> = {},
  ) {
    fixtureSequence += 1;
    return {
      saleCode: `PFI-SAL-20000101-${String(fixtureSequence).padStart(3, "0")}`,
      batchId,
      productId,
      quantity: 10,
      unitPrice: new Prisma.Decimal("2500.00"),
      totalPrice: new Prisma.Decimal("25000.00"),
      paymentMethod: "cash",
      cashReceived: new Prisma.Decimal("30000.00"),
      changeAmount: new Prisma.Decimal("5000.00"),
      createdBy: userId,
      ...overrides,
    };
  }

  function requestContext(): RequestWithId {
    return {
      requestId: randomUUID(),
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as RequestWithId;
  }

  it("accepts cash and transfer sales with consistent payment snapshots", async () => {
    await withFixture(async (transaction, batchId, userId) => {
      await transaction.fishSale.create({
        data: saleData(batchId, userId),
      });
      await transaction.fishSale.create({
        data: saleData(batchId, userId, {
          paymentMethod: "transfer",
          cashReceived: null,
          changeAmount: null,
        }),
      });
    });
  });

  it("rejects invalid sale quantity, price, total, sale code, and payment fields", async () => {
    await withFixture(async (transaction, batchId, userId) => {
      const invalidSales = [
        { quantity: 0 },
        {
          unitPrice: new Prisma.Decimal("10000001.00"),
          totalPrice: new Prisma.Decimal("100000010.00"),
        },
        { totalPrice: new Prisma.Decimal("25001.00") },
        { paymentMethod: "cheque" },
        {
          cashReceived: new Prisma.Decimal("24999.00"),
          changeAmount: new Prisma.Decimal("-1.00"),
        },
        {
          paymentMethod: "transfer",
          cashReceived: new Prisma.Decimal("100.00"),
          changeAmount: null,
        },
        {
          paymentMethod: "transfer",
          cashReceived: null,
          changeAmount: new Prisma.Decimal("1.00"),
        },
        { saleCode: "INVALID-SALE-CODE" },
      ];

      for (const [index, overrides] of invalidSales.entries()) {
        await expectRejectedInSavepoint(
          transaction,
          `invalid_sale_${index}`,
          () =>
            transaction.fishSale.create({
              data: saleData(batchId, userId, overrides),
            }),
        );
      }
    });
  });

  it("permits one VOID and blocks updates or deletes of sale and VOID history", async () => {
    await withFixture(async (transaction, batchId, userId) => {
      const sale = await transaction.fishSale.create({
        data: saleData(batchId, userId),
      });
      await transaction.fishSaleVoid.create({
        data: { saleId: sale.id, voidedBy: userId },
      });

      await expectRejectedInSavepoint(transaction, "duplicate_sale_void", () =>
        transaction.fishSaleVoid.create({
          data: { saleId: sale.id, voidedBy: userId },
        }),
      );
      await expectRejectedInSavepoint(
        transaction,
        "sale_update",
        () =>
          transaction.$executeRaw`UPDATE "fish_sales" SET "quantity" = 11 WHERE "id" = ${sale.id}::uuid`,
      );
      await expectRejectedInSavepoint(
        transaction,
        "sale_delete",
        () =>
          transaction.$executeRaw`DELETE FROM "fish_sales" WHERE "id" = ${sale.id}::uuid`,
      );
      await expectRejectedInSavepoint(
        transaction,
        "sale_void_update",
        () =>
          transaction.$executeRaw`UPDATE "fish_sale_voids" SET "voided_at" = CURRENT_TIMESTAMP WHERE "sale_id" = ${sale.id}::uuid`,
      );
      await expectRejectedInSavepoint(
        transaction,
        "sale_void_delete",
        () =>
          transaction.$executeRaw`DELETE FROM "fish_sale_voids" WHERE "sale_id" = ${sale.id}::uuid`,
      );
    });
  });

  it("recalculates stock and transitions active to completed and back after sale VOID", async () => {
    const { batchId, userId } = await createPersistentFixture();
    expect(await currentStock(batchId)).toBe(100);
    expect(await batchStatus(batchId)).toBe("active");

    const sale = await runtime.fishSale.create({
      data: saleData(batchId, userId, {
        quantity: 100,
        totalPrice: new Prisma.Decimal("250000.00"),
        cashReceived: new Prisma.Decimal("250000.00"),
        changeAmount: new Prisma.Decimal("0.00"),
      }),
    });
    expect(await currentStock(batchId)).toBe(0);
    expect(await batchStatus(batchId)).toBe("completed");

    await expect(
      runtime.fishSale.create({
        data: saleData(batchId, userId, {
          quantity: 1,
          totalPrice: new Prisma.Decimal("2500.00"),
          cashReceived: new Prisma.Decimal("2500.00"),
          changeAmount: new Prisma.Decimal("0.00"),
        }),
      }),
    ).rejects.toThrow();

    const hasDependency = await prisma.$transaction((transaction) =>
      dependentTransactionGuard.hasDependentTransactions(transaction, batchId),
    );
    expect(hasDependency).toBe(true);

    await runtime.fishSaleVoid.create({
      data: { saleId: sale.id, voidedBy: userId },
    });
    expect(await currentStock(batchId)).toBe(100);
    expect(await batchStatus(batchId)).toBe("active");
  });

  it("rejects sale on voided batches and never reactivates them", async () => {
    const { batchId, userId } = await createPersistentFixture();
    await prisma.batch.update({
      where: { id: batchId },
      data: { status: "voided" },
    });

    await expect(
      runtime.fishSale.create({
        data: saleData(batchId, userId),
      }),
    ).rejects.toThrow();
    await expect(
      prisma.batch.update({
        where: { id: batchId },
        data: { status: "active" },
      }),
    ).rejects.toThrow();
    expect(await batchStatus(batchId)).toBe("voided");
  });

  it("prevents two concurrent runtime sales from overselling one batch", async () => {
    const { batchId, userId } = await createPersistentFixture();
    let readyCount = 0;
    let releaseReady!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });

    const createConcurrentSale = (saleCode: string) =>
      runtime.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT set_config('lock_timeout', '5000ms', true)`;
        readyCount += 1;
        if (readyCount === 2) releaseReady();
        await bothReady;
        return transaction.fishSale.create({
          data: saleData(batchId, userId, {
            saleCode,
            quantity: 60,
            totalPrice: new Prisma.Decimal("150000.00"),
            cashReceived: new Prisma.Decimal("150000.00"),
            changeAmount: new Prisma.Decimal("0.00"),
          }),
        });
      });

    const results = await Promise.allSettled([
      createConcurrentSale("PFI-SAL-20000102-001"),
      createConcurrentSale("PFI-SAL-20000102-002"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await currentStock(batchId)).toBe(40);
    expect(await batchStatus(batchId)).toBe("active");
    expect(await prisma.fishSale.count({ where: { batchId } })).toBe(1);
  });

  it("keeps sales as receiving-VOID dependencies even after the sale is VOIDed", async () => {
    const { batchId, userId } = await createPersistentFixture();
    const sale = await prisma.fishSale.create({
      data: saleData(batchId, userId),
    });

    const hasDependency = await prisma.$transaction((transaction) =>
      dependentTransactionGuard.hasDependentTransactions(transaction, batchId),
    );
    expect(hasDependency).toBe(true);

    await expect(
      receivingService.void(
        batchId,
        { reason: "Test receiving dependency" },
        { id: userId },
        randomUUID(),
        requestContext(),
      ),
    ).rejects.toMatchObject({ code: "HAS_DEPENDENT_TRANSACTIONS" });

    await prisma.fishSaleVoid.create({
      data: { saleId: sale.id, voidedBy: userId },
    });
    const stillHasDependency = await prisma.$transaction((transaction) =>
      dependentTransactionGuard.hasDependentTransactions(transaction, batchId),
    );
    expect(stillHasDependency).toBe(true);

    await expect(
      prisma.batch.update({
        where: { id: batchId },
        data: { status: "voided" },
      }),
    ).rejects.toThrow();
    expect(await batchStatus(batchId)).toBe("active");
  });

  it("serializes receiving VOID and sale on the same batch for TC-28", async () => {
    const { batchId, userId } = await createPersistentFixture();
    const saleAttempt = runtime.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT set_config('lock_timeout', '5000ms', true)`;
      return transaction.fishSale.create({
        data: saleData(batchId, userId, {
          quantity: 60,
          totalPrice: new Prisma.Decimal("150000.00"),
          cashReceived: new Prisma.Decimal("150000.00"),
          changeAmount: new Prisma.Decimal("0.00"),
        }),
      });
    });
    const receivingVoidAttempt = receivingService.void(
      batchId,
      { reason: "Concurrent receiving VOID test" },
      { id: userId },
      randomUUID(),
      requestContext(),
    );

    const results = await Promise.allSettled([
      saleAttempt,
      receivingVoidAttempt,
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const status = await batchStatus(batchId);
    const saleCount = await prisma.fishSale.count({ where: { batchId } });
    const receiptVoidCount = await prisma.incomingFishVoid.count({
      where: { incomingFish: { batchId } },
    });
    if (saleCount > 0) {
      expect(status).toBe("active");
      expect(receiptVoidCount).toBe(0);
      expect(results[1]).toMatchObject({
        status: "rejected",
        reason: { code: "HAS_DEPENDENT_TRANSACTIONS" },
      });
    } else {
      expect(status).toBe("voided");
      expect(receiptVoidCount).toBe(1);
      expect(results[0]).toMatchObject({ status: "rejected" });
    }
  });

  it("grants runtime only the approved sequence and append-only sale privileges", async () => {
    const [privileges] = await prisma.$queryRaw<
      Array<{
        schema_create: boolean;
        sequence_select: boolean;
        sequence_last_number_update: boolean;
        sequence_sale_date_update: boolean;
        sales_select: boolean;
        sales_sale_code_insert: boolean;
        sales_id_insert: boolean;
        sales_update: boolean;
        sales_delete: boolean;
        voids_select: boolean;
        voids_sale_id_insert: boolean;
        voids_update: boolean;
        voids_delete: boolean;
      }>
    >`
      SELECT
        has_schema_privilege('pfi_app_runtime', 'public', 'CREATE') AS schema_create,
        has_table_privilege('pfi_app_runtime', 'sale_daily_sequences', 'SELECT') AS sequence_select,
        has_column_privilege('pfi_app_runtime', 'sale_daily_sequences', 'last_number', 'UPDATE') AS sequence_last_number_update,
        has_column_privilege('pfi_app_runtime', 'sale_daily_sequences', 'sale_date', 'UPDATE') AS sequence_sale_date_update,
        has_table_privilege('pfi_app_runtime', 'fish_sales', 'SELECT') AS sales_select,
        has_column_privilege('pfi_app_runtime', 'fish_sales', 'sale_code', 'INSERT') AS sales_sale_code_insert,
        has_column_privilege('pfi_app_runtime', 'fish_sales', 'id', 'INSERT') AS sales_id_insert,
        has_table_privilege('pfi_app_runtime', 'fish_sales', 'UPDATE') AS sales_update,
        has_table_privilege('pfi_app_runtime', 'fish_sales', 'DELETE') AS sales_delete,
        has_table_privilege('pfi_app_runtime', 'fish_sale_voids', 'SELECT') AS voids_select,
        has_column_privilege('pfi_app_runtime', 'fish_sale_voids', 'sale_id', 'INSERT') AS voids_sale_id_insert,
        has_table_privilege('pfi_app_runtime', 'fish_sale_voids', 'UPDATE') AS voids_update,
        has_table_privilege('pfi_app_runtime', 'fish_sale_voids', 'DELETE') AS voids_delete
    `;

    expect(privileges).toEqual({
      schema_create: false,
      sequence_select: true,
      sequence_last_number_update: true,
      sequence_sale_date_update: false,
      sales_select: true,
      sales_sale_code_insert: true,
      sales_id_insert: true,
      sales_update: false,
      sales_delete: false,
      voids_select: true,
      voids_sale_id_insert: true,
      voids_update: false,
      voids_delete: false,
    });
  });
});
