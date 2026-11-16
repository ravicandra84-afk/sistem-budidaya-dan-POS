"use client";

import { Fish, LogOut, Plus, ScrollText } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { UserRole } from "@pfi/shared";
import { PageSkeleton } from "@/components/ui/data-states";
import { useAuth } from "@/features/auth/auth-provider";

const roleLabel: Record<UserRole, string> = {
  Owner: "Owner",
  "Admin Operasional": "Admin Operasional",
  "Kepala Budidaya": "Kepala Budidaya",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { ready, session, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  useEffect(() => {
    function handleUnauthorized() {
      signOut();
      router.replace("/login");
    }
    window.addEventListener("pfi:unauthorized", handleUnauthorized);
    return () =>
      window.removeEventListener("pfi:unauthorized", handleUnauthorized);
  }, [router, signOut]);

  if (!ready || !session) {
    return (
      <div className="min-h-screen bg-canvas p-6 lg:p-10">
        <PageSkeleton />
      </div>
    );
  }

  const navigation = [
    { href: "/batches", label: "Batch & penerimaan", Icon: Fish },
    ...(session.user.role === "Admin Operasional" ||
    session.user.role === "Kepala Budidaya"
      ? [{ href: "/batches/new", label: "Penerimaan baru", Icon: Plus }]
      : []),
    { href: "/audit", label: "Audit operasional", Icon: ScrollText },
  ];

  function isActive(href: string) {
    return href === "/batches"
      ? pathname === "/batches" || /^\/batches\/[^/]+$/.test(pathname)
      : pathname === href || pathname.startsWith(`${href}/`);
  }

  function handleSignOut() {
    signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-canvas text-marine">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-white lg:flex">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <span className="grid size-9 place-items-center rounded-md bg-marine text-white">
            <Fish className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-marine">
              Pisciculture Farm
            </p>
            <p className="text-xs text-slate-500">Operasional Indonesia</p>
          </div>
        </div>
        <nav className="grid gap-1 px-3 py-5" aria-label="Navigasi utama">
          {navigation.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors ${
                isActive(href)
                  ? "bg-marine text-white"
                  : "text-slate-600 hover:bg-canvas hover:text-marine"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-border p-4">
          <p className="truncate text-sm font-semibold">{session.user.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {roleLabel[session.user.role]}
          </p>
          <button
            className="mt-4 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-sm font-semibold text-slate-600 hover:bg-canvas hover:text-danger"
            onClick={handleSignOut}
            type="button"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Keluar
          </button>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border bg-white">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 lg:hidden">
              <span className="grid size-9 place-items-center rounded-md bg-marine text-white">
                <Fish className="size-5" aria-hidden="true" />
              </span>
              <span className="truncate text-sm font-bold">
                Operasional PFI
              </span>
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Sistem operasional
              </p>
              <p className="text-sm font-semibold text-marine">
                Penerimaan dan pengelolaan batch
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="max-w-48 truncate text-sm font-semibold">
                  {session.user.name}
                </p>
                <p className="text-xs text-slate-500">
                  {roleLabel[session.user.role]}
                </p>
              </div>
              <button
                className="grid size-11 place-items-center rounded-md border border-border text-slate-600 hover:bg-canvas hover:text-danger lg:hidden"
                onClick={handleSignOut}
                title="Keluar"
                aria-label="Keluar"
                type="button"
              >
                <LogOut className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden"
            aria-label="Navigasi utama"
          >
            {navigation.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-semibold ${
                  isActive(href)
                    ? "bg-marine text-white"
                    : "text-slate-600 hover:bg-canvas"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
