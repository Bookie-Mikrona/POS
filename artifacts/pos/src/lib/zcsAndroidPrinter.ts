/**
 * ZCS Android tiskalni most — HTTP klient za lokalni APK strežnik.
 *
 * APK teče na istem ZCS Z92 terminalu in posluša na localhost:8090.
 * Tiskanje: browser pridobi UTF-8 JSON z /api/print/racun/:id/zcs,
 * ga pošlje APK-u na /print-text → APK tiska prek ZCS SDK (brez bajt kodiranja).
 *
 * Vir: artifacts/zcs-printer-bridge/
 */

import { getAuthToken } from "@workspace/api-client-react";

const ZCS_BRIDGE_URL = "http://localhost:8090";

// ── Module-level cache ────────────────────────────────────────────────────────
// Ohrani zadnji znani rezultat med montažami komponent (dialog odprt/zaprt).
// Ko most ni zaznan: TTL 6s (pogosto preverjanje).
// Ko most je zaznan: TTL 30s (stabilno stanje, redkeje preverjamo).
let _cachedAvailable: boolean | null = null;
let _cacheExpiry = 0;
// model:"nyx" → most je NyxPrinterBridge (NB80, 40 kolon) → /api/print/racun/:id/nb80
// model:"zcs" ali null → ZcsPrinterBridge (30 kolon) → /api/print/racun/:id/zcs
let _bridgeModel: string | null = null;
// bridge:"bt"  → BtTiskalniMost v2.2+ (vsi BT tiskalniki, 32 kolon) → /api/print/racun/:id/zcs?cols=32
// bridge:"q10" → BtTiskalniMost ≤v2.1 (stara oznaka, enaka logika — za združljivost s starimi APK)
// bridge:"zcs" ali null → ZcsPrinterBridge (30 kolon) → /api/print/racun/:id/zcs (brez cols)
let _bridgeType: string | null = null;
// ZCS most 1.1.1+: besedilo in QR zna natisniti v enem SDK opravilu.
let _singleJobQr = false;

/**
 * Vrne true, če most vrača bridge tipa "bt" (v2.2+) ali "q10" (≤v2.1).
 * Oba pomenita BtTiskalniMost APK — "q10" je stara oznaka, "bt" nova.
 * Povsod v kodi uporabi ta helper namesto neposredne primerjave z nizi.
 */
export function isBtBridge(bridge: string | null | undefined): boolean {
  return bridge === "bt" || bridge === "q10";
}

/**
 * Določi število stolpcev za ZCS /zcs endpoint.
 *
 * Prioriteta:
 *  1. colsOverride — eksplicitno iz klicatelja (npr. PrintReceiptButton)
 *  2. isBtBridge(bridgeType) — most je BT → 32 (privzeto za 58mm papir)
 *  3. deviceSirina varnostna mreža — sirina=32 je VEDNO BT most (neambiguozno) → 32
 *     sirina=80 se NE upošteva tukaj (ambiguozno: NB80 ali BT 80mm — reši colsOverride)
 *  4. undefined → brez ?cols parametra → privzeto 30 (ZCS Z92)
 *
 * Eksportirana kot čista funkcija za testiranje.
 */
export function resolveBtCols(
  colsOverride: number | undefined,
  bridgeType: string | null | undefined,
  deviceSirina: number | undefined,
): number | undefined {
  if (colsOverride !== undefined) return colsOverride;
  if (isBtBridge(bridgeType)) return 32;
  // Varnostna mreža: sirina=32 je nedvoumno BT most — nikoli ne tiskaj s 30
  if (deviceSirina === 32) return 32;
  return undefined;
}

export function getZcsBridgeCached(): boolean | null {
  if (Date.now() < _cacheExpiry) return _cachedAvailable;
  return null; // cache je potekel
}

