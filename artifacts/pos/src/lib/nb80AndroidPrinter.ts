/**
 * NB80 Android tiskalni most — HTTP klient za lokalni APK strežnik.
 *
 * APK teče na istem NB80 terminalu in posluša na localhost:8091.
 * Tiskanje: browser pridobi UTF-8 JSON z /api/print/racun/:id/nb80,
 * ga pošlje APK-u na /print-text → APK tiska prek NB80 PrinterService
 * (com.noryox.printer / com.pos.sdk) prek AIDL Binder.
 *
 * Encoding: NB80 PrinterService podpira UTF-8 nativno.
 * JSON vsebuje navadne UTF-8 nize — ni Windows-1250 pretvorbe (ta velja samo za ESC/POS bajte).
 *
 * Papir: 80 mm → 40 stolpcev.
 * Port: 8091 (ZCS most uporablja 8090).
 */

const NB80_BRIDGE_URL = "http://localhost:8091";

// ── Module-level cache ────────────────────────────────────────────────────────
let _cachedAvailable: boolean | null = null;
let _cacheExpiry = 0;

export function getNb80BridgeCached(): boolean | null {
  if (Date.now() < _cacheExpiry) return _cachedAvailable;
  return null;
}

function setCacheBridgeAvailable(ok: boolean) {
  _cachedAvailable = ok;
  _cacheExpiry = Date.now() + (ok ? 30_000 : 6_000);
}

export type Nb80Status = {
  ok: boolean;
  status?: string;
  error?: string;
};

export type Nb80RacunJson = {
  linee: string[];
  formati?: string[];  // 'B' = bold, 'N' = normal, 'C' = center, 'R' = right, 'L' = left
  qrUrl: string | null;
  qrBase64?: string;   // združljivostno polje; NB80 SDK uporablja qrUrl
  zoi?: string | null; // ZOI za Code 128 črtno kodo
};

/**
 * Preveri, ali NB80 tiskalni most (APK) teče na tej napravi.
 * Timeout 5 s.
 */
export async function isNb80BridgeAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${NB80_BRIDGE_URL}/status`, { signal: ctrl.signal });
    clearTimeout(t);
    const status = await res.json().catch(() => null) as Nb80Status | null;
    const ok = res.ok && status?.ok === true;
    setCacheBridgeAvailable(ok);
    return ok;
  } catch {
    setCacheBridgeAvailable(false);
    return false;
  }
}

export async function waitForNb80Bridge(
  attempts = 3,
  delayMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isNb80BridgeAvailable()) return true;
    if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

/**
 * Natisni račun prek NB80 mosta.
 * Pridobi besedilne vrstice iz /api/print/racun/:id/nb80,
 * nato pošlje JSON APK-u ki tiska nativno prek NB80 PrinterService.
 * @param cols  30 za 58mm papir (30 stolpcev), privzeto 40 za 80mm papir.
 */
export async function printNb80Receipt(
  racunId: number,
  zbirni?: boolean,
  cols?: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const enotaId = localStorage.getItem("pos_enota_id");
    const params = new URLSearchParams();
    if (zbirni) params.set("zbirni", "1");
    if (enotaId) params.set("enota_id", enotaId);
    if (cols) params.set("cols", String(cols));
    const qs = params.size ? `?${params.toString()}` : "";
    const apiUrl = `${base}/api/print/racun/${racunId}/nb80${qs}`;

    const apiRes = await fetch(apiUrl, { credentials: "include" });
    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({})) as { error?: string };
      if (apiRes.status === 401) return { ok: false, error: "Seja je potekla — osvežite stran in se prijavite." };
      return { ok: false, error: err.error ?? `Napaka strežnika (${apiRes.status})` };
    }
    const json = await apiRes.json() as Nb80RacunJson;
    return await printTextViaNb80Bridge(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    return { ok: false, error: msg };
  }
}

/**
 * Pošlji UTF-8 JSON z vrsticami in QR podatki NB80 tiskalniškemu mostu.
 * Timeout 20 s.
 */
export async function printTextViaNb80Bridge(
  data: Nb80RacunJson,
): Promise<{ ok: boolean; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${NB80_BRIDGE_URL}/print-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `APK napaka (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    clearTimeout(t);
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    if (msg.includes("abort") || msg.includes("network")) {
      return {
        ok: false,
        error: "NB80 tiskalni most ni dosegljiv. Preverite, da APK teče v ozadju (localhost:8091).",
      };
    }
    return { ok: false, error: msg };
  }
}

export type Nb80Diagnostics = {
  binderReady: boolean;
  serviceVersion: string | null;
  printerStatus: number;   // 0=OK, >0=napaka, -1=ni dosegljiv
  printerModel: string | null;
};

/**
 * Pridobi diagnostične podatke iz NB80 mosta (stanje Binderja, verzija, status tiskalnika, model).
 * Vrne null če most ni dosegljiv.
 */
export async function getNb80Diagnostics(): Promise<Nb80Diagnostics | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${NB80_BRIDGE_URL}/diagnostics`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as Nb80Diagnostics;
  } catch {
    return null;
  }
}

/**
 * Vrne stanje NB80 mosta za prikaz v UI.
 */
export async function getNb80BridgeStatus(): Promise<Nb80Status> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${NB80_BRIDGE_URL}/status`, { signal: ctrl.signal });
    clearTimeout(t);
    const json = (await res.json()) as Nb80Status;
    return json;
  } catch {
    return { ok: false, error: "Most ni dosegljiv" };
  }
}
