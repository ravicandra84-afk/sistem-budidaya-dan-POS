import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import request from "supertest";
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
const endpoint = "/api/v1/users";

type Actor = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: string;
};

databaseSuite("Owner user management HTTP integration", () => {
  const admin = new PrismaClient({
    datasources: { db: { url: getLocalTestDatabaseUrl() } },
  });
  const runtime = new PrismaClient({
    datasources: { db: { url: getLocalTestRuntimeDatabaseUrl() } },
  });
  let app: INestApplication;

  async function createActor(role: string): Promise<Actor> {
    const id = randomUUID();
    const actor = {
      id,
      name: `Users ${role}`,
      email: `${id}@users.test`,
      password: `Test-${id}`,
      role,
    };
    await admin.user.create({
      data: {
        id,
        name: actor.name,
        email: actor.email,
        passwordHash: await bcrypt.hash(actor.password, 10),
        role,
      },
    });
    return actor;
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

  async function createAsOwner(owner: Actor, role = "Kasir") {
    return request(app.getHttpServer())
      .post(endpoint)
      .set("Authorization", `Bearer ${accessToken(owner)}`)
      .send({
        name: "Kasir Baru",
        email: `${randomUUID()}@users.test`,
        password: "initial-password-8",
        role,
      });
  }

  beforeAll(async () => {
    await admin.$connect();
    await runtime.$connect();
    await admin.$executeRaw`
      TRUNCATE TABLE
        "audit_logs", "batch_sale_readiness_histories", "fish_sale_voids",
        "fish_sales", "products", "product_categories", "fish_sale_prices",
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
    if (app) await app.close();
    await admin.$executeRaw`
      TRUNCATE TABLE
        "audit_logs", "batch_sale_readiness_histories", "fish_sale_voids",
        "fish_sales", "products", "product_categories", "fish_sale_prices",
        "incoming_fish_voids", "incoming_fish", "batches", "idempotency_keys",
        "sale_daily_sequences", "batch_daily_sequences", "users", "fish_species"
      RESTART IDENTITY
    `;
    await runtime.$disconnect();
    await admin.$disconnect();
  }, 30_000);

  it.each(["Kasir", "Admin Operasional"])(
    "rejects %s from the Owner-only endpoints",
    async (role) => {
      const actor = await createActor(role);
      const response = await request(app.getHttpServer())
        .get(endpoint)
        .set("Authorization", `Bearer ${accessToken(actor)}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    },
  );

  it("creates a Kasir, blocks its token on deactivation, then resets and reactivates it", async () => {
    const owner = await createActor("Owner");
    const created = await createAsOwner(owner);

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: "Kasir Baru",
      role: "Kasir",
      is_active: true,
    });
    expect(created.body.data).toHaveProperty("created_at");
    expect(created.body.data).not.toHaveProperty("password_hash");
    expect(created.body.data).not.toHaveProperty("passwordHash");

    const listed = await request(app.getHttpServer())
      .get(endpoint)
      .set("Authorization", `Bearer ${accessToken(owner)}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items[0]).toMatchObject({
      id: created.body.data.id,
      name: "Kasir Baru",
      email: created.body.data.email,
      role: "Kasir",
      is_active: true,
    });
    expect(listed.body.data.items[0]).not.toHaveProperty("password_hash");
    expect(listed.body.data.items[0]).not.toHaveProperty("passwordHash");

    const createdUser = await admin.user.findUniqueOrThrow({
      where: { id: created.body.data.id },
      select: { id: true, email: true },
    });
    const firstLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: createdUser.email, password: "initial-password-8" });
    expect(firstLogin.status).toBe(200);

    const deactivated = await request(app.getHttpServer())
      .patch(`${endpoint}/${createdUser.id}`)
      .set("Authorization", `Bearer ${accessToken(owner)}`)
      .send({ is_active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.is_active).toBe(false);

    const inactiveTokenResponse = await request(app.getHttpServer())
      .get(endpoint)
      .set("Authorization", `Bearer ${firstLogin.body.data.access_token}`);
    expect(inactiveTokenResponse.status).toBe(401);

    const reactivated = await request(app.getHttpServer())
      .patch(`${endpoint}/${createdUser.id}`)
      .set("Authorization", `Bearer ${accessToken(owner)}`)
      .send({ is_active: true, password: "reset-password-8" });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data.is_active).toBe(true);
    expect(reactivated.body.data).not.toHaveProperty("password_hash");

    const resetLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: createdUser.email, password: "reset-password-8" });
    expect(resetLogin.status).toBe(200);

    const actions = await admin.auditLog.findMany({
      where: { entityId: createdUser.id },
      select: { action: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        "USER_CREATED",
        "USER_DEACTIVATED",
        "USER_REACTIVATED",
        "USER_PASSWORD_RESET",
      ]),
    );
  });

  it("updates a user's name and role and rejects case-insensitive duplicate email", async () => {
    const owner = await createActor("Owner");
    const created = await createAsOwner(owner);
    const userId = created.body.data.id as string;

    const updated = await request(app.getHttpServer())
      .patch(`${endpoint}/${userId}`)
      .set("Authorization", `Bearer ${accessToken(owner)}`)
      .send({ name: "Kasir Diubah", role: "Admin Operasional" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      name: "Kasir Diubah",
      role: "Admin Operasional",
    });

    const duplicate = await request(app.getHttpServer())
      .post(endpoint)
      .set("Authorization", `Bearer ${accessToken(owner)}`)
      .send({
        name: "Duplikat",
        email: created.body.data.email.toUpperCase(),
        password: "another-password-8",
        role: "Kasir",
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("USER_EMAIL_CONFLICT");
  });

  it("prevents an Owner from deactivating or demoting their own account", async () => {
    const owner = await createActor("Owner");
    const ownerToken = accessToken(owner);

    const deactivate = await request(app.getHttpServer())
      .patch(`${endpoint}/${owner.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ is_active: false });
    expect(deactivate.status).toBe(400);

    const demote = await request(app.getHttpServer())
      .patch(`${endpoint}/${owner.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ role: "Admin Operasional" });
    expect(demote.status).toBe(400);
  });
});
