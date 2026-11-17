import { expect, test, type Page } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kepala Budidaya" | "Kasir";

const auditEntries = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    request_id: "create-entry-request",
    actor: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Admin Uji",
    },
    action: "CREATE_ENTRY",
    entity_type: "incoming_fish",
    entity_id: "33333333-3333-4333-8333-333333333333",
    old_values: null,
    new_values: null,
    reason: null,
    ip_address: "192.0.2.10",
    created_at: "2026-11-17T03:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    request_id: "void-entry-request",
    actor: {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Admin Uji",
    },
    action: "VOID_ENTRY",
    entity_type: "incoming_fish",
    entity_id: "66666666-6666-4666-8666-666666666666",
    old_values: null,
    new_values: null,
    reason: "Koreksi pencatatan",
    ip_address: "192.0.2.10",
    created_at: "2026-11-17T02:00:00.000Z",
  },
];

async function openAuditPage(page: Page, role: TestRole) {
  let auditRequestCount = 0;
  let authorization: string | undefined;

  await page.route("**/api/v1/audit-logs**", async (route) => {
    auditRequestCount += 1;
    authorization = route.request().headers().authorization;

    if (role === "Kasir") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          status: "error",
          message: "Token tidak valid atau kedaluwarsa.",
          error: { code: "UNAUTHORIZED" },
          meta: { request_id: "kasir-denied" },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Daftar audit log berhasil dimuat.",
        data: {
          items: auditEntries,
          pagination: {
            page: 1,
            limit: 20,
            totalItems: auditEntries.length,
            totalPages: 1,
          },
        },
      }),
    });
  });

  await page.addInitScript(
    ({ sessionStorageKey, role }) => {
      sessionStorage.setItem(
        sessionStorageKey,
        JSON.stringify({
          accessToken: "e2e-audit-token",
          expiresIn: "8h",
          user: {
            id: "e2e-user",
            name: `${role} E2E`,
            email: "e2e@example.test",
            role,
          },
        }),
      );
    },
    { sessionStorageKey: "pfi.operational.session.v1", role },
  );

  await page.goto("/audit");
  return {
    get auditRequestCount() {
      return auditRequestCount;
    },
    get authorization() {
      return authorization;
    },
  };
}

for (const role of [
  "Owner",
  "Admin Operasional",
  "Kepala Budidaya",
] as const) {
  test(`Audit Log loads for ${role} and renders V4.5 actions`, async ({ page }) => {
    const audit = await openAuditPage(page, role);

    await expect(
      page.getByRole("heading", { name: "Audit operasional" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("Penerimaan dicatat")).toBeVisible();
    await expect(page.getByText("Penerimaan di-VOID")).toBeVisible();
    expect(audit.auditRequestCount).toBeGreaterThanOrEqual(1);
    expect(audit.authorization).toBe("Bearer e2e-audit-token");
  });
}

test("Kasir is denied Audit Log and receives no audit entries", async ({
  page,
}) => {
  const audit = await openAuditPage(page, "Kasir");

  await expect(page).toHaveURL(/\/login$/);
  expect(audit.auditRequestCount).toBeGreaterThanOrEqual(1);
  expect(audit.authorization).toBe("Bearer e2e-audit-token");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
});