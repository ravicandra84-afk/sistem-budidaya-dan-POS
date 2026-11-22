interface BluetoothCharacteristicProperties {
  write?: boolean;
  writeWithoutResponse?: boolean;
}

interface BluetoothRemoteGATTCharacteristic {
  properties: BluetoothCharacteristicProperties;
  writeValue?(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATT {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
}

interface BluetoothDevice {
  gatt?: BluetoothRemoteGATT | null;
}

interface WebBluetoothApi {
  requestDevice(options: {
    acceptAllDevices: true;
    optionalServices: string[];
  }): Promise<BluetoothDevice>;
}

const PRINTER_SERVICE_UUIDS = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

const CHUNK_SIZE = 64;
const CHUNK_DELAY_MS = 20;

export function isWebBluetoothSupported(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  return getBluetoothApi() !== undefined;
}

export async function printViaWebBluetooth(bytes: Uint8Array): Promise<void> {
  const bluetoothApi = getBluetoothApi();
  if (!isWebBluetoothSupported() || !bluetoothApi) {
    throw new Error(
      "Web Bluetooth tidak tersedia. Gunakan Chrome pada koneksi HTTPS atau localhost.",
    );
  }

  let device: BluetoothDevice;
  try {
    device = await bluetoothApi.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICE_UUIDS,
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error("Pemilihan printer Bluetooth dibatalkan.");
    }
    throw new Error(
      "Printer Bluetooth tidak dapat dipilih. Pastikan Bluetooth aktif lalu coba lagi.",
    );
  }

  try {
    if (!device.gatt) {
      throw new Error("Perangkat tidak menyediakan koneksi Bluetooth GATT.");
    }

    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    let writeCharacteristic: BluetoothRemoteGATTCharacteristic | undefined;

    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      writeCharacteristic = characteristics.find(isWritableCharacteristic);
      if (writeCharacteristic) break;
    }

    if (!writeCharacteristic) {
      throw new Error(
        "Printer tidak menyediakan karakteristik Bluetooth untuk penulisan data.",
      );
    }

    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
      await writeChunk(writeCharacteristic, chunk);
      if (offset + CHUNK_SIZE < bytes.length) {
        await delay(CHUNK_DELAY_MS);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Printer tidak menyediakan")) {
      throw error;
    }
    throw new Error(
      "Koneksi atau pengiriman ke printer Bluetooth gagal. Pastikan printer menyala dan berada dalam jangkauan.",
    );
  } finally {
    try {
      device.gatt?.disconnect();
    } catch {
      // The print result should not be replaced by a disconnect cleanup error.
    }
  }
}

function getBluetoothApi(): WebBluetoothApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { bluetooth?: WebBluetoothApi }).bluetooth;
}

function isWritableCharacteristic(
  characteristic: BluetoothRemoteGATTCharacteristic,
): boolean {
  return (
    (characteristic.properties.writeWithoutResponse === true &&
      typeof characteristic.writeValueWithoutResponse === "function") ||
    (characteristic.properties.write === true &&
      typeof characteristic.writeValue === "function")
  );
}

function writeChunk(
  characteristic: BluetoothRemoteGATTCharacteristic,
  chunk: Uint8Array,
): Promise<void> {
  if (
    characteristic.properties.writeWithoutResponse === true &&
    characteristic.writeValueWithoutResponse
  ) {
    return characteristic.writeValueWithoutResponse(chunk);
  }
  if (characteristic.properties.write === true && characteristic.writeValue) {
    return characteristic.writeValue(chunk);
  }
  throw new Error("Karakteristik Bluetooth tidak dapat menulis data.");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotFoundError"
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}