/** Vrne "nb80" ali "zcs" glede na zaznani model mosta. */
export function getZcsBridgeModel(): "nyx" | "zcs" {
  return _bridgeModel === "nyx" ? "nyx" : "zcs";
}

/**
 * Vrne tip mosta kot ga sporoči /status: "bt"/"q10" za BtTiskalniMost, "zcs" za ZCS, null če ni znano.
 * Uporablja se za izbiro cols: isBtBridge(tip) → 32 stolpcev, ostalo → 30.
 * Opomba: "q10" je stara oznaka APK ≤v2.1; "bt" je nova (v2.2+). Oba sta BT most.
 */
export function getZcsBridgeType(): "bt" | "q10" | "zcs" | null {
  if (_bridgeType === "bt") return "bt";
  if (_bridgeType === "q10") return "q10";
  if (_bridgeType === "zcs") return "zcs";
  return null;
}

const ZCS_BRIDGE_SEEN_KEY = "zcs_bridge_seen";

/** Most je bil v tej seji že dosegljiv — kasnejša nedosegljivost ni razlog za brskalniški tisk. */
export function wasZcsBridgeSeen(): boolean {
  try { return sessionStorage.getItem(ZCS_BRIDGE_SEEN_KEY) === "1"; } catch { return false; }
}

function setCacheBridgeAvailable(ok: boolean, model?: string, bridge?: string, singleJobQr?: boolean) {
  _cachedAvailable = ok;
  _cacheExpiry = Date.now() + (ok ? 30_000 : 6_000);
  if (ok) {
    try { sessionStorage.setItem(ZCS_BRIDGE_SEEN_KEY, "1"); } catch { /* ni pomnilnika */ }
  }
  if (model) _bridgeModel = model;
  if (bridge !== undefined) _bridgeType = bridge;
  _singleJobQr = singleJobQr === true;
}

export type ZcsStatus = {
  ok: boolean;
  status?: string;
  error?: string;
  /** "nyx" = NyxPrinterBridge (NB80, 40 kolon); odsotno = ZCS (30 kolon) */
  model?: string;
  /**
   * Tip mosta — APK ga sporoči v /status odgovoru:
   *   "q10" = BtTiskalniMost (BT, 58mm, 32 stolpcev → /zcs?cols=32)
   *   "zcs" = ZcsPrinterBridge (ZCS Z92, 30 stolpcev)
   *   odsotno = starejši APK brez polja → privzeto ZCS (30 stolpcev)
   */
  bridge?: string;
  /** ZCS most 1.1.1+: eno opravilo za besedilo + QR, brez vmesnega čakanja. */
  singleJobQr?: boolean;
};

export type ZcsRacunJson = {
  linee: string[];
  formati?: string[];  // 'B' = bold, 'N' = normal; ena vrednost na vrstico
  qrUrl: string | null;
  /** PNG QR slika kot base64 — APK jo natisne kot bitmap (strežnik doda dinamično) */
  qrBase64?: string;
  /** ZOI za Code 128 črtno kodo v APK-ju (strežnik doda dinamično) */
  zoi?: string | null;
  /**
   * Število stolpcev (cols) — ista vrednost kot ?cols query param na /zcs oz. /nb80.
   * BtTiskalniMost v2.4+ bere to polje in izriše sliko prave širine
   * (32 kol → 384 px / 58mm; 40 kol → 576 px / 80mm).
   * Starejši APK polje ignorira → varna za vse naprave.
   */
  cols?: number;
  /**
   * Fizična širina papirja v mm (58 ali 80).
   * BtTiskalniMost v2.4+ ga posreduje tiskalniški gonilnik za izbiro bitmap ločljivosti.
   * Neobvezno — če manjka, APK pade na lastno nastavitev.
   */
  sirina?: number;
};


