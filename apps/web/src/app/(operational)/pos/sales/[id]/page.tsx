"use client";
import { generateUuidV4 } from "@/lib/uuid";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  Printer,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/ui/data-states";
import { PageHeader } from "@/components/page-header";
import {
  PosReceiptPrint,
  type PosReceiptData,
} from "@/components/pos-receipt-print";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiClientError, apiRequest } from "@/lib/api";
import {
  formatBusinessDateTime,
  formatInteger,
  formatPosRupiah,
} from "@/lib/format";

interface SaleDetail {
  id: string;
  sale_code: string;
  created_at: string;
  batch_id: string;
  batch_code: string;
  species_name: string;
  fish_size: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_method: "cash" | "transfer";
  cash_received: number | null;
  change_amount: number | null;
  created_by: { id: string; name: string };
  status: "active" | "voided";
  voided_at: string | null;
  voided_by: { id: string; name: string } | null;
}

interface BatchSnapshot {
  batch: {
    id: string;
    batch_code: string;
    status: "active" | "completed" | "voided";
    current_stock: number;
  };
  species: { id: string; species_code: string; species_name: string };
  fish_size: string;
  unit_price: number | null;
}

interface VoidSaleResponse {
  sale_id: string;
  status: "voided";
  voided_at: string;
  voided_by: string;
  batch_status: "active" | "completed" | "voided";
}

const allowedRoles = ["Owner", "Admin Operasional", "Kasir"] as const;

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "Data transaksi tidak dapat dimuat. Coba kembali.";
}

function SaleValue({
  label,
  children,
  numeric = false,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  numeric?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 border-b border-border py-3">
      <dt className="text-[11px] font-semibold uppercase text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-1 break-words text-sm font-semibold text-marine ${numeric ? "tabular-nums" : ""} ${mono ? "font-mono" : ""}`}
      >
        {children}
      </dd>
    </div>
  );
}

