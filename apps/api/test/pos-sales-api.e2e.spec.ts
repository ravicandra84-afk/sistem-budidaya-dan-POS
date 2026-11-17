import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as jwt from "jsonwebtoken";
import request from "supertest";
import { POS_ROLES } from "@pfi/shared";
import { ApiExceptionFilter } from "../src/common/http/api-exception.filter";
import { configureApiSecurity } from "../src/common/http/security";
import { loadApiEnvironment } from "../src/config/env";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import {
  getLocalTestDatabaseUrl,
  getLocalTestRuntimeDatabaseUrl,
} from "../prisma/runtime-env";

const databaseSuite =
  process.env.RUN_V45_DB_TESTS === "1" ? describe : describe.skip;
const environment = loadApiEnvironment();
const endpoint = "/api/v1/pos/sales";

type Actor = { id: string; name: string; role: string };
type SaleFixture = { batchId: string; user: Actor };

databaseSuite("POS create-sale HTTP integration", () => {
  const admin = new PrismaClient({
    datasources: { db: { url: getLocalTestDatabaseUrl() } },
  });
  const runtime = new PrismaClient({
    datasources: { db: { url: getLocalTestRuntimeDatabaseUrl() } },
  });
  let app: INestApplication;
  let fixtureSequence = 0;
  let saleAuditFailureInstalled = false;

  async function createActor(role: string): Promise<Actor> {
    const id = randomUUID();
    return admin.user.create({
      data: {
        id,
        name: `POS ${role}`,
        email: `${id}@pos.test`,
        passwordHash: "test-only-hash",
        role,
      },
      select: { id: true, name: true, role: true },
    });
  }

  function accessToken(actor: Actor): string {
    return jwt.sign({ role: actor.role }, environment.JWT_SECRET, {
      algorithm: "HS256",
      audience: environment.JWT_AUDIENCE,
      expiresIn: "8h",
      issuer: environment.JWT_ISSUER,
      subject: actor.id,
    });
  }

  async function createFixture(
    role: string,
    options: { withPrice?: boolean; stock?: number; price?: number } = {},
  ): Promise<SaleFixture> {
    fixtureSequence += 1;
    const user = await createActor(role);
    const batch = await admin.$transaction(async (transaction) => {
      const species = await transaction.fishSpecies.create({
        data: {
          speciesCode: `POS-TEST-${String(fixtureSequence).padStart(3, "0")}`,
          speciesName: "POS Test",
        },
        select: { id: true },
      });
      const createdBatch = await transaction.batch.create({
        data: {
          batchCode: `PFI-BCH-20000201-${String(fixtureSequence).padStart(3, "0")}`,
          status: "active",
          speciesId: species.id,
          createdBy: user.id,
        },
      });
      await transaction.incomingFish.create({
        data: {
          batchId: createdBatch.id,
          entryDate: new Date("2000-02-01T00:00:00.000Z"),
          quantity: options.stock ?? 100,
          purchaseCapital: new Prisma.Decimal("0.00"),
          shippingCapital: new Prisma.Decimal("0.00"),
          fishSize: "3-5 cm",
          createdBy: user.id,
        },
      });
      if (options.withPrice !== false) {
        await transaction.fishSalePrice.create({
          data: {
            speciesId: species.id,
            fishSize: "3-5 cm",
            pricePerFish: BigInt(options.price ?? 2500),
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
      }
      return createdBatch;
    });
    return { batchId: batch.id, user };
  }

  function cashPayload(
    batchId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      batch_id: batchId,
      quantity: 10,
      expected_unit_price: 2500,
      payment_method: "cash",
      cash_received: 30000,
      ...overrides,
    };
  }

  function postSale(
    fixture: SaleFixture,
    payload: Record<string, unknown>,
    idempotencyKey: string = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post(endpoint)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);
  }

  function getSales(fixture: SaleFixture, query = "") {
    return request(app.getHttpServer())
      .get(`${endpoint}${query ? `?${query}` : ""}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`);
  }

  function getSale(fixture: SaleFixture, saleId: string) {
    return request(app.getHttpServer())
      .get(`${endpoint}/${saleId}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`);
  }

  function voidSale(
    fixture: SaleFixture,
    saleId: string,
    idempotencyKey = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post(`${endpoint}/${saleId}/void`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({});
  }

  async function createSaleForFixture(
    fixture: SaleFixture,
    quantity = 5,
  ): Promise<string> {
    const response = await postSale(
      fixture,
      cashPayload(fixture.batchId, {
        quantity,
        cash_received: quantity * 2500,
      }),
    );
    expect(response.status).toBe(201);
    return response.body.data.sale.id as string;
  }

  async function installSaleAuditFailure(): Promise<void> {
    await admin.$executeRaw`
      CREATE FUNCTION "p7_test_reject_create_sale_audit"() RETURNS trigger AS $$
      BEGIN
        IF NEW."action" = 'CREATE_SALE' THEN
          RAISE EXCEPTION 'P7 test audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;
    await admin.$executeRaw`
      CREATE TRIGGER "p7_test_reject_create_sale_audit"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "p7_test_reject_create_sale_audit"()
    `;
    saleAuditFailureInstalled = true;
  }

  async function removeSaleAuditFailure(): Promise<void> {
    if (!saleAuditFailureInstalled) return;
    await admin.$executeRaw`
      DROP TRIGGER IF EXISTS "p7_test_reject_create_sale_audit" ON "audit_logs"
    `;
    await admin.$executeRaw`
      DROP FUNCTION IF EXISTS "p7_test_reject_create_sale_audit"()
    `;
    saleAuditFailureInstalled = false;
  }

  beforeAll(async () => {
    await admin.$connect();
    await runtime.$connect();
    await admin.$executeRaw`
      TRUNCATE TABLE
        "audit_logs", "fish_sale_voids", "fish_sales", "fish_sale_prices",
        "incoming_fish_voids", "incoming_fish", "batches", "idempotency_keys",
        "sale_daily_sequences", "batch_daily_sequences", "users", "fish_species"
      RESTART IDENTITY
    `;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(runtime)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    configureApiSecurity(app, environment);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await removeSaleAuditFailure();
    if (app) await app.close();
    await admin.$executeRaw`
      TRUNCATE TABLE
        "audit_logs", "fish_sale_voids", "fish_sales", "fish_sale_prices",
        "incoming_fish_voids", "incoming_fish", "batches", "idempotency_keys",
        "sale_daily_sequences", "batch_daily_sequences", "users", "fish_species"
      RESTART IDENTITY
    `;
    await runtime.$disconnect();
    await admin.$disconnect();
  }, 30_000);

  it.each(POS_ROLES)(
    "allows %s to create a cash sale and caches an identical retry",
    async (role) => {
      const fixture = await createFixture(role);
      const payload = cashPayload(fixture.batchId);
      const key = randomUUID();

      const response = await postSale(fixture, payload, key);
      expect(response.status).toBe(201);
      expect(response.body.meta.idempotency_status).toBe("executed");
      expect(response.body.data.sale).toMatchObject({
        batch_id: fixture.batchId,
        quantity: 10,
        unit_price: 2500,
        total_amount: 25000,
        payment_method: "cash",
        cash_received: 30000,
        change_amount: 5000,
        status: "active",
      });
      expect(Object.keys(response.body.data.receipt)).toEqual([
        "company_name",
        "transaction_date_time",
        "species_name",
        "fish_size",
        "quantity",
        "unit_price",
        "total_payment",
        "payment_method",
        "cashier_name",
      ]);
      expect(response.body.data.receipt).not.toHaveProperty("sale_code");
      expect(response.body.data.receipt).not.toHaveProperty("batch_code");

      const retry = await postSale(fixture, payload, key);
      expect(retry.status).toBe(201);
      expect(retry.body.meta.idempotency_status).toBe("cached");
      expect(retry.body.data.sale.id).toBe(response.body.data.sale.id);
      expect(
        await admin.fishSale.count({ where: { batchId: fixture.batchId } }),
      ).toBe(1);
      expect(
        await admin.auditLog.count({
          where: {
            entityId: response.body.data.sale.id,
            action: "CREATE_SALE",
          },
        }),
      ).toBe(1);
    },
  );

  it("creates a fully confirmed transfer sale with no cash fields", async () => {
    const fixture = await createFixture("Kasir");
    const response = await postSale(fixture, {
      batch_id: fixture.batchId,
      quantity: 4,
      expected_unit_price: 2500,
      payment_method: "transfer",
      transfer_confirmed: true,
    });

    expect(response.status).toBe(201);
    expect(response.body.data.sale).toMatchObject({
      payment_method: "transfer",
      cash_received: null,
      change_amount: null,
      total_amount: 10000,
    });
  });

  it("denies Kepala Budidaya and rejects missing or invalid UUIDv4 idempotency keys", async () => {
    const kepala = await createFixture("Kepala Budidaya");
    const denied = await postSale(kepala, cashPayload(kepala.batchId));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    const kasir = await createFixture("Kasir");
    const missingKey = await request(app.getHttpServer())
      .post(endpoint)
      .set("Authorization", `Bearer ${accessToken(kasir.user)}`)
      .send(cashPayload(kasir.batchId));
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");

    const invalidKey = await postSale(
      kasir,
      cashPayload(kasir.batchId),
      "not-a-uuid",
    );
    expect(invalidKey.status).toBe(400);
    expect(invalidKey.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("returns safe errors for missing price, stale price, and insufficient cash", async () => {
    const noPrice = await createFixture("Kasir", { withPrice: false });
    const noPriceResponse = await postSale(
      noPrice,
      cashPayload(noPrice.batchId),
    );
    expect(noPriceResponse.status).toBe(409);
    expect(noPriceResponse.body.error.code).toBe("PRICE_NOT_CONFIGURED");

    const changedPrice = await createFixture("Kasir", { price: 3000 });
    const stalePriceResponse = await postSale(
      changedPrice,
      cashPayload(changedPrice.batchId),
    );
    expect(stalePriceResponse.status).toBe(409);
    expect(stalePriceResponse.body.error.code).toBe("PRICE_CHANGED");
    expect(stalePriceResponse.body.error.details).toEqual({ unit_price: 3000 });

    const shortCash = await createFixture("Kasir");
    const shortCashResponse = await postSale(
      shortCash,
      cashPayload(shortCash.batchId, { cash_received: 100 }),
    );
    expect(shortCashResponse.status).toBe(400);
    expect(shortCashResponse.body.error.code).toBe("INVALID_PAYLOAD");
    expect(JSON.stringify(shortCashResponse.body)).not.toMatch(
      /Prisma|SELECT|postgres/i,
    );
  });

  it("rolls back sale, sequence, and idempotency when required audit insertion fails", async () => {
    const fixture = await createFixture("Kasir");
    const key = randomUUID();
    const beforeSequence = await admin.saleDailySequence.findUnique({
      where: {
        saleDate: new Date(
          `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
        ),
      },
    });
    await installSaleAuditFailure();

    try {
      const response = await postSale(
        fixture,
        cashPayload(fixture.batchId),
        key,
      );
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(JSON.stringify(response.body)).not.toMatch(
        /P7 test audit failure|23514|SQL/i,
      );
      expect(
        await admin.fishSale.count({ where: { batchId: fixture.batchId } }),
      ).toBe(0);
      expect(
        await admin.idempotencyKey.count({
          where: { userId: fixture.user.id, endpoint, idempotencyKey: key },
        }),
      ).toBe(0);

      const afterSequence = await admin.saleDailySequence.findUnique({
        where: {
          saleDate: new Date(
            `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
          ),
        },
      });
      expect(afterSequence?.lastNumber ?? 0n).toBe(
        beforeSequence?.lastNumber ?? 0n,
      );
    } finally {
      await removeSaleAuditFailure();
    }
  });

  it("returns cached response only for the same key and payload", async () => {
    const fixture = await createFixture("Owner");
    const key = randomUUID();
    const first = await postSale(fixture, cashPayload(fixture.batchId), key);
    expect(first.status).toBe(201);

    const mismatch = await postSale(
      fixture,
      cashPayload(fixture.batchId, { quantity: 11, cash_received: 30000 }),
      key,
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(
      await admin.fishSale.count({ where: { batchId: fixture.batchId } }),
    ).toBe(1);
  });

  it("lists sales with ADR pagination, inclusive time bounds, and derived status", async () => {
    const fixture = await createFixture("Owner");
    const activeSalesBefore = await admin.fishSale.count({
      where: { void: null },
    });
    const saleIds = [
      await createSaleForFixture(fixture),
      await createSaleForFixture(fixture),
      await createSaleForFixture(fixture),
    ];
    const createdAt = new Date(Date.now() - 60_000).toISOString();

    const firstPage = await getSales(
      fixture,
      `page=1&limit=2&startDate=${encodeURIComponent(createdAt)}&status=active`,
    );
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.pagination).toMatchObject({
      page: 1,
      limit: 2,
      totalItems: activeSalesBefore + 3,
      totalPages: Math.ceil((activeSalesBefore + 3) / 2),
    });
    expect(firstPage.body.data.items[0].id).toBe(saleIds[2]);

    const voided = await voidSale(fixture, saleIds[0]!);
    expect(voided.status).toBe(200);
    const activePage = await getSales(fixture, "status=active");
    const voidedPage = await getSales(fixture, "status=voided");
    expect(activePage.body.data.pagination.totalItems).toBe(
      activeSalesBefore + 2,
    );
    expect(
      voidedPage.body.data.items.map((sale: { id: string }) => sale.id),
    ).toEqual([saleIds[0]]);

    const badStatus = await getSales(fixture, "status=pending");
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe("INVALID_PAYLOAD");
  });

  it("returns sale detail with derived active or voided status", async () => {
    const fixture = await createFixture("Admin Operasional");
    const saleId = await createSaleForFixture(fixture);

    const active = await getSale(fixture, saleId);
    expect(active.status).toBe(200);
    expect(active.body.data.status).toBe("active");
    expect(active.body.data.voided_at).toBeNull();

    const voided = await voidSale(fixture, saleId);
    expect(voided.status).toBe(200);
    const detail = await getSale(fixture, saleId);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("voided");
    expect(detail.body.data.voided_at).toEqual(expect.any(String));
    expect(detail.body.data.voided_by).toMatchObject({
      id: fixture.user.id,
      name: fixture.user.name,
    });
  });

  it("voids a completed sale once, restores stock/status, audits and caches retry", async () => {
    const fixture = await createFixture("Kasir", { stock: 100 });
    const saleResponse = await postSale(
      fixture,
      cashPayload(fixture.batchId, {
        quantity: 100,
        cash_received: 250000,
      }),
    );
    expect(saleResponse.status).toBe(201);
    const saleId = saleResponse.body.data.sale.id as string;
    expect(
      (await admin.batch.findUniqueOrThrow({ where: { id: fixture.batchId } }))
        .status,
    ).toBe("completed");

    const key = randomUUID();
    const voided = await voidSale(fixture, saleId, key);
    expect(voided.status).toBe(200);
    expect(voided.body.data).toMatchObject({
      sale_id: saleId,
      status: "voided",
      batch_status: "active",
    });
    expect(await admin.fishSaleVoid.count({ where: { saleId } })).toBe(1);
    expect(
      await admin.auditLog.count({
        where: { entityId: saleId, action: "VOID_SALE" },
      }),
    ).toBe(1);

    const retry = await voidSale(fixture, saleId, key);
    expect(retry.status).toBe(200);
    expect(retry.body.meta.idempotency_status).toBe("cached");
    const duplicate = await voidSale(fixture, saleId);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("SALE_ALREADY_VOIDED");
    expect(
      await admin.batch.findUniqueOrThrow({ where: { id: fixture.batchId } }),
    ).toMatchObject({ status: "active" });
  });

  it("allows POS roles to list, view and VOID while denying Kepala Budidaya", async () => {
    const ownerFixture = await createFixture("Owner");
    const saleId = await createSaleForFixture(ownerFixture);

    for (const role of ["Owner", "Admin Operasional", "Kasir"]) {
      const fixture = await createFixture(role);
      expect((await getSales(fixture)).status).toBe(200);
      expect((await getSale(fixture, saleId)).status).toBe(200);
      const ownSaleId = await createSaleForFixture(fixture);
      expect((await voidSale(fixture, ownSaleId)).status).toBe(200);
    }

    const kepala = await createFixture("Kepala Budidaya");
    expect((await getSales(kepala)).status).toBe(403);
    expect((await getSale(kepala, saleId)).status).toBe(403);
    const deniedVoid = await voidSale(kepala, saleId);
    expect(deniedVoid.status).toBe(403);
    expect(deniedVoid.body.error.code).toBe("FORBIDDEN");
  });

  it("returns SALE_NOT_FOUND for missing detail and VOID targets", async () => {
    const fixture = await createFixture("Kasir");
    const missingId = randomUUID();
    expect((await getSale(fixture, missingId)).body.error.code).toBe(
      "SALE_NOT_FOUND",
    );
    const response = await voidSale(fixture, missingId);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SALE_NOT_FOUND");
  });
});
