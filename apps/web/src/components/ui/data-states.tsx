import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="animate-pulse divide-y divide-border"
      aria-label="Memuat data"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid grid-cols-4 gap-4 px-4 py-4">
          <div className="h-3 rounded bg-slate-200" />
          <div className="h-3 rounded bg-slate-200" />
          <div className="h-3 rounded bg-slate-200" />
          <div className="h-3 rounded bg-slate-200" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-label="Memuat halaman">
      <div className="h-8 w-64 rounded bg-slate-200" />
      <div className="h-20 rounded-md border border-border bg-white" />
      <div className="h-72 rounded-md border border-border bg-white" />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <Inbox
        className="mb-3 size-8 text-slate-400"
        strokeWidth={1.6}
        aria-hidden="true"
      />
      <h2 className="text-base font-semibold text-marine">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Data gagal dimuat",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <AlertCircle
        className="mb-3 size-8 text-danger"
        strokeWidth={1.6}
        aria-hidden="true"
      />
      <h2 className="text-base font-semibold text-marine">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>
      <Button className="mt-4" variant="secondary" onClick={onRetry}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Muat ulang
      </Button>
    </div>
  );
}
