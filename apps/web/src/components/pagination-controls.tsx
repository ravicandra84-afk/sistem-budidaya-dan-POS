"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PaginationControls({
  page,
  limit,
  totalItems,
  totalPages,
  onPageChange,
  onLimitChange,
}: {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  onPageChange(page: number): void;
  onLimitChange(limit: number): void;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span className="tabular-nums">
          {start}–{end} dari {totalItems}
        </span>
        <label className="flex items-center gap-2">
          <span>Baris</span>
          <select
            className="min-h-9 rounded-md border border-border bg-white px-2 tabular-nums text-xs"
            value={limit}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            aria-label="Jumlah baris per halaman"
          >
            {[10, 20, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <span className="mr-1 text-xs text-slate-600">
          Halaman <span className="tabular-nums">{page}</span> dari{" "}
          <span className="tabular-nums">{Math.max(totalPages, 1)}</span>
        </span>
        <Button
          className="size-10 min-h-10 px-0"
          variant="secondary"
          aria-label="Halaman sebelumnya"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <Button
          className="size-10 min-h-10 px-0"
          variant="secondary"
          aria-label="Halaman berikutnya"
          disabled={totalPages === 0 || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
