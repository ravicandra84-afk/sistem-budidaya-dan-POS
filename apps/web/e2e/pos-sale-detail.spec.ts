import { expect, test, type Page, type Route } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kasir" | "Kepala Budidaya";
type SaleStatus = "active" | "voided";

const saleId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";
const creatorId = "33333333-3333-4333-8333-333333333333";

const officialReceipt = {
  company_name: "PT. Pisciculture Farm Indonesia",
  transaction_date_time: "20/11/2026, 10.15.00 WIB",
  species_name: "Ikan Nila",
  fish_size: "3-5 cm",
  quantity: 5,
  unit: "EKOR",
  unit_price: 3000,
  total_payment: 15000,
  payment_method: "cash",
  cashier_name: "Kasir Pemilik",
};

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Berhasil.",
    data,
    meta: { request_id: "sale-detail-e2e" },
  };
}

function detailFor(status: SaleStatus) {
  return {
    id: saleId,
    sale_code: "PFI-SAL-20261120-007",
    created_at: "2026-11-20T03:15:00.000Z",
    batch_id: batchId,
    batch_code: "PFI-BAT-20261119-007",
    species_id: "44444444-4444-4444-8444-444444444444",
    species_code: "NIL",
    species_name: "Ikan Nila",
    fish_size: "3-5 cm",
    quantity: 5,
    unit_price: 3000,
    total_amount: 15000,
    payment_method: "cash",
    cash_received: 20000,
    change_amount: 5000,
    created_by: { id: creatorId, name: "Kasir Pemilik" },
    status,
    voided_at: status === "voided" ? "2026-11-20T04:30:00.000Z" : null,
    voided_by:
      status === "voided"
        ? { id: "55555555-5555-4555-8555-555555555555", name: "Owner Uji" }
        : null,
  };
}

async function openSaleDetail(
  page: Page,
  role: TestRole,
  options: {
    status?: SaleStatus;
    userId?: string;
    voidConflict?: boolean;
  } = {},
) {
  let currentStatus = options.status ?? "active";
  let detailRequests = 0;
  let receiptRequests = 0;
  let batchRequests = 0;
  let voidCalls = 0;
  let voidKey = "";
  let voidBody: unknown;
  let releaseVoid: (() => void) | null = null;

  await page.route("**/api/v1/pos/sales/**", async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/receipt")) {
      receiptRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(successEnvelope(officialReceipt)),
      });
      return;
    }
    if (pathname.endsWith("/void")) {
      voidCalls += 1;
      voidKey = request.headers()["idempotency-key"] ?? "";
      voidBody = request.postDataJSON();
      await new Promise<void>((resolve) => {
        releaseVoid = resolve;
      });
      currentStatus = "voided";
      if (options.voidConflict) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            status: "error",
            message: "Transaksi penjualan sudah di-VOID.",
            error: { code: "SALE_ALREADY_VOIDED" },
            meta: { request_id: "sale-already-voided" },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          successEnvelope({
            sale_id: saleId,
            status: "voided",
            voided_at: "2026-11-20T04:30:00.000Z",
            voided_by: "55555555-5555-4555-8555-555555555555",
            batch_status: "active",
          }),
        ),
      });
      return;
    }

    detailRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(successEnvelope(detailFor(currentStatus))),
    });
  });
  await page.route(`**/api/v1/pos/batches/${batchId}`, async (route) => {
    batchRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        successEnvelope({
          batch: {
            id: batchId,
            batch_code: "PFI-BAT-20261119-007",
            status: "active",
            current_stock: 18,
          },
          species: {
            id: "44444444-4444-4444-8444-444444444444",
            species_code: "NIL",
            species_name: "Ikan Nila",
          },
          fish_size: "3-5 cm",
          unit_price: 3000,
        }),
      ),
    });
  });

  await page.addInitScript(
    ({ role, userId }) => {
      sessionStorage.setItem(
        "pfi.operational.session.v1",
        JSON.stringify({
          accessToken: "e2e-sale-detail-token",
          expiresIn: "8h",
          user: {
            id: userId,
            name: role === "Kasir" ? "Kasir Pemilik" : `${role} Uji`,
            email: "e2e@example.test",
            role,
          },
        }),
      );
    },
    { role, userId: options.userId ?? `${role}-actor` },
  );
  await page.goto(`/pos/sales/${saleId}`);

  return {
    get detailRequests() {
      return detailRequests;
    },
    get receiptRequests() {
      return receiptRequests;
    },
    get batchRequests() {
      return batchRequests;
    },
    get voidCalls() {
      return voidCalls;
    },
    get voidKey() {
      return voidKey;
    },
    get voidBody() {
      return voidBody;
    },
    releaseVoid() {
      releaseVoid?.();
    },
  };
}

