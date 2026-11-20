import { expect, test, type Page, type Route } from "@playwright/test";

const batchId = "11111111-1111-4111-8111-111111111111";
const saleId = "22222222-2222-4222-8222-222222222222";
const creatorId = "33333333-3333-4333-8333-333333333333";

const receipt = {
  company_name: "PT. Pisciculture Farm Indonesia",
  transaction_date_time: "20/11/2026, 10.15.00 WIB",
  species_name: "Ikan Nila",
  fish_size: "3-5 cm",
  quantity: 2,
  unit_price: 2500,
  total_payment: 5000,
  payment_method: "cash",
  cashier_name: "Kasir Cetak",
};

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Berhasil.",
    data,
    meta: { request_id: "print-workflow-e2e" },
  };
}

async function setPrintBehavior(
  page: Page,
  behavior: "succeed" | "throw-once",
) {
  await page.addInitScript((behavior) => {
    const state = { calls: 0, behavior };
    Object.defineProperty(window, "__posPrintState", {
      configurable: true,
      value: state,
    });
    Object.defineProperty(window, "print", {
      configurable: true,
      value: () => {
        state.calls += 1;
        if (state.behavior === "throw-once" && state.calls === 1) {
          throw new Error("Printer tidak tersedia");
        }
      },
    });
  }, behavior);
}

async function setKasirSession(page: Page, userId = "kasir-actor") {
  await page.addInitScript((userId) => {
    sessionStorage.setItem(
      "pfi.operational.session.v1",
      JSON.stringify({
        accessToken: "e2e-print-token",
        expiresIn: "8h",
        user: {
          id: userId,
          name: "Kasir Cetak",
          email: "kasir-print@example.test",
          role: "Kasir",
        },
      }),
    );
  }, userId);
}

async function stubCashierSale(page: Page) {
  let postCount = 0;
  await page.route("**/api/v1/pos/batches**", async (route: Route) => {
    const url = new URL(route.request().url());
    const batch = {
      batch: {
        id: batchId,
        batch_code: "BATCH-PRINT-001",
        status: "active",
        current_stock: 20,
      },
      species: {
        id: "44444444-4444-4444-8444-444444444444",
        species_code: "NIL",
        species_name: "Ikan Nila",
      },
      fish_size: "3-5 cm",
      unit_price: 2500,
    };
    const data = url.pathname.endsWith("/batches")
      ? {
          items: [batch],
          pagination: { page: 1, limit: 100, totalItems: 1, totalPages: 1 },
        }
      : batch;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(successEnvelope(data)),
    });
  });
  await page.route("**/api/v1/pos/sales", async (route) => {
    if (route.request().method() === "POST") {
      postCount += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(
          successEnvelope({ sale: { id: saleId }, receipt }),
        ),
      });
    } else {
      await route.continue();
    }
  });
  await setKasirSession(page);
  await page.goto("/pos");
  await page
    .getByRole("button", { name: "Pilih batch BATCH-PRINT-001" })
    .click();
  await page.getByLabel("Jumlah ikan (ekor)").fill("2");
  await page.getByLabel("Saya mengonfirmasi harga terbaru").check();
  await page.getByLabel("Uang diterima (Rp)").fill("5000");
  await page.getByRole("button", { name: "Simpan penjualan" }).click();
  await expect(
    page.getByRole("heading", { name: "Penjualan berhasil disimpan" }),
  ).toBeVisible();
  return {
    get postCount() {
      return postCount;
    },
  };
}

async function printCallCount(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __posPrintState: { calls: number };
        }
      ).__posPrintState.calls,
  );
}

test("successful committed sale triggers auto-print exactly once", async ({
  page,
}) => {
  await setPrintBehavior(page, "succeed");
  const api = await stubCashierSale(page);

  await expect.poll(() => printCallCount(page)).toBe(1);
  expect(api.postCount).toBe(1);
  await expect(page.getByRole("status")).toContainText(
    "Dialog cetak sistem telah diminta",
  );
});

test("print failure leaves sale successful and retry never posts a second sale", async ({
  page,
}) => {
  await setPrintBehavior(page, "throw-once");
  const api = await stubCashierSale(page);

  await expect(page.locator('p[role="alert"]')).toContainText(
    "Transaksi penjualan berhasil tersimpan",
  );
  await expect(
    page.getByRole("heading", { name: "Penjualan berhasil disimpan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Coba Cetak Ulang" }),
  ).toBeVisible();
  expect(await printCallCount(page)).toBe(1);
  expect(api.postCount).toBe(1);

  await page.getByRole("button", { name: "Coba Cetak Ulang" }).click();
  await expect.poll(() => printCallCount(page)).toBe(2);
  expect(api.postCount).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Penjualan berhasil disimpan" }),
  ).toBeVisible();
});

test("detail reprint loads the existing receipt and local print retry does not mutate sales", async ({
  page,
}) => {
  let receiptGetCount = 0;
  let salePostCount = 0;
  await page.route(`**/api/v1/pos/sales/${saleId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({
          id: saleId,
          sale_code: "PFI-SAL-20261120-007",
          created_at: "2026-11-20T03:15:00.000Z",
          batch_id: batchId,
          batch_code: "BATCH-PRINT-001",
          species_name: "Ikan Nila",
          fish_size: "3-5 cm",
          quantity: 2,
          unit_price: 2500,
          total_amount: 5000,
          payment_method: "cash",
          cash_received: 5000,
          change_amount: 0,
          created_by: { id: creatorId, name: "Kasir Cetak" },
          status: "active",
          voided_at: null,
          voided_by: null,
        }),
      ),
    }),
  );
  await page.route(`**/api/v1/pos/sales/${saleId}/receipt`, async (route) => {
    receiptGetCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(successEnvelope(receipt)),
    });
  });
  await page.route("**/api/v1/pos/sales", async (route) => {
    if (route.request().method() === "POST") salePostCount += 1;
    await route.continue();
  });
  await setPrintBehavior(page, "throw-once");
  await setKasirSession(page, creatorId);
  await page.goto(`/pos/sales/${saleId}`);

  await page.getByRole("button", { name: "Cetak Ulang Struk" }).click();
  const preview = page.getByRole("region", { name: "Pratinjau struk" });
  await expect(preview).toBeVisible();
  await expect.poll(() => receiptGetCount).toBe(1);
  await expect.poll(() => printCallCount(page)).toBe(1);
  await expect(page.locator('p[role="alert"]')).toContainText(
    "proses cetak ulang gagal",
  );
  await expect(
    page.getByRole("button", { name: "Coba Cetak Ulang" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Coba Cetak Ulang" }).click();
  await expect.poll(() => printCallCount(page)).toBe(2);

  expect(receiptGetCount).toBe(1);
  expect(salePostCount).toBe(0);
  await expect(
    page.getByRole("button", { name: "Batalkan Transaksi (VOID)" }),
  ).toBeVisible();
});
