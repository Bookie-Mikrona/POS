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
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
  };
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
  /** Stable per-origin ID (Chrome ≥56). Required for getDevices() reconnect. */
  readonly id: string;
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
  /**
   * Returns previously-permitted devices without showing a chooser.
   * Available in Chrome ≥85 with "bluetooth" permission (Persistent Permissions).
   * Used for silent reconnect after page reload.
   */
  getDevices?(): Promise<BluetoothDevice[]>;
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

import { btSendAll, btSendBitmap } from "./btWriter";

// ── BT device persistence (silent reconnect after page reload) ─────────────

const BT_SAVED_DEVICE_KEY = "bt_device_v1";

export interface SavedBtDevice { id: string; name?: string }

/**
 * Persist the chosen BT device (id + name) to localStorage so that
 * tryAutoConnectBluetooth() can reconnect silently after a page reload
 * without showing the browser chooser again.
 */
export function saveBtDeviceRecord(id: string, name?: string): void {
  try {
    const d: SavedBtDevice = { id, name };
    localStorage.setItem(BT_SAVED_DEVICE_KEY, JSON.stringify(d));
  } catch { /* ignore — storage not available */ }
}

/** Return the last persisted BT device, or null if none saved. */
export function getBtSavedDevice(): SavedBtDevice | null {
  try {
    const raw = localStorage.getItem(BT_SAVED_DEVICE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SavedBtDevice>;
    if (typeof d.id === "string" && d.id.length > 0) {
      return { id: d.id, name: typeof d.name === "string" ? d.name : undefined };
    }
  } catch { /* ignore */ }
  return null;
}

/** Remove the saved BT device (called on explicit user disconnect). */
export function clearBtSavedDevice(): void {
  try { localStorage.removeItem(BT_SAVED_DEVICE_KEY); } catch { /* ignore */ }
}

// ── BT status event ────────────────────────────────────────────────────────

/**
 * Dispatched on window whenever BT connection state changes (connect,
 * disconnect, background reconnect). React components listen for this
 * to call forceUpdate() without polling.
 */
export const BT_CONNECTION_EVENT = "btConnectionChanged";

function notifyBtStatusChanged(): void {
  try { window.dispatchEvent(new CustomEvent(BT_CONNECTION_EVENT)); } catch { /* ignore in tests */ }
}

// ── Bitmap auto-detect ─────────────────────────────────────────────────────

/**
 * Returns true when the ESC/POS stream contains at least one GS v 0 raster
 * block header (0x1D 0x76 0x30). Used to route bitmap data to the reliable
 * writeValue path instead of the fast WNR text path.
 */
function isBitmapData(data: Uint8Array): boolean {
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0x1D && data[i + 1] === 0x76 && data[i + 2] === 0x30) return true;
  }
  return false;
}

// ── Module state ───────────────────────────────────────────────────────────
let _port: SerialPort | null = null;
let _btDevice: BluetoothDevice | null = null;
let _btChar: BluetoothRemoteGATTCharacteristic | null = null;

/**
 * Mutex: prevents two concurrent BT sends (e.g. double-tap, or reconnect
 * racing with a print). printRawViaBluetooth() checks this flag and rejects
 * immediately if a send is already in progress.
 * Only DATA writes are gated — tryAutoConnectBluetooth() is not a data write.
 */
let _btSending = false;

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
    // "povezan" SAMO ko je gatt dejansko connected IN characteristic pripravljena.
    // _btDevice?.name prikazujemo vedno (za orientacijo), a btConnected=false
    // dokler ni oboje izpolnjeno — preprečuje lažni "tiskalnik povezan" status.
    btConnected: _btDevice !== null
      && (_btDevice.gatt?.connected ?? false)
      && _btChar !== null,
    btDeviceName: _btDevice?.name ?? getBtSavedDevice()?.name ?? null,
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scan all known BLE profiles on an already-connected GATT server and return
 * the first matching write characteristic. Returns null if no profile matches.
 * Extracted so both connectBluetoothPrinter() and tryAutoConnectBluetooth()
 * share the same profile-discovery logic.
 */