/**
 * Poskusi vzpostaviti stik z ZCS mostom — retry logika za prebujanje uspavanega APK.
 * Kliče /status do `retries`-krat z `delayMs` pavzo med poskusi.
 * Vrne true takoj ko most odgovori, false ko po vseh poskusih ni odziva.
 * Vsak uspešen klic posodobi module-level cache (_bridgeType, _bridgeModel).
 *
 * Opomba: Android pogosto uspava ozadnjske APK-je. En /status klic jih pogosto prebudi.
 */
export async function waitForZcsBridge(retries = 3, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (i > 0) await new Promise<void>(r => setTimeout(r, delayMs));
    const ok = await isZcsBridgeAvailable();
    if (ok) return true;
  }
  return false;
}

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
    // Parsiraj model (nyx/zcs) in bridge ("q10"|"zcs") za dinamični izbor endpointa in cols
    if (ok) {
      try {
        const json = await res.clone().json() as ZcsStatus;
        setCacheBridgeAvailable(ok, json.model, json.bridge ?? undefined, json.singleJobQr);
      } catch { setCacheBridgeAvailable(ok); }
    } else {
      setCacheBridgeAvailable(ok);
    }
    return ok;
  } catch {
    setCacheBridgeAvailable(false);
    return false;
  }
}

/**
 * Natisni račun prek ZCS mosta z UTF-8 JSON (brez bajt kodiranja šumevcev).
 * Pridobi besedilne vrstice in QR URL iz ustreznega API endpointa,
 * nato pošlje JSON APK-u ki tiska nativno.
 * Endpoint: /nb80 (40 kolon) kadar most vrne model:"nyx" (NyxPrinterBridge),
 *           /zcs  (30 kolon) za ZcsPrinterBridge (privzeto).
 *
 * @param modelOverride — ekspliciten override za model ("nyx"|"zcs"), zaobide
 *   async zaznavanje. Nastavi ga iz naprava.terminalConfig.tiskalnikSirina,
 *   da preprečiš napake ko dve napravi z različnima tiskalnikoma tečeta hkrati.
 */
