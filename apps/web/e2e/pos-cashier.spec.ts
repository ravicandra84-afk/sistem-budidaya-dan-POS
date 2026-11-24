import { expect, test, type Page, type Route } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kepala Budidaya" | "Kasir";

const batchId = "11111111-1111-4111-8111-111111111111";
const batchProduct = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sku: "NILA-35",
  name: "Ikan Nila 3-5 cm",
  tracking_mode: "BATCH_TRACKED" as const,
  species: "Ikan Nila",
  size_label: "3-5 cm",
  unit: "EKOR",
  unit_price: 2500,
  stock_quantity: 12,
  batches: [
    {
      id: batchId,
      batch_code: "BATCH-20261120-001",
      current_stock: 12,
      species_name: "Ikan Nila",
      size_label: "3-5 cm",
    },
  ],
};

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Berhasil.",
    data,
    meta: { request_id: "pos-v46-e2e" },
  };
}

async function setRoleSession(page: Page, role: TestRole) {
  await page.addInitScript((role) => {
    sessionStorage.setItem(
      "pfi.operational.session.v1",
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
  }, role);
}

async function openPos(page: Page, role: TestRole, products = [batchProduct]) {
  let catalogRequests = 0;
  await page.route("**/api/v1/pos/catalog", async (route: Route) => {
    catalogRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(successEnvelope({ items: products })),
    });
  });
  await setRoleSession(page, role);
  await page.goto("/pos");
  return {
    get catalogRequests() {
      return catalogRequests;
    },
  };
}

for (const role of ["Owner", "Admin Operasional", "Kasir"] as const) {
  test(`${role} can access the V4.6 cashier catalog`, async ({ page }) => {
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

test("Kepala Budidaya is redirected out of /pos before catalog loads", async ({
  page,
}) => {
  const api = await openPos(page, "Kepala Budidaya");

  await expect(page).toHaveURL(/\/batches$/);
  await expect(page.getByRole("link", { name: "POS / Kasir" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Kasir ikan" })).toHaveCount(
    0,
  );
  expect(api.catalogRequests).toBe(0);
});

test("batch checkout posts the V4.6 sale and renders its nine-slot receipt", async ({
  page,
}) => {
  let payload: Record<string, unknown> | null = null;
  let idempotencyKey = "";
  let requestPath = "";
  await page.route("**/api/v1/sales", async (route) => {
    const request = route.request();
    requestPath = new URL(request.url()).pathname;
    payload = request.postDataJSON() as Record<string, unknown>;
    idempotencyKey = request.headers()["idempotency-key"] ?? "";
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({
          sale: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
          receipt: {
            company_name: "PT. Pisciculture Farm Indonesia",
            transaction_date_time: "24/11/2026, 10.15 WIB",
            species_name: "Ikan Nila",
            fish_size: "3-5 cm",
            quantity: 2,
            unit: "EKOR",
            unit_price: 2500,
            total_payment: 5000,
            payment_method: "cash",
            cashier_name: "Kasir E2E",
          },
        }),
      ),
    });
  });
  await openPos(page, "Kasir");

  await page
    .getByRole("button", { name: "Pilih batch BATCH-20261120-001" })
    .click();
  await page.getByLabel("Jumlah ikan (ekor)").fill("2");
  await page.getByLabel("Uang diterima").fill("5000");
  await page.getByRole("button", { name: "Simpan penjualan" }).click();

  await expect(
    page.getByRole("heading", { name: "Penjualan berhasil" }),
  ).toBeVisible();
  const receipt = page.getByRole("region", { name: "Pratinjau struk" });
  await expect(receipt.getByRole("definition")).toHaveCount(9);
  await expect(receipt.getByText("Ikan Nila", { exact: true })).toBeVisible();
  await expect(receipt.getByText("3-5 cm", { exact: true })).toBeVisible();
  await expect(receipt.getByText("2 EKOR", { exact: true })).toBeVisible();
  await expect(receipt.getByText("BATCH-20261120-001")).toHaveCount(0);
  expect(requestPath).toBe("/api/v1/sales");
  expect(payload).toMatchObject({
    product_id: batchProduct.id,
    batch_id: batchId,
    quantity: 2,
    expected_unit_price: 2500,
    payment_method: "cash",
    cash_received: 5000,
  });
  expect(idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("Kasir completes a fractional NON_BATCH sale with the V4.6 receipt mapping", async ({
  page,
}) => {
  const nonBatchProduct = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    sku: "PELET-PF-1000",
    name: "Pakan Pelet PF-1000",
    tracking_mode: "NON_BATCH" as const,
    species: null,
    size_label: null,
    unit: "SAK",
    unit_price: 1000,
    stock_quantity: 4.5,
    batches: [],
  };
  let payload: Record<string, unknown> | null = null;
  let idempotencyKey = "";
  await page.route("**/api/v1/sales", async (route) => {
    const request = route.request();
    payload = request.postDataJSON() as Record<string, unknown>;
    idempotencyKey = request.headers()["idempotency-key"] ?? "";
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({
          sale: { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
          receipt: {
            company_name: "PT. Pisciculture Farm Indonesia",
            transaction_date_time: "24/11/2026, 10.15 WIB",
            species_name: nonBatchProduct.name,
            fish_size: nonBatchProduct.sku,
            quantity: 1.5,
            unit: nonBatchProduct.unit,
            unit_price: 1000,
            total_payment: 1500,
            payment_method: "cash",
            cashier_name: "Kasir E2E",
          },
        }),
      ),
    });
  });
  await openPos(page, "Kasir", [nonBatchProduct]);

  await page
    .getByRole("button", { name: "Pilih produk Pakan Pelet PF-1000" })
    .click();
  const quantityInput = page.getByLabel("Jumlah barang (SAK)");
  await expect(quantityInput).toHaveAttribute("step", "0.01");
  await expect(quantityInput).toHaveAttribute("max", "4.5");
  await quantityInput.fill("5");
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();
  await quantityInput.fill("1.5");
  await page.getByLabel("Uang diterima").fill("2000");
  await expect(page.getByText("Rp 1.500", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Simpan penjualan" }).click();

  const receipt = page.getByRole("region", { name: "Pratinjau struk" });
  await expect(receipt.getByRole("definition")).toHaveCount(9);
  await expect(
    receipt.getByText(nonBatchProduct.name, { exact: true }),
  ).toBeVisible();
  await expect(
    receipt.getByText(nonBatchProduct.sku, { exact: true }),
  ).toBeVisible();
  await expect(receipt.getByText("1,5 SAK", { exact: true })).toBeVisible();
  await expect(receipt.getByText(/BATCH|Kode Batch/i)).toHaveCount(0);
  expect(payload).toMatchObject({
    product_id: nonBatchProduct.id,
    batch_id: null,
    quantity: 1.5,
    expected_unit_price: 1000,
    payment_method: "cash",
    cash_received: 2000,
  });
  expect(idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("cashier workspace fits a narrow viewport without horizontal overflow", async ({
  page,
}) => {
  await openPos(page, "Kasir");
  await page
    .getByRole("button", { name: "Pilih batch BATCH-20261120-001" })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
});