async function findBtChar(
  server: BluetoothRemoteGATTServer,
): Promise<BluetoothRemoteGATTCharacteristic | null> {
  for (const profile of BLE_PROFILES) {
    try {
      const svc = await server.getPrimaryService(profile.service);
      return await svc.getCharacteristic(profile.char);
    } catch {
      // try next profile
    }
  }
  return null;
}

/**
 * Background GATT reconnect scheduler — fires on gattserverdisconnected.
 *
 * Tries to reconnect 3 times (2 s → 5 s → 10 s delays). Aborts silently if
 * _btDevice is cleared (user explicitly disconnected). Dispatches
 * BT_CONNECTION_EVENT after each attempt so the UI status reflects reality.
 */
async function scheduleGattReconnect(device: BluetoothDevice): Promise<void> {
  const delays = [2000, 5000, 10000];
  for (const [i, delay] of delays.entries()) {
    await sleep(delay);
    if (_btDevice !== device) {
      // User explicitly disconnected → abort
      return;
    }
    console.info(`[BT] Samodejni reconnect, poskus ${i + 1}/${delays.length}…`);
    try {
      const server = await device.gatt!.connect();
      const char = await findBtChar(server);
      if (!char) throw new Error("Karakteristika ni najdena");
      if (_btDevice !== device) return; // disconnected during attempt
      _btChar = char;
      console.info("[BT] Samodejni reconnect uspel.");
      notifyBtStatusChanged();
      return;
    } catch (err) {
      console.warn(`[BT] Samodejni reconnect ${i + 1} ni uspel: ${err}`);
      notifyBtStatusChanged(); // update UI → show disconnected
    }
  }
  // All attempts exhausted — char is gone, device stays for name display
  _btChar = null;
  notifyBtStatusChanged();
  console.warn("[BT] Samodejni reconnect ni uspel po 3 poskusih.");
}

/**
 * Silent BT reconnect — no browser chooser dialog.
 *
 * Uses navigator.bluetooth.getDevices() (Chrome ≥85, requires previous
 * explicit permission) to find the last chosen device by its persisted id,
 * then connects to GATT and locates the write characteristic.
 *
 * Call on:
 *  (a) App mount — so the connection is restored after page reload.
 *  (b) Print attempt when state.btConnected is false — before showing chooser.
 *
 * Returns true on success; false when getDevices is unavailable, the saved
 * device is not in the permitted list, or GATT connect fails.
 * Never throws — failures are silent so the caller can fall back to chooser.
 */
export async function tryAutoConnectBluetooth(): Promise<boolean> {
  if (!navigator.bluetooth?.getDevices) return false;

  const saved = getBtSavedDevice();
  if (!saved) return false;

  let devices: BluetoothDevice[];
  try {
    devices = await navigator.bluetooth.getDevices();
  } catch {
    return false;
  }

  const device = devices.find(d => d.id === saved.id);
  if (!device) return false;

  try {
    const server = await device.gatt!.connect();
    const char = await findBtChar(server);
    if (!char) return false;

    _btDevice = device;
    _btChar = char;

    device.addEventListener("gattserverdisconnected", () => {
      _btChar = null;
      notifyBtStatusChanged();
      // Only reconnect if user hasn't explicitly disconnected (_btDevice still set)
      if (_btDevice === device) {
        void scheduleGattReconnect(device);
      }
    });

    console.info(`[BT] Tihi reconnect uspel: ${device.name ?? saved.id}`);
    notifyBtStatusChanged();
    return true;
  } catch (err) {
    console.warn(`[BT] Tihi reconnect ni uspel: ${err}`);
    return false;
  }
}

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
    const foundChar = await findBtChar(server);

    if (!foundChar) {
      server.disconnect();
      return { ok: false, error: "Tiskalnik ni prepoznan. Preverite ali je model podprt (58mm ESC/POS BLE)." };
    }

    _btDevice = device;
    _btChar = foundChar;

    // Persist device for silent reconnect after page reload
    saveBtDeviceRecord(device.id, device.name);

    // Background reconnect on unexpected disconnect
    device.addEventListener("gattserverdisconnected", () => {
      _btChar = null;
      notifyBtStatusChanged();
      if (_btDevice === device) {
        void scheduleGattReconnect(device);
      }
    });

    notifyBtStatusChanged();
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
  // Clear saved device so auto-reconnect does not fire after explicit disconnect
  clearBtSavedDevice();
  notifyBtStatusChanged();
}

