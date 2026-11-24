"use client";
import { generateUuidV4 } from "@/lib/uuid";

import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/data-states";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import {
  PosReceiptPrint,
  type PosReceiptData,
} from "@/components/pos-receipt-print";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiClientError, apiRequest } from "@/lib/api";
import { formatInteger, formatPosRupiah } from "@/lib/format";
import { V46PosCatalog } from "@/features/pos/v46-pos-catalog";

interface PosBatch {
  batch: {
    id: string;
    batch_code: string;
    status: "active" | "completed" | "voided";
    current_stock: number;
  };
  species: {
    id: string;
    species_code: string;
    species_name: string;
  };
  fish_size: string;
  unit_price: number | null;
}

interface PosBatchList {
  items: PosBatch[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}

interface CreateSaleResponse {
  sale: { id: string };
  receipt: PosReceiptData;
}

interface SalePayload {
  batch_id: string;
  quantity: number;
  expected_unit_price: number;
  payment_method: "cash" | "transfer";
  cash_received?: number;
  transfer_confirmed?: true;
}

interface UncertainAttempt {
  key: string;
  payload: string;
}

const allowedRoles = ["Owner", "Admin Operasional", "Kasir"] as const;

function displayError(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "Data POS tidak dapat dimuat. Coba kembali.";
}

function safeNumber(
  details: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = details?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export default function PosPage() {
  const { ready, session } = useAuth();
  const router = useRouter();
  const canAccess =
    session !== null &&
    allowedRoles.includes(session.user.role as (typeof allowedRoles)[number]);

  useEffect(() => {
    if (ready && session && !canAccess) router.replace("/batches");
  }, [canAccess, ready, router, session]);

  if (!ready || !session || !canAccess) return <PageSkeleton />;
  return <V46PosCatalog />;
}

export function LegacyPosPage() {
  const { ready, session } = useAuth();
  const router = useRouter();
  const canAccess =
    session !== null &&
    allowedRoles.includes(session.user.role as (typeof allowedRoles)[number]);
  const [batchPage, setBatchPage] = useState(1);
  const [batchList, setBatchList] = useState<PosBatchList | null>(null);
  const [batchListLoading, setBatchListLoading] = useState(true);
  const [batchListError, setBatchListError] = useState("");
  const [batchReload, setBatchReload] = useState(0);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [batchDetail, setBatchDetail] = useState<PosBatch | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailReload, setDetailReload] = useState(0);
  const [quantityInput, setQuantityInput] = useState("1");
  const [quantityAdjustmentRequired, setQuantityAdjustmentRequired] =
    useState(false);
  const [quantityAdjustmentConfirmed, setQuantityAdjustmentConfirmed] =
    useState(false);
  const [priceConfirmed, setPriceConfirmed] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">(
    "cash",
  );
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [uncertainAttempt, setUncertainAttempt] =
    useState<UncertainAttempt | null>(null);
  const [receipt, setReceipt] = useState<PosReceiptData | null>(null);

  useEffect(() => {
    if (ready && session && !canAccess) router.replace("/batches");
  }, [canAccess, ready, router, session]);

