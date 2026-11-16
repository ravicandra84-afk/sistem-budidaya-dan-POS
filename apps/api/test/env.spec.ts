import { loadApiEnvironment } from "../src/config/env";

const validEnvironment = {
  NODE_ENV: "test",
  PORT: "4000",
  API_PREFIX: "/api/v1",
  TZ: "Asia/Jakarta",
  DATABASE_URL: "postgresql://pfi_app_runtime:local-only@localhost:5432/pfi_db",
  JWT_SECRET: "local-test-secret-with-at-least-thirty-two-characters",
  JWT_EXPIRES_IN: "8h",
  JWT_ISSUER: "pfi-test",
  JWT_AUDIENCE: "pfi-test-clients",
  CORS_ALLOWED_ORIGINS: "http://localhost:3000",
};

describe("API environment validation", () => {
  it("accepts a complete local configuration", () => {
    expect(loadApiEnvironment(validEnvironment).PORT).toBe(4000);
  });

  it("fails fast when required configuration is missing", () => {
    expect(() => loadApiEnvironment({})).toThrow(
      "Invalid API environment configuration",
    );
  });

  it("rejects the example runtime database user", () => {
    expect(() =>
      loadApiEnvironment({
        ...validEnvironment,
        DATABASE_URL: "postgresql://postgres:local-only@localhost:5432/pfi_db",
      }),
    ).toThrow("Invalid API environment configuration");
  });
});
