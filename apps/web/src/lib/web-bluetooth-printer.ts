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

export interface BluetoothDevice {
  gatt?: BluetoothRemoteGATT | null;
  addEventListener(
    type: "gattserverdisconnected",
    listener: () => void,
  ): void;
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

export async function connectBluetoothPrinter(): Promise<BluetoothDevice> {
  const bluetoothApi = getBluetoothApi();
  if (!isWebBluetoothSupported() || !bluetoothApi) {
    throw new Error(
      "Web Bluetooth tidak tersedia. Gunakan Chrome pada koneksi HTTPS atau localhost.",
    );
  }

  const device = await bluetoothApi.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICE_UUIDS,
  });
  if (!device.gatt) {
    throw new Error("Perangkat tidak menyediakan koneksi Bluetooth GATT.");
  }

  try {
    const server = await device.gatt.connect();
    const writeCharacteristic = await findWritableCharacteristic(server);
    if (!writeCharacteristic) {
      throw new Error(
        "Printer tidak menyediakan karakteristik Bluetooth untuk penulisan data.",
      );
    }
    return device;
  } catch (error) {
    device.gatt.disconnect();
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Printer Bluetooth tidak dapat dihubungkan.");
  }
}

export async function printViaWebBluetooth(
  bytes: Uint8Array,
  existingDevice?: BluetoothDevice | null,
): Promise<void> {
  const bluetoothApi = getBluetoothApi();
  if (!isWebBluetoothSupported() || !bluetoothApi) {
    throw new Error(
      "Web Bluetooth tidak tersedia. Gunakan Chrome pada koneksi HTTPS atau localhost.",
    );
  }

  const ownsDevice = !existingDevice;
  const device =
    existingDevice ??
    (await bluetoothApi.requestDevice({
      acceptAllDevices: true,
      optionalServices: PRINTER_SERVICE_UUIDS,
    }));

  try {
    if (!device.gatt) {
      throw new Error("Perangkat tidak menyediakan koneksi Bluetooth GATT.");
    }

    const server = await device.gatt.connect();
    const writeCharacteristic = await findWritableCharacteristic(server);
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
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Koneksi atau pengiriman ke printer Bluetooth gagal.");
  } finally {
    if (ownsDevice) {
      try {
        device.gatt?.disconnect();
      } catch {
        // The print result should not be replaced by a disconnect cleanup error.
      }
    }
  }
}

async function findWritableCharacteristic(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic | undefined> {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    const characteristics = await service.getCharacteristics();
    const characteristic = characteristics.find(isWritableCharacteristic);
    if (characteristic) return characteristic;
  }
  return undefined;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