  useEffect(() => {
    if (!session || !canAccess) return;
    let active = true;
    setBatchListLoading(true);
    setBatchListError("");

    apiRequest<PosBatchList>(`/pos/batches?page=${batchPage}&limit=100`, {
      token: session.accessToken,
    })
      .then((response) => {
        if (active) setBatchList(response.data);
      })
      .catch((error: unknown) => {
        if (active) setBatchListError(displayError(error));
      })
      .finally(() => {
        if (active) setBatchListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [batchPage, batchReload, canAccess, session]);

  useEffect(() => {
    if (!session || !selectedBatchId) return;
    let active = true;
    setDetailLoading(true);
    setDetailError("");
    setPriceConfirmed(false);

    apiRequest<PosBatch>(
      `/pos/batches/${encodeURIComponent(selectedBatchId)}`,
      { token: session.accessToken },
    )
      .then((response) => {
        if (!active) return;
        const latest = response.data;
        setBatchDetail(latest);
        const currentQuantity = Number(quantityInput);
        if (
          Number.isSafeInteger(currentQuantity) &&
          currentQuantity > latest.batch.current_stock
        ) {
          setQuantityInput(String(latest.batch.current_stock));
          setQuantityAdjustmentRequired(latest.batch.current_stock > 0);
          setQuantityAdjustmentConfirmed(false);
        }
      })
      .catch((error: unknown) => {
        if (active) setDetailError(displayError(error));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });

    return () => {
      active = false;
    };
  }, [detailReload, selectedBatchId, session]);

  if (!ready || !session || !canAccess) return <PageSkeleton />;

  const quantity = Number(quantityInput);
  const quantityIsValid =
    Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1_000_000;
  const availableStock = batchDetail?.batch.current_stock ?? 0;
  const currentPrice = batchDetail?.unit_price ?? null;
  const totalAmount =
    currentPrice !== null && quantityIsValid ? quantity * currentPrice : null;
  const cashReceived = Number(cashReceivedInput);
  const cashIsValid =
    Number.isSafeInteger(cashReceived) &&
    totalAmount !== null &&
    cashReceived >= totalAmount;
  const canSubmit =
    batchDetail !== null &&
    currentPrice !== null &&
    availableStock > 0 &&
    quantityIsValid &&
    quantity <= availableStock &&
    priceConfirmed &&
    (!quantityAdjustmentRequired || quantityAdjustmentConfirmed) &&
    (paymentMethod === "cash" ? cashIsValid : transferConfirmed) &&
    !detailLoading &&
    !submitting;

  function selectBatch(batchId: string) {
    setSelectedBatchId(batchId);
    setBatchDetail(null);
    setDetailError("");
    setQuantityInput("1");
    setQuantityAdjustmentRequired(false);
    setQuantityAdjustmentConfirmed(false);
    setPriceConfirmed(false);
    setPaymentMethod("cash");
    setCashReceivedInput("");
    setTransferConfirmed(false);
    setCheckoutError("");
    setUncertainAttempt(null);
  }

  function setCappedQuantity(stock: number) {
    const requested = Number(quantityInput);
    if (Number.isSafeInteger(requested) && requested > stock) {
      setQuantityInput(String(stock));
      setQuantityAdjustmentRequired(stock > 0);
      setQuantityAdjustmentConfirmed(false);
    }
  }

  function refreshBatch() {
    setPriceConfirmed(false);
    setCheckoutError("");
    setDetailReload((value) => value + 1);
  }

  function updateQuantity(value: string) {
    if (!batchDetail) return;
    const nextQuantity = Number(value);
    if (
      value !== "" &&
      Number.isSafeInteger(nextQuantity) &&
      nextQuantity > availableStock
    ) {
      setQuantityInput(String(availableStock));
      setQuantityAdjustmentRequired(availableStock > 0);
      setQuantityAdjustmentConfirmed(false);
      return;
    }
    setQuantityInput(value);
    setQuantityAdjustmentRequired(false);
    setQuantityAdjustmentConfirmed(false);
  }

  async function submitSale() {
    if (!session || !batchDetail || currentPrice === null || !canSubmit) return;
    const payload: SalePayload = {
      batch_id: batchDetail.batch.id,
      quantity,
      expected_unit_price: currentPrice,
      payment_method: paymentMethod,
      ...(paymentMethod === "cash"
        ? { cash_received: cashReceived }
        : { transfer_confirmed: true as const }),
    };
    const payloadKey = JSON.stringify(payload);
    const idempotencyKey =
      uncertainAttempt?.payload === payloadKey
        ? uncertainAttempt.key
        : generateUuidV4();

    setSubmitting(true);
    setCheckoutError("");
    try {
      const response = await apiRequest<CreateSaleResponse>("/pos/sales", {
        method: "POST",
        token: session.accessToken,
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });
      setUncertainAttempt(null);
      setReceipt(response.data.receipt);
    } catch (error) {
      setUncertainAttempt(null);
      if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        (error.code === "PRICE_CHANGED" || error.code === "INSUFFICIENT_STOCK")
      ) {
        setPriceConfirmed(false);
        if (error.code === "PRICE_CHANGED") {
          const latestPrice = safeNumber(error.details, "unit_price");
          if (latestPrice !== undefined) {
            setBatchDetail((current) =>
              current ? { ...current, unit_price: latestPrice } : current,
            );
          }
          setCheckoutError(
            "Harga berubah. Harga terbaru dimuat; periksa dan konfirmasikan ulang sebelum menyimpan.",
          );
        } else {
          const latestStock = safeNumber(error.details, "available_quantity");
          if (latestStock !== undefined) {
            setBatchDetail((current) =>
              current
                ? {
                    ...current,
                    batch: { ...current.batch, current_stock: latestStock },
                  }
                : current,
            );
            setCappedQuantity(latestStock);
          }
          setCheckoutError(
            "Stok berubah. Stok dan harga terbaru dimuat; periksa kembali jumlah dan konfirmasikan sebelum menyimpan.",
          );
        }
        setDetailReload((value) => value + 1);
      } else if (error instanceof ApiClientError && error.status === 0) {
        setUncertainAttempt({ key: idempotencyKey, payload: payloadKey });
        setCheckoutError(
          "Hasil transaksi belum dapat dipastikan. Periksa koneksi, lalu kirim ulang permintaan yang sama agar tidak menggandakan penjualan.",
        );
      } else {
        setCheckoutError(displayError(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startNewSale() {
    setReceipt(null);
    setSelectedBatchId("");
    setBatchDetail(null);
    setQuantityInput("1");
    setQuantityAdjustmentRequired(false);
    setQuantityAdjustmentConfirmed(false);
    setPriceConfirmed(false);
    setPaymentMethod("cash");
    setCashReceivedInput("");
    setTransferConfirmed(false);
    setCheckoutError("");
    setUncertainAttempt(null);
    setBatchReload((value) => value + 1);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Penjualan · POS"
        title="Kasir ikan"
        description="Pilih satu batch, konfirmasikan harga dan stok, lalu catat pembayaran penuh."
      />

      {receipt ? (
        <section
          className="mx-auto max-w-3xl border border-[#b8dfb2] bg-white"
          aria-labelledby="pos-success-title"
        >
          <div className="flex items-center gap-3 border-b border-border bg-[#eff8ed] px-5 py-4">
            <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
            <div>
              <h2 id="pos-success-title" className="font-bold text-marine">
                Penjualan berhasil disimpan
              </h2>
              <p className="text-sm text-slate-600">
                Pembayaran telah dikonfirmasi.
              </p>
            </div>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <PosReceiptPrint
              receipt={receipt}
              printButtonLabel="Cetak Struk"
              autoPrint
              saleCommitted
            />
          </div>
          <div className="border-t border-border px-5 py-4">
            <Button onClick={startNewSale}>
              <ShoppingCart className="size-4" aria-hidden="true" />
              Mulai transaksi baru
            </Button>
          </div>
        </section>
      ) : (
        <fieldset
          className="m-0 w-full min-w-0 border-0 p-0"
          disabled={submitting || detailLoading}
        >
          {submitting ? (
            <p
              className="mb-4 flex items-center gap-2 text-sm font-semibold text-marine"
              role="status"
            >
              <span className="size-4 animate-spin rounded-full border-2 border-sky border-r-transparent" />
              Menyimpan penjualan...
            </p>
          ) : null}

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
            <section
              aria-labelledby="sellable-batches-title"
              className="min-w-0"
            >
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2
                    id="sellable-batches-title"
                    className="text-base font-bold text-marine"
                  >
                    Batch siap jual
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Hanya batch aktif dengan stok tersedia.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0 px-3"
                  onClick={() => setBatchReload((value) => value + 1)}
                  type="button"
                  aria-label="Muat ulang daftar batch"
                  title="Muat ulang daftar batch"
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <div className="min-h-56 border-y border-border bg-white">
                {batchListLoading ? (
                  <div
                    className="animate-pulse divide-y divide-border"
                    aria-label="Memuat batch"
                  >
                    {[0, 1, 2].map((row) => (
                      <div key={row} className="grid gap-3 px-4 py-4">
                        <div className="h-4 w-2/5 rounded bg-slate-200" />
                        <div className="h-3 w-3/5 rounded bg-slate-100" />
                      </div>
                    ))}
                  </div>
                ) : null}
                {!batchListLoading && batchListError ? (
                  <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                    <AlertTriangle
                      className="mb-2 size-6 text-danger"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-slate-700">{batchListError}</p>
                    <Button
                      className="mt-3"
                      variant="secondary"
                      onClick={() => setBatchReload((value) => value + 1)}
                      type="button"
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                      Coba lagi
                    </Button>
                  </div>
                ) : null}
                {!batchListLoading &&
                !batchListError &&
                batchList?.items.length === 0 ? (
                  <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                    <ShoppingCart
                      className="mb-2 size-7 text-slate-400"
                      aria-hidden="true"
                    />
                    <p className="font-semibold text-marine">
                      Belum ada batch siap jual
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Batch aktif dengan stok lebih dari nol akan muncul di
                      sini.
                    </p>
                  </div>
                ) : null}
                {!batchListLoading && !batchListError && batchList ? (
                  <div className="divide-y divide-border">
                    {batchList.items.map((item) => {
                      const selected = selectedBatchId === item.batch.id;
                      return (
                        <button
                          key={item.batch.id}
                          type="button"
                          aria-label={`Pilih batch ${item.batch.batch_code}`}
                          aria-pressed={selected}
                          onClick={() => selectBatch(item.batch.id)}
                          className={`grid min-h-[88px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-l-4 px-4 py-3 text-left transition-colors hover:bg-[#f7fafc] ${
                            selected
                              ? "border-l-sky bg-[#f0f9fd]"
                              : "border-l-transparent"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-marine">
                              {item.species.species_name}
                              <span className="px-1 text-slate-400">/</span>
                              {item.fish_size}
                            </span>
                            <span className="mt-1 block font-mono text-xs tabular-nums text-slate-500">
                              {item.batch.batch_code}
                            </span>
                          </span>
                          <span className="text-right">
                            <span className="block text-sm font-bold tabular-nums text-marine">
                              {formatInteger(item.batch.current_stock)} ekor
                            </span>
                            <span
                              className={`mt-1 block text-xs font-semibold tabular-nums ${
                                item.unit_price === null
                                  ? "text-warning"
                                  : "text-slate-600"
                              }`}
                            >
                              {item.unit_price === null
                                ? "Harga belum tersedia"
                                : formatPosRupiah(item.unit_price)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {batchList && batchList.pagination.totalPages > 1 ? (
                <div className="flex items-center justify-between gap-3 py-3 text-xs text-slate-600">
                  <span>
                    Halaman {batchList.pagination.page} dari{" "}
                    {batchList.pagination.totalPages}
                  </span>
                  <span className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="min-h-10 px-3"
                      disabled={batchPage <= 1}
                      onClick={() => setBatchPage((page) => page - 1)}
                      type="button"
                    >
                      Sebelumnya
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-10 px-3"
                      disabled={batchPage >= batchList.pagination.totalPages}
                      onClick={() => setBatchPage((page) => page + 1)}
                      type="button"
                    >
                      Berikutnya
                    </Button>
                  </span>
                </div>
              ) : null}
            </section>

            <section
              aria-labelledby="checkout-title"
              className="min-w-0 self-start border border-border bg-white xl:sticky xl:top-24"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 id="checkout-title" className="font-bold text-marine">
                  Pembayaran
                </h2>
                <CircleDollarSign
                  className="size-5 text-teal"
                  aria-hidden="true"
                />
              </div>

              {selectedBatchId ? (
                <div className="space-y-4 p-4">
                  {detailLoading ? (
                    <div
                      className="animate-pulse space-y-3"
                      aria-label="Memuat detail batch"
                    >
                      <div className="h-4 w-2/3 rounded bg-slate-200" />
                      <div className="h-12 rounded bg-slate-100" />
                      <div className="h-12 rounded bg-slate-100" />
                    </div>
                  ) : null}
                  {!detailLoading && detailError ? (
                    <div className="space-y-3" role="alert">
                      <p className="text-sm text-danger">{detailError}</p>
                      <Button
                        variant="secondary"
                        onClick={refreshBatch}
                        type="button"
                      >
                        <RefreshCw className="size-4" aria-hidden="true" />
                        Coba muat ulang detail
                      </Button>
                    </div>
                  ) : null}
                  {!detailLoading && batchDetail ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-marine">
                            {batchDetail.species.species_name} /{" "}
                            {batchDetail.fish_size}
                          </p>
                          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500">
                            {batchDetail.batch.batch_code}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          className="shrink-0 px-3"
                          onClick={refreshBatch}
                          type="button"
                          aria-label="Perbarui stok dan harga"
                          title="Perbarui stok dan harga"
                        >
                          <RefreshCw className="size-4" aria-hidden="true" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-3 border-y border-border py-3">
                        <div>
                          <p className="text-xs text-slate-500">
                            Stok tersedia
                          </p>
                          <p className="mt-1 font-bold tabular-nums text-marine">
                            {formatInteger(availableStock)} ekor
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">
                            Harga terkini
                          </p>
                          <p className="mt-1 font-bold tabular-nums text-marine">
                            {currentPrice === null
                              ? "Belum tersedia"
                              : formatPosRupiah(currentPrice)}
                          </p>
                        </div>
                      </div>

                      {currentPrice === null ? (
                        <p
                          className="border-l-4 border-warning bg-[#fff7ed] px-3 py-2 text-sm text-[#9a4f05]"
                          role="alert"
                        >
                          Harga untuk spesies dan ukuran ini belum tersedia.
                          Batch tidak dapat di-checkout.
                        </p>
                      ) : null}
                      {availableStock === 0 ? (
                        <p
                          className="border-l-4 border-danger bg-[#fef2f2] px-3 py-2 text-sm text-danger"
                          role="alert"
                        >
                          Stok batch sudah habis dan tidak dapat dijual.
                        </p>
                      ) : null}

                      <Field
                        id="pos-quantity"
                        label="Jumlah ikan (ekor)"
                        required
                      >
                        <Input
                          id="pos-quantity"
                          type="number"
                          min={1}
                          max={availableStock}
                          step={1}
                          inputMode="numeric"
                          className="tabular-nums"
                          value={quantityInput}
                          onChange={(event) =>
                            updateQuantity(event.target.value)
                          }
                          aria-describedby="pos-quantity-hint"
                        />
                      </Field>
                      <p
                        id="pos-quantity-hint"
                        className="-mt-3 text-xs text-slate-500"
                      >
                        Maksimal {formatInteger(availableStock)} ekor dari batch
                        ini.
                      </p>
                      {quantityAdjustmentRequired ? (
                        <div className="space-y-2 border-l-4 border-warning bg-[#fff7ed] px-3 py-2">
                          <p
                            className="text-sm font-semibold text-[#9a4f05]"
                            role="alert"
                          >
                            Jumlah dibatasi otomatis menjadi{" "}
                            {formatInteger(quantity)} ekor. Konfirmasikan jumlah
                            sebelum melanjutkan.
                          </p>
                          <label className="flex min-h-11 items-center gap-2 text-sm text-marine">
                            <input
                              type="checkbox"
                              checked={quantityAdjustmentConfirmed}
                              onChange={(event) =>
                                setQuantityAdjustmentConfirmed(
                                  event.target.checked,
                                )
                              }
                            />
                            Saya menyetujui jumlah yang dibatasi
                          </label>
                        </div>
                      ) : null}

                      <label className="flex min-h-11 items-center gap-2 text-sm text-marine">
                        <input
                          type="checkbox"
                          checked={priceConfirmed}
                          disabled={
                            currentPrice === null || availableStock === 0
                          }
                          onChange={(event) =>
                            setPriceConfirmed(event.target.checked)
                          }
                        />
                        Saya mengonfirmasi harga terbaru
                      </label>

                      <fieldset className="space-y-2 border-0 p-0">
                        <legend className="mb-1 text-sm font-semibold text-marine">
                          Metode pembayaran
                        </legend>
                        <div className="grid grid-cols-2 gap-2">
                          <label
                            className={`flex min-h-11 items-center gap-2 border px-3 text-sm font-semibold ${paymentMethod === "cash" ? "border-marine bg-[#eef4f8] text-marine" : "border-border text-slate-600"}`}
                          >
                            <input
                              type="radio"
                              name="payment-method"
                              value="cash"
                              checked={paymentMethod === "cash"}
                              onChange={() => {
                                setPaymentMethod("cash");
                                setTransferConfirmed(false);
                              }}
                            />
                            Tunai
                          </label>
                          <label
                            className={`flex min-h-11 items-center gap-2 border px-3 text-sm font-semibold ${paymentMethod === "transfer" ? "border-marine bg-[#eef4f8] text-marine" : "border-border text-slate-600"}`}
                          >
                            <input
                              type="radio"
                              name="payment-method"
                              value="transfer"
                              checked={paymentMethod === "transfer"}
                              onChange={() => setPaymentMethod("transfer")}
                            />
                            Transfer
                          </label>
                        </div>
                      </fieldset>

                      {paymentMethod === "cash" ? (
                        <Field
                          id="pos-cash-received"
                          label="Uang diterima (Rp)"
                          required
                        >
                          <Input
                            id="pos-cash-received"
                            type="number"
                            min={totalAmount ?? 0}
                            step={1}
                            inputMode="numeric"
                            className="tabular-nums"
                            value={cashReceivedInput}
                            onChange={(event) =>
                              setCashReceivedInput(event.target.value)
                            }
                          />
                        </Field>
                      ) : (
                        <label className="flex min-h-11 items-center gap-2 border border-border px-3 text-sm text-marine">
                          <input
                            type="checkbox"
                            checked={transferConfirmed}
                            onChange={(event) =>
                              setTransferConfirmed(event.target.checked)
                            }
                          />
                          Saya mengonfirmasi dana transfer sudah diterima
                        </label>
                      )}

                      <dl className="space-y-2 border-t border-border pt-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-slate-600">Total pembayaran</dt>
                          <dd className="font-bold tabular-nums text-marine">
                            {totalAmount === null
                              ? "—"
                              : formatPosRupiah(totalAmount)}
                          </dd>
                        </div>
                        {paymentMethod === "cash" ? (
                          <div className="flex items-center justify-between gap-3">
                            <dt className="text-slate-600">Kembalian</dt>
                            <dd className="font-bold tabular-nums text-success">
                              {cashIsValid && totalAmount !== null
                                ? formatPosRupiah(cashReceived - totalAmount)
                                : formatPosRupiah(0)}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                      {paymentMethod === "cash" &&
                      cashReceivedInput !== "" &&
                      totalAmount !== null &&
                      !cashIsValid ? (
                        <p className="text-xs text-danger" role="alert">
                          Uang diterima harus sama dengan atau lebih besar dari
                          total.
                        </p>
                      ) : null}
                      {checkoutError ? (
                        <p
                          className="border-l-4 border-warning bg-[#fff7ed] px-3 py-2 text-sm text-[#9a4f05]"
                          role="alert"
                        >
                          {checkoutError}
                        </p>
                      ) : null}
                      <Button
                        className="w-full"
                        disabled={!canSubmit}
                        onClick={submitSale}
                        type="button"
                      >
                        <ShoppingCart className="size-4" aria-hidden="true" />
                        Simpan penjualan
                      </Button>
                      <p className="text-center text-xs text-slate-500">
                        Harga dan stok diperiksa kembali saat transaksi
                        disimpan.
                      </p>
                    </>
                  ) : null}
                  {!detailLoading && !detailError && !batchDetail ? (
                    <div className="space-y-2 py-4 text-sm text-slate-500">
                      <p>Pilih satu batch untuk memulai transaksi.</p>
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
                  <ShoppingCart
                    className="mb-2 size-7 text-slate-400"
                    aria-hidden="true"
                  />
                  <p className="font-semibold text-marine">
                    Belum ada batch dipilih
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Pilih satu batch. Setiap transaksi hanya menggunakan satu
                    batch.
                  </p>
                </div>
              )}
            </section>
          </div>
        </fieldset>
      )}
    </div>
  );
}