export default function PosSaleDetailPage() {
  const { id: saleId } = useParams<{ id: string }>();
  const { ready, session } = useAuth();
  const router = useRouter();
  const canAccess =
    session !== null &&
    allowedRoles.includes(session.user.role as (typeof allowedRoles)[number]);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [receipt, setReceipt] = useState<PosReceiptData | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [batchSnapshot, setBatchSnapshot] = useState<BatchSnapshot | null>(
    null,
  );
  const [batchError, setBatchError] = useState("");

  useEffect(() => {
    if (ready && session && !canAccess) router.replace("/batches");
  }, [canAccess, ready, router, session]);

  useEffect(() => {
    if (!session || !canAccess || !saleId) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setReceipt(null);
    apiRequest<SaleDetail>(`/pos/sales/${encodeURIComponent(saleId)}`, {
      token: session.accessToken,
    })
      .then((response) => {
        if (active) setSale(response.data);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canAccess, reloadKey, saleId, session]);

  if (!ready || !session || !canAccess) return <PageSkeleton />;

  async function refreshSale(): Promise<SaleDetail | null> {
    if (!session || !saleId) return null;
    const response = await apiRequest<SaleDetail>(
      `/pos/sales/${encodeURIComponent(saleId)}`,
      { token: session.accessToken },
    );
    setSale(response.data);
    return response.data;
  }

  async function refreshBatch(batchId: string) {
    if (!session) return;
    setBatchError("");
    try {
      const response = await apiRequest<BatchSnapshot>(
        `/pos/batches/${encodeURIComponent(batchId)}`,
        { token: session.accessToken },
      );
      setBatchSnapshot(response.data);
    } catch (error) {
      setBatchSnapshot(null);
      setBatchError(errorMessage(error));
    }
  }

  async function confirmVoid() {
    if (!session || !sale || sale.status !== "active" || voiding) return;
    setVoiding(true);
    setActionError("");
    setActionMessage("");
    try {
      await apiRequest<VoidSaleResponse>(
        `/pos/sales/${encodeURIComponent(sale.id)}/void`,
        {
          method: "POST",
          token: session.accessToken,
          headers: { "Idempotency-Key": generateUuidV4() },
          body: JSON.stringify({}),
        },
      );
      setVoidDialogOpen(false);
      setReceipt(null);
      setActionMessage(
        "Transaksi berhasil di-VOID dan status terbaru telah dimuat.",
      );
      const latestSale = await refreshSale();
      if (latestSale) await refreshBatch(latestSale.batch_id);
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "SALE_ALREADY_VOIDED"
      ) {
        setActionError(
          "Transaksi sudah lebih dahulu di-VOID. Status terbaru sedang dimuat.",
        );
        const latestSale = await refreshSale().catch(() => null);
        if (latestSale) await refreshBatch(latestSale.batch_id);
      } else {
        setActionError(errorMessage(error));
      }
    } finally {
      setVoiding(false);
    }
  }

  async function loadReceipt() {
    if (
      !session ||
      !sale ||
      sale.status !== "active" ||
      sale.created_by.id !== session.user.id ||
      receiptLoading
    ) {
      return;
    }
    setReceiptLoading(true);
    setActionError("");
    try {
      const response = await apiRequest<PosReceiptData>(
        `/pos/sales/${encodeURIComponent(sale.id)}/receipt`,
        { token: session.accessToken },
      );
      setReceipt(response.data);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setReceiptLoading(false);
    }
  }

  const canReprint =
    sale !== null &&
    sale.status === "active" &&
    sale.created_by.id === session.user.id;

  return (
    <div>
      <PageHeader
        eyebrow="Penjualan · Detail"
        title="Detail penjualan"
        description="Snapshot transaksi bersifat tetap; pembatalan dicatat sebagai transaksi VOID terpisah."
        action={
          <Link
            href="/pos/sales"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-marine hover:text-sky-hover"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Kembali ke riwayat
          </Link>
        }
      />

      {loading ? <PageSkeleton /> : null}
      {!loading && loadError ? (
        <ErrorState
          message={loadError}
          onRetry={() => setReloadKey((value) => value + 1)}
        />
      ) : null}
      {!loading && !loadError && !sale ? (
        <EmptyState
          title="Transaksi tidak ditemukan"
          description="Periksa kembali tautan transaksi atau kembali ke riwayat penjualan."
          action={
            <Link
              href="/pos/sales"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-sky-hover"
            >
              Buka riwayat penjualan
            </Link>
          }
        />
      ) : null}

      {!loading && !loadError && sale ? (
        <div className="space-y-5">
          <section className="border border-border bg-white">
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-slate-500">
                  Nomor penjualan internal
                </p>
                <h2 className="mt-1 break-all font-mono text-lg font-bold tabular-nums text-marine">
                  {sale.sale_code}
                </h2>
              </div>
              <span
                className={`inline-flex min-h-8 w-fit items-center rounded-full border px-3 text-xs font-bold ${
                  sale.status === "active"
                    ? "border-teal/30 bg-teal/10 text-[#087a75]"
                    : "border-danger/25 bg-danger/10 text-danger"
                }`}
              >
                {sale.status === "active" ? "Aktif" : "VOID"}
              </span>
            </div>

            <dl className="grid gap-x-8 px-4 sm:grid-cols-2 sm:px-5">
              <SaleValue label="Waktu transaksi (WIB)">
                {formatBusinessDateTime(sale.created_at)}
              </SaleValue>
              <SaleValue label="Kode batch" mono>
                {sale.batch_code}
              </SaleValue>
              <SaleValue label="Spesies / ukuran">
                {sale.species_name} / {sale.fish_size ?? "—"}
              </SaleValue>
              <SaleValue label="Jumlah ikan" numeric>
                {formatInteger(sale.quantity)} ekor
              </SaleValue>
              <SaleValue label="Harga satuan snapshot" numeric>
                {formatPosRupiah(sale.unit_price)}
              </SaleValue>
              <SaleValue label="Total transaksi" numeric>
                {formatPosRupiah(sale.total_amount)}
              </SaleValue>
              <SaleValue label="Metode pembayaran">
                {sale.payment_method === "cash" ? "Tunai" : "Transfer"}
              </SaleValue>
              <SaleValue label="Pembuat transaksi">
                {sale.created_by.name}
              </SaleValue>
              {sale.payment_method === "cash" ? (
                <>
                  <SaleValue label="Uang diterima" numeric>
                    {sale.cash_received === null
                      ? "—"
                      : formatPosRupiah(sale.cash_received)}
                  </SaleValue>
                  <SaleValue label="Kembalian" numeric>
                    {sale.change_amount === null
                      ? "—"
                      : formatPosRupiah(sale.change_amount)}
                  </SaleValue>
                </>
              ) : null}
              {sale.status === "voided" ? (
                <>
                  <SaleValue label="Waktu VOID (WIB)">
                    {sale.voided_at
                      ? formatBusinessDateTime(sale.voided_at)
                      : "Tidak tersedia"}
                  </SaleValue>
                  <SaleValue label="Pelaku VOID">
                    {sale.voided_by?.name ?? "Tidak tersedia"}
                  </SaleValue>
                </>
              ) : null}
            </dl>
          </section>

          {actionMessage ? (
            <p
              className="flex items-start gap-2 border-l-4 border-success bg-[#eff8ed] px-4 py-3 text-sm font-semibold text-[#347c2c]"
              role="status"
            >
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              {actionMessage}
            </p>
          ) : null}
          {actionError ? (
            <p
              className="border-l-4 border-warning bg-[#fff7ed] px-4 py-3 text-sm text-[#9a4f05]"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}

          {sale.status === "active" ? (
            <fieldset
              className="flex flex-col gap-2 border-0 p-0 sm:flex-row"
              disabled={voiding || receiptLoading}
            >
              <Button
                variant="danger"
                onClick={() => setVoidDialogOpen(true)}
                type="button"
              >
                <AlertTriangle className="size-4" aria-hidden="true" />
                Batalkan Transaksi (VOID)
              </Button>
              {canReprint ? (
                <Button
                  variant="secondary"
                  onClick={loadReceipt}
                  type="button"
                  disabled={receiptLoading}
                >
                  {receiptLoading ? (
                    <LoaderCircle
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Printer className="size-4" aria-hidden="true" />
                  )}
                  {receiptLoading ? "Memuat struk..." : "Cetak Ulang Struk"}
                </Button>
              ) : null}
            </fieldset>
          ) : null}

          {sale.status === "voided" ? (
            <p className="flex items-start gap-2 border-l-4 border-danger bg-[#fef2f2] px-4 py-3 text-sm text-danger">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              Transaksi ini sudah di-VOID. Pembatalan dan cetak ulang tidak
              tersedia.
            </p>
          ) : null}

          {batchSnapshot ? (
            <section
              className="border border-border bg-white px-4 py-4 sm:px-5"
              aria-labelledby="restored-stock-title"
            >
              <h2 id="restored-stock-title" className="font-bold text-marine">
                Stok batch terbaru
              </h2>
              <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                <SaleValue label="Batch" mono>
                  {batchSnapshot.batch.batch_code}
                </SaleValue>
                <SaleValue label="Stok tersedia" numeric>
                  {formatInteger(batchSnapshot.batch.current_stock)} ekor
                </SaleValue>
                <SaleValue label="Status batch">
                  {batchSnapshot.batch.status}
                </SaleValue>
              </dl>
            </section>
          ) : null}
          {batchError ? (
            <p className="text-sm text-slate-600" role="status">
              Status VOID sudah tersimpan. {batchError}
            </p>
          ) : null}

          {receipt ? (
            <PosReceiptPrint
              receipt={receipt}
              printButtonLabel="Cetak Ulang Struk"
              autoPrint
            />
          ) : null}
        </div>
      ) : null}

      {voidDialogOpen && sale?.status === "active" ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-marine/40 p-4">
          <section
            className="w-full max-w-lg border border-border bg-white p-5"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="void-sale-title"
            aria-describedby="void-sale-description"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-danger/10 text-danger">
                <AlertTriangle className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="void-sale-title" className="font-bold text-marine">
                  Batalkan transaksi ini?
                </h2>
                <p
                  id="void-sale-description"
                  className="mt-1 text-sm text-slate-600"
                >
                  Transaksi {sale.sale_code} akan di-VOID seluruhnya dan stok
                  batch akan dihitung ulang. Tindakan ini tidak dapat
                  dibatalkan.
                </p>
              </div>
            </div>
            {actionError ? (
              <p className="mt-4 text-sm text-danger" role="alert">
                {actionError}
              </p>
            ) : null}
            <fieldset
              className="mt-6 flex flex-col-reverse gap-2 border-0 p-0 sm:flex-row sm:justify-end"
              disabled={voiding}
            >
              <Button
                variant="secondary"
                onClick={() => setVoidDialogOpen(false)}
                type="button"
              >
                Kembali
              </Button>
              <Button
                variant="danger"
                onClick={confirmVoid}
                type="button"
                disabled={voiding}
              >
                {voiding ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                )}
                {voiding ? "Membatalkan..." : "Ya, VOID transaksi"}
              </Button>
            </fieldset>
          </section>
        </div>
      ) : null}
    </div>
  );
}
