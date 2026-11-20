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
const priceEndpoint = "/api/v1/pos/prices";
const posBatchesEndpoint = "/api/v1/pos/batches";

type Actor = { id: string; name: string; role: string };
type SaleFixture = { batchId: string; speciesId: string; user: Actor };

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
  let priceAuditFailureInstalled = false;

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
    return { batchId: batch.id, speciesId: batch.speciesId, user };
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

  function getPrices(fixture: SaleFixture, query = "") {
    return request(app.getHttpServer())
      .get(`${priceEndpoint}${query ? `?${query}` : ""}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`);
  }

  function getPosBatches(fixture: SaleFixture, query = "") {
    return request(app.getHttpServer())
      .get(`${posBatchesEndpoint}${query ? `?${query}` : ""}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`);
  }

  function getPosBatch(fixture: SaleFixture, batchId: string) {
    return request(app.getHttpServer())
      .get(`${posBatchesEndpoint}/${batchId}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`);
  }

  function postPrice(
    fixture: SaleFixture,
    payload: Record<string, unknown>,
    idempotencyKey = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post(priceEndpoint)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);
  }

  function patchPrice(
    fixture: SaleFixture,
    priceId: string,
    payload: Record<string, unknown>,
    idempotencyKey = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .patch(`${priceEndpoint}/${priceId}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload);
  }

  function getSale(fixture: SaleFixture, saleId: string) {
    return request(app.getHttpServer())
      .get(`${endpoint}/${saleId}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`);
  }

  function getReceipt(fixture: SaleFixture, saleId: string) {
    return request(app.getHttpServer())
      .get(`${endpoint}/${saleId}/receipt`)
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

  async function priceIdForFixture(fixture: SaleFixture): Promise<string> {
    const price = await admin.fishSalePrice.findUniqueOrThrow({
      where: {
        speciesId_fishSize: {
          speciesId: fixture.speciesId,
          fishSize: "3-5 cm",
        },
      },
      select: { id: true },
    });
    return price.id;
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

  async function installPriceAuditFailure(): Promise<void> {
    await admin.$executeRaw`
      CREATE FUNCTION "p7_test_reject_price_audit"() RETURNS trigger AS $$
      BEGIN
        IF NEW."action" IN ('CREATE_SALE_PRICE', 'UPDATE_SALE_PRICE') THEN
          RAISE EXCEPTION 'P7 test price audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;
    await admin.$executeRaw`
      CREATE TRIGGER "p7_test_reject_price_audit"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "p7_test_reject_price_audit"()
    `;
    priceAuditFailureInstalled = true;
  }

  async function removePriceAuditFailure(): Promise<void> {
    if (!priceAuditFailureInstalled) return;
    await admin.$executeRaw`
      DROP TRIGGER IF EXISTS "p7_test_reject_price_audit" ON "audit_logs"
    `;
    await admin.$executeRaw`
      DROP FUNCTION IF EXISTS "p7_test_reject_price_audit"()
    `;
    priceAuditFailureInstalled = false;
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
    await removePriceAuditFailure();
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

  it("includes the middleware request ID in every successful POS GET envelope", async () => {
    const fixture = await createFixture("Owner");
    const saleId = await createSaleForFixture(fixture);
    const responses = [
      await getPosBatches(fixture),
      await getPosBatch(fixture, fixture.batchId),
      await getPrices(fixture),
      await getSales(fixture),
      await getSale(fixture, saleId),
      await getReceipt(fixture, saleId),
    ];

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body.meta.request_id).toEqual(
        response.headers["x-request-id"],
      );
      expect(response.body.meta.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("allocates sale numbers beyond the minimum three-digit sequence", async () => {
    const fixture = await createFixture("Kasir");
    const dateParts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .map(({ type, value }) => [type, value]),
    );
    const saleDateString = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const saleDate = new Date(`${saleDateString}T00:00:00.000Z`);

    await admin.saleDailySequence.upsert({
      where: { saleDate },
      create: { saleDate, lastNumber: 999n },
      update: { lastNumber: 999n },
    });

    const response = await postSale(fixture, cashPayload(fixture.batchId));

    expect(response.status).toBe(201);
    expect(response.body.data.sale.sale_code).toBe(
      `PFI-SAL-${saleDateString.replaceAll("-", "")}-1000`,
    );
    const sequence = await admin.saleDailySequence.findUniqueOrThrow({
      where: { saleDate },
    });
    expect(sequence.lastNumber).toBe(1000n);
  });

  it("lists only active batches with positive computed stock and paginates", async () => {
    const partiallySold = await createFixture("Owner", { stock: 100 });
    await createSaleForFixture(partiallySold, 25);
    const withoutPrice = await createFixture("Owner", {
      stock: 12,
      withPrice: false,
    });
    const soldOut = await createFixture("Owner", { stock: 5 });
    await createSaleForFixture(soldOut, 5);
    const voided = await createFixture("Owner", { stock: 8 });
    await admin.batch.update({
      where: { id: voided.batchId },
      data: { status: "voided" },
    });

    const defaultPage = await getPosBatches(partiallySold);
    expect(defaultPage.status).toBe(200);
    expect(defaultPage.body.data.pagination).toMatchObject({
      page: 1,
      limit: 20,
    });

    const allBatches = await getPosBatches(partiallySold, "limit=100");
    expect(allBatches.status).toBe(200);
    const items = allBatches.body.data.items as Array<{
      batch: { id: string; status: string; current_stock: number };
      unit_price: number | null;
    }>;
    const byId = new Map(items.map((item) => [item.batch.id, item]));
    expect(byId.get(partiallySold.batchId)).toMatchObject({
      batch: { status: "active", current_stock: 75 },
      unit_price: 2500,
    });
    expect(byId.get(withoutPrice.batchId)).toMatchObject({
      batch: { status: "active", current_stock: 12 },
      unit_price: null,
    });
    expect(byId.has(soldOut.batchId)).toBe(false);
    expect(byId.has(voided.batchId)).toBe(false);

    const firstPage = await getPosBatches(partiallySold, "page=1&limit=1");
    const secondPage = await getPosBatches(partiallySold, "page=2&limit=1");
    expect(firstPage.body.data.pagination.totalItems).toBe(
      allBatches.body.data.pagination.totalItems,
    );
    expect(firstPage.body.data.items).toHaveLength(1);
    expect(secondPage.body.data.items).toHaveLength(1);
    expect(firstPage.body.data.items[0].batch.id).not.toBe(
      secondPage.body.data.items[0].batch.id,
    );
  });

  it("refreshes POS batch detail and applies the four-role access matrix", async () => {
    for (const role of POS_ROLES) {
      const fixture = await createFixture(role);
      const detail = await getPosBatch(fixture, fixture.batchId);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        batch: {
          id: fixture.batchId,
          status: "active",
          current_stock: 100,
        },
        species: { id: fixture.speciesId, species_name: "POS Test" },
        fish_size: "3-5 cm",
        unit_price: 2500,
      });
      expect((await getPosBatches(fixture)).status).toBe(200);
    }

    const unpriced = await createFixture("Kasir", { withPrice: false });
    const unpricedDetail = await getPosBatch(unpriced, unpriced.batchId);
    expect(unpricedDetail.status).toBe(200);
    expect(unpricedDetail.body.data.unit_price).toBeNull();

    const soldOut = await createFixture("Owner", { stock: 5 });
    await createSaleForFixture(soldOut, 5);
    const inactiveDetail = await getPosBatch(soldOut, soldOut.batchId);
    expect(inactiveDetail.status).toBe(409);
    expect(inactiveDetail.body.error.code).toBe("BATCH_NOT_ACTIVE");

    const missing = await getPosBatch(soldOut, randomUUID());
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("BATCH_NOT_FOUND");

    const kepala = await createFixture("Kepala Budidaya");
    const deniedList = await getPosBatches(kepala);
    const deniedDetail = await getPosBatch(kepala, kepala.batchId);
    expect(deniedList.status).toBe(403);
    expect(deniedList.body.error.code).toBe("FORBIDDEN");
    expect(deniedDetail.status).toBe(403);
    expect(deniedDetail.body.error.code).toBe("FORBIDDEN");
  });

  it("lists prices for POS roles with pagination and denies Kepala Budidaya", async () => {
    for (const role of POS_ROLES) {
      const fixture = await createFixture(role);
      const defaultResponse = await getPrices(fixture);
      expect(defaultResponse.status).toBe(200);
      expect(defaultResponse.body.data.pagination).toMatchObject({
        page: 1,
        limit: 20,
      });

      const response = await getPrices(fixture, "page=1&limit=1");

      expect(response.status).toBe(200);
      expect(response.body.data.pagination).toMatchObject({
        page: 1,
        limit: 1,
      });
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0]).toEqual(
        expect.objectContaining({
          species_id: expect.any(String),
          species_code: expect.any(String),
          species_name: "POS Test",
          fish_size: "3-5 cm",
          price_per_fish: 2500,
          created_at: expect.any(String),
          updated_at: expect.any(String),
          updated_by: expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
          }),
        }),
      );
    }

    const kepala = await createFixture("Kepala Budidaya");
    const denied = await getPrices(kepala);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("creates prices idempotently, rejects duplicates, and records CREATE audit", async () => {
    const fixture = await createFixture("Owner", { withPrice: false });
    const payload = {
      species_id: fixture.speciesId,
      fish_size: "4-6 cm",
      price_per_fish: 2500,
    };
    const key = randomUUID();

    const created = await postPrice(fixture, payload, key);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      species_id: fixture.speciesId,
      fish_size: "4-6 cm",
      price_per_fish: 2500,
      updated_by: { id: fixture.user.id, name: fixture.user.name },
    });

    const retry = await postPrice(fixture, payload, key);
    expect(retry.status).toBe(201);
    expect(retry.body.meta.idempotency_status).toBe("cached");
    expect(retry.body.data.id).toBe(created.body.data.id);

    const mismatch = await postPrice(
      fixture,
      { ...payload, price_per_fish: 3000 },
      key,
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");

    const duplicate = await postPrice(fixture, payload);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("PRICE_ALREADY_EXISTS");

    const outOfRange = await postPrice(fixture, {
      ...payload,
      fish_size: "5-7 cm",
      price_per_fish: 10_000_001,
    });
    expect(outOfRange.status).toBe(422);
    expect(outOfRange.body.error.code).toBe("PRICE_OUT_OF_RANGE");

    const missingKey = await request(app.getHttpServer())
      .post(priceEndpoint)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`)
      .send(payload);
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");

    const audit = await admin.auditLog.findFirstOrThrow({
      where: { entityId: created.body.data.id, action: "CREATE_SALE_PRICE" },
    });
    expect(audit).toMatchObject({
      actorId: fixture.user.id,
      oldValues: null,
      newValues: null,
    });
  });

  it.each(["Owner", "Admin Operasional"])(
    "allows %s to create prices and denies Kasir/Kepala Budidaya",
    async (role) => {
      const manager = await createFixture(role, { withPrice: false });
      const created = await postPrice(manager, {
        species_id: manager.speciesId,
        fish_size: "4-6 cm",
        price_per_fish: 3000,
      });
      expect(created.status).toBe(201);

      for (const deniedRole of ["Kasir", "Kepala Budidaya"]) {
        const fixture = await createFixture(deniedRole, { withPrice: false });
        const denied = await postPrice(fixture, {
          species_id: fixture.speciesId,
          fish_size: "4-6 cm",
          price_per_fish: 3000,
        });
        expect(denied.status).toBe(403);
        expect(denied.body.error.code).toBe("FORBIDDEN");
      }
    },
  );

  it("updates prices idempotently, audits UPDATE, and returns PRICE_NOT_FOUND", async () => {
    const fixture = await createFixture("Admin Operasional");
    const priceId = await priceIdForFixture(fixture);
    const payload = { price_per_fish: 2750 };
    const key = randomUUID();

    const updated = await patchPrice(fixture, priceId, payload, key);
    expect(updated.status).toBe(200);
    expect(updated.body.data.price_per_fish).toBe(2750);

    const retry = await patchPrice(fixture, priceId, payload, key);
    expect(retry.status).toBe(200);
    expect(retry.body.meta.idempotency_status).toBe("cached");
    expect(retry.body.data.id).toBe(priceId);

    const mismatch = await patchPrice(
      fixture,
      priceId,
      { price_per_fish: 3000 },
      key,
    );
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");

    const audit = await admin.auditLog.findFirstOrThrow({
      where: { entityId: priceId, action: "UPDATE_SALE_PRICE" },
    });
    expect(audit).toMatchObject({
      actorId: fixture.user.id,
      oldValues: null,
      newValues: null,
    });

    const missing = await patchPrice(fixture, randomUUID(), payload);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("PRICE_NOT_FOUND");

    const invalidKey = await request(app.getHttpServer())
      .patch(`${priceEndpoint}/${priceId}`)
      .set("Authorization", `Bearer ${accessToken(fixture.user)}`)
      .set("Idempotency-Key", "not-a-uuid-v4")
      .send(payload);
    expect(invalidKey.status).toBe(400);
    expect(invalidKey.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
  });

  it("rolls back price writes and idempotency when required audit insertion fails", async () => {
    const fixture = await createFixture("Owner");
    const priceId = await priceIdForFixture(fixture);
    const updateKey = randomUUID();
    const createKey = randomUUID();
    await installPriceAuditFailure();

    try {
      const failedUpdate = await patchPrice(
        fixture,
        priceId,
        { price_per_fish: 2750 },
        updateKey,
      );
      expect(failedUpdate.status).toBe(500);
      expect(failedUpdate.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(
        await admin.fishSalePrice.findUniqueOrThrow({
          where: { id: priceId },
          select: { pricePerFish: true },
        }),
      ).toEqual({ pricePerFish: 2500n });
      expect(
        await admin.idempotencyKey.count({
          where: {
            userId: fixture.user.id,
            endpoint: `${priceEndpoint}/${priceId}`,
            idempotencyKey: updateKey,
          },
        }),
      ).toBe(0);

      const failedCreate = await postPrice(
        fixture,
        {
          species_id: fixture.speciesId,
          fish_size: "4-6 cm",
          price_per_fish: 3000,
        },
        createKey,
      );
      expect(failedCreate.status).toBe(500);
      expect(failedCreate.body.error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(
        await admin.fishSalePrice.findUnique({
          where: {
            speciesId_fishSize: {
              speciesId: fixture.speciesId,
              fishSize: "4-6 cm",
            },
          },
        }),
      ).toBeNull();
      expect(
        await admin.idempotencyKey.count({
          where: {
            userId: fixture.user.id,
            endpoint: priceEndpoint,
            idempotencyKey: createKey,
          },
        }),
      ).toBe(0);
    } finally {
      await removePriceAuditFailure();
    }
  });

  it.each(["Owner", "Admin Operasional"])(
    "allows %s to update prices and denies Kasir/Kepala Budidaya",
    async (role) => {
      const manager = await createFixture(role);
      const managerPriceId = await priceIdForFixture(manager);
      const updated = await patchPrice(manager, managerPriceId, {
        price_per_fish: 2700,
      });
      expect(updated.status).toBe(200);

      for (const deniedRole of ["Kasir", "Kepala Budidaya"]) {
        const fixture = await createFixture(deniedRole);
        const denied = await patchPrice(
          fixture,
          await priceIdForFixture(fixture),
          { price_per_fish: 2800 },
        );
        expect(denied.status).toBe(403);
        expect(denied.body.error.code).toBe("FORBIDDEN");
      }
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
    const endDate = new Date(Date.now() + 60_000).toISOString();

    const firstPage = await getSales(
      fixture,
      `page=1&limit=2&startDate=${encodeURIComponent(createdAt)}&endDate=${encodeURIComponent(endDate)}&status=active`,
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

    const defaultPage = await getSales(fixture);
    expect(defaultPage.body.data.pagination).toMatchObject({
      page: 1,
      limit: 20,
    });
    const beforeSales = await getSales(
      fixture,
      "endDate=2000-01-01T00%3A00%3A00.000Z&status=active",
    );
    expect(beforeSales.body.data.pagination.totalItems).toBe(0);

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

  it("allows only the active sale creator to retrieve the exact receipt fields", async () => {
    const creator = await createFixture("Kasir");
    const saleId = await createSaleForFixture(creator);
    const response = await getReceipt(creator, saleId);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data)).toEqual([
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
    expect(response.body.data).toMatchObject({
      company_name: "PT. Pisciculture Farm Indonesia",
      species_name: "POS Test",
      fish_size: "3-5 cm",
      quantity: 5,
      unit_price: 2500,
      total_payment: 12500,
      payment_method: "cash",
      cashier_name: creator.user.name,
    });
    expect(response.body.data.transaction_date_time).toMatch(/ WIB$/);
    expect(response.body.data).not.toHaveProperty("sale_code");
    expect(response.body.data).not.toHaveProperty("batch_code");
    expect(response.body.data).not.toHaveProperty("weight");

    for (const role of ["Kasir", "Admin Operasional", "Owner"]) {
      const otherActor = await createFixture(role);
      const denied = await getReceipt(otherActor, saleId);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe("FORBIDDEN");
    }

    const kepala = await createFixture("Kepala Budidaya");
    const deniedKepala = await getReceipt(kepala, saleId);
    expect(deniedKepala.status).toBe(403);
    expect(deniedKepala.body.error.code).toBe("FORBIDDEN");

    const voidResponse = await voidSale(creator, saleId);
    expect(voidResponse.status).toBe(200);
    const unavailable = await getReceipt(creator, saleId);
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error.code).toBe("RECEIPT_NOT_AVAILABLE");
    expect(JSON.stringify(unavailable.body)).not.toMatch(/Prisma|SELECT|SQL/i);
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
