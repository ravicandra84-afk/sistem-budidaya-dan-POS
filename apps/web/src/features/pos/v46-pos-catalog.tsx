"use client";

import { useEffect, useRef, useState } from "react";
import {
  Banknote,
  Bluetooth,
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  ShoppingCart,
} from "lucide-react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiClientError, apiRequest } from "@/lib/api";
import { buildEscPosReceiptBytes } from "@/lib/escpos-receipt";
import { generateUuidV4 } from "@/lib/uuid";
import { formatInteger, formatPosRupiah } from "@/lib/format";
import {
  connectBluetoothPrinter,
  isWebBluetoothSupported,
  printViaWebBluetooth,
  type BluetoothDevice,
} from "@/lib/web-bluetooth-printer";
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
  batch_id?: string;
  batch_code: string;
  current_stock?: number;
  remaining_stock?: number;
  sale_readiness?: string;
  species_name: string;
  size_label: string;
}

interface CatalogCategory {
  id: string;
  name: string;
  code: string;
  requires_batch: boolean;
  is_active: boolean;
}

interface CatalogProduct {
  id: string;
  category_id?: string;
  category_name?: string;
  sku: string;
  name: string;
  tracking_mode: "BATCH_TRACKED" | "NON_BATCH";
  species: string | null;
  size_label: string | null;
  variant_label?: string | null;
  unit: string;
  unit_price: number;
  available_stock?: number | null;
  stock_quantity: number | null;
  batches: CatalogBatch[];
}

function categoryIdForProduct(product: CatalogProduct): string {
  return (
    product.category_id ??
    (product.tracking_mode === "BATCH_TRACKED"
      ? "legacy-fish"
      : "legacy-general")
  );
}

function categoryNameForProduct(product: CatalogProduct): string {
  return (
    product.category_name ??
    (product.tracking_mode === "BATCH_TRACKED" ? "Benih Ikan" : "Produk Umum")
  );
}

