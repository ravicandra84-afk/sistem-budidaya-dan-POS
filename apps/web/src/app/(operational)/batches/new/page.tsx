"use client";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  Save,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { FISH_SIZES, receiveFishSchema } from "@pfi/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  PageSkeleton,
} from "@/components/ui/data-states";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/features/auth/auth-provider";
import type { SpeciesItem } from "@/features/receiving/types";
import { todayJakarta } from "@/lib/format";
import { ApiClientError, apiRequest } from "@/lib/api";

type FormValues = {
  species_id: string;
  entry_date: string;
  quantity: string;
  purchase_capital: string;
  shipping_capital: string;
  weight_sample_per_500: string;
  fish_size: string;
};

const initialForm: FormValues = {
  species_id: "",
  entry_date: todayJakarta(),
  quantity: "",
  purchase_capital: "",
  shipping_capital: "",
  weight_sample_per_500: "",
  fish_size: "",
};

type PendingAttempt = { fingerprint: string; key: string };

function normalizeDecimalInput(value: string): string {
  return value.trim().replace(",", ".");
}

export default function NewReceivingPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [values, setValues] = useState(initialForm);
  const [species, setSpecies] = useState<SpeciesItem[]>([]);
  const [speciesLoading, setSpeciesLoading] = useState(true);
  const [speciesError, setSpeciesError] = useState("");
  const [speciesReload, setSpeciesReload] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successCode, setSuccessCode] = useState("");
  const attempt = useRef<PendingAttempt | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setSpeciesLoading(true);
    setSpeciesError("");
    apiRequest<SpeciesItem[]>("/fish-species", { token: session.accessToken })
      .then((response) => {
        if (active) setSpecies(response.data);
      })
      .catch((error: unknown) => {
        if (active) {
          setSpeciesError(
            error instanceof ApiClientError
              ? error.message
              : "Daftar spesies tidak dapat dimuat.",
          );
        }
      })
      .finally(() => {
        if (active) setSpeciesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, speciesReload]);

  const canCreate =
    session?.user.role === "Owner" ||
    session?.user.role === "Admin Operasional" ||
    session?.user.role === "Kepala Budidaya";

  function update(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || submitting || !canCreate) return;
    setSubmitError("");
    setSuccessCode("");

    const parsed = receiveFishSchema.safeParse({
      species_id: values.species_id,
      entry_date: values.entry_date,
      quantity: Number(values.quantity),
      purchase_capital: normalizeDecimalInput(values.purchase_capital),
      shipping_capital: normalizeDecimalInput(values.shipping_capital),
      weight_sample_per_500: values.weight_sample_per_500
        ? normalizeDecimalInput(values.weight_sample_per_500)
        : undefined,
      fish_size: values.fish_size,
    });

    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!nextErrors[key]) nextErrors[key] = issue.message;
      }
      setFieldErrors(nextErrors);
      setSubmitError("Periksa kembali isian yang ditandai.");
      return;
    }

    const fingerprint = JSON.stringify(parsed.data);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }

    setSubmitting(true);
    try {
      const response = await apiRequest<{
        batch: { id: string; batch_code: string; status: string };
        incoming_fish: { id: string };
      }>("/fish-entries", {
        method: "POST",
        token: session.accessToken,
        headers: { "Idempotency-Key": attempt.current.key },
        body: JSON.stringify(parsed.data),
      });
      attempt.current = null;
      setSuccessCode(response.data.batch.batch_code);
      router.push(`/batches/${response.data.batch.id}`);
    } catch (error) {
      setSubmitError(
        error instanceof ApiClientError
          ? error.message
          : "Penerimaan belum dapat dipastikan tersimpan. Periksa koneksi, lalu coba lagi dengan isian yang sama.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!canCreate) {
    return (
      <div>
        <PageHeader
          eyebrow="Penerimaan"
          title="Akses tidak tersedia"
          description="Role Anda tidak dapat mencatat penerimaan ikan."
        />
        <Link
          className="text-sm font-bold text-sky-hover hover:underline"
          href="/batches"
        >
          Kembali ke daftar batch
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Penerimaan · Batch"
        title="Penerimaan ikan baru"
        description="Satu transaksi penerimaan membentuk satu batch baru. Data yang tersimpan tidak dapat diedit."
        action={
          <ButtonLink href="/batches" variant="secondary">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Kembali
          </ButtonLink>
        }
      />

      {speciesLoading ? (
        <PageSkeleton />
      ) : speciesError ? (
        <section className="border-y border-border bg-white">
          <ErrorState
            message={speciesError}
            onRetry={() => setSpeciesReload((value) => value + 1)}
          />
        </section>
      ) : species.length === 0 ? (
        <section className="border-y border-border bg-white">
          <EmptyState
            title="Belum ada spesies aktif"
            description="Hubungi pengelola sistem untuk memeriksa master spesies."
          />
        </section>
      ) : (
        <form className="max-w-4xl" onSubmit={handleSubmit} noValidate>
          <section className="grid gap-x-6 gap-y-5 border-y border-border bg-white p-4 sm:grid-cols-2 sm:p-6">
            <Field id="receiving-species" label="Spesies ikan" required>
              <Select
                id="receiving-species"
                value={values.species_id}
                onChange={(event) => update("species_id", event.target.value)}
                aria-invalid={Boolean(fieldErrors.species_id)}
              >
                <option value="">Pilih spesies</option>
                {species.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.species_name}
                  </option>
                ))}
              </Select>
              {fieldErrors.species_id ? (
                <p className="text-xs text-danger">{fieldErrors.species_id}</p>
              ) : null}
            </Field>
            <Field id="receiving-size" label="Ukuran ikan" required>
              <Select
                id="receiving-size"
                value={values.fish_size}
                onChange={(event) => update("fish_size", event.target.value)}
                aria-invalid={Boolean(fieldErrors.fish_size)}
              >
                <option value="">Pilih ukuran</option>
                {FISH_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
              {fieldErrors.fish_size ? (
                <p className="text-xs text-danger">{fieldErrors.fish_size}</p>
              ) : null}
            </Field>
            <Field
              id="receiving-date"
              label="Tanggal penerimaan"
              required
              hint="Mengikuti tanggal bisnis Asia/Jakarta."
            >
              <Input
                id="receiving-date"
                className="tabular-nums"
                type="date"
                max={todayJakarta()}
                value={values.entry_date}
                onChange={(event) => update("entry_date", event.target.value)}
                aria-invalid={Boolean(fieldErrors.entry_date)}
              />
              {fieldErrors.entry_date ? (
                <p className="text-xs text-danger">{fieldErrors.entry_date}</p>
              ) : null}
            </Field>
            <Field
              id="receiving-quantity"
              label="Jumlah ikan (ekor)"
              required
              hint="1–1.000.000 ekor."
            >
              <Input
                id="receiving-quantity"
                className="tabular-nums"
                type="number"
                inputMode="numeric"
                min={1}
                max={1_000_000}
                step={1}
                value={values.quantity}
                onChange={(event) => update("quantity", event.target.value)}
                aria-invalid={Boolean(fieldErrors.quantity)}
                placeholder="Contoh: 5000"
              />
              {fieldErrors.quantity ? (
                <p className="text-xs text-danger">{fieldErrors.quantity}</p>
              ) : null}
            </Field>
            <Field
              id="receiving-purchase-capital"
              label="Modal pembelian (Rp)"
              required
              hint="0,00–9.999.999.999,00. Tidak diisi otomatis."
            >
              <Input
                id="receiving-purchase-capital"
                className="tabular-nums"
                inputMode="decimal"
                value={values.purchase_capital}
                onChange={(event) =>
                  update("purchase_capital", event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.purchase_capital)}
                placeholder="0,00"
              />
              {fieldErrors.purchase_capital ? (
                <p className="text-xs text-danger">
                  {fieldErrors.purchase_capital}
                </p>
              ) : null}
            </Field>
            <Field
              id="receiving-shipping-capital"
              label="Modal pengiriman (Rp)"
              required
              hint="0,00–9.999.999.999,00. Tidak diisi otomatis."
            >
              <Input
                id="receiving-shipping-capital"
                className="tabular-nums"
                inputMode="decimal"
                value={values.shipping_capital}
                onChange={(event) =>
                  update("shipping_capital", event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.shipping_capital)}
                placeholder="0,00"
              />
              {fieldErrors.shipping_capital ? (
                <p className="text-xs text-danger">
                  {fieldErrors.shipping_capital}
                </p>
              ) : null}
            </Field>
            <Field
              id="receiving-weight-sample"
              label="Sampel berat per 500 ekor (gram)"
              hint="Opsional · 0,01–100.000,00 gram."
            >
              <Input
                id="receiving-weight-sample"
                className="tabular-nums"
                inputMode="decimal"
                value={values.weight_sample_per_500}
                onChange={(event) =>
                  update("weight_sample_per_500", event.target.value)
                }
                aria-invalid={Boolean(fieldErrors.weight_sample_per_500)}
                placeholder="Kosongkan bila tidak diukur"
              />
              {fieldErrors.weight_sample_per_500 ? (
                <p className="text-xs text-danger">
                  {fieldErrors.weight_sample_per_500}
                </p>
              ) : null}
            </Field>
          </section>

          {submitError ? (
            <p
              className="mt-4 flex items-start gap-2 rounded-md border border-danger/25 bg-danger/5 px-3 py-3 text-sm text-danger"
              role="alert"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              {submitError}
            </p>
          ) : null}
          {successCode ? (
            <p
              className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#347c2c]"
              role="status"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Batch {successCode} tersimpan.
            </p>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <ButtonLink
              className="w-full sm:w-auto"
              href="/batches"
              variant="secondary"
            >
              Batal
            </ButtonLink>
            <Button
              className="w-full sm:w-auto"
              disabled={submitting}
              type="submit"
            >
              {submitting ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {submitting ? "Menyimpan…" : "Simpan penerimaan"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
