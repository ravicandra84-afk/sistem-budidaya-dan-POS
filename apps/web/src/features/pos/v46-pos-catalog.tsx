"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiClientError, apiRequest } from "@/lib/api";
import { generateUuidV4 } from "@/lib/uuid";
import { formatInteger, formatPosRupiah } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select } from "@/components/ui/field";
import {
  PosReceiptPrint,
  type PosReceiptData,
} from "@/components/pos-receipt-print";

interface CatalogBatch {
  id: string;
  batch_code: string;
  current_stock: number;
  species_name: string;
  size_label: string;
}

interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  tracking_mode: "BATCH_TRACKED" | "NON_BATCH";
  species: string | null;
  size_label: string | null;
  unit: string;
  unit_price: number;
  stock_quantity: number;
  batches: CatalogBatch[];
}

export function V46PosCatalog() {
  const { ready, session } = useAuth();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">(
    "cash",
  );
  const [cashReceived, setCashReceived] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [receipt, setReceipt] = useState<PosReceiptData | null>(null);

  useEffect(() => {
    if (!ready || !session) return;
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<{ items: CatalogProduct[] }>("/pos/catalog", {
      token: session.accessToken,
    })
      .then((response) => {
        if (!active) return;
        setProducts(response.data.items);
      })
      .catch(async (catalogError) => {
        if (
          active &&
          catalogError instanceof ApiClientError &&
          catalogError.status === 404
        ) {
          try {
            const legacy = await apiRequest<{
              items: Array<{
                batch: {
                  id: string;
                  batch_code: string;
                  current_stock: number;
                };
                species: { species_name: string };
                fish_size: string;
                unit_price: number | null;
              }>;
            }>("/pos/batches?page=1&limit=100", { token: session.accessToken });
            if (!active) return;
            setProducts(
              legacy.data.items.map(
                (item, index): CatalogProduct => ({
                  id: `legacy-${item.batch.id}-${index}`,
                  sku: item.batch.batch_code,
                  name: `${item.species.species_name} ${item.fish_size}`,
                  tracking_mode: "BATCH_TRACKED",
                  species: item.species.species_name,
                  size_label: item.fish_size,
                  unit: "EKOR",
                  unit_price: item.unit_price ?? 0,
                  stock_quantity: item.batch.current_stock,
                  batches: [
                    {
                      id: item.batch.id,
                      batch_code: item.batch.batch_code,
                      current_stock: item.batch.current_stock,
                      species_name: item.species.species_name,
                      size_label: item.fish_size,
                    },
                  ],
                }),
              ),
            );
          } catch (error) {
            if (active)
              setError(
                error instanceof ApiClientError
                  ? error.message
                  : "Katalog POS tidak dapat dimuat.",
              );
          }
        } else if (active) {
          setError(
            catalogError instanceof ApiClientError
              ? catalogError.message
              : "Katalog POS tidak dapat dimuat.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ready, reload, session]);

  if (!ready || !session) return <PageSkeleton />;

  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ?? null;
  const selectedBatch =
    selectedProduct?.batches.find((batch) => batch.id === selectedBatchId) ??
    null;
  const availableStock =
    selectedProduct?.tracking_mode === "BATCH_TRACKED"
      ? (selectedBatch?.current_stock ?? 0)
      : (selectedProduct?.stock_quantity ?? 0);
  const quantityNumber = Number(quantity);
  const quantityValid =
    Number.isInteger(quantityNumber) &&
    quantityNumber >= 1 &&
    quantityNumber <= availableStock;
  const total =
    selectedProduct && quantityValid
      ? Number((quantityNumber * selectedProduct.unit_price).toFixed(2))
      : null;
  const cashNumber = Number(cashReceived);
  const paymentValid =
    paymentMethod === "transfer"
      ? transferConfirmed
      : total !== null && Number.isFinite(cashNumber) && cashNumber >= total;
  const canSubmit =
    Boolean(selectedProduct) &&
    quantityValid &&
    paymentValid &&
    !submitting &&
    (selectedProduct?.tracking_mode === "NON_BATCH" || Boolean(selectedBatch));

  function selectProduct(product: CatalogProduct) {
    setSelectedProductId(product.id);
    setSelectedBatchId(
      product.tracking_mode === "BATCH_TRACKED" && product.batches.length === 1
        ? (product.batches[0]?.id ?? "")
        : "",
    );
    setQuantity("1");
    setCashReceived("");
    setTransferConfirmed(false);
    setCheckoutError("");
  }

  async function submitSale() {
    if (!session || !selectedProduct || !canSubmit) return;
    setSubmitting(true);
    setCheckoutError("");
    const payload = selectedProduct.id.startsWith("legacy-")
      ? {
          batch_id: selectedBatchId,
          quantity: quantityNumber,
          expected_unit_price: selectedProduct.unit_price,
          payment_method: paymentMethod,
          ...(paymentMethod === "cash"
            ? { cash_received: cashNumber }
            : { transfer_confirmed: true as const }),
        }
      : {
          product_id: selectedProduct.id,
          batch_id:
            selectedProduct.tracking_mode === "BATCH_TRACKED"
              ? selectedBatchId
              : null,
          quantity: quantityNumber,
          expected_unit_price: selectedProduct.unit_price,
          payment_method: paymentMethod,
          ...(paymentMethod === "cash"
            ? { cash_received: cashNumber }
            : { transfer_confirmed: true as const }),
        };
    try {
      const endpoint = selectedProduct.id.startsWith("legacy-")
        ? "/pos/sales"
        : "/sales";
      const response = await apiRequest<{
        sale: { id: string };
        receipt: PosReceiptData;
      }>(endpoint, {
        method: "POST",
        token: session.accessToken,
        headers: { "Idempotency-Key": generateUuidV4() },
        body: JSON.stringify(payload),
      });
      setReceipt(response.data.receipt);
      setReload((value) => value + 1);
    } catch (caught) {
      setCheckoutError(
        caught instanceof ApiClientError
          ? caught.message
          : "Transaksi belum dapat dipastikan.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <div>
        <PageHeader
          eyebrow="POS · Sukses"
          title="Penjualan berhasil"
          description="Struk dapat dicetak ulang browser atau melalui printer Bluetooth yang mendukung."
        />
        <div className="mb-4 flex items-center gap-2 border border-success bg-[#eff8ed] px-4 py-3 text-sm font-bold text-[#347c2c]">
          <CheckCircle2 className="size-5" />
          Transaksi tersimpan.
        </div>
        <PosReceiptPrint receipt={receipt} saleCommitted autoPrint />
        <div className="mt-4">
          <Button
            type="button"
            onClick={() => {
              setReceipt(null);
              setSelectedProductId("");
              setSelectedBatchId("");
              setQuantity("1");
            }}
          >
            Penjualan baru
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Penjualan · POS"
        title="Kasir ikan"
        description="Pilih katalog aktif, batch spesifik untuk ikan, atau stok langsung untuk barang umum."
        action={
          <Button
            variant="secondary"
            type="button"
            onClick={() => setReload((value) => value + 1)}
          >
            <RefreshCw className="size-4" />
            Muat ulang
          </Button>
        }
      />
      {loading ? <PageSkeleton /> : null}
      {!loading && error ? (
        <ErrorState
          message={error}
          onRetry={() => setReload((value) => value + 1)}
        />
      ) : null}
      {!loading && !error && products.length === 0 ? (
        <EmptyState
          title="Belum ada katalog siap jual"
          description="Batch harus berstatus aktif dan SIAP_JUAL, atau produk umum harus memiliki stok."
        />
      ) : null}

      {!loading && !error && products.length > 0 ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="border border-border bg-white">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-bold text-marine">Katalog aktif</h2>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  aria-label={
                    product.tracking_mode === "BATCH_TRACKED" &&
                    product.batches[0]
                      ? `Pilih batch ${product.batches[0].batch_code}`
                      : `Pilih produk ${product.name}`
                  }
                  className={`min-h-28 border p-4 text-left ${selectedProductId === product.id ? "border-teal bg-[#eff8ed]" : "border-border bg-white"}`}
                >
                  <p className="text-xs font-mono text-slate-500">
                    {product.sku}
                  </p>
                  <p className="mt-1 font-bold text-marine">{product.name}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {product.tracking_mode === "BATCH_TRACKED"
                      ? `${product.species ?? ""} · ${product.size_label ?? ""}`
                      : `Stok langsung · ${product.unit}`}
                  </p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <span className="text-sm font-bold tabular-nums text-marine">
                      {formatPosRupiah(product.unit_price)}
                    </span>
                    <span className="text-sm font-bold tabular-nums">
                      {formatInteger(product.stock_quantity)} {product.unit}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="min-w-0 self-start border border-border bg-white xl:sticky xl:top-24">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-bold text-marine">Pembayaran</h2>
              <CircleDollarSign className="size-5 text-teal" />
            </div>
            <div className="space-y-4 p-4">
              {!selectedProduct ? (
                <p className="text-sm text-slate-600">
                  Pilih produk terlebih dahulu.
                </p>
              ) : (
                <>
                  <div>
                    <p className="font-bold text-marine">
                      {selectedProduct.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selectedProduct.tracking_mode === "BATCH_TRACKED"
                        ? "Batch ikan"
                        : `Barang · ${selectedProduct.unit}`}
                    </p>
                  </div>
                  {selectedProduct.tracking_mode === "BATCH_TRACKED" ? (
                    <Field
                      id="pos-batch"
                      label="Pilih batch siap jual"
                      required
                    >
                      <Select
                        id="pos-batch"
                        value={selectedBatchId}
                        onChange={(event) => {
                          setSelectedBatchId(event.target.value);
                          setQuantity("1");
                          setCheckoutError("");
                        }}
                      >
                        <option value="">Pilih batch</option>
                        {selectedProduct.batches.map((batch) => (
                          <option key={batch.id} value={batch.id}>
                            {batch.batch_code} · sisa{" "}
                            {formatInteger(batch.current_stock)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 border-y border-border py-3">
                    <div>
                      <p className="text-xs text-slate-500">Stok tersedia</p>
                      <p className="mt-1 font-bold tabular-nums text-marine">
                        {formatInteger(availableStock)} {selectedProduct.unit}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Harga satuan</p>
                      <p className="mt-1 font-bold tabular-nums text-marine">
                        {formatPosRupiah(selectedProduct.unit_price)}
                      </p>
                    </div>
                  </div>
                  <Field
                    id="pos-quantity"
                    label={
                      selectedProduct.tracking_mode === "BATCH_TRACKED"
                        ? "Jumlah ikan (ekor)"
                        : `Jumlah barang (${selectedProduct.unit})`
                    }
                    required
                  >
                    <Input
                      id="pos-quantity"
                      type="number"
                      min={1}
                      max={availableStock || undefined}
                      step={1}
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </Field>
                  <Field id="pos-payment" label="Metode pembayaran">
                    <Select
                      id="pos-payment"
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(
                          event.target.value as "cash" | "transfer",
                        )
                      }
                    >
                      <option value="cash">Tunai</option>
                      <option value="transfer">Transfer</option>
                    </Select>
                  </Field>
                  {paymentMethod === "cash" ? (
                    <Field id="pos-cash" label="Uang diterima" required>
                      <Input
                        id="pos-cash"
                        type="number"
                        min={0}
                        step="0.01"
                        value={cashReceived}
                        onChange={(event) =>
                          setCashReceived(event.target.value)
                        }
                      />
                    </Field>
                  ) : (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={transferConfirmed}
                        onChange={(event) =>
                          setTransferConfirmed(event.target.checked)
                        }
                      />
                      Dana transfer sudah diterima
                    </label>
                  )}
                  <div className="border-t border-border pt-3">
                    <p className="text-xs text-slate-500">Total pembayaran</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-marine">
                      {total === null ? "—" : formatPosRupiah(total)}
                    </p>
                    {paymentMethod === "cash" &&
                    total !== null &&
                    cashNumber >= total ? (
                      <p className="mt-1 text-xs tabular-nums text-slate-600">
                        Kembalian {formatPosRupiah(cashNumber - total)}
                      </p>
                    ) : null}
                  </div>
                  {checkoutError ? (
                    <p
                      className="border-l-4 border-danger bg-[#fef2f2] px-3 py-2 text-sm text-danger"
                      role="alert"
                    >
                      {checkoutError}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!canSubmit}
                    onClick={() => void submitSale()}
                  >
                    <ShoppingCart className="size-4" />
                    {submitting ? "Memproses…" : "Simpan penjualan"}
                  </Button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
