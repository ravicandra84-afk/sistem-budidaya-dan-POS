import type { BatchStatus } from "@pfi/shared";

const statusClass: Record<BatchStatus, string> = {
  active: "border-teal/30 bg-teal/10 text-[#087a75]",
  completed: "border-success/30 bg-success/10 text-[#347c2c]",
  voided: "border-danger/25 bg-danger/10 text-danger",
};

const statusLabel: Record<BatchStatus, string> = {
  active: "Aktif",
  completed: "Selesai",
  voided: "VOID",
};

export function StatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${statusClass[status]}`}
    >
      {statusLabel[status]}
    </span>
  );
}
