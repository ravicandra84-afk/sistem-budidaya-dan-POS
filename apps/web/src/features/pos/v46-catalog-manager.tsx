"use client";

import { useEffect, useState } from "react";
import { Archive, Plus, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiClientError, apiRequest } from "@/lib/api";
import { generateUuidV4 } from "@/lib/uuid";
import { formatPosRupiah } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select } from "@/components/ui/field";

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
  unit: string;
  unit_price: number;
  stock_quantity: number | null;
  is_active: boolean;
}

interface ListData<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}

const emptyForm = {
  category_id: "",
  sku: "",
  name: "",
  tracking_mode: "BATCH_TRACKED" as TrackingMode,
  species: "",
  size_label: "",
  unit: "EKOR",
  unit_price: "",
  stock_quantity: "",
};

export function V46CatalogManager() {
  const { session } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const canManage =
    session?.user.role === "Owner" ||
    session?.user.role === "Admin Operasional";

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      apiRequest<ListData<Category>>("/pos/categories?page=1&limit=100", {
        token: session.accessToken,
      }),
      apiRequest<ListData<Product>>("/pos/products?page=1&limit=100", {
        token: session.accessToken,
      }),
    ])
      .then(([categoryResponse, productResponse]) => {
        if (!active) return;
        setCategories(categoryResponse.data.items);
        setProducts(productResponse.data.items);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof ApiClientError
              ? caught.message
              : "Katalog produk tidak dapat dimuat.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload, session]);

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm, category_id: categories[0]?.id ?? "" });
    setActionError("");
  }

  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      category_id: product.category_id,
      sku: product.sku,
      name: product.name,
      tracking_mode: product.tracking_mode,
      species: product.species ?? "",
      size_label: product.size_label ?? "",
      unit: product.unit,
      unit_price: String(product.unit_price),
      stock_quantity:
        product.stock_quantity === null ? "" : String(product.stock_quantity),
    });
    setActionError("");
  }

  async function saveProduct() {
    if (!session || !canManage || saving) return;
    const unitPrice = Number(form.unit_price);
    if (
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0 ||
      unitPrice > 10_000_000
    ) {
      setActionError("Harga satuan harus antara Rp0,01 dan Rp10.000.000,00.");
      return;
    }
    if (
      form.tracking_mode === "BATCH_TRACKED" &&
      (!form.species.trim() || !form.size_label.trim())
    ) {
      setActionError("Produk batch memerlukan jenis dan ukuran ikan.");
      return;
    }
    if (
      form.tracking_mode === "NON_BATCH" &&
      (form.stock_quantity === "" || Number(form.stock_quantity) < 0)
    ) {
      setActionError(
        "Produk non-batch memerlukan stok awal yang tidak negatif.",
      );
      return;
    }

    const payload = {
      category_id: form.category_id,
      sku: form.sku.trim(),
      name: form.name.trim(),
      tracking_mode: form.tracking_mode,
      species:
        form.tracking_mode === "BATCH_TRACKED" ? form.species.trim() : null,
      size_label:
        form.tracking_mode === "BATCH_TRACKED" ? form.size_label.trim() : null,
      unit: form.unit.trim() || "PCS",
      unit_price: unitPrice,
      stock_quantity:
        form.tracking_mode === "NON_BATCH" ? Number(form.stock_quantity) : null,
      is_active: true,
    };

    setSaving(true);
    setActionError("");
    try {
      await apiRequest(
        editing ? `/pos/products/${editing.id}` : "/pos/products",
        {
          method: editing ? "PATCH" : "POST",
          token: session.accessToken,
          headers: { "Idempotency-Key": generateUuidV4() },
          body: JSON.stringify(payload),
        },
      );
      setEditing(null);
      setForm(emptyForm);
      setReload((value) => value + 1);
    } catch (caught) {
      setActionError(
        caught instanceof ApiClientError
          ? caught.message
          : "Produk belum dapat disimpan.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function archiveProduct(product: Product) {
    if (!session || !canManage) return;
    if (!window.confirm(`Arsipkan produk ${product.name}?`)) return;
    setSaving(true);
    setActionError("");
    try {
      await apiRequest(`/pos/products/${product.id}`, {
        method: "DELETE",
        token: session.accessToken,
        headers: { "Idempotency-Key": generateUuidV4() },
      });
      setReload((value) => value + 1);
    } catch (caught) {
      setActionError(
        caught instanceof ApiClientError
          ? caught.message
          : "Produk belum dapat diarsipkan.",
      );
    } finally {
      setSaving(false);
    }
  }

  const filtered = products.filter((product) => {
    const matchesSearch =
      `${product.sku} ${product.name} ${product.species ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchesCategory =
      !categoryFilter || product.category_id === categoryFilter;
    return product.is_active && matchesSearch && matchesCategory;
  });

  return (
    <div>
      <PageHeader
        eyebrow="POS · Katalog"
        title="Manajemen produk & harga"
        description="Kelola kategori, produk batch, stok barang umum, dan harga satuan kasir."
        action={
          canManage ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" /> Tambah produk
            </Button>
          ) : null
        }
      />

      <section className="mb-5 flex flex-wrap items-end gap-3 border-b border-border pb-5">
        <Field id="catalog-search" label="Cari produk">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="catalog-search"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="SKU, nama, atau jenis ikan"
            />
          </div>
        </Field>
        <Field id="catalog-category" label="Kategori">
          <Select
            id="catalog-category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">Semua kategori</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="secondary"
          type="button"
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
          Muat ulang
        </Button>
      </section>

      {loading ? <TableSkeleton /> : null}
      {!loading && error ? (
        <ErrorState
          message={error}
          onRetry={() => setReload((value) => value + 1)}
        />
      ) : null}
      {!loading && !error && filtered.length === 0 ? (
        <EmptyState
          title="Produk tidak ditemukan"
          description="Tambah produk baru atau ubah filter pencarian."
        />
      ) : null}

      {!loading && !error && filtered.length > 0 ? (
        <section className="overflow-x-auto border-y border-border bg-white">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#edf2f6] text-xs font-bold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">SKU / Produk</th>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Pelacakan</th>
                <th className="px-4 py-3">Jenis / Ukuran</th>
                <th className="px-4 py-3 text-right">Stok</th>
                <th className="px-4 py-3 text-right">Harga</th>
                {canManage ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-slate-500">
                      {product.sku}
                    </p>
                    <p className="font-bold text-marine">{product.name}</p>
                  </td>
                  <td className="px-4 py-3">{product.category_name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-bold">
                      {product.tracking_mode}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {product.tracking_mode === "BATCH_TRACKED"
                      ? `${product.species ?? "—"} / ${product.size_label ?? "—"}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {product.tracking_mode === "NON_BATCH"
                      ? `${product.stock_quantity ?? 0} ${product.unit}`
                      : "Dari batch"}
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-marine">
                    {formatPosRupiah(product.unit_price)}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() => openEdit(product)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          type="button"
                          onClick={() => void archiveProduct(product)}
                        >
                          <Archive className="size-4" />
                          Arsip
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {editing || form.category_id || actionError ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-marine/35 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto border border-border bg-white p-5">
            <h2 className="font-bold text-marine">
              {editing ? "Edit produk" : "Tambah produk"}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field id="product-category" label="Kategori">
                <Select
                  id="product-category"
                  value={form.category_id}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      category_id: event.target.value,
                    }))
                  }
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="product-mode" label="Mode pelacakan">
                <Select
                  id="product-mode"
                  value={form.tracking_mode}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      tracking_mode: event.target.value as TrackingMode,
                    }))
                  }
                >
                  <option value="BATCH_TRACKED">Batch ikan</option>
                  <option value="NON_BATCH">Barang umum</option>
                </Select>
              </Field>
              <Field id="product-sku" label="SKU">
                <Input
                  id="product-sku"
                  value={form.sku}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, sku: event.target.value }))
                  }
                />
              </Field>
              <Field id="product-name" label="Nama produk">
                <Input
                  id="product-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, name: event.target.value }))
                  }
                />
              </Field>
              {form.tracking_mode === "BATCH_TRACKED" ? (
                <>
                  <Field id="product-species" label="Jenis ikan">
                    <Input
                      id="product-species"
                      value={form.species}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          species: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field id="product-size" label="Ukuran ikan">
                    <Input
                      id="product-size"
                      value={form.size_label}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          size_label: event.target.value,
                        }))
                      }
                      placeholder="3-5 cm"
                    />
                  </Field>
                </>
              ) : (
                <Field id="product-stock" label="Stok barang">
                  <Input
                    id="product-stock"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.stock_quantity}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        stock_quantity: event.target.value,
                      }))
                    }
                  />
                </Field>
              )}
              <Field id="product-unit" label="Satuan">
                <Input
                  id="product-unit"
                  value={form.unit}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      unit: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </Field>
              <Field id="product-price" label="Harga satuan">
                <Input
                  id="product-price"
                  type="number"
                  min="0.01"
                  max="10000000"
                  step="0.01"
                  value={form.unit_price}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      unit_price: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            {actionError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                  setActionError("");
                }}
              >
                Batal
              </Button>
              <Button
                type="button"
                disabled={saving || !canManage}
                onClick={() => void saveProduct()}
              >
                {saving ? "Menyimpan…" : "Simpan"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
