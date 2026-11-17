import { Controller, Get, INestApplication, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import request from "supertest";
import { JwtAuthGuard } from "../src/common/auth/jwt-auth.guard";
import { Roles } from "../src/common/auth/roles.decorator";
import { RolesGuard } from "../src/common/auth/roles.guard";
import { ApiExceptionFilter } from "../src/common/http/api-exception.filter";
import { AuthModule } from "../src/modules/auth/auth.module";
import { PrismaService } from "../src/modules/prisma/prisma.service";

@Controller("test/admin")
@UseGuards(JwtAuthGuard, RolesGuard)
class AdminProbeController {
  @Get()
  @Roles("Admin Operasional")
  getProtectedValue() {
    return { status: "success", data: "protected" };
  }
}

describe("V4.5 authentication HTTP integration", () => {
  const activeOwner = {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    name: "Owner Test",
    email: "owner.test@pfi.test",
    passwordHash: "",
    role: "Owner",
    isActive: true,
  };
  const prismaMock = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AdminProbeController],
      providers: [JwtAuthGuard, RolesGuard],
    })
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns a verifiable JWT for valid credentials", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      ...activeOwner,
      passwordHash: await bcrypt.hash("local-test-password", 10),
    });

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: activeOwner.email, password: "local-test-password" });

    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe("Owner");
    expect(response.body.data.user.passwordHash).toBeUndefined();

    expect(
      jwt.verify(response.body.data.access_token, process.env.JWT_SECRET!, {
        algorithms: ["HS256"],
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      }),
    ).toMatchObject({ sub: activeOwner.id, role: "Owner" });
  });

  it("returns one generic unauthorized response for invalid credentials", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: activeOwner.email, password: "incorrect-password" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(response.body.message).toBe("Email atau kata sandi tidak valid.");
    expect(JSON.stringify(response.body)).not.toMatch(
      /password_hash|stack|SELECT/i,
    );
  });

  it("rejects inactive users", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      ...activeOwner,
      isActive: false,
      passwordHash: await bcrypt.hash("local-test-password", 10),
    });
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: activeOwner.email, password: "local-test-password" });

    expect(response.status).toBe(401);
  });

  it("rejects invalid login payloads at the HTTP boundary", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PAYLOAD");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("checks the current active account and role for protected endpoints", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      ...activeOwner,
      passwordHash: await bcrypt.hash("local-test-password", 10),
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: activeOwner.email, password: "local-test-password" });
    prismaMock.user.findUnique.mockResolvedValue({
      id: activeOwner.id,
      name: activeOwner.name,
      email: activeOwner.email,
      role: "Owner",
      isActive: true,
    });

    const response = await request(app.getHttpServer())
      .get("/api/v1/test/admin")
      .set("Authorization", `Bearer ${login.body.data.access_token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("rate limits login attempts after five requests per minute", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: activeOwner.email, password: "incorrect-password" });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
