import { expect, test, type Page, type Route } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kasir" | "Kepala Budidaya";
type TrackingMode = "BATCH_TRACKED" | "NON_BATCH";

interface Category {
  id: string;
  name: string;
  code: string;
  requires_batch: boolean;
  is_active: boolean;
}

interface Product {
  id: string;
  category_id: string;
  category_name: string;
  sku: string;
  name: string;
  tracking_mode: TrackingMode;
  species: string | null;
  size_label: string | null;
  variant_label?: string | null;
  unit: string;
  unit_price: number;
  stock_quantity: number | null;
  is_active: boolean;
}

const batchCategoryId = "11111111-1111-4111-8111-111111111111";
const generalCategoryId = "22222222-2222-4222-8222-222222222222";
const newCategoryId = "33333333-3333-4333-8333-333333333333";
const equipmentCategoryId = "55555555-5555-4555-8555-555555555555";
const productId = "44444444-4444-4444-8444-444444444444";

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Berhasil.",
    data,
    meta: { request_id: "catalog-e2e-request" },
  };
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function setRoleSession(page: Page, role: TestRole) {
  await page.addInitScript((role) => {
    sessionStorage.setItem(
      "pfi.operational.session.v1",
      JSON.stringify({
        accessToken: "e2e-catalog-token",
        expiresIn: "8h",
        user: {
          id: `e2e-${role}`,
          name: `${role} Uji`,
          email: "e2e@example.test",
          role,
        },
      }),
    );
  }, role);
}

async function stubCatalog(page: Page, options: { products?: Product[] } = {}) {
  let categories: Category[] = [
    {
      id: batchCategoryId,
      name: "Benih ikan",
      code: "BENIH-IKAN",
      requires_batch: true,
      is_active: true,
    },
    {
      id: generalCategoryId,
      name: "Produk umum",
      code: "PRODUK-UMUM",
      requires_batch: false,
      is_active: true,
    },
  ];
  let products = options.products ?? [];
  const categoryWrites: Array<Record<string, unknown>> = [];
  const productWrites: Array<Record<string, unknown>> = [];
  const idempotencyKeys: string[] = [];
  let createdCategoryCount = 0;

  await page.route("**/api/v1/pos/categories**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      await fulfillJson(
        route,
        200,
        successEnvelope({
          items: categories,
          pagination: {
            page: 1,
            limit: 100,
            totalItems: categories.length,
            totalPages: 1,
          },
        }),
      );
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    categoryWrites.push(body);
    idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
    if (request.method() === "POST") {
      const created: Category = {
        id: createdCategoryCount++ === 0 ? newCategoryId : equipmentCategoryId,
        name: String(body.name),
        code: String(body.code),
        requires_batch: Boolean(body.requires_batch),
        is_active: true,
      };
      categories = [...categories, created];
      await fulfillJson(route, 201, successEnvelope(created));
      return;
    }

    const categoryId = url.pathname.split("/").at(-1);
    categories = categories.map((category) =>
      category.id === categoryId ? { ...category, ...body } : category,
    );
    await fulfillJson(
      route,
      200,
      successEnvelope(
        categories.find((category) => category.id === categoryId),
      ),
    );
  });

  await page.route("**/api/v1/pos/products**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      await fulfillJson(
        route,
        200,
        successEnvelope({
          items: products,
          pagination: {
            page: 1,
            limit: 100,
            totalItems: products.length,
            totalPages: 1,
          },
        }),
      );
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    productWrites.push(body);
    idempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
    if (request.method() === "POST") {
      const categoryId = String(body.category_id);
      const created: Product = {
        id: productId,
        category_id: categoryId,
        category_name:
          categories.find((category) => category.id === categoryId)?.name ?? "",
        sku: String(body.sku),
        name: String(body.name),
        tracking_mode: body.tracking_mode as TrackingMode,
        species: body.species as string | null,
        size_label: body.size_label as string | null,
        variant_label: (body.variant_label as string | null) ?? null,
        unit: String(body.unit),
        unit_price: Number(body.unit_price),
        stock_quantity: body.stock_quantity as number | null,
        is_active: true,
      };
      products = [created, ...products];
      await fulfillJson(route, 201, successEnvelope(created));
      return;
    }

    const targetId = url.pathname.split("/").at(-1);
    if (request.method() === "DELETE") {
      products = products.map((product) =>
        product.id === targetId ? { ...product, is_active: false } : product,
      );
    } else {
      products = products.map((product) =>
        product.id === targetId ? { ...product, ...body } : product,
      );
    }
    await fulfillJson(
      route,
      200,
      successEnvelope(products.find((product) => product.id === targetId)),
    );
  });

  return { categoryWrites, productWrites, idempotencyKeys };
}

