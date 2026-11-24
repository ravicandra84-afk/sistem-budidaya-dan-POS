"use client";

import { CalendarDays, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageSkeleton,
  TableSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { useAuth } from "@/features/auth/auth-provider";
import type { PaginationData } from "@/features/receiving/types";
import { ApiClientError, apiRequest } from "@/lib/api";
import {
  formatBusinessDateTime,
  formatInteger,
  formatPosRupiah,
  inputDateRange,
} from "@/lib/format";

interface PosSale {
  id: string;
  sale_code: string;
  created_at: string;
  batch_id: string | null;
  batch_code: string | null;
  species_name: string;
  fish_size: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_method: "cash" | "transfer";
  created_by: { id: string; name: string };
  status: "active" | "voided";
}

const allowedRoles = ["Owner", "Admin Operasional", "Kasir"] as const;

function displayError(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "Riwayat penjualan tidak dapat dimuat. Coba kembali.";
}

function SaleStatusBadge({ status }: { status: PosSale["status"] }) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${
        active
          ? "border-teal/30 bg-teal/10 text-[#087a75]"
          : "border-danger/25 bg-danger/10 text-danger"
      }`}
    >
      {active ? "Aktif" : "VOID"}
    </span>
  );
}

export default function PosSalesPage() {
  const { ready, session } = useAuth();
  const router = useRouter();
  const canAccess =
    session !== null &&
    allowedRoles.includes(session.user.role as (typeof allowedRoles)[number]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [statusInput, setStatusInput] = useState("");
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    status: "",
    startDate: "",
    endDate: "",
  });
  const [filterError, setFilterError] = useState("");
  const [result, setResult] = useState<PaginationData<PosSale> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (ready && session && !canAccess) router.replace("/batches");
  }, [canAccess, ready, router, session]);

  useEffect(() => {
    if (!session || !canAccess) return;
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (appliedFilters.status) query.set("status", appliedFilters.status);
    if (appliedFilters.startDate) {
      query.set("startDate", inputDateRange(appliedFilters.startDate));
    }
    if (appliedFilters.endDate) {
      query.set("endDate", inputDateRange(appliedFilters.endDate, true));
    }

    apiRequest<PaginationData<PosSale>>(`/pos/sales?${query.toString()}`, {
      token: session.accessToken,
    })
      .then((response) => {
        if (active) setResult(response.data);
      })
      .catch((caught: unknown) => {
        if (active) setError(displayError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [appliedFilters, canAccess, limit, page, reloadKey, session]);

  if (!ready || !session || !canAccess) return <PageSkeleton />;

  function applyFilters() {
    if (startDateInput && endDateInput && startDateInput > endDateInput) {
      setFilterError("Tanggal akhir tidak boleh sebelum tanggal awal.");
      return;
    }
    setFilterError("");
    setAppliedFilters({
      status: statusInput,
      startDate: startDateInput,
      endDate: endDateInput,
    });
    setPage(1);
  }

  function resetFilters() {
    setStatusInput("");
    setStartDateInput("");
    setEndDateInput("");
    setFilterError("");
    setAppliedFilters({ status: "", startDate: "", endDate: "" });
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Penjualan · Riwayat"
        title="Riwayat penjualan"
        description="Telusuri transaksi terbaru beserta snapshot harga, pembayaran, pembuat, dan statusnya."
      />

      <form
        className="mb-5 grid gap-3 border-b border-border pb-5 sm:grid-cols-2 xl:grid-cols-[minmax(150px,0.7fr)_minmax(180px,1fr)_minmax(180px,1fr)_auto_auto] xl:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
      >
        <Field id="sales-status" label="Status transaksi">
          <Select
            id="sales-status"
            value={statusInput}
            onChange={(event) => setStatusInput(event.target.value)}
          >
            <option value="">Semua status</option>
            <option value="active">Aktif</option>
            <option value="voided">VOID</option>
          </Select>
        </Field>
        <Field id="sales-start-date" label="Dari tanggal">
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="sales-start-date"
              className="pl-9 tabular-nums"
              type="date"
              value={startDateInput}
              onChange={(event) => setStartDateInput(event.target.value)}
            />
          </div>
        </Field>
        <Field id="sales-end-date" label="Sampai tanggal">
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="sales-end-date"
              className="pl-9 tabular-nums"
              type="date"
              value={endDateInput}
              onChange={(event) => setEndDateInput(event.target.value)}
            />
          </div>
        </Field>
        <Button className="w-full sm:w-fit" type="submit">
          Terapkan filter
        </Button>
        <Button
          className="w-full sm:w-fit"
          variant="secondary"
          onClick={resetFilters}
          type="button"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset filter
        </Button>
      </form>
      {filterError ? (
        <p className="mb-4 text-sm text-danger" role="alert">
          {filterError}
        </p>
      ) : null}

      <section
        aria-label="Hasil penjualan"
        className="min-w-0 border-y border-border bg-white"
      >
        {loading ? <TableSkeleton rows={5} /> : null}
        {!loading && error ? (
          <ErrorState
            message={error}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : null}
        {!loading && !error && result?.items.length === 0 ? (
          <EmptyState
            title="Belum ada transaksi"
            description="Transaksi yang cocok dengan filter ini akan muncul di sini."
          />
        ) : null}
        {!loading && !error && result && result.items.length > 0 ? (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="hidden w-full min-w-[1350px] border-collapse text-left text-sm lg:table">
                <thead className="sticky top-0 z-10 bg-[#edf2f6] text-xs font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-3">Nomor penjualan</th>
                    <th className="px-3 py-3">Waktu transaksi (WIB)</th>
                    <th className="px-3 py-3">Batch</th>
                    <th className="px-3 py-3">Spesies / ukuran</th>
                    <th className="px-3 py-3 text-right">Jumlah</th>
                    <th className="px-3 py-3 text-right">Harga satuan</th>
                    <th className="px-3 py-3 text-right">Total</th>
                    <th className="px-3 py-3">Pembayaran</th>
                    <th className="px-3 py-3">Pembuat</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">
                      <span className="sr-only">Detail</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((sale, index) => (
                    <tr
                      key={sale.id}
                      className={index % 2 ? "bg-[#fbfcfd]" : "bg-white"}
                    >
                      <td className="px-3 py-3.5">
                        <span className="font-mono text-xs font-semibold tabular-nums text-marine">
                          {sale.sale_code}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 tabular-nums text-slate-700">
                        {formatBusinessDateTime(sale.created_at)}
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="font-mono text-xs tabular-nums text-slate-700">
                          {sale.batch_code}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <p className="font-semibold text-marine">
                          {sale.species_name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {sale.fish_size ?? "—"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums font-semibold">
                        {formatInteger(sale.quantity)} ekor
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums text-slate-700">
                        {formatPosRupiah(sale.unit_price)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums font-bold text-marine">
                        {formatPosRupiah(sale.total_amount)}
                      </td>
                      <td className="px-3 py-3.5">
                        {sale.payment_method === "cash" ? "Tunai" : "Transfer"}
                      </td>
                      <td className="max-w-40 truncate px-3 py-3.5 text-slate-700">
                        {sale.created_by.name}
                      </td>
                      <td className="px-3 py-3.5">
                        <SaleStatusBadge status={sale.status} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right">
                        <Link
                          className="text-xs font-bold text-sky-hover hover:underline"
                          href={`/pos/sales/${encodeURIComponent(sale.id)}`}
                        >
                          Lihat Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="divide-y divide-border lg:hidden">
              {result.items.map((sale) => (
                <li key={sale.id} className="min-w-0 px-4 py-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-semibold tabular-nums text-marine">
                        {sale.sale_code}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-marine">
                        {sale.species_name} / {sale.fish_size ?? "—"}
                      </p>
                    </div>
                    <SaleStatusBadge status={sale.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                    <SaleValue label="Waktu transaksi (WIB)" numeric>
                      {formatBusinessDateTime(sale.created_at)}
                    </SaleValue>
                    <SaleValue label="Batch" mono>
                      {sale.batch_code}
                    </SaleValue>
                    <SaleValue label="Jumlah" numeric>
                      {formatInteger(sale.quantity)} ekor
                    </SaleValue>
                    <SaleValue label="Metode pembayaran">
                      {sale.payment_method === "cash" ? "Tunai" : "Transfer"}
                    </SaleValue>
                    <SaleValue label="Harga satuan" numeric>
                      {formatPosRupiah(sale.unit_price)}
                    </SaleValue>
                    <SaleValue label="Pembuat">
                      {sale.created_by.name}
                    </SaleValue>
                    <SaleValue label="Total transaksi" numeric>
                      {formatPosRupiah(sale.total_amount)}
                    </SaleValue>
                    <div className="col-span-2 flex justify-end pt-1">
                      <Link
                        className="inline-flex min-h-11 items-center font-bold text-sky-hover"
                        href={`/pos/sales/${encodeURIComponent(sale.id)}`}
                      >
                        Lihat Detail
                      </Link>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            <PaginationControls
              page={result.pagination.page}
              limit={result.pagination.limit}
              totalItems={result.pagination.totalItems}
              totalPages={result.pagination.totalPages}
              onPageChange={setPage}
              onLimitChange={(value) => {
                setLimit(value);
                setPage(1);
              }}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}

function SaleValue({
  label,
  children,
  numeric = false,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  numeric?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-words text-slate-700 ${numeric ? "tabular-nums" : ""} ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {children}
      </dd>
    </div>
  );
}
