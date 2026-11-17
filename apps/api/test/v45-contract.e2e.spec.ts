import { ValidationPipe } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import * as jwt from "jsonwebtoken";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  calculateBatchStock,
  canCompleteBatch,
} from "../src/modules/batches/batch-stock";
import { ApiExceptionFilter } from "../src/common/http/api-exception.filter";
import { configureApiSecurity } from "../src/common/http/security";
import { loadApiEnvironment } from "../src/config/env";
import { PrismaService } from "../src/modules/prisma/prisma.service";
import { DEPENDENT_TRANSACTION_GUARD } from "../src/modules/receiving/dependent-transaction.guard";
import {
  getLocalTestDatabaseUrl,
  getLocalTestRuntimeDatabaseUrl,
} from "../prisma/runtime-env";

const databaseSuite =
  process.env.RUN_V45_DB_TESTS === "1" ? describe : describe.skip;
const benchmarkPopulation = 100_000;
const entryDate = "2000-02-01";
const environment = loadApiEnvironment();
type Actor = { id: string; role: string };

databaseSuite(
  "Official V4.5 contract cases against isolated PostgreSQL",
  () => {
    let admin: PrismaClient;
    let runtime: PrismaClient;
    let app: Awaited<ReturnType<typeof createApplication>>;
    let owner: Actor;
    let adminOperasional: Actor;
    let kepalaBudidaya: Actor;
    let inactiveOwner: Actor;
    let speciesId: string;
    const dependentBatchIds = new Set<string>();

    const dependentTransactionGuard = {
      hasDependentTransactions: async (
        _transaction: unknown,
        batchId: string,
      ) => dependentBatchIds.has(batchId),
    };

    async function createApplication() {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(runtime)
        .overrideProvider(DEPENDENT_TRANSACTION_GUARD)
        .useValue(dependentTransactionGuard)
        .compile();
      const application = moduleRef.createNestApplication();
      application.setGlobalPrefix("api/v1");
      application.useGlobalFilters(new ApiExceptionFilter());
      configureApiSecurity(application, environment);
      application.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await application.init();
      return application;
    }

    async function createActor(role: string, isActive = true): Promise<Actor> {
      const id = randomUUID();
      const user = await admin.user.create({
        data: {
          id,
          name: `V4.5 ${role}`,
          email: `${id}@v45.test`,
          passwordHash: "test-only-hash",
          role,
          isActive,
        },
        select: { id: true, role: true },
      });
      return user;
    }

    function token(actor: Actor, expired = false): string {
      return jwt.sign({ role: actor.role }, environment.JWT_SECRET, {
        algorithm: "HS256",
        audience: environment.JWT_AUDIENCE,
        expiresIn: expired ? -1 : "8h",
        issuer: environment.JWT_ISSUER,
        subject: actor.id,
      });
    }

    function payload(
      overrides: Record<string, unknown> = {},
      date = entryDate,
    ) {
      return {
        species_id: speciesId,
        entry_date: date,
        quantity: 500,
        purchase_capital: "2500000.00",
        shipping_capital: "150000.00",
        weight_sample_per_500: "485.50",
        fish_size: "3-5 cm",
        ...overrides,
      };
    }

    function createEntry(
      actor: Actor,
      input: Record<string, unknown> = payload(),
      key: string = randomUUID(),
      authToken = token(actor),
    ) {
      return request(app.getHttpServer())
        .post("/api/v1/fish-entries")
        .set("Authorization", `Bearer ${authToken}`)
        .set("Idempotency-Key", key)
        .send(input);
    }

    async function createBatchForVoid(actor = adminOperasional) {
      const response = await createEntry(actor);
      expect(response.status).toBe(201);
      return response.body.data.batch.id as string;
    }

    async function installFailureTrigger(
      table: "incoming_fish" | "audit_logs",
    ) {
      const suffix = randomUUID().replaceAll("-", "");
      const functionName = `v45_fail_${suffix}`;
      const triggerName = `v45_fail_${suffix}`;
      await admin.$executeRawUnsafe(
        `CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'V4.5 injected failure'; END; $$ LANGUAGE plpgsql`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
      );
      return async () => {
        await admin.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "${table}"`,
        );
        await admin.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${functionName}"()`,
        );
      };
    }

    beforeAll(async () => {
      admin = new PrismaClient({
        datasources: { db: { url: getLocalTestDatabaseUrl() } },
      });
      runtime = new PrismaClient({
        datasources: { db: { url: getLocalTestRuntimeDatabaseUrl() } },
      });
      await admin.$connect();
      await runtime.$connect();

      await admin.$executeRaw`
      TRUNCATE TABLE
        "audit_logs", "incoming_fish_voids", "incoming_fish", "batches",
        "idempotency_keys", "batch_daily_sequences", "users", "fish_species"
      RESTART IDENTITY
    `;
      const populationPrefix = `v45-benchmark-${randomUUID()}-`;
      await admin.$executeRaw`
      INSERT INTO "users" ("name", "email", "password_hash", "role")
      SELECT 'Benchmark fixture', ${populationPrefix} || sequence::text || '@pfi.test',
             'not-a-login-hash', 'Owner'
      FROM generate_series(1, ${benchmarkPopulation}) AS sequence
    `;
      const populationRows = await admin.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "users"
    `;
      const populationCount = populationRows[0]?.count ?? 0;
      if (populationCount < benchmarkPopulation) {
        throw new Error(
          "pfi_test did not reach the 100,000-record benchmark floor.",
        );
      }

      owner = await createActor("Owner");
      adminOperasional = await createActor("Admin Operasional");
      kepalaBudidaya = await createActor("Kepala Budidaya");
      inactiveOwner = await createActor("Owner", false);
      const species = await admin.fishSpecies.create({
        data: { speciesCode: "LELE", speciesName: "Lele" },
        select: { id: true },
      });
      speciesId = species.id;
      app = await createApplication();
    }, 120_000);

    afterAll(async () => {
      if (app) await app.close();
      if (runtime) await runtime.$disconnect();
      if (admin) {
        await admin.$executeRaw`
        TRUNCATE TABLE
          "audit_logs", "incoming_fish_voids", "incoming_fish", "batches",
          "idempotency_keys", "batch_daily_sequences", "users", "fish_species"
        RESTART IDENTITY
      `;
        await admin.$disconnect();
      }
    }, 120_000);

    it("TC-01 valid receiving commits batch, receipt, audit, and idempotency atomically", async () => {
      const key = randomUUID();
      const response = await createEntry(adminOperasional, payload(), key);
      const batchId = response.body.data.batch.id as string;
      const receipt = await admin.incomingFish.findUnique({
        where: { batchId },
      });

      expect(response.status).toBe(201);
      expect(receipt).not.toBeNull();
      expect(
        await admin.auditLog.count({
          where: { entityId: receipt!.id, action: "CREATE_ENTRY" },
        }),
      ).toBe(1);
      expect(
        await admin.idempotencyKey.count({
          where: { userId: adminOperasional.id, idempotencyKey: key },
        }),
      ).toBe(1);
    });

    it("TC-02 rejects invalid quantity, negative capital, enum, and unknown fields without writes", async () => {
      const before = await admin.batch.count();
      const invalidPayloads = [
        payload({ quantity: 0 }),
        payload({ purchase_capital: "-1.00" }),
        payload({ fish_size: "1-2 cm" }),
        { ...payload(), injected_field: true },
      ];
      for (const input of invalidPayloads) {
        const response = await createEntry(adminOperasional, input);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("INVALID_PAYLOAD");
      }
      expect(await admin.batch.count()).toBe(before);
    });

    it("TC-03 accepts quantities 1 and 1,000,000 and rejects 1,000,001", async () => {
      expect(
        (await createEntry(adminOperasional, payload({ quantity: 1 }))).status,
      ).toBe(201);
      expect(
        (
          await createEntry(
            adminOperasional,
            payload({ quantity: 1_000_000 }, "2000-02-02"),
          )
        ).status,
      ).toBe(201);
      const invalid = await createEntry(
        adminOperasional,
        payload({ quantity: 1_000_001 }, "2000-02-03"),
      );
      expect(invalid.status).toBe(400);
    });

    it("TC-04 rejects missing, expired, and invalid JWTs", async () => {
      const noToken = await request(app.getHttpServer())
        .post("/api/v1/fish-entries")
        .set("Idempotency-Key", randomUUID())
        .send(payload());
      const expired = await createEntry(
        adminOperasional,
        payload(),
        randomUUID(),
        token(adminOperasional, true),
      );
      const invalid = await createEntry(
        adminOperasional,
        payload(),
        randomUUID(),
        "not-a-jwt",
      );

      expect([noToken.status, expired.status, invalid.status]).toEqual([
        401, 401, 401,
      ]);
    });

    it("TC-05 allows Owner and authorized receiving roles while denying Kepala VOID", async () => {
      const ownerResponse = await createEntry(owner);
      const ownerBatchId = ownerResponse.body.data.batch.id as string;
      const kepalaResponse = await createEntry(kepalaBudidaya);
      const batchId = kepalaResponse.body.data.batch.id as string;
      const ownerVoid = await request(app.getHttpServer())
        .post(`/api/v1/fish-entries/${ownerBatchId}/void`)
        .set("Authorization", `Bearer ${token(owner)}`)
        .set("Idempotency-Key", randomUUID())
        .send({ reason: "VOID oleh Owner" });
      const deniedVoid = await request(app.getHttpServer())
        .post(`/api/v1/fish-entries/${batchId}/void`)
        .set("Authorization", `Bearer ${token(kepalaBudidaya)}`)
        .set("Idempotency-Key", randomUUID())
        .send({ reason: "Tidak berhak" });

      expect(ownerResponse.status).toBe(201);
      expect(kepalaResponse.status).toBe(201);
      expect(ownerVoid.status).toBe(200);
      expect(deniedVoid.status).toBe(403);
    });

    it("TC-06 returns a cached response with a fresh request ID for identical retry", async () => {
      const key = randomUUID();
      const first = await createEntry(adminOperasional, payload(), key);
      const retry = await createEntry(adminOperasional, payload(), key);

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body.meta.idempotency_status).toBe("cached");
      expect(retry.body.meta.request_id).not.toBe(first.body.meta.request_id);
      expect(retry.body.data).toEqual(first.body.data);
    });

    it("TC-07 creates 50 unique sequential batches concurrently and reports latency percentiles", async () => {
      const benchmarkStarted = performance.now();
      const requests = Array.from({ length: 50 }, () => {
        const started = performance.now();
        return createEntry(
          adminOperasional,
          payload({}, "2000-02-07"),
          randomUUID(),
        ).then((response) => ({
          status: response.status,
          code: response.body.data?.batch?.batch_code as string | undefined,
          error: response.body.error?.code as string | undefined,
          latencyMs: performance.now() - started,
        }));
      });
      const results = await Promise.all(requests);
      const durationMs = performance.now() - benchmarkStarted;
      const latencies = results
        .map((result) => result.latencyMs)
        .sort((a, b) => a - b);
      const percentile = (fraction: number) =>
        Number(
          latencies[Math.ceil(fraction * latencies.length) - 1]?.toFixed(2),
        );
      const successfulCodes = results
        .map((result) => result.code)
        .filter((value): value is string => Boolean(value))
        .sort();
      const metrics = {
        requests: results.length,
        durationMs: Number(durationMs.toFixed(2)),
        throughputRequestsPerSecond: Number(
          (results.length / (durationMs / 1000)).toFixed(2),
        ),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        errorRatePercent: Number(
          (
            ((results.length - successfulCodes.length) / results.length) *
            100
          ).toFixed(2),
        ),
        errors: results
          .filter((result) => result.status !== 201)
          .map((result) => result.error),
        uniqueBatchCodes: new Set(successfulCodes).size,
        firstCode: successfulCodes[0],
        lastCode: successfulCodes.at(-1),
        databaseRecordsAtStart: benchmarkPopulation + 4,
      };
      console.info(`V45_BENCHMARK ${JSON.stringify(metrics)}`);

      expect(results).toHaveLength(50);
      expect(results.every((result) => result.status === 201)).toBe(true);
      expect(metrics.uniqueBatchCodes).toBe(50);
      expect(successfulCodes[0]).toContain("-001");
      expect(successfulCodes.at(-1)).toContain("-050");
      expect(metrics.p95Ms).toBeLessThanOrEqual(1500);
    }, 60_000);

    it("TC-08 rolls back idempotency, sequence, and batch when receipt insert fails", async () => {
      const key = randomUUID();
      const removeTrigger = await installFailureTrigger("incoming_fish");
      try {
        const response = await createEntry(adminOperasional, payload(), key);
        expect(response.status).toBe(500);
        expect(
          await admin.idempotencyKey.findUnique({
            where: {
              userId_endpoint_idempotencyKey: {
                userId: adminOperasional.id,
                endpoint: "/api/v1/fish-entries",
                idempotencyKey: key,
              },
            },
          }),
        ).toBeNull();
      } finally {
        await removeTrigger();
      }
    });

    it("TC-09 maintains exactly one receipt for each committed batch", async () => {
      const response = await createEntry(adminOperasional);
      const batchId = response.body.data.batch.id as string;
      const receiptCount = await admin.incomingFish.count({
        where: { batchId },
      });
      expect(response.status).toBe(201);
      expect(receiptCount).toBe(1);
    });

    it("TC-10 regression keeps creation, VOID, and historical receipt behavior intact", async () => {
      const created = await createEntry(adminOperasional);
      const batchId = created.body.data.batch.id as string;
      const voided = await request(app.getHttpServer())
        .post(`/api/v1/fish-entries/${batchId}/void`)
        .set("Authorization", `Bearer ${token(adminOperasional)}`)
        .set("Idempotency-Key", randomUUID())
        .send({ reason: "Regresi V4.5" });
      const receipt = await admin.incomingFish.findUnique({
        where: { batchId },
      });

      expect(created.status).toBe(201);
      expect(voided.status).toBe(200);
      expect(receipt).not.toBeNull();
      expect(
        await admin.incomingFishVoid.count({
          where: { incomingFishId: receipt!.id },
        }),
      ).toBe(1);
    });

    it("TC-11 rejects an inactive fish species", async () => {
      const inactiveSpecies = await admin.fishSpecies.create({
        data: {
          speciesCode: `OFF-${randomUUID()}`,
          speciesName: "Nonaktif",
          isActive: false,
        },
      });
      const response = await createEntry(
        adminOperasional,
        payload({ species_id: inactiveSpecies.id }),
      );
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("SPECIES_NOT_ACTIVE");
    });

    it("TC-12 initializes a new daily sequence safely under two concurrent requests", async () => {
      const date = "2000-02-12";
      const responses = await Promise.all([
        createEntry(adminOperasional, payload({}, date)),
        createEntry(kepalaBudidaya, payload({}, date)),
      ]);
      const codes = responses
        .map((response) => response.body.data.batch.batch_code)
        .sort();
      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      expect(codes[0]).toContain("-001");
      expect(codes[1]).toContain("-002");
    });

    it("TC-13 rolls back receiving when audit-log insertion fails", async () => {
      const key = randomUUID();
      const removeTrigger = await installFailureTrigger("audit_logs");
      try {
        const response = await createEntry(adminOperasional, payload(), key);
        expect(response.status).toBe(500);
        expect(
          await admin.idempotencyKey.findUnique({
            where: {
              userId_endpoint_idempotencyKey: {
                userId: adminOperasional.id,
                endpoint: "/api/v1/fish-entries",
                idempotencyKey: key,
              },
            },
          }),
        ).toBeNull();
      } finally {
        await removeTrigger();
      }
    });

    it("TC-14 hashes null/omitted weight and equivalent decimal strings identically", async () => {
      const key = randomUUID();
      const first = await createEntry(
        adminOperasional,
        payload({
          weight_sample_per_500: null,
          purchase_capital: "2500000.00",
        }),
        key,
      );
      const retryPayload = Object.fromEntries(
        Object.entries(payload({ purchase_capital: "2500000" })).filter(
          ([key]) => key !== "weight_sample_per_500",
        ),
      );
      const retry = await createEntry(adminOperasional, retryPayload, key);
      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body.meta.idempotency_status).toBe("cached");
      expect(retry.body.data.batch.id).toBe(first.body.data.batch.id);
    });

    it("TC-15 scopes identical idempotency keys to different users", async () => {
      const key = randomUUID();
      const [first, second] = await Promise.all([
        createEntry(adminOperasional, payload(), key),
        createEntry(kepalaBudidaya, payload(), key),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(first.body.data.batch.id).not.toBe(second.body.data.batch.id);
    });

    it("TC-16 enforces case-insensitive email uniqueness in PostgreSQL", async () => {
      const uniqueEmail = `Case-${randomUUID()}@v45.test`;
      await admin.user.create({
        data: {
          name: "Case test",
          email: uniqueEmail,
          passwordHash: "test-only-hash",
          role: "Owner",
        },
      });
      await expect(
        admin.user.create({
          data: {
            name: "Case duplicate",
            email: uniqueEmail.toLowerCase(),
            passwordHash: "test-only-hash",
            role: "Owner",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("TC-17 rejects direct batch insertion without a receipt at commit", async () => {
      const code = `PFI-BCH-20000217-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`;
      await expect(
        admin.$transaction(async (transaction) => {
          await transaction.batch.create({
            data: {
              batchCode: code,
              status: "active",
              speciesId,
              createdBy: owner.id,
            },
          });
        }),
      ).rejects.toThrow();
      expect(
        await admin.batch.findUnique({ where: { batchCode: code } }),
      ).toBeNull();
    });

    it("TC-18 maps a database lock timeout to sanitized 503", async () => {
      const date = "2000-02-18";
      let releaseLock = () => {};
      let signalLocked = () => {};
      const lockReleased = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        signalLocked = resolve;
      });
      await admin.$executeRaw`
      INSERT INTO "batch_daily_sequences" ("entry_date", "last_number")
      VALUES (${date}::date, 0) ON CONFLICT ("entry_date") DO NOTHING
    `;
      const holder = admin.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
        SELECT "entry_date" FROM "batch_daily_sequences"
        WHERE "entry_date" = ${date}::date FOR UPDATE
      `;
          signalLocked();
          await lockReleased;
        },
        { timeout: 15_000 },
      );
      await locked;
      const response = await createEntry(adminOperasional, payload({}, date));
      releaseLock();
      await holder;
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("DATABASE_LOCK_TIMEOUT");
      expect(response.body.message).not.toMatch(/lock_timeout|SELECT|stack/i);
    }, 20_000);

    it("TC-19 rejects a date that is tomorrow in Asia/Jakarta", async () => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const dateParts = Object.fromEntries(
        parts.map(({ type, value }) => [type, value]),
      );
      const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
      const future = new Date(`${today}T00:00:00.000Z`);
      future.setUTCDate(future.getUTCDate() + 1);
      const futureDate = future.toISOString().slice(0, 10);
      const response = await createEntry(
        adminOperasional,
        payload({}, futureDate),
      );
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("INVALID_ENTRY_DATE");
    });

    it("TC-20 blocks receiving VOID when a dependent transaction exists", async () => {
      const batchId = await createBatchForVoid();
      dependentBatchIds.add(batchId);
      const response = await request(app.getHttpServer())
        .post(`/api/v1/fish-entries/${batchId}/void`)
        .set("Authorization", `Bearer ${token(adminOperasional)}`)
        .set("Idempotency-Key", randomUUID())
        .send({ reason: "Batch memiliki transaksi turunan" });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("HAS_DEPENDENT_TRANSACTIONS");
      expect(
        await admin.batch.findUnique({
          where: { id: batchId },
          select: { status: true },
        }),
      ).toEqual({ status: "active" });
      const receipt = await admin.incomingFish.findUnique({
        where: { batchId },
        include: { void: true },
      });
      expect(receipt?.void).toBeNull();
    });

    it("TC-21 rejects UPDATE and DELETE on append-only history for runtime access", async () => {
      const response = await createEntry(adminOperasional);
      const receiptId = response.body.data.incoming_fish.id as string;
      const audit = await admin.auditLog.findFirst({
        where: { entityId: receiptId, action: "CREATE_ENTRY" },
        select: { id: true },
      });
      expect(audit).not.toBeNull();
      await expect(
        runtime.$executeRaw`UPDATE "incoming_fish" SET "quantity" = 501 WHERE "id" = ${receiptId}::uuid`,
      ).rejects.toThrow();
      await expect(
        runtime.$executeRaw`DELETE FROM "incoming_fish" WHERE "id" = ${receiptId}::uuid`,
      ).rejects.toThrow();
      await expect(
        runtime.$executeRaw`UPDATE "audit_logs" SET "action" = 'VOID_ENTRY' WHERE "id" = ${audit!.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        runtime.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${audit!.id}::uuid`,
      ).rejects.toThrow();
    });

    it("TC-22 computes stock and rejects completion while stock remains", async () => {
      const batchId = await createBatchForVoid();
      const batchResponse = await request(app.getHttpServer())
        .get(`/api/v1/batches/${batchId}`)
        .set("Authorization", `Bearer ${token(adminOperasional)}`);
      const [databaseStock] = await admin.$queryRaw<
        Array<{ stock: bigint }>
      >`SELECT "calculate_batch_stock"(${batchId}::uuid) AS "stock"`;
      const positiveStock = calculateBatchStock({ receivedQuantity: 500 });

      expect(batchResponse.status).toBe(200);
      expect(batchResponse.body.data.batch.current_stock).toBe(500);
      expect(Number(databaseStock?.stock)).toBe(positiveStock);
      expect(canCompleteBatch(positiveStock)).toBe(false);
      expect(
        calculateBatchStock({
          receivedQuantity: 500,
          validSalesQuantity: 500,
        }),
      ).toBe(0);
      expect(
        calculateBatchStock({ receivedQuantity: 500, receiptVoided: true }),
      ).toBe(0);
      expect(canCompleteBatch(0)).toBe(true);

      await expect(
        admin.$executeRaw`UPDATE "batches" SET "status" = 'completed' WHERE "id" = ${batchId}::uuid`,
      ).rejects.toThrow();
      await expect(
        admin.$executeRaw`UPDATE "batches" SET "status" = 'unknown' WHERE "id" = ${batchId}::uuid`,
      ).rejects.toThrow();
      await admin.batch.update({
        where: { id: batchId },
        data: { status: "voided" },
      });
      await expect(
        admin.$executeRaw`UPDATE "batches" SET "status" = 'active' WHERE "id" = ${batchId}::uuid`,
      ).rejects.toThrow();
    });

    it("TC-23 accepts the minimum sample weight 0.01 grams", async () => {
      const response = await createEntry(
        adminOperasional,
        payload({ weight_sample_per_500: "0.01" }),
      );
      expect(response.status).toBe(201);
    });

    it("TC-24 accepts the maximum sample weight 100000.00 grams", async () => {
      const response = await createEntry(
        adminOperasional,
        payload({ weight_sample_per_500: "100000.00" }),
      );
      expect(response.status).toBe(201);
    });

    it("TC-25 rejects sample weight 100000.01 grams", async () => {
      const response = await createEntry(
        adminOperasional,
        payload({ weight_sample_per_500: "100000.01" }),
      );
      expect(response.status).toBe(400);
    });

    it("TC-26 accepts purchase and shipping capital at the maximum", async () => {
      const response = await createEntry(
        adminOperasional,
        payload({
          purchase_capital: "9999999999.00",
          shipping_capital: "9999999999.00",
        }),
      );
      expect(response.status).toBe(201);
    });

    it("TC-27 rejects purchase capital above the maximum", async () => {
      const response = await createEntry(
        adminOperasional,
        payload({ purchase_capital: "10000000000.00" }),
      );
      expect(response.status).toBe(400);
    });

    it("TC-28 serializes VOID against insertion of a dependent transaction", async () => {
      const batchId = await createBatchForVoid();
      let signalBatchLock: () => void = () => undefined;
      let releaseBatchLock: () => void = () => undefined;
      const batchLocked = new Promise<void>((resolve) => {
        signalBatchLock = resolve;
      });
      const releaseWriter = new Promise<void>((resolve) => {
        releaseBatchLock = resolve;
      });
      const dependentWriter = admin.$transaction(
        async (transaction) => {
          const [batch] = await transaction.$queryRaw<
            Array<{ status: string }>
          >`SELECT "status" FROM "batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`;
          expect(batch?.status).toBe("active");
          signalBatchLock();
          await releaseWriter;
          dependentBatchIds.add(batchId);
        },
        { timeout: 15_000 },
      );

      await batchLocked;
      const voidResponse = request(app.getHttpServer())
        .post(`/api/v1/fish-entries/${batchId}/void`)
        .set("Authorization", `Bearer ${token(adminOperasional)}`)
        .set("Idempotency-Key", randomUUID())
        .send({ reason: "VOID concorrente" })
        .then((response) => response);

      try {
        const deadline = Date.now() + 5_000;
        let voidWaitingOnBatchLock = false;
        while (Date.now() < deadline && !voidWaitingOnBatchLock) {
          const [activity] = await admin.$queryRaw<Array<{ waiting: boolean }>>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE wait_event_type = 'Lock'
                AND query ILIKE '%batches%'
                AND query ILIKE '%FOR UPDATE%'
                AND pid <> pg_backend_pid()
            ) AS waiting
          `;
          voidWaitingOnBatchLock = activity?.waiting ?? false;
          if (!voidWaitingOnBatchLock) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        expect(voidWaitingOnBatchLock).toBe(true);
      } finally {
        dependentBatchIds.add(batchId);
        releaseBatchLock();
      }

      await dependentWriter;
      const response = await voidResponse;
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("HAS_DEPENDENT_TRANSACTIONS");
      expect(
        await admin.batch.findUnique({
          where: { id: batchId },
          select: { status: true },
        }),
      ).toEqual({ status: "active" });
      const receipt = await admin.incomingFish.findUnique({
        where: { batchId },
        include: { void: true },
      });
      expect(receipt?.void).toBeNull();
    }, 20_000);

    it("TC-29 returns one cached result for concurrent identical VOID retries", async () => {
      const batchId = await createBatchForVoid();
      const key = randomUUID();
      const sendVoid = () =>
        request(app.getHttpServer())
          .post(`/api/v1/fish-entries/${batchId}/void`)
          .set("Authorization", `Bearer ${token(adminOperasional)}`)
          .set("Idempotency-Key", key)
          .send({ reason: "Retry serentak" });
      const responses = await Promise.all([sendVoid(), sendVoid()]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(
        responses
          .map((response) => response.body.meta.idempotency_status)
          .sort(),
      ).toEqual(["cached", "executed"]);
    });

    it("TC-30 returns sequence exhausted when the daily counter is 999", async () => {
      const date = "2000-02-28";
      await admin.$executeRaw`
      INSERT INTO "batch_daily_sequences" ("entry_date", "last_number")
      VALUES (${date}::date, 999)
      ON CONFLICT ("entry_date") DO UPDATE SET "last_number" = 999
    `;
      const response = await createEntry(adminOperasional, payload({}, date));
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("BATCH_SEQUENCE_EXHAUSTED");
    });

    it("TC-31 rejects missing and non-UUIDv4 Idempotency-Key headers", async () => {
      const missing = await request(app.getHttpServer())
        .post("/api/v1/fish-entries")
        .set("Authorization", `Bearer ${token(adminOperasional)}`)
        .send(payload());
      const invalid = await createEntry(
        adminOperasional,
        payload(),
        "not-a-uuid-v4",
      );
      expect(missing.status).toBe(400);
      expect(invalid.status).toBe(400);
      expect(missing.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
      expect(invalid.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    });

    it("TC-32 rejects a second VOID with a different idempotency key", async () => {
      const batchId = await createBatchForVoid();
      const sendVoid = (key: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/fish-entries/${batchId}/void`)
          .set("Authorization", `Bearer ${token(adminOperasional)}`)
          .set("Idempotency-Key", key)
          .send({ reason: "VOID key conflict" });
      const responses = await Promise.all([
        sendVoid(randomUUID()),
        sendVoid(randomUUID()),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      expect(
        responses.find((response) => response.status === 409)?.body.error.code,
      ).toBe("BATCH_NOT_ACTIVE");
    });

    it("rejects inactive accounts before reading protected data", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/batches")
        .set("Authorization", `Bearer ${token(inactiveOwner)}`);
      expect(response.status).toBe(401);
    });
  },
);
