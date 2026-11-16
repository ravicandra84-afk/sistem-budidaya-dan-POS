"use client";

import { CalendarDays, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { paginationQuerySchema } from "@pfi/shared";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/ui/data-states";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { useAuth } from "@/features/auth/auth-provider";
import type { AuditEntry, PaginationData } from "@/features/receiving/types";
import { formatBusinessDateTime, inputDateRange } from "@/lib/format";
import { ApiClientError, apiRequest } from "@/lib/api";

const actionLabels: Record<string, string> = {
  CREATE_ENTRY: "Penerimaan dicatat",
  VOID_ENTRY: "Penerimaan di-VOID",
};

function displayError(error: unknown): string {
  return error instanceof ApiClientError
    ? error.message
    : "Riwayat audit tidak dapat dimuat. Coba kembali.";
}

export default function AuditPage() {
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<PaginationData<AuditEntry> | null>(null);
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
    };
    const parsedQuery = paginationQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      setLoading(false);
      setError(
        "Rentang tanggal tidak valid. Periksa kembali tanggal awal dan akhir.",
      );
      return () => {
        active = false;
      };
    }

    apiRequest<PaginationData<AuditEntry>>(
      `/audit-logs?${new URLSearchParams(rawQuery)}`,
      {
        token: session.accessToken,
      },
    )
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
  }, [session, page, limit, startDate, endDate, reloadKey]);

  function resetFilters() {
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Riwayat sistem"
        title="Audit operasional"
        description="Catatan tindakan penerimaan dan batch. Riwayat tidak dapat diubah dari aplikasi."
      />

      <section className="mb-5 grid gap-3 border-b border-border pb-5 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] xl:items-end">
        <Field id="audit-start-date" label="Dari tanggal">
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="audit-start-date"
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
        <Field id="audit-end-date" label="Sampai tanggal">
          <div className="relative">
            <CalendarDays
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="audit-end-date"
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
        <Button
          className="w-full sm:w-fit"
          variant="secondary"
          onClick={resetFilters}
          type="button"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset tanggal
        </Button>
      </section>

      <section
        aria-label="Riwayat audit"
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
            title="Belum ada riwayat pada rentang ini"
            description="Ubah tanggal atau hapus filter untuk melihat catatan lainnya."
          />
        ) : null}
        {!loading && !error && result && result.items.length > 0 ? (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[#edf2f6] text-xs font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Waktu</th>
                    <th className="px-4 py-3">Pelaku</th>
                    <th className="px-4 py-3">Tindakan</th>
                    <th className="px-4 py-3">Objek</th>
                    <th className="px-4 py-3">Alasan</th>
                    <th className="px-4 py-3">Request ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((entry, index) => (
                    <tr
                      key={entry.id}
                      className={index % 2 ? "bg-[#fbfcfd]" : "bg-white"}
                    >
                      <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-xs text-slate-700">
                        {formatBusinessDateTime(entry.created_at)}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-marine">
                          {entry.actor.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
                          {entry.actor.id}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-marine">
                          {actionLabels[entry.action] ?? entry.action}
                        </span>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          {entry.action}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-slate-700">{entry.entity_type}</p>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
                          {entry.entity_id}
                        </p>
                      </td>
                      <td className="max-w-xs px-4 py-3.5 text-slate-700">
                        {entry.reason ?? "—"}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs tabular-nums text-slate-500">
                        {entry.request_id}
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