/**
 * Send ESC/POS bytes to connected BLE thermal printer.
 *
 * ## Mutex
 *   Only one BT send can be active at a time (_btSending flag). A second call
 *   while a send is in progress returns ok=false immediately. This prevents:
 *   - Double-tap → two concurrent streams to the same characteristic.
 *   - Reconnect racing with a print (tryAutoConnectBluetooth does NOT set this
 *     flag — it only negotiates GATT, it writes no data).
 *
 * ## Routing
 *   - BITMAP (contains GS v 0 header 0x1D 0x76 0x30):
 *       → btSendBitmap(): resolves write mode from properties (WR or WNR),
 *         single attempt, aborts immediately on error (no auto-retry).
 *   - TEXT (~2 KB):
 *       → btSendAll(): WNR preferred for speed, retries on GATT error.
 */
export async function printRawViaBluetooth(
  data: Uint8Array,
): Promise<{ ok: boolean; error?: string; btInfo?: string }> {
  if (!_btChar) return { ok: false, error: "BT tiskalnik ni povezan." };

  if (_btSending) {
    return {
      ok: false,
      error: "Tiskanje je že v teku. Počakajte, da se zaključi, nato poskusite znova.",
    };
  }

  _btSending = true;
  try {
    const bitmap = isBitmapData(data);
    const result = bitmap
      ? await btSendBitmap(_btChar, data, _btDevice?.name)
      : await btSendAll(_btChar, data, _btDevice?.name);

    if (!result.ok) return { ok: false, error: result.error };

    const kb = (data.length / 1024).toFixed(1);
    const kbps = result.ms > 0
      ? ((data.length / 1024) / (result.ms / 1000)).toFixed(1)
      : "–";
    // writeMode comes from btSendBitmap; text path uses WNR/WR via btSendAll
    const transport = result.writeMode
      ?? (bitmap ? "bitmap" : (result.usedParams ? "WNR" : "WR"));
    const btInfo =
      `BT [${transport}]: ${result.usedParams?.chunkSize ?? "?"} B/kos, ` +
      `${kb} KB → ${result.ms} ms (~${kbps} KB/s)` +
      (result.attempts > 1 ? `, ponovi ×${result.attempts - 1}` : "");
    return { ok: true, btInfo };
  } finally {
    _btSending = false;
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

export async function fetchReceiptBytes(racunId: number, zbirni?: boolean, napravaId?: number): Promise<Uint8Array> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (zbirni) params.set("zbirni", "1");
  if (napravaId != null) params.set("napravaId", String(napravaId));
  const qs = params.size ? `?${params.toString()}` : "";
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
  // Popup gre direktno na /api/... (ne skozi Vite proxy /pos/api → localhost:8080),
  // ker bi Vite proxy spremenil host header in Clerk handshake bi preusmeril na localhost:8080.
  // window.open() ne more pošiljati custom headerjev, zato enota_id dodamo kot query param.
  const enotaId = localStorage.getItem("pos_enota_id");
  const params = new URLSearchParams();
  if (zbirni) params.set("zbirni", "1");
  if (enotaId) params.set("enota_id", enotaId);
  const qs = params.size ? `?${params.toString()}` : "";
  const url = `/api/print/racun/${racunId}/html${qs}`;

  const win = window.open(url, "_blank", "width=340,height=800,left=100,top=50");
  if (!win) throw new Error("Pojavno okno je blokirano. Dovolite pojavna okna za to stran.");
}
