/**
 * Sunmi Android inner printer integration via Sunmi JSAPI.
 *
 * On Sunmi devices (T2, V2, Z92, …) the built-in thermal printer is
 * accessible from the browser only when the page runs inside:
 *   • the Sunmi built-in browser (com.sunmi.browser), OR
 *   • a WebView that has the Sunmi JS bridge injected.
 *
 * The bridge exposes window.SunmiInnerPrinter (older devices) or
 * window.sunmi (newer SDK). Neither is available in Chrome on Android.
 *
 * Reference: Sunmi JSAPI / InnerPrinter documentation
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type SunmiInnerPrinterLegacy = {
  sendRawData(base64: string, callback: (result: number) => void): void;
  passThrough(base64: string, callback: (result: number) => void): void;
  cutPaper(callback?: (result: number) => void): void;
};

type SunmiNewAPI = {
  printer: {
    sendRawData(base64: string, callback: (result: number) => void): void;
    passThrough(base64: string, callback: (result: number) => void): void;
    cutPaper(callback?: (result: number) => void): void;
  };
};

function getLegacyPrinter(): SunmiInnerPrinterLegacy | null {
  return (window as any).SunmiInnerPrinter ?? null;
}

function getNewPrinter(): SunmiInnerPrinterLegacy | null {
  const sunmi: SunmiNewAPI | undefined = (window as any).sunmi;
  return sunmi?.printer ?? null;
}

function getPrinter(): SunmiInnerPrinterLegacy | null {
  return getNewPrinter() ?? getLegacyPrinter();
}

/** Returns true when the Sunmi inner printer JS bridge is available. */
export function isSunmiPrinterAvailable(): boolean {
  return getPrinter() !== null;
}

/**
 * Send raw ESC/POS bytes to the Sunmi inner printer.
 * Uses passThrough first (wider support), falls back to sendRawData.
 */
export async function printViaSunmi(
  data: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  const printer = getPrinter();
  if (!printer) {
    return {
      ok: false,
      error:
        "Sunmi vgrajen tiskalnik ni na voljo. Aplikacija mora teči v Sunmi brskalniku ali WebView.",
    };
  }

  // Convert bytes to base64
  let binary = "";
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
  const base64 = btoa(binary);

  // Try passThrough first, then sendRawData
  const method: "passThrough" | "sendRawData" =
    typeof printer.passThrough === "function" ? "passThrough" : "sendRawData";

  return new Promise((resolve) => {
    try {
      printer[method](base64, (result: number) => {
        if (result === 0) {
          resolve({ ok: true });
        } else {
          resolve({
            ok: false,
            error: `Sunmi tiskalnik napaka (koda ${result})`,
          });
        }
      });
    } catch (err) {
      resolve({
        ok: false,
        error: err instanceof Error ? err.message : "Napaka Sunmi tiskalnika",
      });
    }
  });
}
