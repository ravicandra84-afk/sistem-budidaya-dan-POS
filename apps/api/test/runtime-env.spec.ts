import {
  getLocalTestDatabaseUrl,
  getLocalTestRuntimeDatabaseUrl,
} from "../prisma/runtime-env";

describe("local V4.5 database test guard", () => {
  it("accepts only localhost pfi_test", () => {
    const url =
      "postgresql://test_admin:test_password@localhost:5432/pfi_test?schema=public";

    expect(getLocalTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  it.each([
    "postgresql://test_admin:test_password@localhost:5432/pfi_db",
    "postgresql://test_admin:test_password@db.example:5432/pfi_test",
    "postgresql://test_admin:test_password@localhost:5432/other_db",
  ])("rejects unsafe test database targets", (url) => {
    expect(() => getLocalTestDatabaseUrl({ TEST_DATABASE_URL: url })).toThrow(
      "Database tests are restricted to localhost database pfi_test.",
    );
  });

  it("rejects a missing test database URL", () => {
    expect(() => getLocalTestDatabaseUrl({})).toThrow(
      "TEST_DATABASE_URL is missing or invalid.",
    );
  });

  it("routes the runtime role to pfi_test without changing its credentials", () => {
    const runtimeUrl = getLocalTestRuntimeDatabaseUrl({
      TEST_DATABASE_URL:
        "postgresql://test_admin:test_password@localhost:5432/pfi_test?schema=public",
      DATABASE_URL:
        "postgresql://pfi_app_runtime:runtime_password@localhost:5432/pfi_db?schema=public",
    });
    const parsed = new URL(runtimeUrl);

    expect(parsed.pathname).toBe("/pfi_test");
    expect(parsed.username).toBe("pfi_app_runtime");
    expect(parsed.password).toBe("runtime_password");
  });

  it("rejects runtime credentials that do not use the local runtime role", () => {
    expect(() =>
      getLocalTestRuntimeDatabaseUrl({
        TEST_DATABASE_URL:
          "postgresql://test_admin:test_password@localhost:5432/pfi_test",
        DATABASE_URL:
          "postgresql://postgres:runtime_password@localhost:5432/pfi_db",
      }),
    ).toThrow(
      "Test runtime access requires the local pfi_app_runtime role and pfi_test database.",
    );
  });
});
