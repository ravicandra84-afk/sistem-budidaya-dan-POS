import { Controller, Get, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApiSecurity } from "../src/common/http/security";
import { loadApiEnvironment } from "../src/config/env";

@Controller("security-probe")
class SecurityProbeController {
  @Get()
  getProbe() {
    return { status: "success" };
  }
}

describe("HTTP security policy", () => {
  const environment = loadApiEnvironment();
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SecurityProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApiSecurity(app, environment);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sets Helmet headers and a strict API CSP", async () => {
    const response = await request(app.getHttpServer()).get("/security-probe");

    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows only configured origins and expected preflight headers", async () => {
    const allowed = await request(app.getHttpServer())
      .options("/security-probe")
      .set("Origin", environment.FRONTEND_URL)
      .set("Access-Control-Request-Method", "POST")
      .set(
        "Access-Control-Request-Headers",
        "authorization,content-type,idempotency-key",
      );
    const denied = await request(app.getHttpServer())
      .get("/security-probe")
      .set("Origin", "https://unapproved.invalid");

    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      environment.FRONTEND_URL,
    );
    expect(allowed.headers["access-control-allow-headers"]).toContain(
      "Idempotency-Key",
    );
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