for (const role of ["Owner", "Admin Operasional", "Kasir"] as const) {
  test(`${role} can confirm a full-sale VOID without entering a reason`, async ({
    page,
  }) => {
    const api = await openSaleDetail(page, role, {
      userId: `${role}-void-actor`,
    });
    await expect(
      page.getByRole("heading", { name: "Detail penjualan" }),
    ).toBeVisible();
    await expect(page.getByText("PFI-SAL-20261120-007")).toBeVisible();
    await expect(page.getByText("PFI-BAT-20261119-007")).toBeVisible();
    await expect(page.getByText("Rp 20.000")).toBeVisible();
    await expect(page.getByText("Rp 5.000")).toBeVisible();

    await page
      .getByRole("button", { name: "Batalkan Transaksi (VOID)" })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    const confirmButton = dialog.getByRole("button", {
      name: "Ya, VOID transaksi",
    });
    await confirmButton.click();
    const loadingButton = dialog.getByRole("button", {
      name: "Membatalkan...",
    });
    await expect(loadingButton).toBeDisabled();
    api.releaseVoid();

    await expect(page.getByText("VOID", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("Owner Uji")).toBeVisible();
    await expect(page.getByText("18 ekor")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Batalkan Transaksi (VOID)" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Cetak Ulang Struk" }),
    ).toHaveCount(0);
    expect(api.voidCalls).toBe(1);
    expect(api.voidBody).toEqual({});
    expect(api.voidKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(api.detailRequests).toBeGreaterThanOrEqual(2);
    expect(api.batchRequests).toBe(1);
  });
}

test("sale already voided conflict refreshes status and keeps actions hidden", async ({
  page,
}) => {
  const api = await openSaleDetail(page, "Owner", {
    userId: "Owner-race-actor",
    voidConflict: true,
  });
  await page.getByRole("button", { name: "Batalkan Transaksi (VOID)" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Ya, VOID transaksi" }).click();
  api.releaseVoid();

  await expect(
    page
      .locator('p[role="alert"]')
      .filter({ hasText: "sudah lebih dahulu di-VOID" })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("VOID", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Batalkan Transaksi (VOID)" }),
  ).toHaveCount(0);
  expect(api.detailRequests).toBeGreaterThanOrEqual(2);
  expect(api.batchRequests).toBe(1);
});

test("original creator can reprint an active receipt with 58mm and 80mm print layouts", async ({
  page,
}) => {
  const api = await openSaleDetail(page, "Kasir", { userId: creatorId });
  await expect(
    page.getByRole("button", { name: "Cetak Ulang Struk" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cetak Ulang Struk" }).click();

  const preview = page.getByRole("region", { name: "Pratinjau struk" });
  await expect(preview.getByRole("definition")).toHaveCount(9);
  await expect(
    preview.getByText("PT. Pisciculture Farm Indonesia"),
  ).toBeVisible();
  await expect(preview.getByText("PFI-SAL-20261120-007")).toHaveCount(0);
  await expect(preview.getByText("PFI-BAT-20261119-007")).toHaveCount(0);
  expect(api.receiptRequests).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(mobileWidth).toBeLessThanOrEqual(390);

  for (const width of ["58", "80"] as const) {
    await page.getByRole("radio", { name: `${width} mm` }).check();
    await page.emulateMedia({ media: "print" });
    const printMetrics = await preview.evaluate((element) => {
      const style = getComputedStyle(element);
      const controls = element.querySelector<HTMLElement>(
        ".pos-receipt-controls",
      );
      return {
        width: Number.parseFloat(style.width),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        pageName: style.page,
        controlsDisplay: controls
          ? getComputedStyle(controls).display
          : "missing",
      };
    });
    expect(printMetrics.width).toBeCloseTo((Number(width) * 96) / 25.4, 0);
    expect(printMetrics.scrollWidth).toBeLessThanOrEqual(
      printMetrics.clientWidth + 1,
    );
    expect(printMetrics.pageName).toContain(width === "58" ? "58" : "80");
    expect(printMetrics.controlsDisplay).toBe("none");
    await expect(page.locator("aside")).toHaveCSS("visibility", "hidden");
    await page.emulateMedia({ media: "screen" });
  }
});

for (const role of ["Owner", "Admin Operasional", "Kasir"] as const) {
  test(`${role} cannot reprint another creator's active sale`, async ({
    page,
  }) => {
    const api = await openSaleDetail(page, role, {
      userId: `${role}-other-user`,
    });
    await expect(
      page.getByRole("button", { name: "Cetak Ulang Struk" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Batalkan Transaksi (VOID)" }),
    ).toBeVisible();
    expect(api.receiptRequests).toBe(0);
  });
}

test("a voided sale hides both VOID and reprint actions, including from its creator", async ({
  page,
}) => {
  await openSaleDetail(page, "Owner", { status: "voided", userId: creatorId });
  await expect(page.getByText("VOID", { exact: true })).toBeVisible();
  await expect(page.getByText("Waktu VOID (WIB)")).toBeVisible();
  await expect(page.getByText("Pelaku VOID")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Batalkan Transaksi (VOID)" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cetak Ulang Struk" }),
  ).toHaveCount(0);
});

test("Kepala Budidaya is redirected from sale detail", async ({ page }) => {
  await openSaleDetail(page, "Kepala Budidaya");
  await expect(page).toHaveURL(/\/batches$/);
  await expect(
    page.getByRole("heading", { name: "Detail penjualan" }),
  ).toHaveCount(0);
});
