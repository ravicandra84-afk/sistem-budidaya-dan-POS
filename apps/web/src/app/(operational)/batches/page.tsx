"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { batchListQuerySchema } from "@pfi/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusBadge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth/auth-provider";
import type { BatchItem, PaginationData } from "@/features/receiving/types";
import { SaleReadinessBadge } from "@/features/pos/v46-batch-readiness";
import { ApiClientError, apiRequest } from "@/lib/api";
import { formatBusinessDate, formatInteger, formatRupiah } from "@/lib/format";
import { generateUuidV4 } from "@/lib/uuid";

export default function BatchesPage() {
  const { session } = useAuth();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<PaginationData<BatchItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<BatchItem | null>(null);
  const [nextReadiness, setNextReadiness] = useState<
    "BELUM_SIAP" | "SIAP_JUAL"
  >("SIAP_JUAL");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const canCreate =
    session?.user.role === "Owner" ||
    session?.user.role === "Admin Operasional" ||
    session?.user.role === "Kepala Budidaya";
  const canManageReadiness =
    session?.user.role === "Owner" || session?.user.role === "Kepala Budidaya";

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setError("");
    const raw = batchListQuerySchema.safeParse({
      page: String(page),
      limit: String(limit),
      ...(status ? { status } : {}),
    });
    if (!raw.success) {
      setLoading(false);
      setError("Filter batch tidak valid.");
      return () => {
        active = false;
      };
    }
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(status ? { status } : {}),
    });
    apiRequest<PaginationData<BatchItem>>(`/batches?${params.toString()}`, {
      token: session.accessToken,
    })
      .then((response) => {
        if (active) setResult(response.data);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof ApiClientError
              ? caught.message
              : "Data batch tidak dapat dimuat.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [limit, page, reload, session, status]);

  async function openReadiness(batch: BatchItem) {
    if (!session) return;
    setActionError("");
    setNote("");
    const detail = await apiRequest<BatchItem>(
      `/batches/${encodeURIComponent(batch.batch.id)}`,
      { token: session.accessToken },
    ).catch(() => null);
    const latest = detail?.data ?? batch;
    setSelected(latest);
    setNextReadiness(
      latest.batch.sale_readiness === "SIAP_JUAL" ? "BELUM_SIAP" : "SIAP_JUAL",
    );
  }

  async function saveReadiness() {
    if (!session || !selected || saving) return;
    setSaving(true);
    setActionError("");
    try {
      await apiRequest(
        `/batches/${encodeURIComponent(selected.batch.id)}/sale-readiness`,
        {
          method: "PATCH",
          token: session.accessToken,
          headers: { "Idempotency-Key": generateUuidV4() },
          body: JSON.stringify({
            saleReadiness: nextReadiness,
            note: note.trim() || undefined,
          }),
        },
      );
      setSelected(null);
      setNote("");
      setReload((value) => value + 1);
    } catch (caught) {
      setActionError(
        caught instanceof ApiClientError
          ? caught.message
          : "Kesiapan jual belum dapat diperbarui.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Penerimaan · Batch"
        title="Daftar batch"
        description="Telusuri penerimaan ikan, stok, status batch, dan kesiapan jual."
        action={
          canCreate ? (
            <ButtonLink href="/batches/new">
              <Plus className="size-4" aria-hidden="true" />
              Penerimaan baru
            </ButtonLink>
          ) : null
        }
      />
      <section className="mb-5 flex flex-wrap items-end gap-3 border-b border-border pb-5">
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
          variant="secondary"
          type="button"
          onClick={() => setReload((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
          Muat ulang
        </Button>
      </section>
      <section className="border-y border-border bg-white">
        {loading ? <TableSkeleton /> : null}
        {!loading && error ? (
          <ErrorState
            message={error}
            onRetry={() => setReload((value) => value + 1)}
          />
        ) : null}
        {!loading && !error && result?.items.length === 0 ? (
          <EmptyState
            title="Belum ada batch"
            description="Ubah filter atau catat penerimaan baru."
          />
        ) : null}
        {!loading && !error && result && result.items.length > 0 ? (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="bg-[#edf2f6] text-xs font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Kode</th>
                    <th className="px-4 py-3">Spesies / ukuran</th>
                    <th className="px-4 py-3">Tanggal</th>
                    <th className="px-4 py-3 text-right">Stok</th>
                    <th className="px-4 py-3">Status batch</th>
                    <th className="px-4 py-3">Kesiapan jual</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Aksi</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {result.items.map((item) => (
                    <tr key={item.batch.id}>
                      <td className="px-4 py-3.5">
                        <Link
                          className="font-mono text-xs font-semibold text-marine"
                          href={`/batches/${item.batch.id}`}
                        >
                          {item.batch.batch_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-marine">
                          {item.species.species_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.incoming_fish?.fish_size ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">
                        {item.incoming_fish
                          ? formatBusinessDate(item.incoming_fish.entry_date)
                          : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold tabular-nums">
                        {formatInteger(item.batch.current_stock)} ekor
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={item.batch.status} />
                      </td>
                      <td className="px-4 py-3.5">
                        <SaleReadinessBadge value={item.batch.sale_readiness} />
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {canManageReadiness &&
                        item.batch.status === "active" ? (
                          <Button
                            variant="secondary"
                            type="button"
                            onClick={() => void openReadiness(item)}
                          >
                            Ubah
                          </Button>
                        ) : (
                          <Link
                            className="text-xs font-bold text-sky-hover"
                            href={`/batches/${item.batch.id}`}
                          >
                            Detail
                          </Link>
                        )}
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

      {selected ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-marine/35 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg border border-border bg-white p-5">
            <h2 className="font-bold text-marine">
              Ubah kesiapan jual · {selected.batch.batch_code}
            </h2>
            <div className="mt-4 grid gap-3">
              <button
                type="button"
                onClick={() => setNextReadiness("BELUM_SIAP")}
                className={`min-h-11 border px-3 text-sm font-semibold ${nextReadiness === "BELUM_SIAP" ? "border-warning bg-[#fff7ed] text-[#9a4f05]" : "border-border text-marine"}`}
              >
                Belum siap
              </button>
              <button
                type="button"
                onClick={() => setNextReadiness("SIAP_JUAL")}
                className={`min-h-11 border px-3 text-sm font-semibold ${nextReadiness === "SIAP_JUAL" ? "border-success bg-[#eff8ed] text-[#347c2c]" : "border-border text-marine"}`}
              >
                Siap jual
              </button>
              <Field
                id="readiness-note-list"
                label="Catatan lapangan"
                hint="Opsional"
              >
                <Textarea
                  id="readiness-note-list"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                />
              </Field>
            </div>
            {selected.sale_readiness_histories?.length ? (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-bold uppercase text-slate-500">
                  Riwayat terbaru
                </p>
                {selected.sale_readiness_histories
                  .slice(0, 3)
                  .map((history) => (
                    <p key={history.id} className="mt-2 text-sm text-slate-700">
                      {history.from_readiness ?? "Belum ada"} →{" "}
                      {history.to_readiness}
                      {history.note ? ` · ${history.note}` : ""}
                    </p>
                  ))}
              </div>
            ) : null}
            {actionError ? (
              <p className="mt-3 text-sm text-danger" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setSelected(null)}
              >
                Batal
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void saveReadiness()}
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