for (const role of ["Owner", "Admin Operasional"] as const) {
  test(`${role} can manage V4.6 categories and product catalog`, async ({
    page,
  }) => {
    const api = await stubCatalog(page);
    await setRoleSession(page, role);
    await page.goto("/pos/prices");

    await expect(
      page.getByRole("heading", { name: "Manajemen produk & harga" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Kategori produk" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Tambah kategori" }).click();
    await page.getByLabel("Nama kategori").fill("Pakan");
    await page.getByLabel("Kode").fill("PAKAN");
    await page.getByRole("button", { name: "Simpan kategori" }).click();
    const newCategoryRow = page.getByRole("row").filter({ hasText: "Pakan" });
    await expect(newCategoryRow).toContainText("Non-batch");

    await newCategoryRow.getByRole("button", { name: "Ubah" }).click();
    await page.getByLabel("Nama kategori").fill("Obat Ikan");
    await page.getByLabel("Kode").fill("OBAT-IKAN");
    await page.getByRole("button", { name: "Simpan kategori" }).click();
    const updatedCategoryRow = page
      .getByRole("row")
      .filter({ hasText: "Obat Ikan" });
    await expect(updatedCategoryRow).toContainText("Non-batch");

    page.on("dialog", (dialog) => dialog.accept());
    await updatedCategoryRow.getByRole("button", { name: "Arsip" }).click();
    await expect(updatedCategoryRow).toContainText("Diarsipkan");
    await updatedCategoryRow.getByRole("button", { name: "Aktifkan" }).click();
    await expect(updatedCategoryRow).toContainText("Aktif");

    await page.getByRole("button", { name: "Tambah kategori" }).click();
    await page.getByLabel("Nama kategori").fill("Peralatan Perikanan");
    await page.getByLabel("Kode").fill("PERALATAN-PERIKANAN");
    await page.getByRole("button", { name: "Simpan kategori" }).click();
    await expect(
      page.getByRole("row").filter({ hasText: "Peralatan Perikanan" }),
    ).toContainText("Non-batch");

    await page.getByRole("button", { name: "Tambah produk" }).click();
    await page.locator("#product-category").selectOption(generalCategoryId);
    await page.getByLabel("Mode pelacakan").selectOption("BATCH_TRACKED");
    await page.getByLabel("SKU").fill("BATCH-INVALID-PRICE");
    await page.getByLabel("Nama produk").fill("Benih uji");
    await page.getByLabel("Jenis ikan").fill("Ikan Nila");
    await page.getByLabel("Ukuran ikan").fill("3-5 cm");
    await page.getByLabel("Harga satuan").fill("1250.5");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    await expect(
      page.getByText("Harga produk batch harus bilangan bulat", {
        exact: false,
      }),
    ).toBeVisible();
    expect(api.productWrites).toHaveLength(0);

    await page.getByLabel("Mode pelacakan").selectOption("NON_BATCH");
    await page.getByLabel("SKU").fill("PELET-001");
    await page.getByLabel("Nama produk").fill("Pakan pelet");
    await page.locator("#product-unit").fill("SAK");
    await page.getByLabel("Stok barang").fill("10.5");
    await page.getByLabel("Harga satuan").fill("1250.5");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    const productRow = page.getByRole("row").filter({ hasText: "PELET-001" });
    await expect(productRow).toBeVisible();
    expect(api.productWrites[0]).toMatchObject({
      tracking_mode: "NON_BATCH",
      unit_price: 1250.5,
      stock_quantity: 10.5,
      unit: "SAK",
    });

    await productRow.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Harga satuan").fill("1251.25");
    await page.getByRole("button", { name: "Simpan", exact: true }).click();
    expect(api.productWrites[1]).toMatchObject({ unit_price: 1251.25 });

    await productRow.getByRole("button", { name: "Arsip" }).click();
    await expect(page.getByText("Produk tidak ditemukan")).toBeVisible();
    expect(api.productWrites).toHaveLength(3);
    expect(api.categoryWrites).toHaveLength(5);
    expect(api.idempotencyKeys).toHaveLength(8);
    expect(
      api.idempotencyKeys.every((key) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          key,
        ),
      ),
    ).toBe(true);
    expect(new Set(api.idempotencyKeys).size).toBe(8);
  });
}

