/**
 * Thermal receipt printer integration.
 *
 * Strategy:
 * 1. Web Bluetooth API (Chrome on Android/Desktop) — BLE ESC/POS printing.
 * 2. Web Serial API (Chrome/Edge desktop, USB or Bluetooth serial) — direct byte-level printing.
 * 3. Browser window.print() with receipt CSS — universal fallback.
 */

// ── Web Serial type stubs ──────────────────────────────────────────────────
declare global {
  interface SerialPort {
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    readonly writable: WritableStream<Uint8Array> | null;
  }
}

// ── Web Bluetooth type stubs ───────────────────────────────────────────────
interface BluetoothRemoteGATTCharacteristic {
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValue(data: BufferSource): Promise<void>;
  properties: { writeWithoutResponse: boolean };
}
interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
}
interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
  readonly connected: boolean;
  disconnect(): void;
}
interface BluetoothDevice {
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
}
interface BluetoothRequestDeviceFilter { services?: string[] }
interface Bluetooth {
  requestDevice(options: {
    filters?: BluetoothRequestDeviceFilter[];
    optionalServices?: string[];
    acceptAllDevices?: boolean;
  }): Promise<BluetoothDevice>;
}
declare global {
  interface Navigator { bluetooth?: Bluetooth }
}

// ── Known BLE profiles for generic 58mm Chinese thermal printers ───────────
const BLE_PROFILES = [
  // POS-5802LD, many generic 58mm BT printers (FFE0/FFE1 SPP-over-BLE)
  { service: "0000ffe0-0000-1000-8000-00805f9b34fb", char: "0000ffe1-0000-1000-8000-00805f9b34fb" },
  // Most common: used by GPrinter, Goojprt, Rongta, etc.
  { service: "000018f0-0000-1000-8000-00805f9b34fb", char: "00002af1-0000-1000-8000-00805f9b34fb" },
  // FF00/FF02 variant
  { service: "0000ff00-0000-1000-8000-00805f9b34fb", char: "0000ff02-0000-1000-8000-00805f9b34fb" },
  // Used by some Goojprt / iDPRT models
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", char: "49535343-1e4d-4bd9-ba61-23c647249616" },
  // Used by some MUNBYN / HPRT BLE models
  { service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2", char: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f" },
];

// ── Module state ───────────────────────────────────────────────────────────
let _port: SerialPort | null = null;
let _btDevice: BluetoothDevice | null = null;
let _btChar: BluetoothRemoteGATTCharacteristic | null = null;

// ── Wi-Fi / Network printer (localStorage, per device) ────────────────────
const NETWORK_PRINTER_KEY = "omrezniTiskalnikNaslov";

export function getNetworkPrinterUrl(): string | null {
  return localStorage.getItem(NETWORK_PRINTER_KEY);
}

export function setNetworkPrinterUrl(naslov: string): void {
  localStorage.setItem(NETWORK_PRINTER_KEY, naslov.trim());
}

export function clearNetworkPrinterUrl(): void {
  localStorage.removeItem(NETWORK_PRINTER_KEY);
}

// ── PrinterState ───────────────────────────────────────────────────────────
export interface PrinterState {
  /** Web Serial API available (desktop Chrome/Edge) */
  supported: boolean;
  connected: boolean;
  portName: string | null;
  /** Web Bluetooth API available (Chrome on Android + desktop) */
  btSupported: boolean;
  btConnected: boolean;
  btDeviceName: string | null;
  /** Wi-Fi / network printer configured URL (device-local, stored in localStorage) */
  networkUrl: string | null;
  /** QZ Tray printer name saved in localStorage */
  qzPrinterName: string | null;
}

export function getPrinterState(): PrinterState {
  return {
    supported: "serial" in navigator,
    connected: _port !== null,
    portName: _port ? "Termalni tiskalnik" : null,
    btSupported: "bluetooth" in navigator,
    btConnected: _btDevice !== null && (_btDevice.gatt?.connected ?? false),
    btDeviceName: _btDevice?.name ?? null,
    networkUrl: localStorage.getItem(NETWORK_PRINTER_KEY),
    qzPrinterName: localStorage.getItem("qzTiskalnikIme"),
  };
}

// ── Web Serial ─────────────────────────────────────────────────────────────

type SerialApi = { requestPort(): Promise<SerialPort>; getPorts(): Promise<SerialPort[]> };

/**
 * Samodejno vzpostavi povezavo z že odobrenim USB tiskalnikov brez dialoga.
 * Pokliče getPorts() (brez user-gesture zahteve) in odpre prvi najdeni port.
 * Vrne true če je bila povezava uspešna.
 */
export async function tryAutoConnectSerial(): Promise<boolean> {
  if (_port !== null) return true;
  if (!("serial" in navigator)) return false;
  try {
    const serial = (navigator as Navigator & { serial: SerialApi }).serial;
    const ports = await serial.getPorts();
    if (ports.length === 0) return false;
    const port = ports[0];
    await port.open({ baudRate: 9600 });
    _port = port;
    return true;
  } catch {
    return false;
  }
}