export async function printZcsReceipt(
  racunId: number,
  zbirni?: boolean,
  modelOverride?: "nyx" | "zcs",
  /** Za NB80 58mm papir (30 stolpcev): pošlje ?cols=30 na /nb80 endpoint. */
  colsOverride?: number,
  /**
   * Širina papirja naprave (iz terminalConfig.tiskalnikSirina).
   * Varnostna mreža za cols kadar most ni bil predhodno zaznan:
   * sirina=32 je nedvoumno BT most → cols=32 (nikoli ne tiskamo s 30).
   */
  deviceSirina?: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Če je modelOverride podan (iz tiskalnikSirina nastavitve naprave), ga
    // uporabi neposredno in preskoci async zaznavanje — prepreči napako ko se
    // _bridgeModel ohrani od druge naprave ali pred-prejšnje seje.
    let effectiveModel: string | null = modelOverride ?? null;

    if (effectiveModel === null) {
      // Brez override: stara logika — zaznaj model iz /status.
      // KRITIČNO: fetch se zgodi PRED izračunom effectiveCols, da _bridgeType
      // in _bridgeModel odražata aktualno stanje (popravi hladni start).
      if (_bridgeModel === null) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 2000);
          const r = await fetch(`${ZCS_BRIDGE_URL}/status`, { signal: ctrl.signal });
          clearTimeout(t);
          if (r.ok) {
            const s = await r.json() as ZcsStatus;
            if (s.model) _bridgeModel = s.model;
            // ← POPRAVEK: posodobi bridge tip (prej manjkalo → cols ni bil nastavljen ob hladnem startu)
            if (s.bridge !== undefined) _bridgeType = s.bridge;
            _singleJobQr = s.singleJobQr === true;
          }
        } catch { /* most ni dosegljiv — bo javil napako spodaj */ }
      }
      effectiveModel = _bridgeModel;
    }

    const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
    const enotaId = localStorage.getItem("pos_enota_id");
    const params = new URLSearchParams();
    if (zbirni) params.set("zbirni", "1");
    if (enotaId) params.set("enota_id", enotaId);

    // Cols: resolveBtCols uveljavlja prioriteto (override > bridge zaznava > sirina varnostna mreža)
    const effectiveCols = resolveBtCols(colsOverride, _bridgeType, deviceSirina);
    if (effectiveCols) params.set("cols", String(effectiveCols));

    const qs = params.size ? `?${params.toString()}` : "";
    // model:"nyx" (NB80, 40 ali 30 kolon) → /nb80; ZCS/Q10 (30 ali 32 kolon) → /zcs
    const endpoint = effectiveModel === "nyx" ? "nb80" : "zcs";
    const apiUrl = `${base}/api/print/racun/${racunId}/${endpoint}${qs}`;

    // Tiskalni endpoint je zaščiten z isto Clerk avtentikacijo kot ostali POS API-ji.
    // Sam credentials:"include" ni dovolj zanesljiv, ker Clerk seja uporablja
    // Bearer žeton; brez njega lahko most deluje, pridobitev računa pa vrne 401.
    const token = await getAuthToken();
    const apiRes = await fetch(apiUrl, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({})) as { error?: string };
      if (apiRes.status === 401) return { ok: false, error: "Seja je potekla — osvežite stran in se prijavite." };
      return { ok: false, error: err.error ?? `Napaka strežnika (${apiRes.status})` };
    }
    const json = await apiRes.json() as ZcsRacunJson;

    // USKLADITEV: telo mostu mora nesti iste cols/sirina kot ?cols query param na /zcs.
    // BtTiskalniMost v2.4+ bere cols iz telesa in izriše sliko prave širine:
    //   cols=32 → 384px/58mm, cols=40 → 576px/80mm.
    // Starejši APK polje ignorira → varna za vse naprave.
    const bodyExtra: Pick<ZcsRacunJson, "cols" | "sirina"> = {};
    if (effectiveCols !== undefined) bodyExtra.cols = effectiveCols;
    if (deviceSirina !== undefined) bodyExtra.sirina = deviceSirina;

    // ZCS Z92 SDK most za besedilo in QR uporabi dve asinhroni tiskalni opravili.
    // Če sta obe poslani v istem /print-text klicu, QR-opravilo prekine besedilo
    // približno po devetih vrsticah. APK-ja na terminalu ne spreminjamo: samo za
    // izvorni ZCS Z92 najprej pošljemo besedilo, počakamo, nato QR/ZOI ločeno.
    const isOriginalZcsZ92 =
      effectiveModel === "zcs" &&
      !isBtBridge(_bridgeType) &&
      effectiveCols === undefined;
    const hasGraphicTrailer = Boolean(json.qrUrl || json.zoi);

    if (isOriginalZcsZ92 && hasGraphicTrailer && _singleJobQr) {
      return await printTextViaZcsBridge({ ...json, ...bodyExtra });
    }

    if (isOriginalZcsZ92 && hasGraphicTrailer) {
      const textResult = await printTextViaZcsBridge({
        ...json,
        ...bodyExtra,
        qrUrl: null,
        qrBase64: undefined,
        zoi: null,
      });
      if (!textResult.ok) return textResult;

      const textWaitMs = Math.min(12_000, Math.max(1_500, json.linee.length * 150 + 500));
      await new Promise<void>((resolve) => setTimeout(resolve, textWaitMs));

      return await printTextViaZcsBridge({
        // Brez umetne prazne vrstice: ZCS most sicer iz nje zgradi dodatno
        // asinhrono opravilo s tremi praznimi vrsticami tik pred QR.
        linee: [],
        formati: [],
        qrUrl: json.qrUrl,
        qrBase64: json.qrBase64,
        zoi: json.zoi,
        ...bodyExtra,
      });
    }

    return await printTextViaZcsBridge({ ...json, ...bodyExtra });
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
