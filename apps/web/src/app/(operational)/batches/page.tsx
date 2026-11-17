"use client";

import { CalendarDays, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { batchListQuerySchema } from "@pfi/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { useAuth } from "@/features/auth/auth-provider";
import type { BatchItem, PaginationData } from "@/features/receiving/types";
import {
  formatBusinessDate,
  formatInteger,
  formatRupiah,
  inputDateRange,
} from "@/lib/format";
import { ApiClientError, apiRequest } from "@/lib/api";

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "Data batch tidak dapat dimuat. Coba kembali.";
}

export default function BatchesPage() {
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<PaginationData<BatchItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setError("");

    const rawQuery = {
      page: String(page),
      limit: String(limit),
      ...(startDate ? { startDate: inputDateRange(startDate) } : {}),
      ...(endDate ? { endDate: inputDateRange(endDate, true) } : {}),
      ...(status ? { status } : {}),
    };
    const parsedQuery = batchListQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      setLoading(false);
      setError(
        "Rentang tanggal tidak valid. Periksa kembali tanggal awal dan akhir.",
      );
      return () => {
        active = false;
      };
    }

    const params = new URLSearchParams(rawQuery);
    apiRequest<PaginationData<BatchItem>>(`/batches?${params.toString()}`, {
      token: session.accessToken,
    })
      .then((response) => {
        if (active) setResult(response.data);
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [session, page, limit, startDate, endDate, status, reloadKey]);

  const canCreate =
    session?.user.role === "Owner" ||
    session?.user.role === "Admin Operasional" ||
    session?.user.role === "Kepala Budidaya";

  function resetFilters() {
    setStartDate("");
    setEndDate("");
    setStatus("");
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Penerimaan · Batch"
        title="Daftar batch"
        description="Telusuri penerimaan ikan, ukuran, jumlah awal, dan status batch."
        action={
          canCreate ? (
            <ButtonLink href="/batches/new">
              <Plus className="size-4" aria-hidden="true" />
              Penerimaan baru
            </ButtonLink>
          ) : null
        }
      />

      <section className="mb-5 grid gap-3 border-b border-border pb-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_190px_auto] xl:items-end">
        <Field id="batch-start-date" label="Dari tanggal">
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="batch-start-date"
              className="pl-9 tabular-nums"
              type="date"
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </Field>
        <Field id="batch-end-date" label="Sampai tanggal">
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="batch-end-date"
              className="pl-9 tabular-nums"
              type="date"
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </Field>
        <Field id="batch-status" label="Status batch">
          <Select
            id="batch-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua status</option>
            <option value="active">Aktif</option>
            <option value="completed">Selesai</option>
            <option value="voided">VOID</option>
          </Select>
        </Field>
        <Button
          className="w-full sm:w-fit"
          variant="secondary"
          onClick={resetFilters}
          type="button"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset filter
        </Button>
      </section>

      <section
        aria-label="Hasil batch"
        className="min-w-0 border-y border-border bg-white"
      >
        {loading ? <TableSkeleton /> : null}
        {!loading && error ? (
          <ErrorState
            message={error}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : null}
        {!loading && !error && result?.items.length === 0 ? (
          <EmptyState
            title="Belum ada batch untuk filter ini"
            description="Ubah rentang tanggal atau status. Penerimaan yang baru dicatat akan muncul di daftar ini."
            action={
              canCreate ? (
                <ButtonLink href="/batches/new">
                  <Plus className="size-4" aria-hidden="true" />
                  Catat penerimaan
                </ButtonLink>
              ) : null
            }
          />
        ) : null}
        {!loading && !error && result && result.items.length > 0 ? (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[1060px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[#edf2f6] text-xs font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Kode batch</th>
                    <th className="px-4 py-3">Spesies / ukuran</th>
                    <th className="px-4 py-3">Tanggal masuk</th>
                    <th className="px-4 py-3 text-right">Jumlah awal</th>
                    <th className="px-4 py-3 text-right">Stok saat ini</th>
                    <th className="px-4 py-3 text-right">Modal beli</th>
                    <th className="px-4 py-3 text-right">Ongkos kirim</th>
                    <th className="px-4 py-3 text-right">Berat / 500</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Detail</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((item, index) => (
                    <tr
                      key={item.batch.id}
                      className={index % 2 ? "bg-[#fbfcfd]" : "bg-white"}
                    >
                      <td className="px-4 py-3.5">
                        <Link
                          className="font-mono text-xs font-semibold tabular-nums text-marine hover:text-sky-hover"
                          href={`/batches/${item.batch.id}`}
                        >
                          {item.batch.batch_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-marine">
                          {item.species.species_name}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {item.incoming_fish?.fish_size ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-slate-700">
                        {item.incoming_fish
                          ? formatBusinessDate(item.incoming_fish.entry_date)
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums font-semibold">
                        {item.incoming_fish
                          ? `${formatInteger(item.incoming_fish.quantity)} ekor`
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums font-semibold">
                        {formatInteger(item.batch.current_stock)} ekor
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
                        {item.incoming_fish
                          ? formatRupiah(item.incoming_fish.purchase_capital)
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
                        {item.incoming_fish
                          ? formatRupiah(item.incoming_fish.shipping_capital)
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
                        {item.incoming_fish?.weight_sample_per_500
                          ? `${item.incoming_fish.weight_sample_per_500} g`
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={item.batch.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          className="text-xs font-bold text-sky-hover hover:underline"
                          href={`/batches/${item.batch.id}`}
                        >
                          Buka detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