test("normalizes batch species and size before creating a catalog product", async ({
  page,
}) => {
  const api = await stubCatalog(page);
  await setRoleSession(page, "Owner");
  await page.goto("/pos/prices");

  await page.getByRole("button", { name: "Tambah produk" }).click();
  await expect(page.locator("#product-species")).toHaveAttribute(
    "list",
    "batch-species-options",
  );
  await expect(page.locator("#product-size")).toHaveAttribute(
    "list",
    "batch-size-options",
  );
  await expect(page.locator("#batch-species-options option")).toHaveCount(4);
  await expect(page.locator("#batch-size-options option")).toHaveCount(8);

  await page.getByLabel("SKU").fill("LELE-35-NORMALIZED");
  await page.getByLabel("Nama produk").fill("Benih Lele");
  await page.getByLabel("Jenis ikan").fill("  Lele   ");
  await page.getByLabel("Ukuran ikan").fill("3 - 5 cm");
  await page.getByLabel("Varian").fill("  Hitam  ");
  await page.getByLabel("Harga satuan").fill("2500");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();

  await expect(
    page.getByRole("row").filter({ hasText: "LELE-35-NORMALIZED" }),
  ).toBeVisible();
  expect(api.productWrites).toHaveLength(1);
  expect(api.productWrites[0]).toMatchObject({
    tracking_mode: "BATCH_TRACKED",
    species: "Lele",
    size_label: "3-5 cm",
    variant_label: "Hitam",
  });

  const productRow = page
    .getByRole("row")
    .filter({ hasText: "LELE-35-NORMALIZED" });
  await productRow.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Varian").fill(" Merah ");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  expect(api.productWrites[1]).toMatchObject({ variant_label: "Merah" });
  await expect(productRow).toContainText("Varian: Merah");
});

for (const role of ["Kasir", "Kepala Budidaya"] as const) {
  test(`${role} cannot mutate V4.6 catalog`, async ({ page }) => {
    let catalogRequests = 0;
    await page.route("**/api/v1/pos/categories**", async (route) => {
      catalogRequests += 1;
      await fulfillJson(
        route,
        200,
        successEnvelope({ items: [], pagination: {} }),
      );
    });
    await page.route("**/api/v1/pos/products**", async (route) => {
      catalogRequests += 1;
      await fulfillJson(
        route,
        200,
        successEnvelope({ items: [], pagination: {} }),
      );
    });
    await setRoleSession(page, role);
    await page.goto("/pos/prices");

    await expect(
      page.getByRole("heading", { name: "Manajemen produk & harga" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tambah kategori" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Tambah produk" }),
    ).toHaveCount(0);
    expect(catalogRequests).toBeGreaterThanOrEqual(2);
  });
}

test("V4.6 catalog tables fit a 390px viewport without page overflow", async ({
  page,
}) => {
  await stubCatalog(page);
  await setRoleSession(page, "Owner");
  await page.goto("/pos/prices");
  await page.setViewportSize({ width: 390, height: 844 });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(
    page.getByRole("heading", { name: "Kategori produk" }),
  ).toBeVisible();
});
