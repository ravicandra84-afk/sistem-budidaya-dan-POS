import { expect, test, type Page, type Route } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kepala Budidaya" | "Kasir";

const batchId = "11111111-1111-4111-8111-111111111111";
const batchProduct = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  category_id: "benih-ikan",
  category_name: "Benih Ikan",
  sku: "NILA-35",
  name: "Ikan Nila 3-5 cm",
  tracking_mode: "BATCH_TRACKED" as const,
  species: "Ikan Nila",
  size_label: "3-5 cm",
  variant_label: null,
  unit: "EKOR",
  unit_price: 2500,
  available_stock: 12,
  stock_quantity: 12,
  batches: [
    {
      id: batchId,
      batch_id: batchId,
      batch_code: "BATCH-20261120-001",
      current_stock: 12,
      remaining_stock: 12,
      sale_readiness: "SIAP_JUAL",
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
  const categoryMap = new Map<string, Record<string, unknown>>();
  for (const product of products) {
    const categoryId =
      product.category_id ??
      (product.tracking_mode === "BATCH_TRACKED"
        ? "legacy-fish"
        : "legacy-general");
    categoryMap.set(categoryId, {
      id: categoryId,
      name:
        product.category_name ??
        (product.tracking_mode === "BATCH_TRACKED"
          ? "Benih Ikan"
          : "Produk Umum"),
      code: String(categoryId).toUpperCase(),
      requires_batch: product.tracking_mode === "BATCH_TRACKED",
      is_active: true,
    });
  }
  await page.route("**/api/v1/pos/categories**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({ items: [...categoryMap.values()] }),
      ),
    });
  });
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

async function selectCashierProduct(
  page: Page,
  categoryName: string,
  typeName: string,
  productName: string,
) {
  await page
    .getByRole("button", { name: new RegExp(`^${categoryName}`) })
    .click();
  await page.getByRole("button", { name: new RegExp(`^${typeName}`) }).click();
  await page
    .getByRole("button", { name: new RegExp(`^Pilih varian ${productName}`) })
    .click();
}

for (const role of ["Owner", "Admin Operasional", "Kasir"] as const) {
  test(`${role} can access the V4.6 cashier catalog`, async ({ page }) => {
    await openPos(page, role);
    await selectCashierProduct(
      page,
      "Benih Ikan",
      "Ikan Nila",
      batchProduct.name,
    );

    await expect(page.getByRole("link", { name: "POS / Kasir" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Kasir ikan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^Pilih varian Ikan Nila 3-5 cm/,
      }),
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
  await page.route("**/api/v1/pos/sales", async (route) => {
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

  {
    const pageForSplit = page;
    const secondBatchId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const splitProduct = {
      ...batchProduct,
      id: "99999999-9999-4999-8999-999999999999",
      available_stock: 1000,
      stock_quantity: 1000,
      batches: [
        {
          id: batchId,
          batch_id: batchId,
          batch_code: "BATCH-SPLIT-A",
          current_stock: 600,
          remaining_stock: 600,
          sale_readiness: "SIAP_JUAL",
          species_name: "Ikan Nila",
          size_label: "3-5 cm",
        },
        {
          id: secondBatchId,
          batch_id: secondBatchId,
          batch_code: "BATCH-SPLIT-B",
          current_stock: 400,
          remaining_stock: 400,
          sale_readiness: "SIAP_JUAL",
          species_name: "Ikan Nila",
          size_label: "3-5 cm",
        },
      ],
    };
    let payload: Record<string, unknown> | null = null;
    let requestPath = "";
    await page.addInitScript(() => {
      const printWindow = window as Window & { __posPrintCount?: number };
      printWindow.__posPrintCount = 0;
      window.print = () => {
        printWindow.__posPrintCount = (printWindow.__posPrintCount ?? 0) + 1;
      };
    });
    await page.route(
      "**/api/v1/pos/sales",
      async (route) => {
        requestPath = new URL(route.request().url()).pathname;
        payload = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify(
            successEnvelope({
              sale: {
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                checkout_group_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              },
              receipt: {
                company_name: "PT. Pisciculture Farm Indonesia",
                transaction_date_time: "24/11/2026, 10.15 WIB",
                species_name: "Ikan Nila",
                fish_size: "3-5 cm",
                quantity: 1000,
                unit: "EKOR",
                unit_price: 2500,
                total_payment: 2_500_000,
                payment_method: "cash",
                cashier_name: "Kasir E2E",
              },
            }),
          ),
        });
      },
      { times: 1 },
    );
    await openPos(pageForSplit, "Kasir", [splitProduct]);
    await selectCashierProduct(
      pageForSplit,
      "Benih Ikan",
      "Ikan Nila",
      splitProduct.name,
    );

    const batchQuantities = pageForSplit.getByLabel("Jumlah ekor");
    await expect(batchQuantities).toHaveCount(2);
    await expect(batchQuantities.nth(0)).toHaveAttribute("max", "600");
    await expect(batchQuantities.nth(1)).toHaveAttribute("max", "400");
    await batchQuantities.nth(0).fill("601");
    await batchQuantities.nth(1).fill("400");
    await expect(
      pageForSplit.getByRole("button", { name: "Simpan penjualan" }),
    ).toBeDisabled();
    await batchQuantities.nth(0).fill("600");
    await expect(
      pageForSplit.getByText("Total dialokasikan: 1.000 ekor"),
    ).toBeVisible();
    await expect(
      pageForSplit.getByText("Rp 2.500.000", { exact: true }),
    ).toBeVisible();

    const cashInput = pageForSplit.getByLabel("Uang diterima");
    await cashInput.fill("2600000");
    await expect(page.getByText(/Uang Kembalian.*100\.000/)).toBeVisible();
    await pageForSplit.getByRole("button", { name: "Uang Pas" }).click();
    await expect(cashInput).toHaveValue("2500000");
    await expect(page.getByText(/Uang Kembalian.*Rp 0/)).toBeVisible();
    expect(
      await pageForSplit.evaluate(
        () => (window as Window & { __posPrintCount?: number }).__posPrintCount,
      ),
    ).toBe(0);

    await pageForSplit
      .getByRole("button", { name: "Simpan penjualan" })
      .click();
    await expect(
      pageForSplit.getByRole("heading", { name: "Penjualan berhasil" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        pageForSplit.evaluate(
          () =>
            (window as Window & { __posPrintCount?: number }).__posPrintCount,
        ),
      )
      .toBe(1);
    expect(requestPath).toBe("/api/v1/pos/sales");
    expect(payload).toMatchObject({
      product_id: splitProduct.id,
      quantity: 1000,
      batch_allocations: [
        { batch_id: batchId, quantity: 600 },
        { batch_id: secondBatchId, quantity: 400 },
      ],
      expected_unit_price: 2500,
      payment_method: "cash",
      cash_received: 2_500_000,
    });
    expect(payload).not.toHaveProperty("batch_id");
    const receipt = pageForSplit.getByRole("region", {
      name: "Pratinjau struk",
    });
    await expect(receipt.getByRole("definition")).toHaveCount(9);
    await expect(receipt.getByText(/BATCH-SPLIT/)).toHaveCount(0);
  }
  await page.addInitScript(() => {
    const printWindow = window as Window & { __posPrintCount?: number };
    printWindow.__posPrintCount = 0;
    window.print = () => {
      printWindow.__posPrintCount = (printWindow.__posPrintCount ?? 0) + 1;
    };
  });
  await openPos(page, "Kasir");

  await selectCashierProduct(
    page,
    "Benih Ikan",
    "Ikan Nila",
    batchProduct.name,
  );
  await page.getByLabel("Jumlah ekor").fill("2");
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
  expect(requestPath).toBe("/api/v1/pos/sales");
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
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __posPrintCount?: number }).__posPrintCount,
      ),
    )
    .toBe(1);
});

