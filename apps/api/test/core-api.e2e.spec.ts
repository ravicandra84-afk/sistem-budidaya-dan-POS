import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as jwt from "jsonwebtoken";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ApiExceptionFilter } from "../src/common/http/api-exception.filter";
import { hashBusinessPayload } from "../src/modules/receiving/idempotency";
import { receiveFishSchema } from "../src/modules/receiving/receiving.schemas";
import { PrismaService } from "../src/modules/prisma/prisma.service";

const actorId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const speciesId = "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2";
const idempotencyRecordId = "d3d3d3d3-d3d3-d3d3-d3d3-d3d3d3d3d3d3";
const batchId = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const receiptId = "a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4";
const receiptInput = {
  species_id: speciesId,
  entry_date: "2026-11-15",
  quantity: 500,
  purchase_capital: "2500000.00",
  shipping_capital: "150000.00",
  weight_sample_per_500: "485.50",
  fish_size: "3-5 cm",
};

describe("V4.5 core API HTTP integration", () => {
  const prismaMock = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: { findFirst: jest.fn(), findUnique: jest.fn() },
    fishSpecies: { findMany: jest.fn(), findUnique: jest.fn() },
    batch: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    incomingFish: { create: jest.fn(), findUnique: jest.fn() },
    incomingFishVoid: { create: jest.fn() },
    idempotencyKey: { findUnique: jest.fn() },
    auditLog: { create: jest.fn(), count: jest.fn(), findMany: jest.fn() },
  };
  const transactionMock = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    user: prismaMock.user,
    fishSpecies: prismaMock.fishSpecies,
    batch: prismaMock.batch,
    incomingFish: prismaMock.incomingFish,
    incomingFishVoid: prismaMock.incomingFishVoid,
    auditLog: prismaMock.auditLog,
  };
  let app: INestApplication;

  function accessToken(role: string, subject = actorId): string {
    return jwt.sign({ role }, process.env.JWT_SECRET!, {
      algorithm: "HS256",
      audience: process.env.JWT_AUDIENCE,
      expiresIn: "8h",
      issuer: process.env.JWT_ISSUER,
      subject,
    });
  }

  const protectedEndpointRequests = (token: string | (() => string)) => {
    const authorization = () =>
      `Bearer ${typeof token === "function" ? token() : token}`;

    return [
      {
        name: "GET /fish-species",
        send: () =>
          request(app.getHttpServer())
            .get("/api/v1/fish-species")
            .set("Authorization", authorization()),
      },
      {
        name: "GET /batches",
        send: () =>
          request(app.getHttpServer())
            .get("/api/v1/batches")
            .set("Authorization", authorization()),
      },
      {
        name: "GET /batches/{id}",
        send: () =>
          request(app.getHttpServer())
            .get(`/api/v1/batches/${batchId}`)
            .set("Authorization", authorization()),
      },
      {
        name: "GET /audit-logs",
        send: () =>
          request(app.getHttpServer())
            .get("/api/v1/audit-logs")
            .set("Authorization", authorization()),
      },
      {
        name: "POST /fish-entries",
        send: () =>
          request(app.getHttpServer())
            .post("/api/v1/fish-entries")
            .set("Authorization", authorization())
            .set("Idempotency-Key", randomUUID())
            .send(receiptInput),
      },
      {
        name: "POST /fish-entries/{batch_id}/void",
        send: () =>
          request(app.getHttpServer())
            .post(`/api/v1/fish-entries/${batchId}/void`)
            .set("Authorization", authorization())
            .set("Idempotency-Key", randomUUID())
            .send({ reason: "Uji akses RBAC" }),
      },
    ];
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (operation: unknown) => {
      if (typeof operation === "function") return operation(transactionMock);
      return Promise.all(operation as Promise<unknown>[]);
    });
    transactionMock.$queryRaw.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const statement = strings.join(" ");
        if (statement.includes('INSERT INTO "idempotency_keys"')) {
          return [{ id: idempotencyRecordId }];
        }
        if (statement.includes('SELECT "last_number"'))
          return [{ last_number: 4 }];
        if (statement.includes('UPDATE "batch_daily_sequences"')) {
          return [{ last_number: 5 }];
        }
        if (statement.includes('FROM "batches"')) {
          return [
            {
              id: batchId,
              batch_code: "PFI-BCH-20261115-005",
              status: "active",
            },
          ];
        }
        return [];
      },
    );
    transactionMock.$executeRaw.mockResolvedValue(1);
    transactionMock.fishSpecies.findUnique.mockResolvedValue({
      id: speciesId,
      isActive: true,
    });
    transactionMock.batch.create.mockResolvedValue({
      id: batchId,
      batchCode: "PFI-BCH-20261115-005",
      status: "active",
      createdAt: new Date("2026-11-15T10:00:00.000Z"),
    });
    transactionMock.incomingFish.create.mockImplementation(
      async ({ data }) => ({
        id: receiptId,
        ...data,
        createdAt: new Date("2026-11-15T10:00:00.000Z"),
        purchaseCapital: new Prisma.Decimal(data.purchaseCapital),
        shippingCapital: new Prisma.Decimal(data.shippingCapital),
        weightSamplePer500: new Prisma.Decimal(data.weightSamplePer500),
      }),
    );
    transactionMock.auditLog.create.mockResolvedValue({ id: "audit-id" });
    transactionMock.incomingFish.findUnique.mockResolvedValue({
      id: receiptId,
    });
    transactionMock.incomingFishVoid.create.mockResolvedValue({
      id: "void-id",
    });
    transactionMock.batch.update.mockResolvedValue({
      id: batchId,
      status: "voided",
    });
    prismaMock.user.findUnique.mockImplementation(async ({ where }) => ({
      id: where.id,
      name: "Pengguna Test",
      email: "user@pfi.test",
      role: "Admin Operasional",
      isActive: true,
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(["Owner", "Admin Operasional", "Kepala Budidaya"])(
    "%s follows the V4.5 endpoint authorization matrix",
    async (role) => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: actorId,
        name: `${role} Test`,
        email: "user@pfi.test",
        role,
        isActive: true,
      });
      prismaMock.fishSpecies.findMany.mockResolvedValue([]);
      prismaMock.batch.count.mockResolvedValue(0);
      prismaMock.batch.findMany.mockResolvedValue([]);
      prismaMock.batch.findUnique.mockResolvedValue({
        id: batchId,
        batchCode: "PFI-BCH-20261115-005",
        status: "active",
        createdAt: new Date("2026-11-15T10:00:00.000Z"),
        species: { id: speciesId, speciesCode: "LELE", speciesName: "Lele" },
        incomingFish: null,
      });
      prismaMock.auditLog.count.mockResolvedValue(0);
      prismaMock.auditLog.findMany.mockResolvedValue([]);

      const token = accessToken(role);
      const endpoints = protectedEndpointRequests(token);
      const readResponses = await Promise.all(
        endpoints.slice(0, 4).map(({ send }) => send()),
      );
      const createResponse = await endpoints[4]!.send();
      const transactionsBeforeVoid = prismaMock.$transaction.mock.calls.length;
      const voidResponse = await endpoints[5]!.send();

      expect(readResponses.map(({ status }) => status)).toEqual([
        200, 200, 200, 200,
      ]);
      expect(createResponse.status).toBe(201);
      if (role === "Kepala Budidaya") {
        expect(voidResponse.status).toBe(403);
        expect(voidResponse.body.error.code).toBe("FORBIDDEN");
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(
          transactionsBeforeVoid,
        );
        expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { action: { in: ["CREATE_ENTRY", "VOID_ENTRY"] } },
          }),
        );
      } else {
        expect(voidResponse.status).toBe(200);
        expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: {} }),
        );
      }
    },
  );

  it("returns FORBIDDEN when Kepala Budidaya attempts receiving VOID", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: actorId,
      name: "Kepala Budidaya Test",
      email: "kepala@pfi.test",
      role: "Kepala Budidaya",
      isActive: true,
    });

    const response = await protectedEndpointRequests(
      accessToken("Kepala Budidaya"),
    )[5]!.send();

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each(protectedEndpointRequests("matrix-token"))(
    "$name rejects an invalid JWT",
    async ({ send }) => {
      const response = await send();

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    },
  );

  it.each(protectedEndpointRequests(() => accessToken("Owner")))(
    "$name rejects an inactive account",
    async ({ send }) => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: actorId,
        name: "Nonaktif Test",
        email: "inactive@pfi.test",
        role: "Owner",
        isActive: false,
      });

      const response = await send();

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    },
  );

  it.each(protectedEndpointRequests(() => accessToken("Kasir")))(
    "$name denies Kasir access to non-POS endpoints",
    async ({ send }) => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: actorId,
        name: "Kasir Test",
        email: "kasir@pfi.test",
        role: "Kasir",
        isActive: true,
      });

      const response = await send();

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    },
  );

  it("protects species list and returns active species for authorized V4.5 roles", async () => {
    prismaMock.fishSpecies.findMany.mockResolvedValue([
      { id: speciesId, speciesCode: "LELE", speciesName: "Lele" },
    ]);
    const unauthenticated = await request(app.getHttpServer()).get(
      "/api/v1/fish-species",
    );
    const authorized = await request(app.getHttpServer())
      .get("/api/v1/fish-species")
      .set("Authorization", `Bearer ${accessToken("Kepala Budidaya")}`);

    expect(unauthenticated.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.body.data).toEqual([
      { id: speciesId, species_code: "LELE", species_name: "Lele" },
    ]);
  });

  it("rejects a valid token when the account has since been deactivated", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: actorId,
      name: "Pengguna Nonaktif",
      email: "inactive@pfi.test",
      role: "Owner",
      isActive: false,
    });
    const response = await request(app.getHttpServer())
      .get("/api/v1/fish-species")
      .set("Authorization", `Bearer ${accessToken("Owner")}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(prismaMock.fishSpecies.findMany).not.toHaveBeenCalled();
  });

  it("applies approved pagination, filters, and newest-first ordering to batch lists", async () => {
    prismaMock.batch.count.mockResolvedValue(0);
    prismaMock.batch.findMany.mockResolvedValue([]);
    const response = await request(app.getHttpServer())
      .get(
        "/api/v1/batches?page=2&limit=5&status=active&startDate=2026-11-10T00:00:00Z&endDate=2026-11-15T23:59:59Z",
      )
      .set("Authorization", `Bearer ${accessToken("Owner")}`);

    expect(response.status).toBe(200);
    expect(response.body.data.pagination).toEqual({
      page: 2,
      limit: 5,
      totalItems: 0,
      totalPages: 0,
    });
    expect(prismaMock.batch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        where: expect.objectContaining({ status: "active" }),
      }),
    );
  });

  it("returns the receipt and species with an authorized batch detail", async () => {
    prismaMock.batch.findUnique.mockResolvedValue({
      id: batchId,
      batchCode: "PFI-BCH-20261115-005",
      status: "active",
      createdAt: new Date("2026-11-15T10:00:00.000Z"),
      species: { id: speciesId, speciesCode: "LELE", speciesName: "Lele" },
      incomingFish: {
        id: receiptId,
        entryDate: new Date("2026-11-15T00:00:00.000Z"),
        quantity: 500,
        purchaseCapital: new Prisma.Decimal("2500000.00"),
        shippingCapital: new Prisma.Decimal("150000.00"),
        weightSamplePer500: new Prisma.Decimal("485.50"),
        fishSize: "3-5 cm",
        createdAt: new Date("2026-11-15T10:00:00.000Z"),
        void: null,
      },
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/batches/${batchId}`)
      .set("Authorization", `Bearer ${accessToken("Owner")}`);

    expect(response.status).toBe(200);
    expect(response.body.data.batch.batch_code).toBe("PFI-BCH-20261115-005");
    expect(response.body.data.incoming_fish.purchase_capital).toBe(
      "2500000.00",
    );
    expect(response.body.data.incoming_fish.voided).toBe(false);
  });

  it("rejects query limits above the approved maximum", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/batches?limit=101")
      .set("Authorization", `Bearer ${accessToken("Owner")}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PAYLOAD");
    expect(prismaMock.batch.findMany).not.toHaveBeenCalled();
  });

  it("restricts audit entries visible to Kepala Budidaya", async () => {
    prismaMock.auditLog.count.mockResolvedValue(0);
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.user.findUnique.mockResolvedValue({
      id: actorId,
      name: "Kepala Budidaya Test",
      email: "kepala@pfi.test",
      role: "Kepala Budidaya",
      isActive: true,
    });
    const response = await request(app.getHttpServer())
      .get("/api/v1/audit-logs")
      .set("Authorization", `Bearer ${accessToken("Kepala Budidaya")}`);

    expect(response.status).toBe(200);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: { in: ["CREATE_ENTRY", "VOID_ENTRY"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("creates receipt atomically for authorized roles with a UUIDv4 key", async () => {
    transactionMock.auditLog.create.mockResolvedValue({ id: "audit-id" });
    const response = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send(receiptInput);

    expect(response.status).toBe(201);
    expect(response.body.data.batch.batch_code).toBe("PFI-BCH-20261115-005");
    expect(response.body.meta.idempotency_status).toBe("executed");
    const transactionQueries = transactionMock.$queryRaw.mock.calls.map(
      ([parts]) => (parts as TemplateStringsArray).join(" "),
    );
    expect(
      transactionQueries.some((sql) =>
        sql.includes("set_config('lock_timeout'"),
      ),
    ).toBe(true);
    expect(transactionQueries.some((sql) => sql.includes("FOR UPDATE"))).toBe(
      true,
    );
    expect(transactionMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("returns the original response for an identical idempotency retry", async () => {
    const key = "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646";
    const first = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", key)
      .send(receiptInput);
    const cachedBody = {
      status: first.body.status,
      message: first.body.message,
      data: first.body.data,
    };
    transactionMock.$queryRaw.mockImplementation(
      async (strings: TemplateStringsArray) =>
        strings.join(" ").includes('INSERT INTO "idempotency_keys"') ? [] : [],
    );
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      payloadHash: hashBusinessPayload(receiveFishSchema.parse(receiptInput)),
      status: "completed",
      responseBody: cachedBody,
    });

    const retry = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", key)
      .send(receiptInput);

    expect(retry.status).toBe(201);
    expect(retry.body.data).toEqual(first.body.data);
    expect(retry.body.meta.idempotency_status).toBe("cached");
    expect(transactionMock.batch.create).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of an idempotency key with a different normalized payload", async () => {
    transactionMock.$queryRaw.mockImplementation(
      async (strings: TemplateStringsArray) =>
        strings.join(" ").includes('INSERT INTO "idempotency_keys"') ? [] : [],
    );
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      payloadHash: "0".repeat(64),
      status: "completed",
      responseBody: { status: "success", message: "cached", data: {} },
    });
    const response = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send({ ...receiptInput, quantity: 501 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(transactionMock.batch.create).not.toHaveBeenCalled();
  });

  it("rejects inactive species and future entry dates", async () => {
    transactionMock.fishSpecies.findUnique.mockResolvedValue({
      id: speciesId,
      isActive: false,
    });
    const inactiveSpecies = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send(receiptInput);
    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const futureDate = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send({ ...receiptInput, entry_date: tomorrow });

    expect(inactiveSpecies.status).toBe(422);
    expect(inactiveSpecies.body.error.code).toBe("SPECIES_NOT_ACTIVE");
    expect(futureDate.status).toBe(422);
    expect(futureDate.body.error.code).toBe("INVALID_ENTRY_DATE");
  });

  it("allows Owner receiving creation", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: actorId,
      name: "Owner Test",
      email: "owner@pfi.test",
      role: "Owner",
      isActive: true,
    });
    const response = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Owner")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send(receiptInput);

    expect(response.status).toBe(201);
    expect(transactionMock.batch.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing or non-v4 idempotency key before opening a transaction", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "not-a-uuid-v4")
      .send(receiptInput);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("voids an eligible receipt atomically for Admin Operasional", async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/fish-entries/${batchId}/void`)
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send({ reason: "Kesalahan pencatatan" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("voided");
    expect(transactionMock.incomingFishVoid.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reason: "Kesalahan pencatatan",
        voidedBy: actorId,
      }),
    });
    expect(transactionMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(
      transactionMock.$queryRaw.mock.calls
        .map(([parts]) => (parts as TemplateStringsArray).join(" "))
        .some((sql) => sql.includes("FOR UPDATE")),
    ).toBe(true);
  });

  it("allows Owner to VOID an eligible receiving", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: actorId,
      name: "Owner Test",
      email: "owner@pfi.test",
      role: "Owner",
      isActive: true,
    });
    const response = await request(app.getHttpServer())
      .post(`/api/v1/fish-entries/${batchId}/void`)
      .set("Authorization", `Bearer ${accessToken("Owner")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send({ reason: "Kesalahan pencatatan" });

    expect(response.status).toBe(200);
    expect(transactionMock.incomingFishVoid.create).toHaveBeenCalledTimes(1);
  });

  it("rejects VOID for a batch that is not active", async () => {
    transactionMock.$queryRaw.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const statement = strings.join(" ");
        if (statement.includes('INSERT INTO "idempotency_keys"')) {
          return [{ id: idempotencyRecordId }];
        }
        if (statement.includes('FROM "batches"')) {
          return [
            {
              id: batchId,
              batch_code: "PFI-BCH-20261115-005",
              status: "completed",
            },
          ];
        }
        return [];
      },
    );
    const response = await request(app.getHttpServer())
      .post(`/api/v1/fish-entries/${batchId}/void`)
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send({ reason: "Kesalahan pencatatan" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("BATCH_NOT_ACTIVE");
    expect(transactionMock.incomingFishVoid.create).not.toHaveBeenCalled();
  });

  it("sanitizes internal database failures and does not report partial success", async () => {
    transactionMock.auditLog.create.mockRejectedValue(
      new Error("internal SQL detail"),
    );
    const response = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send(receiptInput);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(response.body)).not.toMatch(
      /internal SQL detail|stack|SELECT/i,
    );
  });

  it("maps database outages to a sanitized 503 response", async () => {
    transactionMock.auditLog.create.mockRejectedValue(
      Object.assign(new Error("private connection detail"), { code: "P1001" }),
    );
    const response = await request(app.getHttpServer())
      .post("/api/v1/fish-entries")
      .set("Authorization", `Bearer ${accessToken("Admin Operasional")}`)
      .set("Idempotency-Key", "5c7c0806-6b9b-4af4-9f4b-5d1ed5b9e646")
      .send(receiptInput);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(JSON.stringify(response.body)).not.toMatch(
      /private connection detail|stack/i,
    );
  });
});
