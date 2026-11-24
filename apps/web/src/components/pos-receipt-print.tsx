"use client";

import { Bluetooth, Printer, Usb } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildEscPosReceiptBytes } from "@/lib/escpos-receipt";
import { formatPosRupiah } from "@/lib/format";
import {
  isWebBluetoothSupported,
  printViaWebBluetooth,
} from "@/lib/web-bluetooth-printer";

export interface PosReceiptData {
  company_name: string;
  transaction_date_time: string;
  species_name: string;
  fish_size: string | null;
  quantity: number;
  unit?: string;
  unit_price: number;
  total_payment: number;
  payment_method: "cash" | "transfer";
  cashier_name: string;
}

interface SerialPortConnection {
  open(options: { baudRate: number }): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
  close(): Promise<void>;
}

interface SerialApi {
  requestPort(): Promise<SerialPortConnection>;
}

type ThermalStatus = {
  kind: "info" | "error";
  message: string;
};

export function PosReceiptPrint({
  receipt,
  printButtonLabel = "Cetak Struk",
  autoPrint = false,
  saleCommitted = false,
}: {
  receipt: PosReceiptData;
  printButtonLabel?: string;
  autoPrint?: boolean;
  saleCommitted?: boolean;
}) {
  const controlId = useId();
  const [paperWidth, setPaperWidth] = useState<"58" | "80">("58");
  const [printState, setPrintState] = useState<"idle" | "requested" | "failed">(
    "idle",
  );
  const [thermalStatus, setThermalStatus] = useState<ThermalStatus | null>(
    null,
  );
  const autoPrintAttempted = useRef(false);

  useEffect(() => {
    if (!autoPrint || autoPrintAttempted.current) return;
    autoPrintAttempted.current = true;
    setPrintState(requestBrowserPrint() ? "requested" : "failed");
  }, [autoPrint]);

  function printAgain() {
    setThermalStatus(null);
    setPrintState(requestBrowserPrint() ? "requested" : "failed");
  }

  async function printToBluetooth(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      setThermalStatus({
        kind: "error",
        message:
          "Web Bluetooth tidak tersedia. Gunakan Chrome pada koneksi HTTPS atau localhost.",
      });
      return;
    }

    setThermalStatus({
      kind: "info",
      message: "Menghubungkan ke printer Bluetooth...",
    });

    try {
      const bytes = buildEscPosReceiptBytes(receipt, paperWidth);
      await printViaWebBluetooth(bytes);
      setThermalStatus({
        kind: "info",
        message: "Struk berhasil dikirim ke printer Bluetooth.",
      });
    } catch (error) {
      setThermalStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Cetak Bluetooth gagal. Penjualan tetap tersimpan.",
      });
    }
  }

  async function printToSerial(): Promise<void> {
    setThermalStatus(null);

    const serialApi = getSerialApi();
    if (!serialApi) {
      setThermalStatus({
        kind: "error",
        message:
          "Browser ini tidak mendukung Web Serial. Gunakan cetak sistem atau browser yang mendukung Web Serial.",
      });
      return;
    }

    let port: SerialPortConnection | undefined;
    let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
    let failed = false;
    let failure: unknown;

    try {
      port = await serialApi.requestPort();
      await port.open({ baudRate: 9600 });
      if (!port.writable) throw new Error("Serial port is not writable");

      writer = port.writable.getWriter();
      await writer.write(buildEscPosReceiptBytes(receipt, paperWidth));
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      try {
        writer?.releaseLock();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }

      if (port) {
        try {
          await port.close();
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
    }

    if (failed) {
      setThermalStatus({
        kind: "error",
        message: isNotFoundError(failure)
          ? "Pemilihan printer dibatalkan. Penjualan tetap tersimpan dan tidak dibuat ulang."
          : "Koneksi atau pengiriman ke printer gagal. Periksa printer lalu coba lagi; penjualan tetap tersimpan.",
      });
      return;
    }

    setThermalStatus({
      kind: "info",
      message: "Payload ESC/POS berhasil dikirim ke printer thermal.",
    });
  }

  return (
    <section
      className={`pos-receipt-print pfi-receipt-${paperWidth} mx-auto w-full max-w-[80mm] border border-border bg-white px-4 py-4 text-slate-900`}
      aria-label="Pratinjau struk"
    >
      <div className="pos-receipt-controls mb-4 flex flex-wrap items-end justify-between gap-3">
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
          <legend className="mb-1 w-full text-xs font-semibold text-slate-600">
            Lebar kertas
          </legend>
          {(["58", "80"] as const).map((width) => (
            <label
              key={width}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm font-semibold ${
                paperWidth === width
                  ? "border-marine bg-[#eef4f8] text-marine"
                  : "border-border bg-white text-slate-600"
              }`}
            >
              <input
                type="radio"
                name={`receipt-paper-${controlId}`}
                value={width}
                checked={paperWidth === width}
                onChange={() => setPaperWidth(width)}
              />
              {width} mm
            </label>
          ))}
        </fieldset>
        <Button onClick={printAgain} type="button">
          <Printer className="size-4" aria-hidden="true" />
          {printState === "failed" ? "Coba Cetak Ulang" : printButtonLabel}
        </Button>
        <Button
          onClick={() => void printToBluetooth()}
          type="button"
          variant="secondary"
        >
          <Bluetooth className="size-4" aria-hidden="true" />
          Cetak Thermal (Bluetooth)
        </Button>
        <Button
          onClick={() => void printToSerial()}
          type="button"
          variant="secondary"
        >
          <Usb className="size-4" aria-hidden="true" />
          Cetak Thermal (USB/Serial)
        </Button>
      </div>
      {thermalStatus ? (
        <p
          className={`pos-receipt-print-status mb-3 px-3 py-2 text-sm ${
            thermalStatus.kind === "error"
              ? "border-l-4 border-danger bg-[#fef2f2] text-danger"
              : "text-slate-600"
          }`}
          role={thermalStatus.kind === "error" ? "alert" : "status"}
        >
          {thermalStatus.message}
        </p>
      ) : printState === "failed" ? (
        <p
          className="pos-receipt-print-status mb-3 border-l-4 border-danger bg-[#fef2f2] px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {saleCommitted
            ? "Transaksi penjualan berhasil tersimpan, tetapi proses cetak struk gagal atau tidak didukung. Coba cetak ulang."
            : "Data struk berhasil dimuat, tetapi proses cetak ulang gagal atau tidak didukung. Coba lagi."}
        </p>
      ) : printState === "requested" ? (
        <p
          className="pos-receipt-print-status mb-3 text-xs text-slate-600"
          role="status"
        >
          Dialog cetak sistem telah diminta. Hasil cetak bergantung pada dialog
          dan perangkat.
        </p>
      ) : null}

      <dl
        className="pos-receipt-details divide-y divide-slate-200"
        aria-label="Ringkasan struk"
      >
        <ReceiptLine label="Perusahaan" value={receipt.company_name} company />
        <ReceiptLine
          label="Waktu transaksi (WIB)"
          value={receipt.transaction_date_time}
        />
        <ReceiptLine label="Spesies / produk" value={receipt.species_name} />
        <ReceiptLine label="Ukuran / SKU" value={receipt.fish_size ?? "—"} />
        <ReceiptLine
          label="Jumlah"
          value={`${formatReceiptQuantity(receipt.quantity)} ${receipt.unit || "ekor"}`}
          numeric
        />
        <ReceiptLine
          label="Harga satuan"
          value={formatPosRupiah(receipt.unit_price)}
          numeric
        />
        <ReceiptLine
          label="Total pembayaran"
          value={formatPosRupiah(receipt.total_payment)}
          numeric
          total
        />
        <ReceiptLine
          label="Metode pembayaran"
          value={receipt.payment_method === "cash" ? "Tunai" : "Transfer"}
        />
        <ReceiptLine label="Nama kasir" value={receipt.cashier_name} />
      </dl>
    </section>
  );
}

function requestBrowserPrint(): boolean {
  if (typeof window === "undefined" || typeof window.print !== "function") {
    return false;
  }
  try {
    window.print();
    return true;
  } catch {
    return false;
  }
}

function formatReceiptQuantity(quantity: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(
    quantity,
  );
}

function getSerialApi(): SerialApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { serial?: SerialApi }).serial;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotFoundError"
  );
}

function ReceiptLine({
  label,
  value,
  numeric = false,
  company = false,
  total = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  company?: boolean;
  total?: boolean;
}) {
  return (
    <div
      className={`pos-receipt-row flex min-w-0 items-start justify-between gap-3 py-2 ${company ? "border-b-2 border-slate-900 text-center" : ""} ${total ? "border-t border-slate-900" : ""}`}
    >
      <dt
        className={`pos-receipt-label min-w-0 text-xs text-slate-600 ${company ? "sr-only" : ""}`}
      >
        {label}
      </dt>
      <dd
        className={`pos-receipt-value min-w-0 break-words text-right text-sm font-semibold text-slate-900 ${numeric ? "tabular-nums" : ""} ${company ? "w-full text-center text-base font-bold" : ""} ${total ? "text-base font-bold" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
