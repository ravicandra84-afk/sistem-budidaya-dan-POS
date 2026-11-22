import type { PosReceiptData } from "@/components/pos-receipt-print";
import { formatInteger, formatPosRupiah } from "./format";

export type ReceiptPaperWidth = "58" | "80";

const ESC = "\x1b";
const LINE_FEED = "\n";
const COLUMN_WIDTHS: Record<ReceiptPaperWidth, number> = {
  "58": 32,
  "80": 48,
};

export function buildEscPosReceiptBytes(
  receipt: PosReceiptData,
  paperWidth: ReceiptPaperWidth,
): Uint8Array {
  const width = COLUMN_WIDTHS[paperWidth];
  const parts: string[] = [`${ESC}@`, `${ESC}a\x01`, `${ESC}E\x01`];

  appendLines(parts, wrapText(toPrinterAscii(receipt.company_name), width));
  appendLine(parts, "-".repeat(width));
  parts.push(`${ESC}a\x00`, `${ESC}E\x00`);

  appendPair(parts, "Waktu (WIB)", receipt.transaction_date_time, width);
  appendPair(parts, "Spesies", receipt.species_name, width);
  appendPair(parts, "Ukuran ikan", receipt.fish_size ?? "-", width);
  appendPair(parts, "Jumlah", `${formatInteger(receipt.quantity)} ekor`, width);
  appendPair(parts, "Harga/ekor", formatPosRupiah(receipt.unit_price), width);

  appendLine(parts, "-".repeat(width));
  parts.push(`${ESC}E\x01`);
  appendPair(parts, "TOTAL", formatPosRupiah(receipt.total_payment), width);
  parts.push(`${ESC}E\x00`);
  appendLine(parts, "-".repeat(width));

  appendPair(
    parts,
    "Pembayaran",
    receipt.payment_method === "cash" ? "Tunai" : "Transfer",
    width,
  );
  appendPair(parts, "Kasir", receipt.cashier_name, width);
  parts.push(`${ESC}d\x04`);

  return Uint8Array.from(parts.join(""), (character) =>
    character.charCodeAt(0),
  );
}

function appendPair(
  parts: string[],
  label: string,
  value: string,
  width: number,
): void {
  const safeLabel = toPrinterAscii(label);
  const safeValue = toPrinterAscii(value);

  if (safeLabel.length + safeValue.length + 1 <= width) {
    const spaces = width - safeLabel.length - safeValue.length;
    appendLine(parts, `${safeLabel}${" ".repeat(spaces)}${safeValue}`);
    return;
  }

  appendLines(parts, wrapText(safeLabel, width));
  appendLines(
    parts,
    wrapText(safeValue, width - 2).map((line) => `  ${line}`),
  );
}

function appendLines(parts: string[], lines: string[]): void {
  for (const line of lines) appendLine(parts, line);
}

function appendLine(parts: string[], line: string): void {
  parts.push(line, LINE_FEED);
}

function wrapText(value: string, width: number): string[] {
  const lines: string[] = [];
  let currentLine = "";

  for (const word of value.split(" ")) {
    if (!word) continue;

    let remaining = word;
    while (remaining.length > width) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }

    if (!currentLine) {
      currentLine = remaining;
    } else if (currentLine.length + remaining.length + 1 <= width) {
      currentLine += ` ${remaining}`;
    } else {
      lines.push(currentLine);
      currentLine = remaining;
    }
  }

  if (currentLine || lines.length === 0) lines.push(currentLine);
  return lines;
}

function toPrinterAscii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}
