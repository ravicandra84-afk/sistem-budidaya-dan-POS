"use client";

import {
  CircleDollarSign,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { FISH_SIZES, type FishSize } from "@pfi/shared";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageSkeleton,
  TableSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/features/auth/auth-provider";
import type { PaginationData, SpeciesItem } from "@/features/receiving/types";
import { ApiClientError, apiRequest } from "@/lib/api";
import { formatBusinessDateTime, formatPosRupiah } from "@/lib/format";
import { PaginationControls } from "@/components/pagination-controls";

interface PriceItem {
  id: string;
  species_id: string;
  species_code: string;
  species_name: string;
  fish_size: FishSize;
  price_per_fish: number;
  created_at: string;
  updated_at: string;
  updated_by: { id: string; name: string } | null;
}

const maximumPrice = 10_000_000;
const manageableRoles = ["Owner", "Admin Operasional"] as const;

function errorText(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "Daftar harga tidak dapat dimuat. Coba kembali.";
}

export default function PosPricesPage() {
  const { ready, session } = useAuth();
  const router = useRouter();
  const canManage =
    session !== null &&
    manageableRoles.includes(
      session.user.role as (typeof manageableRoles)[number],
    );
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [prices, setPrices] = useState<PaginationData<PriceItem> | null>(null);
  const [pricesLoading, setPricesLoading] = useState(true);
  const [pricesError, setPricesError] = useState("");
  const [pricesReload, setPricesReload] = useState(0);
  const [species, setSpecies] = useState<SpeciesItem[]>([]);
  const [speciesLoading, setSpeciesLoading] = useState(true);
  const [speciesError, setSpeciesError] = useState("");
  const [speciesReload, setSpeciesReload] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<PriceItem | null>(null);
  const [speciesId, setSpeciesId] = useState("");
  const [fishSize, setFishSize] = useState<FishSize>(FISH_SIZES[0]);
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (ready && session && !canManage) {
      router.replace(session.user.role === "Kasir" ? "/pos" : "/batches");
    }
  }, [canManage, ready, router, session]);

  useEffect(() => {
    if (!session || !canManage) return;
    let active = true;
    setPricesLoading(true);
    setPricesError("");
    apiRequest<PaginationData<PriceItem>>(
      `/pos/prices?page=${page}&limit=${limit}`,
      { token: session.accessToken },
    )
      .then((response) => {
        if (active) setPrices(response.data);
      })
      .catch((error: unknown) => {
        if (active) setPricesError(errorText(error));
      })
      .finally(() => {
        if (active) setPricesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canManage, limit, page, pricesReload, session]);

  useEffect(() => {
    if (!session || !canManage) return;
    let active = true;
    setSpeciesLoading(true);
    setSpeciesError("");
    apiRequest<SpeciesItem[]>("/fish-species", {
      token: session.accessToken,
    })
      .then((response) => {
        if (active) setSpecies(response.data);
      })
      .catch((error: unknown) => {
        if (active) setSpeciesError(errorText(error));
      })
      .finally(() => {
        if (active) setSpeciesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canManage, session, speciesReload]);

  if (!ready || !session || !canManage) return <PageSkeleton />;

  function openAddForm() {
    setEditingPrice(null);
    setSpeciesId("");
    setFishSize(FISH_SIZES[0]);
    setPriceInput("");
    setPriceError("");
    setFormError("");
    setFormOpen(true);
  }

  function openEditForm(price: PriceItem) {
    setEditingPrice(price);
    setSpeciesId(price.species_id);
    setFishSize(price.fish_size);
    setPriceInput(String(price.price_per_fish));
    setPriceError("");
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    if (submitting) return;
    setFormOpen(false);
    setEditingPrice(null);
    setFormError("");
    setPriceError("");
  }

  async function submitPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || submitting) return;
    setPriceError("");
    setFormError("");
    setNotice("");

    const parsedPrice = Number(priceInput);
    if (!Number.isSafeInteger(parsedPrice) || !/^\d+$/.test(priceInput)) {
      setPriceError("Masukkan harga dalam Rupiah bulat tanpa desimal.");
      return;
    }
    if (parsedPrice < 1 || parsedPrice > maximumPrice) {
      setPriceError("Harga harus antara Rp1 dan Rp10.000.000 per ekor.");
      return;
    }
    if (!speciesId) {
      setFormError("Pilih spesies ikan terlebih dahulu.");
      return;
    }

    setSubmitting(true);
    try {
      if (editingPrice) {
        await apiRequest<PriceItem>(
          `/pos/prices/${encodeURIComponent(editingPrice.id)}`,
          {
            method: "PATCH",
            token: session.accessToken,
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ price_per_fish: parsedPrice }),
          },
        );
      } else {
        await apiRequest<PriceItem>("/pos/prices", {
          method: "POST",
          token: session.accessToken,
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            species_id: speciesId,
            fish_size: fishSize,
            price_per_fish: parsedPrice,
          }),
        });
      }
      setNotice(
        editingPrice
          ? "Harga berhasil diperbarui."
          : "Harga baru berhasil ditambahkan.",
      );
      setFormOpen(false);
      setEditingPrice(null);
      setPricesReload((value) => value + 1);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "PRICE_ALREADY_EXISTS"
      ) {
        setFormError(
          "Harga untuk kombinasi spesies dan ukuran ini sudah tersedia. Pilih kombinasi lain atau ubah harga yang ada.",
        );
      } else if (
        error instanceof ApiClientError &&
        error.code === "PRICE_OUT_OF_RANGE"
      ) {
        setPriceError("Harga harus antara Rp1 dan Rp10.000.000 per ekor.");
      } else {
        setFormError(errorText(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Pengaturan penjualan"
        title="Daftar harga"
        description="Harga aktif per spesies dan ukuran. Perubahan harga tidak mengubah nilai transaksi yang sudah tersimpan."
        action={
          <Button onClick={openAddForm} type="button">
            <Plus className="size-4" aria-hidden="true" />
            Tambah harga baru
          </Button>
        }
      />

      {notice ? (
        <p
          className="mb-4 border-l-4 border-success bg-[#eff8ed] px-4 py-3 text-sm font-semibold text-[#347c2c]"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {formOpen ? (
        <section
          className="mb-6 border border-border bg-white"
          aria-labelledby="price-form-title"
        >
          <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[#e8f5f4] text-teal">
              <CircleDollarSign className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="price-form-title" className="font-bold text-marine">
                {editingPrice ? "Ubah harga" : "Tambah harga baru"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Harga Rp1 sampai Rp10.000.000 per ekor, tanpa pecahan.
              </p>
            </div>
          </div>

          {speciesError ? (
            <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-l-4 border-danger bg-[#fef2f2] px-3 py-3 text-sm text-danger sm:mx-5">
              <span>{speciesError}</span>
              <Button
                variant="secondary"
                onClick={() => setSpeciesReload((value) => value + 1)}
                type="button"
              >
                Coba muat spesies lagi
              </Button>
            </div>
          ) : null}

          <form className="p-4 sm:p-5" noValidate onSubmit={submitPrice}>
            <fieldset
              className="m-0 grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2"
              disabled={submitting || speciesLoading}
            >
              <Field id="price-species" label="Spesies ikan" required>
                <Select
                  id="price-species"
                  value={speciesId}
                  onChange={(event) => setSpeciesId(event.target.value)}
                  disabled={
                    Boolean(editingPrice) ||
                    speciesLoading ||
                    species.length === 0
                  }
                  required
                >
                  <option value="">
                    {speciesLoading ? "Memuat spesies..." : "Pilih spesies"}
                  </option>
                  {species.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.species_name} ({item.species_code})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="price-fish-size" label="Ukuran ikan" required>
                <Select
                  id="price-fish-size"
                  value={fishSize}
                  onChange={(event) =>
                    setFishSize(event.target.value as FishSize)
                  }
                  disabled={Boolean(editingPrice)}
                  required
                >
                  {FISH_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="price-per-fish"
                label="Harga per ekor (Rp)"
                required
                hint="Bilangan bulat dari Rp1 hingga Rp10.000.000."
              >
                <Input
                  id="price-per-fish"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  value={priceInput}
                  onChange={(event) => {
                    setPriceInput(event.target.value);
                    setPriceError("");
                  }}
                  aria-invalid={Boolean(priceError)}
                  aria-describedby={priceError ? "price-error" : undefined}
                  required
                />
              </Field>
              <div className="flex items-end">
                <p className="min-h-11 w-full border border-border bg-canvas px-3 py-3 text-sm text-slate-600">
                  {priceInput && Number.isSafeInteger(Number(priceInput))
                    ? `Pratinjau: ${formatPosRupiah(Number(priceInput))} / ekor`
                    : "Masukkan harga Rupiah bulat."}
                </p>
              </div>
            </fieldset>
            {priceError ? (
              <p
                id="price-error"
                className="mt-3 text-sm text-danger"
                role="alert"
              >
                {priceError}
              </p>
            ) : null}
            {formError ? (
              <p
                className="mt-3 border-l-4 border-warning bg-[#fff7ed] px-3 py-2 text-sm text-[#9a4f05]"
                role="alert"
              >
                {formError}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                disabled={submitting}
                onClick={closeForm}
                type="button"
              >
                Batal
              </Button>
              <Button disabled={submitting || speciesLoading} type="submit">
                {submitting ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleDollarSign className="size-4" aria-hidden="true" />
                )}
                {submitting ? "Menyimpan..." : "Simpan harga"}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <section
        aria-label="Katalog harga"
        className="min-w-0 border-y border-border bg-white"
      >
        {pricesLoading ? <TableSkeleton rows={5} /> : null}
        {!pricesLoading && pricesError ? (
          <ErrorState
            message={pricesError}
            onRetry={() => setPricesReload((value) => value + 1)}
          />
        ) : null}
        {!pricesLoading && !pricesError && prices?.items.length === 0 ? (
          <EmptyState
            title="Belum ada harga aktif"
            description="Tambahkan harga untuk kombinasi spesies dan ukuran sebelum batch dapat dijual."
            action={
              <Button onClick={openAddForm} type="button">
                <Plus className="size-4" aria-hidden="true" />
                Tambah harga baru
              </Button>
            }
          />
        ) : null}
        {!pricesLoading && !pricesError && prices && prices.items.length > 0 ? (
          <>
            <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(9rem,0.8fr)_minmax(0,1fr)_3.25rem] gap-3 bg-[#edf2f6] px-4 py-3 text-xs font-bold uppercase text-slate-600 md:grid">
              <span>Spesies / ukuran</span>
              <span>Harga per ekor</span>
              <span>Pembaruan terakhir</span>
              <span className="sr-only">Aksi</span>
            </div>
            <ul className="divide-y divide-border">
              {prices.items.map((item) => (
                <li
                  key={item.id}
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3.5 md:grid-cols-[minmax(0,1.3fr)_minmax(9rem,0.8fr)_minmax(0,1fr)_3.25rem]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-marine">
                      {item.species_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.fish_size}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-500 md:hidden">
                      Harga per ekor
                    </p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums text-marine">
                      {formatPosRupiah(item.price_per_fish)}
                    </p>
                  </div>
                  <div className="col-span-2 min-w-0 text-xs text-slate-600 md:col-span-1">
                    <p className="tabular-nums">
                      {formatBusinessDateTime(item.updated_at)}
                    </p>
                    <p className="mt-0.5 truncate">
                      {item.updated_by?.name ?? "Aktor tidak tersedia"}
                    </p>
                  </div>
                  <div className="col-start-2 row-start-2 justify-self-end md:col-start-auto md:row-start-auto">
                    <Button
                      variant="secondary"
                      className="size-11 px-0"
                      onClick={() => openEditForm(item)}
                      type="button"
                      aria-label={`Ubah harga ${item.species_name}, ukuran ${item.fish_size}`}
                      title="Ubah harga"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <PaginationControls
              page={prices.pagination.page}
              limit={prices.pagination.limit}
              totalItems={prices.pagination.totalItems}
              totalPages={prices.pagination.totalPages}
              onPageChange={setPage}
              onLimitChange={(value) => {
                setLimit(value);
                setPage(1);
              }}
            />
          </>
        ) : null}
      </section>
      {pricesLoading ||
      pricesError ||
      !prices ||
      prices.items.length === 0 ? null : (
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => setPricesReload((value) => value + 1)}
          type="button"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Muat ulang daftar harga
        </Button>
      )}
    </div>
  );
}
