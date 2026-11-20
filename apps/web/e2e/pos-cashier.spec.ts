import { expect, test, type Page } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kepala Budidaya" | "Kasir";

const availableBatchId = "11111111-1111-4111-8111-111111111111";
const missingPriceBatchId = "22222222-2222-4222-8222-222222222222";

function batchItem(
  id: string,
  batchCode: string,
  stock: number,
  price: number | null,
) {
  return {
    batch: {
      id,
      batch_code: batchCode,
      status: "active",
      current_stock: stock,
    },
    species: {
      id: "33333333-3333-4333-8333-333333333333",
      species_code: "NIL",
      species_name: "Ikan Nila",
    },
    fish_size: "3-5 cm",
    unit_price: price,
  };
}

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Berhasil.",
    data,
    meta: { request_id: "pos-e2e-request" },
  };
}

async function openPos(page: Page, role: TestRole) {
  let batchListRequests = 0;
  await page.route("**/api/v1/pos/batches**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/pos/batches") {
      batchListRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          successEnvelope({
            items: [
              batchItem(availableBatchId, "BATCH-20261120-001", 12, 2500),
              batchItem(missingPriceBatchId, "BATCH-20261120-002", 8, null),
            ],
            pagination: {
              page: 1,
              limit: 100,
              totalItems: 2,
              totalPages: 1,
            },
          }),
        ),
      });
      return;
    }

    const batchId = pathname.split("/").at(-1);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope(
          batchId === missingPriceBatchId
            ? batchItem(batchId, "BATCH-20261120-002", 8, null)
            : batchItem(
                batchId ?? availableBatchId,
                "BATCH-20261120-001",
                12,
                2500,
              ),
        ),
      ),
    });
  });

  await page.addInitScript(
    ({ sessionStorageKey, role }) => {
      sessionStorage.setItem(
        sessionStorageKey,
        JSON.stringify({
          accessToken: "e2e-pos-token",
          expiresIn: "8h",
          user: {
            id: `e2e-${role}`,
            name: `${role} E2E`,
            email: "e2e@example.test",
            role,
          },
        }),
      );
    },
    { sessionStorageKey: "pfi.operational.session.v1", role },
  );

  await page.goto("/pos");
  return {
    get batchListRequests() {
      return batchListRequests;
    },
  };
}

