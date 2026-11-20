import { expect, test, type Page, type Route } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kasir" | "Kepala Budidaya";

const activeSaleId = "11111111-1111-4111-8111-111111111111";
const voidedSaleId = "22222222-2222-4222-8222-222222222222";

function saleItem(
  id: string,
  saleCode: string,
  status: "active" | "voided",
  creatorName: string,
) {
  return {
    id,
    sale_code: saleCode,
    created_at: "2026-11-20T03:15:00.000Z",
    batch_id: "33333333-3333-4333-8333-333333333333",
    batch_code: "PFI-BAT-20261119-007",
    species_name: "Ikan Nila",
    fish_size: "3-5 cm",
    quantity: 1250,
    unit_price: 2500,
    total_amount: 3_125_000,
    payment_method: status === "active" ? "cash" : "transfer",
    created_by: {
      id: "44444444-4444-4444-8444-444444444444",
      name: creatorName,
    },
    status,
    voided_at: status === "voided" ? "2026-11-20T04:00:00.000Z" : null,
    voided_by: status === "voided" ? { id: "55555555-5555-4555-8555-555555555555", name: "Owner Uji" } : null,
  };
}

const sales = [
  saleItem(activeSaleId, "PFI-SAL-20261120-012", "active", "Kasir Pagi"),
  saleItem(voidedSaleId, "PFI-SAL-20261120-011", "voided", "Kasir Sore"),
  ...Array.from({ length: 33 }, (_, index) => {
    const saleNumber = index + 20;
    return saleItem(
      `${String(saleNumber).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      `PFI-SAL-20261120-${String(saleNumber).padStart(3, "0")}`,
      "voided",
      "Kasir Lain",
    );
  }),
];

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Daftar penjualan berhasil dimuat.",
    data,
    meta: { request_id: "sales-list-e2e" },
  };
}

async function setRoleSession(page: Page, role: TestRole) {
  await page.addInitScript(
    ({ sessionStorageKey, role }) => {
      sessionStorage.setItem(
        sessionStorageKey,
        JSON.stringify({
          accessToken: "e2e-sales-list-token",
          expiresIn: "8h",
          user: {
            id: `e2e-${role}`,
            name: `${role} Uji`,
            email: "e2e@example.test",
            role,
          },
        }),
      );
    },
    { sessionStorageKey: "pfi.operational.session.v1", role },
  );
}

async function stubSales(page: Page, requests: URL[] = []) {
  await page.route("**/api/v1/pos/sales**", async (route: Route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const status = url.searchParams.get("status");
    const matchingSales =
      status === "active"
        ? sales.filter((sale) => sale.status === "active")
        : status === "voided"
          ? sales.filter((sale) => sale.status === "voided")
          : sales;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({
          items: matchingSales.slice((pageNumber - 1) * limit, pageNumber * limit),
          pagination: {
            page: pageNumber,
            limit,
            totalItems: matchingSales.length,
            totalPages: Math.ceil(matchingSales.length / limit),
          },
        }),
      ),
    });
  });
}

for (const role of ["Owner", "Admin Operasional", "Kasir"] as const) {
  test(`${role} can view all required sales history fields`, async ({ page }) => {
    await stubSales(page);
    await setRoleSession(page, role);
    await page.goto("/pos/sales");

    await expect(
      page.getByRole("link", { name: "Riwayat penjualan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Riwayat penjualan" }),
    ).toBeVisible();
    const table = page.getByRole("table");
    for (const column of [
      "Nomor penjualan",
      "Waktu transaksi (WIB)",
      "Batch",
      "Spesies / ukuran",
      "Jumlah",
      "Harga satuan",
      "Total",
      "Pembayaran",
      "Pembuat",
      "Status",
    ]) {
      await expect(table.getByRole("columnheader", { name: column })).toBeVisible();
    }

    const activeRow = table
      .getByRole("row", { name: /PFI-SAL-20261120-012/ })
      .filter({ hasText: "Kasir Pagi" });
    await expect(activeRow).toContainText("20 Nov 2026");
    await expect(activeRow).toContainText("PFI-BAT-20261119-007");
    await expect(activeRow).toContainText("Ikan Nila");
    await expect(activeRow).toContainText("3-5 cm");
    await expect(activeRow).toContainText("1.250 ekor");
    await expect(activeRow).toContainText("Rp 2.500");
    await expect(activeRow).toContainText("Rp 3.125.000");
    await expect(activeRow).toContainText("Tunai");
    await expect(activeRow).toContainText("Kasir Pagi");
    await expect(activeRow).toContainText("Aktif");
    await expect(activeRow.getByRole("link", { name: "Lihat Detail" })).toHaveAttribute(
      "href",
      `/pos/sales/${activeSaleId}`,
    );

    const voidedRow = table.getByRole("row", {
      name: /PFI-SAL-20261120-011/,
    });
    await expect(voidedRow).toContainText("Transfer");
    await expect(voidedRow).toContainText("Kasir Sore");
    await expect(voidedRow).toContainText("VOID");
    await expect(page.getByRole("button", { name: /edit|ubah|hapus|delete/i })).toHaveCount(0);
    await expect(page.locator('input[type="search"]')).toHaveCount(0);
    await expect(page.getByLabel(/cari|search/i)).toHaveCount(0);
  });
}

test("Kepala Budidaya has no sales navigation and is redirected from /pos/sales", async ({
  page,
}) => {
  const requests: URL[] = [];
  await stubSales(page, requests);
  await setRoleSession(page, "Kepala Budidaya");
  await page.goto("/pos/sales");

  await expect(page).toHaveURL(/\/batches$/);
  await expect(page.getByRole("link", { name: "Riwayat penjualan" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Riwayat penjualan" })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test("approved status/date filters and pagination use only contract query parameters", async ({
  page,
}) => {
  const requests: URL[] = [];
  await stubSales(page, requests);
  await setRoleSession(page, "Owner");
  await page.goto("/pos/sales");

  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Status transaksi").selectOption("active");
  await page.getByLabel("Dari tanggal").fill("2026-11-18");
  await page.getByLabel("Sampai tanggal").fill("2026-11-20");
  await page.getByRole("button", { name: "Terapkan filter" }).click();

  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  const activeRequest = requests.at(-1);
  expect(activeRequest?.searchParams.get("page")).toBe("1");
  expect(activeRequest?.searchParams.get("limit")).toBe("20");
  expect(activeRequest?.searchParams.get("status")).toBe("active");
  expect(activeRequest?.searchParams.get("startDate")).toBe(
    "2026-11-18T00:00:00.000+07:00",
  );
  expect(activeRequest?.searchParams.get("endDate")).toBe(
    "2026-11-20T23:59:59.999+07:00",
  );

  await page.getByLabel("Status transaksi").selectOption("voided");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(3);
  expect(requests.at(-1)?.searchParams.get("status")).toBe("voided");

  await page.getByLabel("Jumlah baris per halaman").selectOption("10");
  await page.getByRole("button", { name: "Halaman berikutnya" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
  expect(requests.at(-1)?.searchParams.get("limit")).toBe("10");
  expect(requests.at(-1)?.searchParams.get("status")).toBe("voided");
  for (const request of requests) {
    expect([...request.searchParams.keys()].sort()).toEqual(
      [...request.searchParams.keys()].filter((key) =>
        ["page", "limit", "status", "startDate", "endDate"].includes(key),
      ).sort(),
    );
    expect(request.searchParams.has("search")).toBe(false);
    expect(request.searchParams.has("sort")).toBe(false);
  }
});

test("sales cards fit a 390px viewport without horizontal overflow", async ({
  page,
}) => {
  await stubSales(page);
  await setRoleSession(page, "Kasir");
  await page.goto("/pos/sales");
  await page.setViewportSize({ width: 390, height: 844 });

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  const cards = page.locator("main ul").first();
  const activeCard = cards
    .locator("li")
    .filter({ hasText: "PFI-SAL-20261120-012" });
  const voidedCard = cards
    .locator("li")
    .filter({ hasText: "PFI-SAL-20261120-011" });
  await expect(activeCard.getByText("1.250 ekor")).toBeVisible();
  await expect(activeCard.getByText("Rp 3.125.000")).toBeVisible();
  await expect(voidedCard.getByText("VOID")).toBeVisible();
});