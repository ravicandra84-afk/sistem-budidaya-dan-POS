import { expect, test, type Page } from "@playwright/test";

const batchId = "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1";
const batchCode = "PFI-BCH-20261117-001";

type Role = "Owner" | "Admin Operasional" | "Kepala Budidaya";

type CapturedVoid = {
  reason: string;
  idempotencyKey: string | undefined;
  authorization: string | undefined;
};

type CapturedReadiness = {
  path: string;
  method: string;
  payload: { saleReadiness: string; note?: string };
  idempotencyKey: string | undefined;
};

async function mockApi(page: Page, role: Role, initialStatus = "active") {
  const state: {
    detailReads: number;
    voidRequest: CapturedVoid | null;
    readiness: "BELUM_SIAP" | "SIAP_JUAL";
    readinessHistories: Array<{
      id: string;
      from_readiness: "BELUM_SIAP" | "SIAP_JUAL" | null;
      to_readiness: "BELUM_SIAP" | "SIAP_JUAL";
      changed_by: { id: string; name: string };
      note: string | null;
      created_at: string;
    }>;
    readinessRequest: CapturedReadiness | null;
  } = {
    detailReads: 0,
    voidRequest: null,
    readiness: "BELUM_SIAP",
    readinessHistories: [],
    readinessRequest: null,
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      url.pathname === `/api/v1/batches/${batchId}` &&
      request.method() === "GET"
    ) {
      state.detailReads += 1;
      const voided = state.voidRequest !== null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Detail batch berhasil dimuat.",
          data: {
            batch: {
              id: batchId,
              batch_code: batchCode,
              status: voided ? "voided" : initialStatus,
              current_stock: voided ? 0 : 500,
              created_at: "2026-11-17T03:00:00.000Z",
              sale_readiness: state.readiness,
            },
            species: {
              id: "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2",
              species_code: "LELE",
              species_name: "Lele",
            },
            incoming_fish: {
              id: "a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4",
              entry_date: "2026-11-17",
              quantity: 500,
              purchase_capital: "2500000.00",
              shipping_capital: "150000.00",
              weight_sample_per_500: "485.50",
              fish_size: "3-5 cm",
              created_at: "2026-11-17T03:00:00.000Z",
              voided,
            },
            sale_readiness_histories: state.readinessHistories,
          },
        }),
      });
      return;
    }

    if (
      url.pathname === `/api/v1/batches/${batchId}/sale-readiness` &&
      request.method() === "PATCH"
    ) {
      const payload = request.postDataJSON() as CapturedReadiness["payload"];
      const headers = request.headers();
      const previousReadiness = state.readiness;
      state.readiness = payload.saleReadiness as "BELUM_SIAP" | "SIAP_JUAL";
      state.readinessRequest = {
        path: url.pathname,
        method: request.method(),
        payload,
        idempotencyKey: headers["idempotency-key"],
      };
      state.readinessHistories = [
        {
          id: "d5d5d5d5-d5d5-45d5-85d5-d5d5d5d5d5d5",
          from_readiness: previousReadiness,
          to_readiness: state.readiness,
          changed_by: { id: "e2e-user", name: "Kepala Budidaya E2E" },
          note: payload.note ?? null,
          created_at: "2026-11-24T03:00:00.000Z",
        },
        ...state.readinessHistories,
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Kesiapan jual berhasil diperbarui.",
          data: { batch_id: batchId, sale_readiness: state.readiness },
          meta: { idempotency_status: "executed", request_id: "e2e-request" },
        }),
      });
      return;
    }

    if (
      url.pathname === `/api/v1/fish-entries/${batchId}/void` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as { reason: string };
      const headers = request.headers();
      state.voidRequest = {
        reason: body.reason,
        idempotencyKey: headers["idempotency-key"],
        authorization: headers.authorization,
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "success",
          message: "Transaksi penerimaan berhasil di-VOID.",
          data: { batch_id: batchId, batch_code: batchCode, status: "voided" },
          meta: { idempotency_status: "executed", request_id: "e2e-request" },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        message: "Unexpected E2E API call.",
      }),
    });
  });

  return state;
}

