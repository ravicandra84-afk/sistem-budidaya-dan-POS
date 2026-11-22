import { expect, test } from "@playwright/test";

const saleId = "11111111-1111-4111-8111-111111111111";
const creatorId = "22222222-2222-4222-8222-222222222222";

const detail = {
  id: saleId,
  sale_code: "PFI-SAL-20261120-007",
  created_at: "2026-11-20T03:15:00.000Z",
  batch_id: "33333333-3333-4333-8333-333333333333",
  batch_code: "BATCH-20261120-007",
  species_name: "Ikan Nila",
  fish_size: "3-5 cm",
  quantity: 1250,
  unit_price: 2500,
  total_amount: 3_125_000,
  payment_method: "cash",
  cash_received: 3_200_000,
  change_amount: 75_000,
  created_by: { id: creatorId, name: "Kasir Uji Layout" },
  status: "active",
  voided_at: null,
  voided_by: null,
};

const receiptWithUnexpectedFields = {
  company_name: "PT. Pisciculture Farm Indonesia",
  transaction_date_time: "20/11/2026, 10.15.00 WIB",
  species_name: "Ikan Nila",
  fish_size: "3-5 cm",
  quantity: 1250,
  unit_price: 2500,
  total_payment: 3_125_000,
  payment_method: "cash",
  cashier_name: "Kasir Uji Layout",
  sale_code: "PFI-SAL-20261120-007",
  batch_code: "BATCH-20261120-007",
  customer_name: "Pelanggan Uji Terlarang",
  transfer_reference: "REF-TRANSFER-TERLARANG",
};

test("receipt contains only the nine official fields and fits both print widths", async ({
  page,
}) => {
  await page.route(`**/api/v1/pos/sales/${saleId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Detail penjualan berhasil dimuat.",
        data: detail,
      }),
    }),
  );
  await page.route(`**/api/v1/pos/sales/${saleId}/receipt`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        message: "Data struk berhasil dimuat.",
        data: receiptWithUnexpectedFields,
      }),
    }),
  );
  await page.addInitScript(
    ({ creatorId }) => {
      sessionStorage.setItem(
        "pfi.operational.session.v1",
        JSON.stringify({
          accessToken: "e2e-receipt-layout-token",
          expiresIn: "8h",
          user: {
            id: creatorId,
            name: "Kasir Uji Layout",
            email: "receipt@example.test",
            role: "Kasir",
          },
        }),
      );
    },
    { creatorId },
  );
  await page.goto(`/pos/sales/${saleId}`);
  await page.getByRole("button", { name: "Cetak Ulang Struk" }).click();

  const preview = page.getByRole("region", { name: "Pratinjau struk" });
  const officialLabels = [
    "Perusahaan",
    "Waktu transaksi (WIB)",
    "Spesies",
    "Ukuran ikan",
    "Jumlah",
    "Harga per ekor",
    "Total pembayaran",
    "Metode pembayaran",
    "Nama kasir",
  ];
  await expect(preview.getByRole("definition")).toHaveCount(9);
  for (const label of officialLabels) {
    await expect(preview.getByText(label)).toBeVisible();
  }
  for (const value of [
    "PT. Pisciculture Farm Indonesia",
    "20/11/2026, 10.15.00 WIB",
    "Ikan Nila",
    "3-5 cm",
    "1.250 ekor",
    "Rp 2.500",
    "Rp 3.125.000",
    "Tunai",
    "Kasir Uji Layout",
  ]) {
    await expect(preview.getByText(value, { exact: true })).toBeVisible();
  }

  for (const forbidden of [
    "PFI-SAL-20261120-007",
    "BATCH-20261120-007",
    "Pelanggan Uji Terlarang",
    "REF-TRANSFER-TERLARANG",
  ]) {
    await expect(preview.getByText(forbidden, { exact: false })).toHaveCount(0);
  }

  for (const width of ["58", "80"] as const) {
    await page.getByRole("radio", { name: `${width} mm` }).check();
    await page.emulateMedia({ media: "print" });
    const layout = await preview.evaluate((element) => {
      const rows = [
        ...element.querySelectorAll<HTMLElement>(".pos-receipt-row"),
      ];
      const controls = element.querySelector<HTMLElement>(
        ".pos-receipt-controls",
      );
      const printStatus = element.querySelector<HTMLElement>(
        ".pos-receipt-print-status",
      );
      return {
        width: Number.parseFloat(getComputedStyle(element).width),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rowsFit: rows.every((row) => row.scrollWidth <= row.clientWidth + 1),
        rowCount: rows.length,
        controlsDisplay: controls
          ? getComputedStyle(controls).display
          : "missing",
        printStatusDisplay: printStatus
          ? getComputedStyle(printStatus).display
          : "missing",
      };
    });
    expect(layout.width).toBeCloseTo((Number(width) * 96) / 25.4, 0);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.rowsFit).toBe(true);
    expect(layout.rowCount).toBe(9);
    expect(layout.controlsDisplay).toBe("none");
    expect(layout.printStatusDisplay).toBe("none");
    await expect(page.locator("aside")).toHaveCSS("visibility", "hidden");
    await expect(page.locator("main h1")).toHaveCSS("visibility", "hidden");
    await page.emulateMedia({ media: "screen" });
  }
});
