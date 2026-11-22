import { expect, test, type Page, type Route } from "@playwright/test";
import { buildEscPosReceiptBytes } from "../src/lib/escpos-receipt";

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

async function setSerialBehavior(page: Page) {
  await page.addInitScript(() => {
    const state = {
      requestPortCalls: 0,
      baudRate: 0,
      byteCount: 0,
      lockReleased: false,
      portClosed: false,
    };
    Object.defineProperty(window, "__posSerialState", {
      configurable: true,
      value: state,
    });
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: async () => {
          state.requestPortCalls += 1;
          return {
            open: async ({ baudRate }: { baudRate: number }) => {
              state.baudRate = baudRate;
            },
            writable: {
              getWriter: () => ({
                write: async (bytes: Uint8Array) => {
                  state.byteCount = bytes.length;
                },
                releaseLock: () => {
                  state.lockReleased = true;
                },
              }),
            },
            close: async () => {
              state.portClosed = true;
            },
          };
        },
      },
    });
  });
}

async function setBluetoothBehavior(page: Page) {
  await page.addInitScript(() => {
    const state = {
      requestOptions: null as {
        acceptAllDevices: boolean;
        optionalServices: string[];
      } | null,
      connected: false,
      discoveredServices: false,
      discoveredCharacteristics: false,
      chunks: [] as number[][],
      disconnected: false,
    };
    Object.defineProperty(window, "__posBluetoothState", {
      configurable: true,
      value: state,
    });
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: {
        requestDevice: async (options: typeof state.requestOptions) => {
          state.requestOptions = options;
          return {
            gatt: {
              connect: async () => {
                state.connected = true;
                return {
                  getPrimaryServices: async () => {
                    state.discoveredServices = true;
                    return [
                      {
                        getCharacteristics: async () => {
                          state.discoveredCharacteristics = true;
                          return [
                            {
                              properties: { writeWithoutResponse: true },
                              writeValueWithoutResponse: async (
                                bytes: Uint8Array,
                              ) => {
                                state.chunks.push(Array.from(bytes));
                              },
                            },
                          ];
                        },
                      },
                    ];
                  },
                };
              },
              disconnect: () => {
                state.disconnected = true;
              },
            },
          };
        },
      },
    });
  });
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

test("thermal serial print sends bytes without changing the system print or sale flow", async ({
  page,
}) => {
  await setPrintBehavior(page, "succeed");
  await setSerialBehavior(page);
  const api = await stubCashierSale(page);

  await page
    .getByRole("button", { name: "Cetak Thermal (USB/Serial)" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Payload ESC/POS berhasil dikirim",
  );
  const serialState = await page.evaluate(
    () =>
      (
        window as Window & {
          __posSerialState: {
            requestPortCalls: number;
            baudRate: number;
            byteCount: number;
            lockReleased: boolean;
            portClosed: boolean;
          };
        }
      ).__posSerialState,
  );
  expect(serialState).toEqual({
    requestPortCalls: 1,
    baudRate: 9600,
    byteCount: expect.any(Number),
    lockReleased: true,
    portClosed: true,
  });
  expect(serialState.byteCount).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Cetak Struk" }).click();
  await expect.poll(() => printCallCount(page)).toBe(2);
  expect(api.postCount).toBe(1);
});

test("thermal Bluetooth print sends all ESC/POS chunks and disconnects without repeating the sale", async ({
  page,
}) => {
  await setPrintBehavior(page, "succeed");
  await setBluetoothBehavior(page);
  const api = await stubCashierSale(page);

  await page.getByRole("button", { name: "Cetak Thermal (Bluetooth)" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Struk berhasil dikirim ke printer Bluetooth",
  );

  const bluetoothState = await page.evaluate(
    () =>
      (
        window as Window & {
          __posBluetoothState: {
            requestOptions: {
              acceptAllDevices: boolean;
              optionalServices: string[];
            } | null;
            connected: boolean;
            discoveredServices: boolean;
            discoveredCharacteristics: boolean;
            chunks: number[][];
            disconnected: boolean;
          };
        }
      ).__posBluetoothState,
  );
  const sentBytes = bluetoothState.chunks.flat();
  expect(bluetoothState.requestOptions?.acceptAllDevices).toBe(true);
  expect(bluetoothState.requestOptions?.optionalServices).toContain(
    "000018f0-0000-1000-8000-00805f9b34fb",
  );
  expect(bluetoothState.connected).toBe(true);
  expect(bluetoothState.discoveredServices).toBe(true);
  expect(bluetoothState.discoveredCharacteristics).toBe(true);
  expect(bluetoothState.chunks.length).toBeGreaterThan(1);
  expect(bluetoothState.chunks.every((chunk) => chunk.length <= 64)).toBe(true);
  expect(sentBytes).toEqual(Array.from(buildEscPosReceiptBytes(receipt, "58")));
  expect(bluetoothState.disconnected).toBe(true);

  await page.getByRole("button", { name: "Cetak Struk" }).click();
  await expect.poll(() => printCallCount(page)).toBe(2);
  expect(api.postCount).toBe(1);
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
