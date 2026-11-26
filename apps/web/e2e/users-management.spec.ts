import { expect, test, type Page, type Route } from "@playwright/test";

type TestRole = "Owner" | "Admin Operasional" | "Kepala Budidaya" | "Kasir";
type UserRole = TestRole;

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

const ownerId = "11111111-1111-4111-8111-111111111111";
const staffId = "22222222-2222-4222-8222-222222222222";

const startingUsers: UserRow[] = [
  {
    id: ownerId,
    name: "Owner Utama",
    email: "owner@example.test",
    role: "Owner",
    is_active: true,
    created_at: "2026-11-20T03:00:00.000Z",
  },
  {
    id: staffId,
    name: "Kasir Lama",
    email: "kasir@example.test",
    role: "Kasir",
    is_active: true,
    created_at: "2026-11-19T03:00:00.000Z",
  },
];

function successEnvelope(data: unknown) {
  return {
    status: "success",
    message: "Berhasil.",
    data,
    meta: { request_id: "users-e2e-request" },
  };
}

async function setRoleSession(page: Page, role: TestRole, id = ownerId) {
  await page.addInitScript(
    ({ role, id }) => {
      sessionStorage.setItem(
        "pfi.operational.session.v1",
        JSON.stringify({
          accessToken: `e2e-${role.toLowerCase().replaceAll(" ", "-")}-token`,
          expiresIn: "8h",
          user: {
            id,
            name: role === "Owner" ? "Owner Utama" : `${role} Uji`,
            email: "e2e@example.test",
            role,
          },
        }),
      );
    },
    { role, id },
  );
}

async function fulfillJson(route: Route, status: number, data: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(successEnvelope(data)),
  });
}

async function stubUsers(page: Page, initial: UserRow[] = startingUsers) {
  let users = [...initial];
  const writes: Array<{
    method: string;
    id?: string;
    body: Record<string, unknown>;
  }> = [];
  let requests = 0;

  await page.route("**/api/v1/users**", async (route) => {
    requests += 1;
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === "GET") {
      await fulfillJson(route, 200, { items: users });
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    if (request.method() === "POST") {
      writes.push({ method: "POST", body });
      const created: UserRow = {
        id: "33333333-3333-4333-8333-333333333333",
        name: String(body.name),
        email: String(body.email),
        role: body.role as UserRole,
        is_active: true,
        created_at: "2026-11-26T03:00:00.000Z",
      };
      users = [created, ...users];
      await fulfillJson(route, 201, created);
      return;
    }

    const id = url.pathname.split("/").at(-1);
    writes.push({ method: "PATCH", id, body });
    users = users.map((user) => {
      if (user.id !== id) return user;
      const updated = { ...user, ...body } as UserRow;
      delete (updated as UserRow & { password?: string }).password;
      return updated;
    });
    await fulfillJson(
      route,
      200,
      users.find((user) => user.id === id),
    );
  });

  return {
    writes,
    get requests() {
      return requests;
    },
  };
}

test("Owner sees the user-management navigation entry", async ({ page }) => {
  await stubUsers(page, []);
  await setRoleSession(page, "Owner");
  await page.goto("/users");

  await expect(
    page.getByRole("link", { name: "Manajemen User" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Manajemen User" }).first(),
  ).toBeVisible();
});

test("Kasir cannot see navigation or fetch users from a direct URL", async ({
  page,
}) => {
  const api = await stubUsers(page);
  await setRoleSession(page, "Kasir", staffId);
  await page.goto("/users");

  await expect(
    page.getByText("Hanya Owner yang dapat mengelola akun staf.").first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Manajemen User" })).toHaveCount(
    0,
  );
  expect(api.requests).toBe(0);
});

test("Owner creates, updates, resets, deactivates users without self-lockout", async ({
  page,
}) => {
  const api = await stubUsers(page);
  await setRoleSession(page, "Owner");
  await page.goto("/users");

  await expect(
    page.getByRole("row").filter({ hasText: "Owner Utama" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Kasir Lama" }),
  ).toContainText("Aktif");

  const ownerRow = page.getByRole("row").filter({ hasText: "Owner Utama" });
  await expect(
    ownerRow.getByRole("button", { name: "Nonaktifkan" }),
  ).toBeDisabled();

  await page.getByLabel("Nama Lengkap").fill("Staf Baru");
  await page.getByLabel("Email Login").fill("staf.baru@example.test");
  await page.getByLabel("Password Awal").fill("password-awal-8");
  await page.getByLabel("Role").first().selectOption("Kasir");
  await page.getByRole("button", { name: "Tambah akun" }).click();

  const newUserRow = page.getByRole("row").filter({ hasText: "Staf Baru" });
  await expect(newUserRow).toContainText("staf.baru@example.test");
  await expect(page.getByRole("status")).toContainText(
    "Akun staf berhasil dibuat.",
  );
  expect(api.writes[0]).toMatchObject({
    method: "POST",
    body: { role: "Kasir", email: "staf.baru@example.test" },
  });

  await newUserRow.getByRole("button", { name: "Edit / reset sandi" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nama Lengkap").fill("Staf Operasional");
  await dialog.getByLabel("Role").selectOption("Admin Operasional");
  await dialog.getByLabel("Password baru").fill("password-reset-8");
  await dialog.getByRole("button", { name: "Simpan perubahan" }).click();

  const updatedRow = page
    .getByRole("row")
    .filter({ hasText: "Staf Operasional" });
  await expect(updatedRow).toContainText("Admin Operasional");
  expect(api.writes[1]).toMatchObject({
    method: "PATCH",
    body: {
      name: "Staf Operasional",
      role: "Admin Operasional",
      password: "password-reset-8",
    },
  });

  page.once("dialog", (confirmation) => confirmation.accept());
  await updatedRow.getByRole("button", { name: "Nonaktifkan" }).click();
  await expect(updatedRow).toContainText("Nonaktif");
  expect(api.writes[2]).toMatchObject({
    method: "PATCH",
    body: { is_active: false },
  });

  page.once("dialog", (confirmation) => confirmation.accept());
  await updatedRow.getByRole("button", { name: "Aktifkan kembali" }).click();
  await expect(updatedRow).toContainText("Aktif");
  expect(api.writes[3]).toMatchObject({
    method: "PATCH",
    body: { is_active: true },
  });
});
