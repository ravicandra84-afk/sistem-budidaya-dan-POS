"use client";

import {
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  UserRoundCog,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { UserRole } from "@pfi/shared";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select } from "@/components/ui/field";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiClientError, apiRequest } from "@/lib/api";
import { formatBusinessDateTime } from "@/lib/format";

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

interface UserListData {
  items: ManagedUser[];
}

const userRoles: UserRole[] = [
  "Kasir",
  "Admin Operasional",
  "Kepala Budidaya",
  "Owner",
];

const roleBadgeClass: Record<UserRole, string> = {
  Owner: "border-marine/20 bg-marine/5 text-marine",
  "Admin Operasional": "border-sky/25 bg-sky/10 text-[#126d96]",
  "Kepala Budidaya": "border-teal/25 bg-teal/10 text-[#087a75]",
  Kasir: "border-amber-600/25 bg-amber-500/10 text-amber-800",
};

function displayError(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

export default function UsersPage() {
  const { session } = useAuth();
  const isOwner = session?.user.role === "Owner";
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "Kasir" as UserRole,
  });
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    role: "Kasir" as UserRole,
    password: "",
  });

  useEffect(() => {
    if (!session || session.user.role !== "Owner") {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError("");
    apiRequest<UserListData>("/users", { token: session.accessToken })
      .then((response) => {
        if (active) setUsers(response.data.items);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            displayError(error, "Daftar user tidak dapat dimuat. Coba lagi."),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey, session]);

  if (!isOwner) {
    return (
      <section
        className="border-y border-border bg-white px-5 py-8"
        role="alert"
      >
        <PageHeader
          eyebrow="Akses terbatas"
          title="Manajemen User"
          description="Hanya Owner yang dapat mengelola akun staf."
        />
        <p className="text-sm font-semibold text-danger">
          Hanya Owner yang dapat mengelola akun staf.
        </p>
      </section>
    );
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await apiRequest<ManagedUser>("/users", {
        method: "POST",
        token: session.accessToken,
        body: JSON.stringify({
          name: createForm.name,
          email: createForm.email,
          password: createForm.password,
          role: createForm.role,
        }),
      });
      setCreateForm({ name: "", email: "", password: "", role: "Kasir" });
      setFeedback({ kind: "success", message: "Akun staf berhasil dibuat." });
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: displayError(
          error,
          "Akun staf gagal dibuat. Periksa data lalu coba lagi.",
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  function openEditor(user: ManagedUser) {
    setFeedback(null);
    setEditingUser(user);
    setEditForm({ name: user.name, role: user.role, password: "" });
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !editingUser || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await apiRequest<ManagedUser>(
        `/users/${encodeURIComponent(editingUser.id)}`,
        {
          method: "PATCH",
          token: session.accessToken,
          body: JSON.stringify({
            name: editForm.name,
            role: editForm.role,
            ...(editForm.password ? { password: editForm.password } : {}),
          }),
        },
      );
      setEditingUser(null);
      setFeedback({
        kind: "success",
        message: "Perubahan akun berhasil disimpan.",
      });
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: displayError(error, "Perubahan akun gagal disimpan."),
      });
    } finally {
      setSaving(false);
    }
  }

  async function setActive(user: ManagedUser, isActive: boolean) {
    if (!session || saving) return;
    const action = isActive ? "mengaktifkan kembali" : "menonaktifkan";
    const confirmation = isActive
      ? `Aktifkan kembali akun ${user.name}?`
      : `Nonaktifkan akses ${user.name}? Akun dan riwayat transaksinya tetap disimpan.`;
    if (!window.confirm(confirmation)) return;

    setSaving(true);
    setFeedback(null);
    try {
      await apiRequest<ManagedUser>(`/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        token: session.accessToken,
        body: JSON.stringify({ is_active: isActive }),
      });
      setFeedback({
        kind: "success",
        message: `Akun ${user.name} berhasil ${action}.`,
      });
      setReloadKey((value) => value + 1);
    } catch (error) {
      setFeedback({
        kind: "error",
        message: displayError(error, `Akun ${user.name} gagal ${action}.`),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Pengaturan akses"
        title="Manajemen User"
        description="Kelola akun staf dan hak akses. Penonaktifan mempertahankan data serta riwayat akun."
        action={
          <Button
            variant="secondary"
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Muat ulang
          </Button>
        }
      />

      {feedback ? (
        <p
          className={`mb-5 border px-4 py-3 text-sm ${
            feedback.kind === "success"
              ? "border-success/30 bg-success/10 text-[#347c2c]"
              : "border-danger/25 bg-danger/5 text-danger"
          }`}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      ) : null}

      <section className="mb-7 border-y border-border bg-white px-4 py-5 sm:px-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-sky/10 text-[#126d96]">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-bold text-marine">
              Tambah akun staf
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              Akun baru aktif setelah berhasil dibuat.
            </p>
          </div>
        </div>
        <form
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1.1fr_1.2fr_1fr_1fr_auto] xl:items-end"
          onSubmit={submitCreate}
        >
          <Field id="new-user-name" label="Nama Lengkap" required>
            <Input
              id="new-user-name"
              autoComplete="name"
              maxLength={255}
              required
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, name: event.target.value }))
              }
            />
          </Field>
          <Field id="new-user-email" label="Email Login" required>
            <Input
              id="new-user-email"
              type="email"
              autoComplete="email"
              maxLength={255}
              required
              value={createForm.email}
              onChange={(event) =>
                setCreateForm((form) => ({
                  ...form,
                  email: event.target.value,
                }))
              }
            />
          </Field>
          <Field
            id="new-user-password"
            label="Password Awal"
            hint="Minimal 8 karakter."
            required
          >
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={createForm.password}
              onChange={(event) =>
                setCreateForm((form) => ({
                  ...form,
                  password: event.target.value,
                }))
              }
            />
          </Field>
          <Field id="new-user-role" label="Role" required>
            <Select
              id="new-user-role"
              value={createForm.role}
              onChange={(event) =>
                setCreateForm((form) => ({
                  ...form,
                  role: event.target.value as UserRole,
                }))
              }
            >
              {userRoles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </Select>
          </Field>
          <Button className="w-full xl:w-auto" type="submit" disabled={saving}>
            <UserRoundCog className="size-4" aria-hidden="true" />
            {saving ? "Menyimpan…" : "Tambah akun"}
          </Button>
        </form>
      </section>

      <section
        aria-label="Daftar akun staf"
        className="border-y border-border bg-white"
      >
        {loading ? <TableSkeleton rows={5} /> : null}
        {!loading && loadError ? (
          <ErrorState
            message={loadError}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : null}
        {!loading && !loadError && users.length === 0 ? (
          <EmptyState
            title="Belum ada akun staf"
            description="Tambahkan akun untuk memberikan akses operasional kepada staf."
          />
        ) : null}
        {!loading && !loadError && users.length > 0 ? (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#edf2f6] text-xs font-bold uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">Nama</th>
                  <th className="px-4 py-3">Email login</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Dibuat</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((user, index) => {
                  const isCurrentOwner = session.user.id === user.id;
                  return (
                    <tr
                      key={user.id}
                      className={index % 2 ? "bg-[#fbfcfd]" : "bg-white"}
                    >
                      <td className="px-4 py-3.5 font-semibold text-marine">
                        {user.name}
                        {isCurrentOwner ? (
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            Anda
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 text-slate-700">
                        {user.email}
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${roleBadgeClass[user.role]}`}
                        >
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${
                            user.is_active
                              ? "border-success/30 bg-success/10 text-[#347c2c]"
                              : "border-danger/25 bg-danger/10 text-danger"
                          }`}
                        >
                          {user.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-xs text-slate-700">
                        {formatBusinessDateTime(user.created_at)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => openEditor(user)}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            Edit / reset sandi
                          </Button>
                          {user.is_active ? (
                            <Button
                              variant="danger"
                              type="button"
                              disabled={saving || isCurrentOwner}
                              title={
                                isCurrentOwner
                                  ? "Owner tidak dapat menonaktifkan akunnya sendiri."
                                  : undefined
                              }
                              onClick={() => void setActive(user, false)}
                            >
                              Nonaktifkan
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              type="button"
                              disabled={saving}
                              onClick={() => void setActive(user, true)}
                            >
                              Aktifkan kembali
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {editingUser ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-marine/35 p-4">
          <section
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto border border-border bg-white p-5 sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-user-title"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">
                  Pengaturan akun
                </p>
                <h2
                  id="edit-user-title"
                  className="mt-1 text-lg font-bold text-marine"
                >
                  Edit / reset sandi
                </h2>
                <p className="mt-1 break-all text-sm text-slate-600">
                  {editingUser.email}
                </p>
              </div>
              <button
                className="grid size-11 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-canvas hover:text-marine"
                type="button"
                aria-label="Tutup"
                onClick={() => setEditingUser(null)}
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <form className="mt-5 grid gap-4" onSubmit={submitEdit}>
              <Field id="edit-user-name" label="Nama Lengkap" required>
                <Input
                  id="edit-user-name"
                  maxLength={255}
                  required
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((form) => ({
                      ...form,
                      name: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field id="edit-user-role" label="Role" required>
                <Select
                  id="edit-user-role"
                  value={editForm.role}
                  onChange={(event) =>
                    setEditForm((form) => ({
                      ...form,
                      role: event.target.value as UserRole,
                    }))
                  }
                >
                  {userRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="edit-user-password"
                label="Password baru"
                hint="Kosongkan jika tidak ingin mereset password. Jika diisi, minimal 8 karakter."
              >
                <Input
                  id="edit-user-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={editForm.password}
                  onChange={(event) =>
                    setEditForm((form) => ({
                      ...form,
                      password: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setEditingUser(null)}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={saving}>
                  <KeyRound className="size-4" aria-hidden="true" />
                  {saving ? "Menyimpan…" : "Simpan perubahan"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
