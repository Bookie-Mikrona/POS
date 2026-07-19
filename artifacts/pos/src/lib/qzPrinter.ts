/**
 * QZ Tray integracija za tih tisk na katerikoli Windows gonilniški tiskalnik.
 *
 * Zahteva QZ Tray nameščen in zagnan na lokalnem računalniku.
 * Prenos: https://qz.io/download/
 *
 * Nastavitev za unsigned delovanje (brez certifikata):
 *   Desni klik na QZ Tray ikono v opravilni vrstici → Advanced → Allow Unsigned
 */

// ── Tipi ──────────────────────────────────────────────────────────────────
interface QzModule {
  websocket: {
    connect(options?: { retries?: number; delay?: number }): Promise<void>;
    disconnect(): Promise<void>;
    isActive(): boolean;
  };
  printers: {
    find(query?: string): Promise<string | string[]>;
  };
  configs: {
    create(printer: string, options?: Record<string, unknown>): QzConfig;
  };
  print(config: QzConfig, data: QzPrintData[]): Promise<void>;
  security: {
    setCertificate(cert: null | string | Promise<null | string>): void;
    setSignatureAlgorithm(algo: string): void;
    setSignaturePromise(fn: (toSign: string) => Promise<null>): void;
  };
}

interface QzConfig {
  printer: string;
}

interface QzPrintData {
  type: string;
  format: string;
  data: string;
}

// ── Stanje modula ──────────────────────────────────────────────────────────
let _qz: QzModule | null = null;
let _connected = false;

const QZ_PRINTER_KEY = "qzTiskalnikIme";

// ── localStorage helpers ───────────────────────────────────────────────────
export function getQzPrinterName(): string | null {
  return localStorage.getItem(QZ_PRINTER_KEY);
}

export function setQzPrinterName(name: string): void {
  localStorage.setItem(QZ_PRINTER_KEY, name);
}

export function clearQzPrinterName(): void {
  localStorage.removeItem(QZ_PRINTER_KEY);
}

export function isQzConfigured(): boolean {
  return getQzPrinterName() !== null;
}

export function isQzConnected(): boolean {
  return _connected && (_qz?.websocket.isActive() ?? false);
}

// ── Lazy load qz-tray (UMD) ────────────────────────────────────────────────
async function getQz(): Promise<QzModule> {
  if (!_qz) {
    // qz-tray je UMD paket — uvozimo vse imensko polje
    const mod = await import("qz-tray") as unknown as QzModule;
    _qz = mod;
    // Unsigned način: QZ Tray mora imeti Allow Unsigned vklopljeno
    _qz.security.setCertificate(null);
    _qz.security.setSignatureAlgorithm("SHA512");
    _qz.security.setSignaturePromise(() => Promise.resolve(null));
  }
  return _qz;
}

// ── Povezava ───────────────────────────────────────────────────────────────
const QZ_CONNECT_TIMEOUT_MS = 5000;

export async function connectQz(): Promise<{ ok: boolean; error?: string }> {
  try {
    const qz = await getQz();
    if (!qz.websocket.isActive()) {
      // Timeout po 5 sekundah — brez tega qz-tray čaka 30+ s
      await Promise.race([
        qz.websocket.connect({ retries: 0, delay: 500 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), QZ_CONNECT_TIMEOUT_MS)
        ),
      ]);
    }
    _connected = true;
    return { ok: true };
  } catch (err) {
    _connected = false;
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|unable|refused|ECONNREFUSED|failed to connect/i.test(msg)) {
      return {
        ok: false,
        error:
          "QZ Tray ni dosegljiv.\n\n" +
          "Preverite:\n" +
          "1. Ali je QZ Tray zagnan (ikona v opravilni vrstici)?\n" +
          "2. Ali ste zaupali certifikatu na https://localhost:8183 v Chromu?",
      };
    }
    return { ok: false, error: msg };
  }
}

export async function disconnectQz(): Promise<void> {
  try {
    if (_qz?.websocket.isActive()) {
      await _qz.websocket.disconnect();
    }
  } catch {
    // prezremo
  }
  _connected = false;
}

// ── Seznam tiskalnikov ─────────────────────────────────────────────────────
export async function listQzPrinters(): Promise<string[]> {
  const qz = await getQz();
  const result = await qz.printers.find();
  if (Array.isArray(result)) return result as string[];
  return [result as string];
}

// ── Tiskanje ───────────────────────────────────────────────────────────────
export async function printQz(
  data: Uint8Array
): Promise<{ ok: boolean; error?: string }> {
  const printerName = getQzPrinterName();
  if (!printerName) return { ok: false, error: "QZ tiskalnik ni izbran." };

  try {
    const qz = await getQz();
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({ retries: 1, delay: 500 });
      _connected = true;
    }
    const config = qz.configs.create(printerName, {
      encoding: "RAW",
    });
    // Pretvori Uint8Array v base64
    let binary = "";
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    const b64 = btoa(binary);
    await qz.print(config, [{ type: "raw", format: "base64", data: b64 }]);
    return { ok: true };
  } catch (err) {
    _connected = false;
    const msg = err instanceof Error ? err.message : String(err);
    if (/unable|refused|ECONNREFUSED/i.test(msg)) {
      return {
        ok: false,
        error: "QZ Tray se je odklopil. Preverite ali je zagnan.",
      };
    }
    return { ok: false, error: msg };
  }
}
