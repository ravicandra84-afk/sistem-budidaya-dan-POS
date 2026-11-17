"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { BatchStatus } from "@pfi/shared";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import {
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/ui/data-states";
import { Field, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/features/auth/auth-provider";
import type { BatchItem } from "@/features/receiving/types";
import {
  formatBusinessDateTime,
  formatInteger,
  formatRupiah,
} from "@/lib/format";
import { ApiClientError, apiRequest } from "@/lib/api";

type PendingVoid = { fingerprint: string; key: string };

export default function BatchDetailPage() {
  const params = useParams<{ id: string }>();
  const batchId = params.id;
  const { session } = useAuth();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const voidAttempt = useRef<PendingVoid | null>(null);
  const [detail, setDetail] = useState<BatchItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [reason, setReason] = useState("");
  const [voidError, setVoidError] = useState("");
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    if (!session || !batchId) return;
    let active = true;
    setLoading(true);
    setError("");
    apiRequest<BatchItem>(`/batches/${encodeURIComponent(batchId)}`, {
      token: session.accessToken,
    })
      .then((response) => {
        if (active) setDetail(response.data);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof ApiClientError
              ? caught.message
              : "Detail batch tidak dapat dimuat.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [batchId, reloadKey, session]);

  const canVoid =
    (session?.user.role === "Owner" ||
      session?.user.role === "Admin Operasional") &&
    detail?.batch.status === "active" &&
    Boolean(detail.incoming_fish) &&
    !detail.incoming_fish?.voided;

  function openVoidDialog() {
    setReason("");
    setVoidError("");
    voidAttempt.current = null;
    dialogRef.current?.showModal();
  }

  function closeVoidDialog() {
    if (voiding) return;
    dialogRef.current?.close();
  }

  async function submitVoid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !detail || !canVoid || voiding) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setVoidError("Alasan VOID wajib diisi.");
      return;
    }
    const fingerprint = JSON.stringify({
      batch_id: batchId,
      reason: trimmedReason,
    });
    if (
      !voidAttempt.current ||
      voidAttempt.current.fingerprint !== fingerprint
    ) {
      voidAttempt.current = { fingerprint, key: crypto.randomUUID() };
    }

    setVoiding(true);
    setVoidError("");
    try {
      await apiRequest(`/fish-entries/${encodeURIComponent(batchId)}/void`, {
        method: "POST",
        token: session.accessToken,
        headers: { "Idempotency-Key": voidAttempt.current.key },
        body: JSON.stringify({ reason: trimmedReason }),
      });
      voidAttempt.current = null;
      dialogRef.current?.close();
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setVoidError(
        caught instanceof ApiClientError
          ? caught.message
          : "Status VOID belum dapat dipastikan. Periksa koneksi, lalu coba lagi dengan alasan yang sama.",
      );
    } finally {
      setVoiding(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    );
  if (!detail) {
    return (
      <EmptyState
        title="Batch tidak ditemukan"
        description="Data batch tidak tersedia atau sudah tidak dapat diakses."
        action={
          <Link className="font-semibold text-sky-hover" href="/batches">
            Kembali ke daftar batch
          </Link>
        }
      />
    );
  }

  const incoming = detail.incoming_fish;

  return (
    <div>
      <PageHeader
        eyebrow="Detail penerimaan"
        title={detail.batch.batch_code}
        description={`${detail.species.species_name}${incoming ? ` · ${incoming.fish_size}` : ""}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => router.push("/batches")}
              type="button"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Daftar batch
            </Button>
            {canVoid ? (
              <Button variant="danger" onClick={openVoidDialog} type="button">
                <AlertTriangle className="size-4" aria-hidden="true" />
                VOID penerimaan
              </Button>
            ) : null}
          </div>
        }
      />

      <section className="grid gap-0 border-y border-border bg-white sm:grid-cols-2 lg:grid-cols-3">
        <DetailValue label="Status batch">
          <StatusBadge status={detail.batch.status as BatchStatus} />
        </DetailValue>
        <DetailValue label="Stok saat ini">
          <span className="tabular-nums font-semibold">
            {formatInteger(detail.batch.current_stock)} ekor
          </span>
        </DetailValue>
        <DetailValue label="Kode batch">
          <span className="font-mono tabular-nums text-sm font-semibold">
            {detail.batch.batch_code}
          </span>
        </DetailValue>
        <DetailValue label="Waktu pencatatan">
          <span className="tabular-nums">
            {formatBusinessDateTime(detail.batch.created_at)}
          </span>
        </DetailValue>
      </section>

      {!incoming ? (
        <section className="mt-6 border-y border-border bg-white">
          <EmptyState
            title="Data penerimaan tidak tersedia"
            description="Batch ini belum memiliki data penerimaan yang dapat ditampilkan."
          />
        </section>
      ) : (
        <section className="mt-7">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="size-4 text-teal" aria-hidden="true" />
            <h2 className="text-base font-bold text-marine">
              Rincian penerimaan
            </h2>
          </div>
          <div className="grid gap-0 border-y border-border bg-white sm:grid-cols-2 lg:grid-cols-3">
            <DetailValue label="Tanggal masuk">
              <span className="tabular-nums">{incoming.entry_date}</span>
            </DetailValue>
            <DetailValue label="Jumlah awal">
              <span className="tabular-nums">
                {formatInteger(incoming.quantity)} ekor
              </span>
            </DetailValue>
            <DetailValue label="Ukuran ikan">{incoming.fish_size}</DetailValue>
            <DetailValue label="Modal pembelian">
              <span className="tabular-nums">
                {formatRupiah(incoming.purchase_capital)}
              </span>
            </DetailValue>
            <DetailValue label="Modal pengiriman">
              <span className="tabular-nums">
                {formatRupiah(incoming.shipping_capital)}
              </span>
            </DetailValue>
            <DetailValue label="Sampel berat / 500 ekor">
              <span className="tabular-nums">
                {incoming.weight_sample_per_500
                  ? `${incoming.weight_sample_per_500} g`
                  : "Tidak diukur"}
              </span>
            </DetailValue>
            <DetailValue label="Status penerimaan">
              {incoming.voided ? (
                <span className="font-semibold text-danger">VOID</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#347c2c]">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Tercatat
                </span>
              )}
            </DetailValue>
            <DetailValue label="Waktu dicatat">
              <span className="tabular-nums">
                {formatBusinessDateTime(incoming.created_at)}
              </span>
            </DetailValue>
          </div>
          {detail.batch.status === "active" &&
          session?.user.role === "Kepala Budidaya" ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="size-4" aria-hidden="true" />
              VOID penerimaan tidak tersedia untuk Kepala Budidaya.
            </p>
          ) : null}
        </section>
      )}

      <dialog
        ref={dialogRef}
        className="m-auto w-[min(100%-2rem,34rem)] rounded-md border border-border bg-white p-0 text-marine backdrop:bg-marine/35"
        aria-labelledby="void-title"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeVoidDialog();
        }}
      >
        <form className="p-5 sm:p-6" onSubmit={submitVoid}>
          <div className="flex items-start gap-3 border-b border-border pb-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-danger/10 text-danger">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="void-title" className="text-lg font-bold">
                VOID penerimaan
              </h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Batch{" "}
                <span className="font-mono tabular-nums font-semibold">
                  {detail.batch.batch_code}
                </span>{" "}
                akan ditandai voided. Data penerimaan asli tetap tersimpan.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <Field
              id="void-reason"
              label="Alasan VOID"
              required
              hint="Alasan dicatat pada riwayat operasional."
            >
              <Textarea
                id="void-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={2000}
                required
              />
            </Field>
          </div>
          {voidError ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {voidError}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={closeVoidDialog} type="button">
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={voiding || !reason.trim()}
              type="submit"
            >
              {voiding ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle className="size-4" aria-hidden="true" />
              )}
              {voiding ? "Memproses…" : "Konfirmasi VOID"}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function DetailValue({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border-b border-border px-4 py-4 last:border-b-0 sm:even:border-l lg:nth-[3n+2]:border-l lg:nth-[3n]:border-l">
      <p className="text-[11px] font-bold uppercase text-slate-500">{label}</p>
      <div className="mt-1.5 break-words text-sm text-marine">{children}</div>
    </div>
  );
}
