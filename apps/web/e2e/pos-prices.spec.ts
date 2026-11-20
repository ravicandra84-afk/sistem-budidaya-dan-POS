import { expect, test, type Page, type Route } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kasir" | "Kepala Budidaya";

const nilaId = "11111111-1111-4111-8111-111111111111";
const leleId = "22222222-2222-4222-8222-222222222222";
const existingPriceId = "33333333-3333-4333-8333-333333333333";
const createdPriceId = "44444444-4444-4444-8444-444444444444";

function priceItem(
  id: string,
  speciesId: string,
  speciesName: string,
  fishSize: string,
  price: number,
  updaterName = "Owner Uji",
) {
  return {
    id,
    species_id: speciesId,
    species_code: speciesId === nilaId ? "NIL" : "LEL",
    species_name: speciesName,
    fish_size: fishSize,
    price_per_fish: price,
    created_at: "2026-11-19T03:00:00.000Z",
    updated_at: "2026-11-20T03:00:00.000Z",
    updated_by: {
      id: "55555555-5555-4555-8555-555555555555",
      name: updaterName,
    },
  };
}

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Berhasil.",
    data,
    meta: { request_id: "prices-e2e-request" },
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
  await page.addInitScript(
    ({ sessionStorageKey, role }) => {
      sessionStorage.setItem(
        sessionStorageKey,
        JSON.stringify({
          accessToken: "e2e-prices-token",
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

async function stubSpecies(page: Page) {
  await page.route("**/api/v1/fish-species", (route) =>
    fulfillJson(
      route,
      200,
      successEnvelope([
        { id: nilaId, species_code: "NIL", species_name: "Ikan Nila" },
        { id: leleId, species_code: "LEL", species_name: "Ikan Lele" },
      ]),
    ),
  );
}

for (const role of ["Owner", "Admin Operasional"] as const) {
  test(`${role} can view, add, and update prices`, async ({ page }) => {
    let prices = [
      priceItem(existingPriceId, nilaId, "Ikan Nila", "3-5 cm", 2500),
    ];
    const postPayloads: Array<Record<string, unknown>> = [];
    const patchPayloads: Array<Record<string, unknown>> = [];
    const mutationKeys: string[] = [];

    await page.route("**/api/v1/pos/prices**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (request.method() === "GET") {
        const pageNumber = Number(url.searchParams.get("page") ?? 1);
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const start = (pageNumber - 1) * limit;
        await fulfillJson(
          route,
          200,
          successEnvelope({
            items: prices.slice(start, start + limit),
            pagination: {
              page: pageNumber,
              limit,
              totalItems: prices.length,
              totalPages: Math.ceil(prices.length / limit),
            },
          }),
        );
        return;
      }

      const idempotencyKey = request.headers()["idempotency-key"] ?? "";
      mutationKeys.push(idempotencyKey);
      const body = request.postDataJSON() as Record<string, unknown>;

      if (request.method() === "POST") {
        postPayloads.push(body);
        if (body.species_id === nilaId && body.fish_size === "3-5 cm") {
          await fulfillJson(route, 409, {
            status: "error",
            message:
              "Harga untuk kombinasi spesies dan ukuran ini sudah tersedia.",
            error: { code: "PRICE_ALREADY_EXISTS" },
            meta: { request_id: "price-already-exists" },
          });
          return;
        }

        const created = priceItem(
          createdPriceId,
          String(body.species_id),
          "Ikan Lele",
          String(body.fish_size),
          Number(body.price_per_fish),
          `${role} Uji`,
        );
        prices = [created, ...prices];
        await fulfillJson(route, 201, successEnvelope(created));
        return;
      }

      const priceId = url.pathname.split("/").at(-1);
      patchPayloads.push(body);
      prices = prices.map((price) =>
        price.id === priceId
          ? {
              ...price,
              price_per_fish: Number(body.price_per_fish),
              updated_at: "2026-11-20T04:00:00.000Z",
              updated_by: {
                id: "66666666-6666-4666-8666-666666666666",
                name: `${role} Uji`,
              },
            }
          : price,
      );
      await fulfillJson(
        route,
        200,
        successEnvelope(prices.find((price) => price.id === priceId)),
      );
    });
    await stubSpecies(page);
    await setRoleSession(page, role);
    await page.goto("/pos/prices");

    await expect(
      page.getByRole("link", { name: "Daftar harga" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Daftar harga" }),
    ).toBeVisible();
    await expect(page.getByText("Ikan Nila").first()).toBeVisible();
    await expect(page.getByText("Rp 2.500", { exact: true })).toBeVisible();
    await expect(page.getByText("Owner Uji").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /hapus|delete/i }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Tambah harga baru" }).click();
    await page.getByLabel("Spesies ikan").selectOption(nilaId);
    await page.getByLabel("Ukuran ikan").selectOption("3-5 cm");
    const priceInput = page.getByLabel("Harga per ekor (Rp)");

    await priceInput.fill("0");
    await page.getByRole("button", { name: "Simpan harga" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      "Rp1 dan Rp10.000.000",
    );
    await priceInput.fill("10000001");
    await page.getByRole("button", { name: "Simpan harga" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      "Rp1 dan Rp10.000.000",
    );
    await priceInput.fill("12.5");
    await page.getByRole("button", { name: "Simpan harga" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      "Rupiah bulat tanpa desimal",
    );
    expect(postPayloads).toHaveLength(0);

    await priceInput.fill("2500");
    await page.getByRole("button", { name: "Simpan harga" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      "kombinasi spesies dan ukuran ini sudah tersedia",
    );
    await expect(page.getByLabel("Spesies ikan")).toHaveValue(nilaId);
    await expect(page.getByLabel("Ukuran ikan")).toHaveValue("3-5 cm");
    await expect(priceInput).toHaveValue("2500");

    await page.getByLabel("Spesies ikan").selectOption(leleId);
    await page.getByLabel("Ukuran ikan").selectOption("2-4 cm");
    await priceInput.fill("1");
    await page.getByRole("button", { name: "Simpan harga" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Harga baru berhasil ditambahkan",
    );
    await expect(page.getByText("Ikan Lele").first()).toBeVisible();

    await page
      .getByRole("button", {
        name: "Ubah harga Ikan Nila, ukuran 3-5 cm",
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ubah harga" }),
    ).toBeVisible();
    await expect(page.getByLabel("Spesies ikan")).toBeDisabled();
    await expect(page.getByLabel("Ukuran ikan")).toBeDisabled();
    await page.getByLabel("Harga per ekor (Rp)").fill("10000000");
    await page.getByRole("button", { name: "Simpan harga" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Harga berhasil diperbarui",
    );

    expect(postPayloads).toHaveLength(2);
    expect(postPayloads[0]).toMatchObject({
      species_id: nilaId,
      fish_size: "3-5 cm",
      price_per_fish: 2500,
    });
    expect(postPayloads[1]).toMatchObject({
      species_id: leleId,
      fish_size: "2-4 cm",
      price_per_fish: 1,
    });
    expect(patchPayloads).toEqual([{ price_per_fish: 10_000_000 }]);
    expect(
      mutationKeys.every((key) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          key,
        ),
      ),
    ).toBe(true);
    expect(new Set(mutationKeys).size).toBe(3);
  });
}

for (const role of ["Kasir", "Kepala Budidaya"] as const) {
  test(`${role} cannot open price management`, async ({ page }) => {
    let priceRequests = 0;
    await page.route("**/api/v1/pos/prices**", async (route) => {
      priceRequests += 1;
      await fulfillJson(
        route,
        200,
        successEnvelope({ items: [], pagination: {} }),
      );
    });
    await stubSpecies(page);
    await setRoleSession(page, role);
    await page.goto("/pos/prices");

    await expect(page).toHaveURL(role === "Kasir" ? /\/pos$/ : /\/batches$/);
    await expect(page.getByRole("link", { name: "Daftar harga" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("heading", { name: "Daftar harga" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Tambah harga baru" }),
    ).toHaveCount(0);
    expect(priceRequests).toBe(0);
  });
}

test("prices use standard pagination and fit a 390px viewport", async ({
  page,
}) => {
  const firstPage = Array.from({ length: 20 }, (_, index) =>
    priceItem(
      `77777777-7777-4777-8777-${String(index + 1).padStart(12, "0")}`,
      nilaId,
      `Ikan Nila ${index + 1}`,
      "3-5 cm",
      2500 + index,
    ),
  );
  const secondPage = [
    priceItem(
      "88888888-8888-4888-8888-888888888888",
      leleId,
      "Ikan Lele 21",
      "4-6 cm",
      5000,
    ),
  ];
  const requests: string[] = [];

  await page.route("**/api/v1/pos/prices**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(
      `${url.searchParams.get("page")}:${url.searchParams.get("limit")}`,
    );
    const pageNumber = Number(url.searchParams.get("page") ?? 1);
    await fulfillJson(
      route,
      200,
      successEnvelope({
        items: pageNumber === 1 ? firstPage : secondPage,
        pagination: {
          page: pageNumber,
          limit: 20,
          totalItems: 21,
          totalPages: 2,
        },
      }),
    );
  });
  await stubSpecies(page);
  await setRoleSession(page, "Owner");
  await page.goto("/pos/prices");

  await expect(page.getByText("Ikan Nila 1").first()).toBeVisible();
  await page.getByRole("button", { name: "Halaman berikutnya" }).click();
  await expect(page.getByText("Ikan Lele 21")).toBeVisible();
  expect(requests).toContain("1:20");
  expect(requests).toContain("2:20");

  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  await expect(
    page.getByRole("heading", { name: "Daftar harga" }),
  ).toBeVisible();
});
