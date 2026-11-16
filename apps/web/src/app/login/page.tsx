"use client";

import { Eye, EyeOff, Fish, LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PageSkeleton } from "@/components/ui/data-states";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiClientError } from "@/lib/api";

export default function LoginPage() {
  const { ready, session, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (ready && session) router.replace("/batches");
  }, [ready, router, session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signIn(email, password);
      router.replace("/batches");
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Login gagal. Periksa koneksi lalu coba kembali.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready || session) {
    return (
      <div className="min-h-screen bg-canvas p-6 lg:p-12">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_480px]">
      <section className="relative hidden overflow-hidden bg-marine px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div
          className="absolute inset-y-0 right-0 w-20 border-l border-white/10"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-md border border-white/20 bg-white/10">
            <Fish className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="font-bold">Pisciculture Farm Indonesia</p>
            <p className="text-xs text-white/65">Sistem operasional internal</p>
          </div>
        </div>
        <div className="relative max-w-xl pb-16">
          <p className="text-xs font-bold uppercase text-white/60">
            Akses operasional
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight">
            Penerimaan dan pengelolaan batch
          </h1>
        </div>
        <p className="relative text-xs text-white/55">Asia/Jakarta · PFI</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[390px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-md bg-marine text-white">
              <Fish className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold text-marine">Pisciculture Farm</p>
              <p className="text-xs text-slate-500">Sistem operasional</p>
            </div>
          </div>
          <div className="mb-7 border-b border-border pb-5">
            <p className="text-xs font-bold uppercase text-slate-500">
              Masuk ke sistem
            </p>
            <h2 className="mt-2 text-2xl font-bold text-marine">Login</h2>
            <p className="mt-1 text-sm text-slate-500">
              Gunakan akun operasional PFI.
            </p>
          </div>

          <form className="grid gap-5" onSubmit={handleSubmit}>
            <Field id="login-email" label="Email" required>
              <Input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nama@pfi.id"
                required
                maxLength={255}
              />
            </Field>
            <Field id="login-password" label="Kata sandi" required>
              <div className="relative">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pr-12"
                  placeholder="Masukkan kata sandi"
                  required
                  maxLength={72}
                />
                <button
                  className="absolute inset-y-0 right-0 grid min-h-11 w-11 place-items-center text-slate-500 hover:text-marine"
                  type="button"
                  aria-label={
                    showPassword
                      ? "Sembunyikan kata sandi"
                      : "Tampilkan kata sandi"
                  }
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </Field>

            {error ? (
              <p
                className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2.5 text-sm text-danger"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <Button className="w-full" disabled={submitting} type="submit">
              {submitting ? (
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <LockKeyhole className="size-4" aria-hidden="true" />
              )}
              {submitting ? "Memverifikasi…" : "Masuk"}
            </Button>
          </form>
          <p className="mt-7 border-t border-border pt-4 text-xs leading-5 text-slate-500">
            Akses hanya untuk pengguna yang telah didaftarkan oleh pengelola
            sistem.
          </p>
        </div>
      </section>
    </main>
  );
}