function categoriesFromProducts(products: CatalogProduct[]): CatalogCategory[] {
  const categories = new Map<string, CatalogCategory>();
  for (const product of products) {
    const id = categoryIdForProduct(product);
    categories.set(id, {
      id,
      name: categoryNameForProduct(product),
      code: id.toUpperCase().replace(/[^A-Z0-9]+/g, "-"),
      requires_batch: product.tracking_mode === "BATCH_TRACKED",
      is_active: true,
    });
  }
  return [...categories.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function productTypeKey(product: CatalogProduct): string {
  const name =
    product.tracking_mode === "BATCH_TRACKED"
      ? (product.species ?? product.name)
      : product.name;
  return `${product.tracking_mode}:${name}`;
}

function catalogBatchId(batch: CatalogBatch): string {
  return batch.batch_id ?? batch.id ?? batch.batch_code;
}

function catalogBatchStock(batch: CatalogBatch): number {
  return batch.remaining_stock ?? batch.current_stock ?? 0;
}

function isSellableBatch(batch: CatalogBatch): boolean {
  return !batch.sale_readiness || batch.sale_readiness === "SIAP_JUAL";
}

function getProductAvailableStock(product: CatalogProduct): number {
  return product.available_stock ?? product.stock_quantity ?? 0;
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(
    value,
  );
}

export function V46PosCatalog() {
  const { ready, session } = useAuth();
  const printerDevice = useRef<BluetoothDevice | null>(null);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [batchQuantities, setBatchQuantities] = useState<
    Record<string, string>
  >({});
  const [quantity, setQuantity] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">(
    "cash",
  );
  const [cashReceived, setCashReceived] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [receipt, setReceipt] = useState<PosReceiptData | null>(null);
  const [receiptAutoPrint, setReceiptAutoPrint] = useState(false);
  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerConnecting, setPrinterConnecting] = useState(false);
  const [printerMessage, setPrinterMessage] = useState("");

  useEffect(() => {
    if (!ready || !session) return;
    let active = true;
    setLoading(true);
    setError("");
    void apiRequest<{ items: CatalogCategory[] }>(
      "/pos/categories?page=1&limit=100",
      { token: session.accessToken },
    )
      .then((response) => {
        if (active) {
          setCategories(
            response.data.items.filter((category) => category.is_active),
          );
        }
      })
      .catch(() => undefined);
    apiRequest<{ items: CatalogProduct[] }>("/pos/catalog", {
      token: session.accessToken,
    })
      .then((response) => {
        if (!active) return;
        setProducts(response.data.items);
        setCategories((current) =>
          current.length > 0
            ? current
            : categoriesFromProducts(response.data.items),
        );
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
            const legacyProducts = legacy.data.items.map(
              (item, index): CatalogProduct => ({
                id: `legacy-${item.batch.id}-${index}`,
                category_id: "legacy-fish",
                category_name: "Benih Ikan",
                sku: item.batch.batch_code,
                name: `${item.species.species_name} ${item.fish_size}`,
                tracking_mode: "BATCH_TRACKED",
                species: item.species.species_name,
                size_label: item.fish_size,
                variant_label: null,
                unit: "EKOR",
                unit_price: item.unit_price ?? 0,
                available_stock: item.batch.current_stock,
                stock_quantity: item.batch.current_stock,
                batches: [
                  {
                    id: item.batch.id,
                    batch_id: item.batch.id,
                    batch_code: item.batch.batch_code,
                    current_stock: item.batch.current_stock,
                    remaining_stock: item.batch.current_stock,
                    sale_readiness: "SIAP_JUAL",
                    species_name: item.species.species_name,
                    size_label: item.fish_size,
                  },
                ],
              }),
            );
            setProducts(legacyProducts);
            setCategories(categoriesFromProducts(legacyProducts));
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

  useEffect(
    () => () => {
      printerDevice.current?.gatt?.disconnect();
    },
    [],
  );

  if (!ready || !session) return <PageSkeleton />;

  const activeCategories = (
    categories.length > 0 ? categories : categoriesFromProducts(products)
  ).filter((category) => category.is_active);
  const categoryProducts = products.filter(
    (product) => categoryIdForProduct(product) === selectedCategoryId,
  );
  const typeGroups = new Map<
    string,
    { id: string; name: string; count: number }
  >();
  for (const product of categoryProducts) {
    const id = productTypeKey(product);
    const name =
      product.tracking_mode === "BATCH_TRACKED"
        ? (product.species ?? product.name)
        : product.name;
    const previous = typeGroups.get(id);
    typeGroups.set(id, { id, name, count: (previous?.count ?? 0) + 1 });
  }
  const typeChoices = [...typeGroups.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const productsForType = categoryProducts.filter(
    (product) => productTypeKey(product) === selectedTypeId,
  );
  const selectedProduct =
    productsForType.find((product) => product.id === selectedProductId) ?? null;
  const availableBatches = selectedProduct
    ? selectedProduct.batches.filter(isSellableBatch)
    : [];
  const batchAllocations =
    selectedProduct?.tracking_mode === "BATCH_TRACKED"
      ? availableBatches
          .map((batch) => ({
            batch_id: catalogBatchId(batch),
            quantity: Number(batchQuantities[catalogBatchId(batch)] ?? 0),
          }))
          .filter((allocation) => allocation.quantity > 0)
      : [];
  const selectedProductStock = selectedProduct
    ? getProductAvailableStock(selectedProduct)
    : 0;
  const selectedProductOutOfStock =
    selectedProduct !== null &&
    (selectedProductStock <= 0 ||
      (selectedProduct.tracking_mode === "BATCH_TRACKED" &&
        availableBatches.length === 0));
  const availableStock = selectedProductStock;
  const quantityNumber =
    selectedProduct?.tracking_mode === "BATCH_TRACKED"
      ? batchAllocations.reduce(
          (total, allocation) => total + allocation.quantity,
          0,
        )
      : Number(quantity);
  const quantityHasTwoDecimals =
    Math.abs(quantityNumber * 100 - Math.round(quantityNumber * 100)) < 1e-8;
  const batchInputsValid =
    selectedProduct?.tracking_mode !== "BATCH_TRACKED" ||
    availableBatches.every((batch) => {
      const rawQuantity = batchQuantities[catalogBatchId(batch)] ?? "";
      if (rawQuantity.trim() === "") return true;
      const value = Number(rawQuantity);
      return (
        Number.isInteger(value) &&
        value >= 0 &&
        value <= catalogBatchStock(batch)
      );
    });
  const quantityValid =
    selectedProduct?.tracking_mode === "BATCH_TRACKED"
      ? batchInputsValid &&
        batchAllocations.length > 0 &&
        Number.isInteger(quantityNumber) &&
        quantityNumber >= 1 &&
        quantityNumber <= selectedProductStock
      : selectedProduct?.tracking_mode === "NON_BATCH" &&
        Number.isFinite(quantityNumber) &&
        quantityNumber > 0 &&
        quantityHasTwoDecimals &&
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
    !selectedProductOutOfStock &&
    quantityValid &&
    paymentValid &&
    !submitting &&
    (selectedProduct?.tracking_mode === "NON_BATCH" ||
      batchAllocations.length > 0);
  const changeDue =
    paymentMethod === "cash" &&
    total !== null &&
    Number.isFinite(cashNumber) &&
    cashNumber >= total
      ? Number((cashNumber - total).toFixed(2))
      : null;

  function selectProduct(product: CatalogProduct) {
    setSelectedProductId(product.id);
    setBatchQuantities({});
    setQuantity("1");
    setCashReceived("");
    setTransferConfirmed(false);
    setCheckoutError("");
  }

  function chooseCategory(categoryId: string) {
    setSelectedCategoryId(categoryId);
    setSelectedTypeId("");
    setSelectedProductId("");
    setBatchQuantities({});
    setQuantity("1");
    setCheckoutError("");
  }

  function chooseType(typeId: string) {
    setSelectedTypeId(typeId);
    setSelectedProductId("");
    setBatchQuantities({});
    setQuantity("1");
    setCheckoutError("");
  }

  async function connectPrinter() {
    if (printerConnected) {
      printerDevice.current?.gatt?.disconnect();
      printerDevice.current = null;
      setPrinterConnected(false);
      setPrinterMessage("Printer diputuskan.");
      return;
    }
    if (!isWebBluetoothSupported()) {
      setPrinterMessage(
        "Web Bluetooth tidak tersedia. Gunakan browser yang mendukung pada koneksi HTTPS atau localhost.",
      );
      return;
    }
    setPrinterConnecting(true);
    setPrinterMessage("");
    try {
      const device = await connectBluetoothPrinter();
      printerDevice.current = device;
      device.addEventListener("gattserverdisconnected", () => {
        if (printerDevice.current === device) {
          setPrinterConnected(false);
          setPrinterMessage("Koneksi printer terputus.");
        }
      });
      setPrinterConnected(device.gatt?.connected ?? false);
      setPrinterMessage(
        device.gatt?.connected
          ? "Printer Terhubung"
          : "Printer belum terhubung.",
      );
    } catch (caught) {
      printerDevice.current = null;
      setPrinterConnected(false);
      setPrinterMessage(
        caught instanceof Error
          ? caught.message
          : "Printer tidak dapat dihubungkan. Gunakan browser yang mendukung pada koneksi HTTPS atau localhost.",
      );
    } finally {
      setPrinterConnecting(false);
    }
  }

  async function submitSale() {
    if (!session || !selectedProduct || !canSubmit) return;
    setSubmitting(true);
    setCheckoutError("");
    const payload = selectedProduct.id.startsWith("legacy-")
      ? {
          batch_id: batchAllocations[0]?.batch_id,
          quantity: quantityNumber,
          expected_unit_price: selectedProduct.unit_price,
          payment_method: paymentMethod,
          ...(paymentMethod === "cash"
            ? { cash_received: cashNumber }
            : { transfer_confirmed: true as const }),
        }
      : {
          product_id: selectedProduct.id,
          ...(selectedProduct.tracking_mode === "BATCH_TRACKED"
            ? batchAllocations.length === 1
              ? { batch_id: batchAllocations[0]?.batch_id }
              : { batch_allocations: batchAllocations }
            : { batch_id: null }),
          quantity: quantityNumber,
          expected_unit_price: selectedProduct.unit_price,
          payment_method: paymentMethod,
          ...(paymentMethod === "cash"
            ? { cash_received: cashNumber }
            : { transfer_confirmed: true as const }),
        };
    try {
      const response = await apiRequest<{
        sale: { id: string };
        receipt: PosReceiptData;
      }>("/pos/sales", {
        method: "POST",
        token: session.accessToken,
        headers: { "Idempotency-Key": generateUuidV4() },
        body: JSON.stringify(payload),
      });
      setReceipt(response.data.receipt);
      const connectedPrinter = printerDevice.current;
      setReceiptAutoPrint(!connectedPrinter);
      setReload((value) => value + 1);
      if (connectedPrinter) {
        try {
          await printViaWebBluetooth(
            buildEscPosReceiptBytes(response.data.receipt, "58"),
            connectedPrinter,
          );
          setPrinterMessage("Struk berhasil dikirim ke printer Bluetooth.");
          setPrinterConnected(connectedPrinter.gatt?.connected ?? false);
        } catch (printError) {
          setPrinterMessage(
            printError instanceof Error
              ? `${printError.message} Dialog cetak browser dibuka.`
              : "Cetak Bluetooth gagal. Dialog cetak browser dibuka.",
          );
          setPrinterConnected(connectedPrinter.gatt?.connected ?? false);
          setReceiptAutoPrint(true);
        }
      }
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

  const printerStatusPanel = (
    <section className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-border bg-white px-4 py-3">
      <div className="flex min-h-11 items-center gap-3">
        <span
          className={`grid size-10 place-items-center border ${printerConnected ? "border-success bg-[#eff8ed] text-[#347c2c]" : "border-border bg-[#f4f7fa] text-slate-600"}`}
        >
          <Bluetooth className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">
            Printer Thermal
          </p>
          <p className="font-semibold text-marine" role="status">
            {printerConnected
              ? "Printer Terhubung"
              : isWebBluetoothSupported()
                ? "Printer belum terhubung"
                : "Bluetooth tidak tersedia"}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="min-h-11"
        onClick={() => void connectPrinter()}
        disabled={printerConnecting}
      >
        <Bluetooth className="size-4" aria-hidden="true" />
        {printerConnecting
          ? "Menghubungkan…"
          : printerConnected
            ? "Putuskan Printer"
            : "Hubungkan Printer"}
      </Button>
      {printerMessage ? (
        <p className="w-full text-sm text-slate-600" role="status">
          {printerMessage}
        </p>
      ) : null}
    </section>
  );

  if (receipt) {
    return (
      <div>
        <PageHeader
          eyebrow="POS · Sukses"
          title="Penjualan berhasil"
          description="Transaksi tersimpan; cetak otomatis dicoba melalui printer yang terhubung atau dialog browser."
        />
        {printerStatusPanel}
        <div className="mb-4 flex items-center gap-2 border border-success bg-[#eff8ed] px-4 py-3 text-sm font-bold text-[#347c2c]">
          <CheckCircle2 className="size-5" />
          Transaksi tersimpan.
        </div>
        <PosReceiptPrint
          receipt={receipt}
          saleCommitted
          autoPrint={receiptAutoPrint}
        />
        <div className="mt-4">
          <Button
            type="button"
            onClick={() => {
              setReceipt(null);
              setReceiptAutoPrint(false);
              setSelectedCategoryId("");
              setSelectedTypeId("");
              setSelectedProductId("");
              setBatchQuantities({});
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
        description="Pilih kategori, jenis, varian, lalu alokasikan stok untuk transaksi."
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
      {printerStatusPanel}
      {loading ? <PageSkeleton /> : null}
      {!loading && error ? (
        <ErrorState
          message={error}
          onRetry={() => setReload((value) => value + 1)}
        />
      ) : null}
      {!loading && !error && activeCategories.length === 0 ? (
        <EmptyState
          title="Belum ada produk aktif"
          description="Katalog produk aktif akan tampil di sini setelah dimuat."
        />
      ) : null}

      {!loading && !error && activeCategories.length > 0 ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <section className="border border-border bg-white">
              <div className="border-b border-border px-4 py-3">
                <h2 className="font-bold text-marine">
                  1 · Pilih kategori produk
                </h2>
              </div>
              <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={selectedCategoryId === category.id}
                    onClick={() => chooseCategory(category.id)}
                    className={`flex min-h-16 items-center justify-between gap-3 border px-4 text-left font-semibold ${selectedCategoryId === category.id ? "border-teal bg-[#eff8ed] text-marine" : "border-border bg-white text-marine hover:bg-[#f4f7fa]"}`}
                  >
                    <span>{category.name}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {
                        products.filter(
                          (product) =>
                            categoryIdForProduct(product) === category.id,
                        ).length
                      }{" "}
                      produk
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {selectedCategoryId ? (
              <section className="border border-border bg-white">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="font-bold text-marine">
                    2 · Pilih jenis / spesies
                  </h2>
                </div>
                {typeChoices.length > 0 ? (
                  <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {typeChoices.map((choice) => (
                      <button
                        key={choice.id}
                        type="button"
                        aria-pressed={selectedTypeId === choice.id}
                        onClick={() => chooseType(choice.id)}
                        className={`flex min-h-16 items-center justify-between gap-3 border px-4 text-left font-semibold ${selectedTypeId === choice.id ? "border-teal bg-[#eff8ed] text-marine" : "border-border bg-white text-marine hover:bg-[#f4f7fa]"}`}
                      >
                        <span>{choice.name}</span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {choice.count} varian
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-5 text-sm text-slate-600">
                    Belum ada produk pada kategori ini.
                  </p>
                )}
              </section>
            ) : null}

            {selectedTypeId ? (
              <section className="border border-border bg-white">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="font-bold text-marine">
                    Pilih varian / ukuran
                  </h2>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  {productsForType.map((product) => {
                    const stock = getProductAvailableStock(product);
                    const variantDescription = [
                      product.variant_label,
                      product.size_label,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => selectProduct(product)}
                        aria-pressed={selectedProductId === product.id}
                        aria-label={`Pilih varian ${product.name}${variantDescription ? ` ${variantDescription}` : ""}`}
                        className={`min-h-28 border p-4 text-left ${selectedProductId === product.id ? "border-teal bg-[#eff8ed]" : "border-border bg-white hover:bg-[#f4f7fa]"}`}
                      >
                        <p className="text-xs font-mono text-slate-500">
                          {product.sku}
                        </p>
                        <p className="mt-1 font-bold text-marine">
                          {product.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-600">
                          {product.tracking_mode === "BATCH_TRACKED"
                            ? variantDescription || product.species
                            : `${variantDescription || "Stok langsung"} · ${product.unit}`}
                        </p>
                        <div className="mt-3 flex flex-col items-start gap-2">
                          <span className="text-sm font-bold tabular-nums text-marine">
                            {formatPosRupiah(product.unit_price)}
                          </span>
                          {stock > 0 ? (
                            <span className="text-xs font-semibold tabular-nums text-slate-700">
                              {product.tracking_mode === "BATCH_TRACKED"
                                ? `Sisa stok siap jual: ${formatInteger(stock)} ${product.unit.toLowerCase()}`
                                : `Sisa stok: ${formatQuantity(stock)} ${product.unit}`}
                            </span>
                          ) : (
                            <span className="border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                              Stok Habis (0)
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>

          <section className="min-w-0 self-start border border-border bg-white xl:sticky xl:top-24">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-bold text-marine">
                3 · Alokasi & pembayaran
              </h2>
              <CircleDollarSign className="size-5 text-teal" />
            </div>
            <div className="space-y-4 p-4">
              {!selectedProduct ? (
                <p className="text-sm text-slate-600">
                  Pilih kategori, jenis, dan varian terlebih dahulu.
                </p>
              ) : (
                <>
                  <div>
                    <p className="font-bold text-marine">
                      {selectedProduct.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selectedProduct.tracking_mode === "BATCH_TRACKED"
                        ? [
                            selectedProduct.variant_label,
                            selectedProduct.size_label,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Batch ikan"
                        : `Barang · ${selectedProduct.unit}`}
                    </p>
                  </div>
                  {selectedProductOutOfStock ? (
                    <p
                      className="border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      role="alert"
                    >
                      {selectedProduct.tracking_mode === "BATCH_TRACKED"
                        ? "Produk ini belum memiliki stok SIAP_JUAL"
                        : "Stok produk ini sedang habis (0)"}
                    </p>
                  ) : null}
                  {selectedProduct.tracking_mode === "BATCH_TRACKED" ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-marine">
                          Batch SIAP_JUAL
                        </p>
                        <p className="text-xs tabular-nums text-slate-600">
                          Total dialokasikan: {formatInteger(quantityNumber)}{" "}
                          ekor
                        </p>
                      </div>
                      {availableBatches.map((batch) => {
                        const id = catalogBatchId(batch);
                        const stock = catalogBatchStock(batch);
                        return (
                          <div
                            key={id}
                            className="grid gap-2 border border-border p-3 sm:grid-cols-[minmax(0,1fr)_120px] sm:items-center"
                          >
                            <div>
                              <p className="font-semibold text-marine">
                                {batch.batch_code}
                              </p>
                              <p className="text-xs tabular-nums text-slate-600">
                                Sisa {formatInteger(stock)} ekor ·{" "}
                                {batch.sale_readiness ?? "SIAP_JUAL"}
                              </p>
                            </div>
                            <label
                              className="text-xs font-semibold text-slate-600"
                              htmlFor={`allocation-${id}`}
                            >
                              Jumlah ekor
                              <Input
                                id={`allocation-${id}`}
                                type="number"
                                min={0}
                                max={stock}
                                step={1}
                                value={batchQuantities[id] ?? ""}
                                disabled={selectedProductOutOfStock}
                                onChange={(event) =>
                                  setBatchQuantities((current) => ({
                                    ...current,
                                    [id]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 border-y border-border py-3">
                    <div>
                      <p className="text-xs text-slate-500">Stok tersedia</p>
                      <p className="mt-1 font-bold tabular-nums text-marine">
                        {selectedProduct.tracking_mode === "BATCH_TRACKED"
                          ? formatInteger(availableStock)
                          : formatQuantity(availableStock)}{" "}
                        {selectedProduct.unit}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Harga satuan</p>
                      <p className="mt-1 font-bold tabular-nums text-marine">
                        {formatPosRupiah(selectedProduct.unit_price)}
                      </p>
                    </div>
                  </div>
                  {selectedProduct.tracking_mode === "NON_BATCH" ? (
                    <Field
                      id="pos-quantity"
                      label={`Jumlah barang (${selectedProduct.unit})`}
                      required
                    >
                      <Input
                        id="pos-quantity"
                        type="number"
                        min={0.01}
                        max={selectedProductStock || undefined}
                        step="0.01"
                        value={quantity}
                        disabled={selectedProductOutOfStock}
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </Field>
                  ) : null}
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
                    <div className="space-y-2">
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
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11"
                        disabled={total === null}
                        onClick={() => {
                          if (total !== null) setCashReceived(String(total));
                        }}
                      >
                        <Banknote className="size-4" aria-hidden="true" />
                        Uang Pas
                      </Button>
                    </div>
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
                    <p className="text-xs text-slate-500">Total Tagihan</p>
                    <p className="mt-1 text-xl font-bold tabular-nums text-marine">
                      {total === null ? "—" : formatPosRupiah(total)}
                    </p>
                    {changeDue !== null ? (
                      <p className="mt-1 text-xs tabular-nums text-slate-600">
                        Uang Kembalian {formatPosRupiah(changeDue)}
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
                    aria-label="Simpan penjualan"
                    disabled={!canSubmit}
                    onClick={() => void submitSale()}
                  >
                    <ShoppingCart className="size-4" />
                    {submitting ? "Memproses…" : "Konfirmasi & Cetak Transaksi"}
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