test("Kasir completes a fractional NON_BATCH sale with the V4.6 receipt mapping", async ({
  page,
}) => {
  const nonBatchProduct = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    category_id: "produk-umum",
    category_name: "Produk Umum",
    sku: "PELET-PF-1000",
    name: "Pakan Pelet PF-1000",
    tracking_mode: "NON_BATCH" as const,
    species: null,
    size_label: null,
    variant_label: null,
    unit: "SAK",
    unit_price: 1000,
    available_stock: 4.5,
    stock_quantity: 4.5,
    batches: [],
  };
  let payload: Record<string, unknown> | null = null;
  let idempotencyKey = "";
  await page.route("**/api/v1/pos/sales", async (route) => {
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

  await selectCashierProduct(
    page,
    "Produk Umum",
    nonBatchProduct.name,
    nonBatchProduct.name,
  );
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

test("shows active products with zero stock and blocks checkout", async ({
  page,
}) => {
  const unavailableBatchProduct = {
    ...batchProduct,
    category_id: "benih-ikan",
    category_name: "Benih Ikan",
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    sku: "LELE-35",
    name: "Ikan Lele 3-5 cm",
    species: "Ikan Lele",
    available_stock: 0,
    stock_quantity: 0,
    batches: [],
  };
  const unavailableNonBatchProduct = {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    category_id: "produk-umum",
    category_name: "Produk Umum",
    sku: "PELET-KOSONG",
    name: "Pakan Pelet Kosong",
    tracking_mode: "NON_BATCH" as const,
    species: null,
    size_label: null,
    variant_label: null,
    unit: "SAK",
    unit_price: 1000,
    available_stock: 0,
    stock_quantity: 0,
    batches: [],
  };

  await openPos(page, "Kasir", [
    unavailableBatchProduct,
    unavailableNonBatchProduct,
  ]);

  await selectCashierProduct(
    page,
    "Benih Ikan",
    "Ikan Lele",
    unavailableBatchProduct.name,
  );
  const batchCard = page.getByRole("button", {
    name: /^Pilih varian Ikan Lele 3-5 cm/,
  });
  await expect(batchCard).toBeVisible();
  await expect(batchCard).toContainText("Stok Habis (0)");
  await batchCard.click();
  await expect(
    page.getByText("Produk ini belum memiliki stok SIAP_JUAL", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();

  await selectCashierProduct(
    page,
    "Produk Umum",
    unavailableNonBatchProduct.name,
    unavailableNonBatchProduct.name,
  );
  const nonBatchCard = page.getByRole("button", {
    name: /^Pilih varian Pakan Pelet Kosong/,
  });
  await expect(nonBatchCard).toBeVisible();
  await expect(nonBatchCard).toContainText("Stok Habis (0)");
  await nonBatchCard.click();
  await expect(
    page.getByText("Stok produk ini sedang habis (0)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Jumlah barang (SAK)")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Simpan penjualan" }),
  ).toBeDisabled();
});

test("cashier workspace fits a narrow viewport without horizontal overflow", async ({
  page,
}) => {
  await openPos(page, "Kasir");
  await selectCashierProduct(
    page,
    "Benih Ikan",
    "Ikan Nila",
    batchProduct.name,
  );
  await page.setViewportSize({ width: 390, height: 844 });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
});