for (const role of ["Owner", "Admin Operasional", "Kasir"] as const) {
  test(`${role} can navigate to the cashier POS`, async ({ page }) => {
    await openPos(page, role);

    await expect(page.getByRole("link", { name: "POS / Kasir" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Kasir ikan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pilih batch BATCH-20261120-001" }),
    ).toBeVisible();
  });
}

test("Kepala Budidaya has no POS navigation and is redirected from /pos", async ({
  page,
}) => {
  const pos = await openPos(page, "Kepala Budidaya");

  await expect(page).toHaveURL(/\/batches$/);
  await expect(page.getByRole("link", { name: "POS / Kasir" })).toHaveCount(0);
  expect(pos.batchListRequests).toBe(0);
  await expect(page.getByRole("heading", { name: "Kasir ikan" })).toHaveCount(
    0,
  );
});

test("cashier workspace fits a narrow viewport without horizontal overflow", async ({
  page,
}) => {
  await openPos(page, "Kasir");
  await page
    .getByRole("button", { name: "Pilih batch BATCH-20261120-001" })
    .click();
  await page.getByLabel("Jumlah ikan (ekor)").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
});

test("cash checkout caps quantity and refreshes both price and stock conflicts", async ({
  page,
}) => {
  let currentStock = 12;
  let currentPrice = 2500;
  let detailRequests = 0;
  let saleAttempts = 0;
  const idempotencyKeys: string[] = [];
  const payloads: Array<Record<string, unknown>> = [];

  await page.route("**/api/v1/pos/batches**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/pos/batches") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          successEnvelope({
            items: [
              batchItem(availableBatchId, "BATCH-20261120-001", 12, 2500),
            ],
            pagination: { page: 1, limit: 100, totalItems: 1, totalPages: 1 },
          }),
        ),
      });
      return;
    }

    detailRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope(
          batchItem(
            availableBatchId,
            "BATCH-20261120-001",
            currentStock,
            currentPrice,
          ),
        ),
      ),
    });
  });

  await page.route("**/api/v1/pos/sales", async (route) => {
    const request = route.request();
    idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
    payloads.push(request.postDataJSON() as Record<string, unknown>);
    saleAttempts += 1;

    if (saleAttempts === 1) {
      currentPrice = 3000;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          status: "error",
          message: "Harga jual berubah.",
          error: { code: "PRICE_CHANGED", details: { unit_price: 3000 } },
          meta: { request_id: "price-conflict" },
        }),
      });
      return;
    }

    if (saleAttempts === 2) {
      currentStock = 5;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          status: "error",
          message: "Stok batch berubah.",
          error: {
            code: "INSUFFICIENT_STOCK",
            details: { available_quantity: 5 },
          },
          meta: { request_id: "stock-conflict" },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({
          sale: { id: "44444444-4444-4444-8444-444444444444" },
          receipt: {
            company_name: "PT. Pisciculture Farm Indonesia",
            transaction_date_time: "20/11/2026, 10.15.00 WIB",
            species_name: "Ikan Nila",
            fish_size: "3-5 cm",
            quantity: 5,
            unit_price: 3000,
            total_payment: 15000,
            payment_method: "cash",
            cashier_name: "Kasir E2E",
          },
        }),
      ),
    });
  });

  await page.addInitScript(() => {
    sessionStorage.setItem(
      "pfi.operational.session.v1",
      JSON.stringify({
        accessToken: "e2e-pos-token",
        expiresIn: "8h",
        user: {
          id: "e2e-Kasir",
          name: "Kasir E2E",
          email: "e2e@example.test",
          role: "Kasir",
        },
      }),
    );
  });
  await page.goto("/pos");

  await expect(
    page.getByRole("button", { name: "Pilih batch BATCH-20261120-001" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pilih batch BATCH-20261120-001" })
    .click();
  const checkout = page.locator('section[aria-labelledby="checkout-title"]');
  const batchSnapshot = checkout.locator(".grid.grid-cols-2");
  await expect(
    batchSnapshot.getByText("Rp 2.500", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Jumlah ikan (ekor)").fill("20");
  await expect(page.getByLabel("Jumlah ikan (ekor)")).toHaveValue("12");
  await expect(
    page
      .locator('p[role="alert"]')
      .filter({ hasText: "Jumlah dibatasi otomatis menjadi 12 ekor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();
  await page.getByLabel("Saya menyetujui jumlah yang dibatasi").check();
  await page.getByLabel("Saya mengonfirmasi harga terbaru").check();
  await page.getByLabel("Uang diterima (Rp)").fill("50000");
  await expect(page.getByText("Rp 20.000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simpan penjualan" }).click();

  await expect(
    page.locator('p[role="alert"]').filter({ hasText: "Harga berubah" }),
  ).toBeVisible();
  await expect(
    batchSnapshot.getByText("Rp 3.000", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Saya mengonfirmasi harga terbaru"),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();
  await page.getByLabel("Saya mengonfirmasi harga terbaru").check();
  await expect(checkout.getByText("Rp 36.000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simpan penjualan" }).click();

  await expect(
    page.locator('p[role="alert"]').filter({ hasText: "Stok berubah" }),
  ).toBeVisible();
  await expect(page.getByLabel("Jumlah ikan (ekor)")).toHaveValue("5");
  await expect(
    page
      .locator('p[role="alert"]')
      .filter({ hasText: "Jumlah dibatasi otomatis menjadi 5 ekor" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Saya mengonfirmasi harga terbaru"),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();
  await page.getByLabel("Saya menyetujui jumlah yang dibatasi").check();
  await page.getByLabel("Saya mengonfirmasi harga terbaru").check();
  await expect(checkout.getByText("Rp 15.000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simpan penjualan" }).click();

  await expect(
    page.getByRole("heading", { name: "Penjualan berhasil disimpan" }),
  ).toBeVisible();
  await expect(page.getByRole("definition")).toHaveCount(9);
  await expect(page.getByText("PT. Pisciculture Farm Indonesia")).toBeVisible();
  await expect(
    page.getByLabel("Ringkasan struk").getByText("Kasir E2E"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mulai transaksi baru" }),
  ).toBeVisible();
  expect(detailRequests).toBeGreaterThanOrEqual(3);
  expect(saleAttempts).toBe(3);
  expect(
    idempotencyKeys.every((key) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      ),
    ),
  ).toBe(true);
  expect(new Set(idempotencyKeys).size).toBe(3);
  expect(payloads[0]).toMatchObject({
    quantity: 12,
    expected_unit_price: 2500,
    cash_received: 50000,
  });
  expect(payloads[1]).toMatchObject({
    quantity: 12,
    expected_unit_price: 3000,
    cash_received: 50000,
  });
  expect(payloads[2]).toMatchObject({
    quantity: 5,
    expected_unit_price: 3000,
    cash_received: 50000,
  });
});

test("missing price blocks checkout and transfer requires an explicit confirmation", async ({
  page,
}) => {
  let salePayload: Record<string, unknown> | null = null;
  await page.route("**/api/v1/pos/batches**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const isDetail = pathname !== "/api/v1/pos/batches";
    const id = isDetail ? pathname.split("/").at(-1) : undefined;
    const items = [
      batchItem(missingPriceBatchId, "BATCH-20261120-002", 8, null),
      batchItem(availableBatchId, "BATCH-20261120-001", 8, 1000),
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope(
          isDetail
            ? id === missingPriceBatchId
              ? batchItem(missingPriceBatchId, "BATCH-20261120-002", 8, null)
              : batchItem(availableBatchId, "BATCH-20261120-001", 8, 1000)
            : {
                items,
                pagination: {
                  page: 1,
                  limit: 100,
                  totalItems: 2,
                  totalPages: 1,
                },
              },
        ),
      ),
    });
  });
  await page.route("**/api/v1/pos/sales", async (route) => {
    salePayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({
          sale: { id: "55555555-5555-4555-8555-555555555555" },
          receipt: {
            company_name: "PT. Pisciculture Farm Indonesia",
            transaction_date_time: "20/11/2026, 10.15.00 WIB",
            species_name: "Ikan Nila",
            fish_size: "3-5 cm",
            quantity: 2,
            unit_price: 1000,
            total_payment: 2000,
            payment_method: "transfer",
            cashier_name: "Owner E2E",
          },
        }),
      ),
    });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "pfi.operational.session.v1",
      JSON.stringify({
        accessToken: "e2e-pos-token",
        expiresIn: "8h",
        user: {
          id: "e2e-Owner",
          name: "Owner E2E",
          email: "e2e@example.test",
          role: "Owner",
        },
      }),
    );
  });
  await page.goto("/pos");

  await expect(page.getByText("Harga belum tersedia").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Pilih batch BATCH-20261120-002" })
    .click();
  await expect(page.locator('p[role="alert"]')).toContainText("belum tersedia");
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();

  await page
    .getByRole("button", { name: "Pilih batch BATCH-20261120-001" })
    .click();
  await expect(
    page
      .locator('section[aria-labelledby="checkout-title"] .grid.grid-cols-2')
      .getByText("Rp 1.000", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Saya mengonfirmasi harga terbaru" })
    .check();
  await page.getByRole("radio", { name: "Transfer" }).check();
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "Saya mengonfirmasi dana transfer sudah diterima",
    })
    .check();
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Simpan penjualan" }).click();

  await expect(
    page.getByRole("heading", { name: "Penjualan berhasil disimpan" }),
  ).toBeVisible();
  expect(salePayload).toMatchObject({
    batch_id: availableBatchId,
    quantity: 1,
    expected_unit_price: 1000,
    payment_method: "transfer",
    transfer_confirmed: true,
  });
  expect(salePayload).not.toHaveProperty("cash_received");
  await expect(page.getByRole("definition")).toHaveCount(9);
});