export async function connectSerialPrinter(): Promise<{ ok: boolean; error?: string }> {
  if (!("serial" in navigator)) {
    return { ok: false, error: "Web Serial API ni podprt v tem brskalniku. Uporabite Chrome ali Edge." };
  }
  try {
    const serial = (navigator as Navigator & { serial: SerialApi }).serial;
    const port = await serial.requestPort();
    await port.open({ baudRate: 9600 });
    _port = port;
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return { ok: false, error: "Ni bil izbran noben tiskalnik." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Napaka pri povezavi tiskalnika." };
  }
}

export async function disconnectSerialPrinter(): Promise<void> {
  if (_port) {
    try { await _port.close(); } catch { /* ignore */ }
    _port = null;
  }
}

export async function printRaw(data: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  if (!_port) return { ok: false, error: "Tiskalnik ni povezan." };
  try {
    const writer = _port.writable?.getWriter();
    if (!writer) return { ok: false, error: "Pisanje ni na voljo." };
    await writer.write(data);
    writer.releaseLock();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Napaka pri tiskanju." };
  }
}

// ── Web Bluetooth ──────────────────────────────────────────────────────────

export async function connectBluetoothPrinter(): Promise<{ ok: boolean; error?: string }> {
  if (!navigator.bluetooth) {
    return { ok: false, error: "Web Bluetooth ni podprt v tem brskalniku." };
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_PROFILES.map(p => p.service),
    });

    const server = await device.gatt!.connect();

    // Try each known BLE profile until one works
    let foundChar: BluetoothRemoteGATTCharacteristic | null = null;
    for (const profile of BLE_PROFILES) {
      try {
        const svc = await server.getPrimaryService(profile.service);
        foundChar = await svc.getCharacteristic(profile.char);
        break;
      } catch {
        // try next profile
      }
    }

    if (!foundChar) {
      server.disconnect();
      return { ok: false, error: "Tiskalnik ni prepoznan. Preverite ali je model podprt (58mm ESC/POS BLE)." };
    }

    _btDevice = device;
    _btChar = foundChar;

    // Clean up on unexpected disconnect
    device.addEventListener("gattserverdisconnected", () => {
      _btDevice = null;
      _btChar = null;
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "NotFoundError") {
      return { ok: false, error: "Ni bil izbran noben tiskalnik." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Napaka pri BT povezavi." };
  }
}

export async function disconnectBluetoothPrinter(): Promise<void> {
  if (_btDevice?.gatt?.connected) {
    try { _btDevice.gatt.disconnect(); } catch { /* ignore */ }
  }
  _btDevice = null;
  _btChar = null;
}

/**
 * Send ESC/POS bytes to connected BLE thermal printer.
 * Splits data into 200-byte chunks (BLE MTU safe).
 */
export async function printRawViaBluetooth(data: Uint8Array): Promise<{ ok: boolean; error?: string }> {
  if (!_btChar) return { ok: false, error: "BT tiskalnik ni povezan." };
  const CHUNK = 200;
  try {
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.slice(i, i + CHUNK);
      if (_btChar.properties.writeWithoutResponse && _btChar.writeValueWithoutResponse) {
        await _btChar.writeValueWithoutResponse(chunk);
      } else {
        await _btChar.writeValue(chunk);
      }
      // Small delay between chunks to avoid overflow
      if (i + CHUNK < data.length) {
        await new Promise(r => setTimeout(r, 20));
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Napaka pri BT tiskanju." };
  }
}

// ── Wi-Fi / Network printer send ───────────────────────────────────────────

export async function printReceiptViaNetwork(racunId: number, zbirni?: boolean): Promise<{ ok: boolean; error?: string }> {
  const naslov = getNetworkPrinterUrl();
  if (!naslov) return { ok: false, error: "Wi-Fi tiskalnik ni nastavljen." };
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const qs = zbirni ? "?zbirni=1" : "";
  try {
    const res = await fetch(`${base}/api/print/racun/${racunId}/network${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ naslov }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Napaka pri omrežnem tiskanju." };
  }
}

// ── Fetch helpers ──────────────────────────────────────────────────────────

export async function fetchReceiptBytes(racunId: number, zbirni?: boolean): Promise<Uint8Array> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const qs = zbirni ? "?zbirni=1" : "";
  const res = await fetch(`${base}/api/print/racun/${racunId}${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export function printReceiptViaBrowser(racunId: number, zbirni?: boolean): void {
  // Open the receipt HTML endpoint directly in a new window — the browser sends
  // the session cookie automatically. Calling window.open() synchronously (no
  // preceding await) keeps us inside the user-gesture handler so Chrome/Edge on
  // Windows cannot block the popup.
  const qs = zbirni ? "?zbirni=1" : "";
  // Popup gre direktno na /api/... (ne skozi Vite proxy /pos/api → localhost:8080),
  // ker bi Vite proxy spremenil host header in Clerk handshake bi preusmeril na localhost:8080.
  const url = `/api/print/racun/${racunId}/html${qs}`;

  const win = window.open(url, "_blank", "width=340,height=800,left=100,top=50");
  if (!win) throw new Error("Pojavno okno je blokirano. Dovolite pojavna okna za to stran.");
}