async function openBatchDetail(
  page: Page,
  role: Role,
  initialStatus = "active",
) {
  const api = await mockApi(page, role, initialStatus);
  await page.addInitScript(
    ({ sessionStorageKey, role }) => {
      sessionStorage.setItem(
        sessionStorageKey,
        JSON.stringify({
          accessToken: "e2e-only-token",
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
  await page.goto(`/batches/${batchId}`);
  await expect(page.getByRole("heading", { name: batchCode })).toBeVisible();
  return api;
}

for (const role of ["Admin Operasional", "Owner", "Kepala Budidaya"] as const) {
  test(`VOID action visibility follows the P5-05 UI rule for ${role}`, async ({
    page,
  }) => {
    await openBatchDetail(page, role);
    const voidButton = page.getByRole("button", {
      name: "VOID penerimaan",
      exact: true,
    });

    if (role === "Admin Operasional" || role === "Owner") {
      await expect(voidButton).toBeVisible();
    } else {
      await expect(voidButton).toHaveCount(0);
      await expect(
        page.getByText("VOID penerimaan tidak tersedia untuk Kepala Budidaya."),
      ).toBeVisible();
    }
  });
}

test("hides VOID action when the batch is not active", async ({ page }) => {
  await openBatchDetail(page, "Admin Operasional", "completed");
  await expect(
    page.getByRole("button", { name: "VOID penerimaan", exact: true }),
  ).toHaveCount(0);
});

test("Kepala Budidaya marks a batch sale-ready with a note and history", async ({
  page,
}) => {
  const api = await openBatchDetail(page, "Kepala Budidaya");
  await expect(
    page.getByRole("heading", { name: "Kontrol Kesiapan Jual POS" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tandai SIAP_JUAL" }),
  ).toBeVisible();

  await page
    .getByLabel("Catatan perubahan (opsional)")
    .fill("Stok dan ukuran batch sudah diverifikasi");
  await page.getByRole("button", { name: "Tandai SIAP_JUAL" }).click();

  const historyRow = page
    .getByRole("row")
    .filter({ hasText: "Stok dan ukuran batch sudah diverifikasi" });
  await expect(historyRow).toContainText("BELUM_SIAP");
  await expect(historyRow).toContainText("SIAP_JUAL");
  await expect(historyRow).toContainText("Kepala Budidaya E2E");
  await expect(
    page.getByRole("button", { name: "Tarik ke BELUM_SIAP" }),
  ).toBeVisible();

  expect(api.readinessRequest).toMatchObject({
    path: `/api/v1/batches/${batchId}/sale-readiness`,
    method: "PATCH",
    payload: {
      saleReadiness: "SIAP_JUAL",
      note: "Stok dan ukuran batch sudah diverifikasi",
    },
  });
  expect(api.readinessRequest?.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("validates reason, sends UUIDv4 idempotency, and refreshes the voided batch", async ({
  page,
}) => {
  const api = await openBatchDetail(page, "Admin Operasional");
  await page
    .getByRole("button", { name: "VOID penerimaan", exact: true })
    .click();

  const dialog = page.getByRole("dialog", { name: "VOID penerimaan" });
  const reason = dialog.locator("#void-reason");
  const confirm = dialog.getByRole("button", { name: "Konfirmasi VOID" });

  await expect(dialog).toBeVisible();
  await expect(reason).toHaveAttribute("required", "");
  await expect(confirm).toBeDisabled();
  await reason.fill("   ");
  await expect(confirm).toBeDisabled();
  await reason.fill("  Kesalahan input ukuran  ");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("VOID", { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "VOID penerimaan", exact: true }),
  ).toHaveCount(0);
  expect(api.detailReads).toBeGreaterThanOrEqual(2);
  expect(api.voidRequest).not.toBeNull();
  expect(api.voidRequest?.reason).toBe("Kesalahan input ukuran");
  expect(api.voidRequest?.authorization).toBe("Bearer e2e-only-token");
  expect(api.voidRequest?.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect(page.getByText("Rincian penerimaan")).toBeVisible();
  await expect(page.getByText("Stok saat ini")).toBeVisible();
  await expect(page.getByText("Jumlah awal")).toBeVisible();
});
