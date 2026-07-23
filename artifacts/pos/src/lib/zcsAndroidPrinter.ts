/**
 * ZCS Android tiskalni most — HTTP klient za lokalni APK strežnik.
 *
 * APK teče na istem ZCS Z92 terminalu in posluša na localhost:8090.
 * Tiskanje: browser pridobi UTF-8 JSON z /api/print/racun/:id/zcs,
 * ga pošlje APK-u na /print-text → APK tiska prek ZCS SDK (brez bajt kodiranja).
 *
 * Vir: artifacts/zcs-printer-bridge/
 */

const ZCS_BRIDGE_URL = "http://localhost:8090";

// ── Module-level cache ────────────────────────────────────────────────────────
// Ohrani zadnji znani rezultat med montažami komponent (dialog odprt/zaprt).
// Ko most ni zaznan: TTL 6s (pogosto preverjanje).
// Ko most je zaznan: TTL 30s (stabilno stanje, redkeje preverjamo).
let _cachedAvailable: boolean | null = null;
let _cacheExpiry = 0;

export function getZcsBridgeCached(): boolean | null {
  if (Date.now() < _cacheExpiry) return _cachedAvailable;
  return null; // cache je potekel
}

function setCacheBridgeAvailable(ok: boolean) {
  _cachedAvailable = ok;
  _cacheExpiry = Date.now() + (ok ? 30_000 : 6_000);
}

export type ZcsStatus = {
  ok: boolean;
  status?: string;
  error?: string;
};

export type ZcsRacunJson = {
  linee: string[];
  formati?: string[];  // 'B' = bold, 'N' = normal; ena vrednost na vrstico
  qrUrl: string | null;
};

/**
 * Preveri, ali ZCS tiskalni most (APK) teče na tej napravi.
 * Vrne true kadar HTTP strežnik odgovori z 200 — ne glede na stanje tiskalnika.
 * (Tiskalna pripravljenost se preverja ločeno v getZcsBridgeStatus.)
 * Timeout 5 s — Chrome Private Network Access preflight + dejanski klic.
 * Rezultat se shrani v module-level cache (30s če ok, 6s če ni).
 */
export async function isZcsBridgeAvailable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${ZCS_BRIDGE_URL}/status`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    // Dovolj je HTTP 200 — pomeni da APK HTTP strežnik teče.
    // ok:false pomeni tiskalnik še ni inicializiran, a most JE dosegljiv.
    const ok = res.ok;
    setCacheBridgeAvailable(ok);
    return ok;
  } catch {
    setCacheBridgeAvailable(false);
    return false;
  }
}

/**
 * Natisni račun prek ZCS mosta z UTF-8 JSON (brez bajt kodiranja šumevcev).
 * Pridobi besedilne vrstice in QR URL iz /api/print/racun/:id/zcs,
 * nato pošlje JSON APK-u ki tiska nativno prek ZCS SDK.
 */
export async function printZcsReceipt(
  racunId: number,
  zbirni?: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const enotaId = localStorage.getItem("pos_enota_id");
    const params = new URLSearchParams();
    if (zbirni) params.set("zbirni", "1");
    if (enotaId) params.set("enota_id", enotaId);
    const qs = params.size ? `?${params.toString()}` : "";
    const apiUrl = `${base}/api/print/racun/${racunId}/zcs${qs}`;

    const apiRes = await fetch(apiUrl, { credentials: "include" });
    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({})) as { error?: string };
      if (apiRes.status === 401) return { ok: false, error: "Seja je potekla — osvežite stran in se prijavite." };
      return { ok: false, error: err.error ?? `Napaka strežnika (${apiRes.status})` };
    }
    const json = await apiRes.json() as ZcsRacunJson;

    return await printTextViaZcsBridge(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    return { ok: false, error: msg };
  }
}

/**
 * Pošlji UTF-8 JSON z vrsticami in QR URL ZCS tiskalniškemu mostu.
 * Timeout 20 s — ZCS SDK tiskanje lahko vzame čas.
 */
export async function printTextViaZcsBridge(
  data: ZcsRacunJson,
): Promise<{ ok: boolean; error?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${ZCS_BRIDGE_URL}/print-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    const json = (await res.json()) as { ok: boolean; error?: string };

    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error: json.error ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    clearTimeout(t);
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    if (msg.includes("aborted") || msg.includes("abort")) {
      return { ok: false, error: "ZCS tiskalnik se ni odzval v 20 sekundah — preverite stanje APK-ja." };
    }
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return {
        ok: false,
        error:
          "ZCS tiskalni most ni dosegljiv. Preverite, da APK teče v ozadju (localhost:8090).",
      };
    }
    return { ok: false, error: msg };
  }
}

/**
 * Pošlji surove ESC/POS bajte ZCS tiskalniškemu mostu (legacy — za nazaj združljivo).
 */
export async function printViaZcsBridge(
  data: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${ZCS_BRIDGE_URL}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: data.buffer as ArrayBuffer,
    });

    const json = (await res.json()) as { ok: boolean; error?: string };

    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error: json.error ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
      return {
        ok: false,
        error:
          "ZCS tiskalni most ni dosegljiv. Preverite, da APK teče v ozadju (localhost:8090).",
      };
    }
    return { ok: false, error: msg };
  }
}

export type ZcsDiagnostics = {
  devFiles: string[];
  writableDevFiles: string[];
  zcsPackages: string[];
  sysLibs: string[];
  bridgeReady: boolean;
  status: string;
};

/**
 * Pridobi diagnostične podatke iz ZCS mosta (kateri /dev so dostopni, kateri ZCS paketi so nameščeni).
 */
export async function getZcsDiagnostics(): Promise<ZcsDiagnostics | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${ZCS_BRIDGE_URL}/diagnostics`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as ZcsDiagnostics;
  } catch {
    return null;
  }
}

/**
 * Vrne stanje ZCS mosta za prikaz v UI.
 */
export async function getZcsBridgeStatus(): Promise<ZcsStatus> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${ZCS_BRIDGE_URL}/status`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const json = (await res.json()) as ZcsStatus;
    return json;
  } catch {
    return { ok: false, error: "Most ni dosegljiv" };
  }
}
