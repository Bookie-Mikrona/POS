/**
 * osRegisterMedletni.ts — Čisti izračun medletnega registra OS
 *
 * BREZ dostopa do baze. Vhod: predhodno naloženi podatki.
 *
 * SKLOP 1 — ZAČETNO STANJE (1.1. izbranega leta):
 *   zacNV  = Σ nabavna_vrednost doknjižb aktiviranih PRED letom
 *   zacPV  = Σ uvozena_odpisana (pred_letnih) + Σ obracunano preteklih let
 *   zacNed = zacNV − zacPV
 *
 * SKLOP 2 — SPREMEMBE v obdobju:
 *   noveNabave  = Σ nabavna_vrednost doknjižb aktiviranih V letu
 *   amortObdobja = obracunano iz os_amortizacija_obracun_sredstvo za izbrano leto
 *   izlocitveNV/PV = 0 (ni podatkov — pripravljeno)
 *
 * SKLOP 3 — KONČNO STANJE:
 *   konNV  = zacNV + noveNabave − izlocitveNV
 *   konPV  = zacPV + amortObdobja − izlocitvePV
 *   konNed = konNV − konPV
 *
 * Klasifikacija doknjižbe po letu:
 *   datumAktivacije (ali datumNabave kot rezerva) → leto aktivacije
 *   < leto  → pred_letom (začetno stanje)
 *   == leto → v_letu (spremembe)
 *   > leto  → po_letu (ignoriramo)
 */

import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ─── Vhodni tipi ─────────────────────────────────────────────────────────────

export interface RegisterDoknjizbaInput {
  id: string;
  seq: number;
  nabavnaVrednost: string;
  /** Akumulirana amortizacija na dan uvoza (za mojca = 12/2023). */
  odpisanaVrednost: string;
  datumNabave: string;           // "YYYY-MM-DD"
  datumAktivacije: string | null; // "YYYY-MM-DD"
}

export interface RegisterSredstvoInput {
  id: string;
  inventarnaSt: string;
  naziv: string;
  skupinaId: string | null;
  status: string; // agregiran (resolveStatusSredstvo)
  steviloDoknjizb: number; // count(seq>0)
  doknjizbe: RegisterDoknjizbaInput[];
  /** Map: leto → obracunano (string); iz os_amortizacija_obracun_sredstvo */
  obracuniPoLetih: Map<number, string>;
  /**
   * Map: leto → oslabitev (string); iz os_amortizacija_obracun_sredstvo.oslabitev.
   * Oslabitev leta N se upošteva kot del PV od leta N+1 naprej
   * in kot ločena postavka v spremembe registra za leto N.
   */
  oslabitevPoLetih?: Map<number, string>;
  /**
   * Datum prodaje / odtujitve celotnega sredstva (glava-raven).
   * Kadar je nastavljeno in pade V izbrano leto registra:
   *   izlocitveNV = skupna NV (zacNV + noveNabave)
   *   izlocitvePV = zacPV + amortObdobja (akumulirani PV do dneva odtujitve)
   *   konNV = konPV = konNed = 0 (razknjiženo)
   * Kadar je nastavljeno in pade PRED letom registra:
   *   sredstvo ne sme biti v registru (klic. ga filtrira pred klicem).
   */
  datumOdtujitve?: string | null;
}

// ─── Izhodni tipi ─────────────────────────────────────────────────────────────

export interface MedletniRegisterVrstica {
  id: string;
  inventarnaSt: string;
  naziv: string;
  skupinaId: string | null;
  status: string;
  steviloDoknjizb: number;

  // Sklop 1
  zacNV: string;
  zacPV: string;
  zacNed: string;

  // Sklop 2
  noveNabave: string;
  amortObdobja: string;
  /** Oslabitev tega leta (iz zakljucenega obračuna leta) — ločena postavka */
  oslabiteVObdobja: string;
  izlocitveNV: string;
  izlocitvePV: string;

  // Sklop 3
  konNV: string;
  konPV: string;
  konNed: string;
}

export interface MedletniSeštevki {
  zacNV: string;
  zacPV: string;
  zacNed: string;
  noveNabave: string;
  amortObdobja: string;
  oslabiteVObdobja: string;
  izlocitveNV: string;
  izlocitvePV: string;
  konNV: string;
  konPV: string;
  konNed: string;
}

// ─── Pomožne čiste funkcije ───────────────────────────────────────────────────

/**
 * Razvrsti doknjizbo glede na leto (pred_letom / v_letu / po_letu).
 *
 * Prednostni vrstni red:
 *   1. datumAktivacije — kadar je podano
 *   2. datumNabave — rezerva za neaktivirane doknjižbe (v_teku)
 *
 * Vrne leto iz datuma za primerjavo z izbranim letom registra.
 */
export function razvrstiDoknjizbo(
  d: { datumAktivacije: string | null; datumNabave: string },
  leto: number,
): "pred_letom" | "v_letu" | "po_letu" {
  const refDate = d.datumAktivacije ?? d.datumNabave;
  if (!refDate || refDate.length < 4) return "pred_letom";
  const year = parseInt(refDate.slice(0, 4), 10);
  if (isNaN(year)) return "pred_letom";
  if (year < leto) return "pred_letom";
  if (year === leto) return "v_letu";
  return "po_letu";
}

/**
 * Izračuna zadnji dan meseca v ISO formatu "YYYY-MM-DD".
 * month je 1-baziran (1=jan … 12=dec).
 *
 * Primer: lastDayOfMonthIso(2024, 6) → "2024-06-30"
 *         lastDayOfMonthIso(2024, 12) → "2024-12-31"
 */
export function lastDayOfMonthIso(year: number, month: number): string {
  // Date.UTC(year, month, 0): ker je month v Datetu 0-baziran,
  // month (1-baziran) kot argument brez -1 = naslednji mesec, dan 0 = zadnji dan prejšnjega
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Izračuna medletni register za eno sredstvo.
 */
export function calcMedletniSredstvo(
  s: RegisterSredstvoInput,
  leto: number,
): MedletniRegisterVrstica {
  let zacNV = new Decimal(0);
  let zacPV_uvozena = new Decimal(0);
  let noveNabave = new Decimal(0);

  for (const d of s.doknjizbe) {
    const razv = razvrstiDoknjizbo(d, leto);
    if (razv === "pred_letom") {
      zacNV = zacNV.plus(new Decimal(d.nabavnaVrednost));
      zacPV_uvozena = zacPV_uvozena.plus(new Decimal(d.odpisanaVrednost));
    } else if (razv === "v_letu") {
      noveNabave = noveNabave.plus(new Decimal(d.nabavnaVrednost));
      // nove nabave: uvozena PV = 0 (nastale po uvozu, zato odpisana=0 v DB)
    }
    // po_letu: prihodnje nabave — ignoriramo
  }

  // Seštevek preteklih obračunov (leta < leto) vključno z oslabitvami teh let
  let pretekliObracuni = new Decimal(0);
  let pretekleOslabitve = new Decimal(0);
  for (const [obracunLeto, obracunano] of s.obracuniPoLetih) {
    if (obracunLeto < leto) {
      pretekliObracuni = pretekliObracuni.plus(new Decimal(obracunano));
      // Oslabitev leta obracunLeto vpliva na PV od naslednjega leta naprej
      const osl = new Decimal(s.oslabitevPoLetih?.get(obracunLeto) ?? "0");
      pretekleOslabitve = pretekleOslabitve.plus(osl);
    }
  }

  const zacPV = zacPV_uvozena.plus(pretekliObracuni).plus(pretekleOslabitve);
  const zacNed = zacNV.minus(zacPV);

  // Amortizacija tega leta (iz shranjenega obračuna — že pravilno omejena na mesec pred odtujitvijo)
  const amortObdobja = new Decimal(s.obracuniPoLetih.get(leto) ?? "0");

  // Oslabitev tega leta (ločena postavka v spremembe)
  const oslabiteVObdobja = new Decimal(s.oslabitevPoLetih?.get(leto) ?? "0");

  // ── Izločitve: odtujitev v tem letu → razknjiženje NV in PV ──────────────────
  let izlocitveNV = new Decimal(0);
  let izlocitvePV = new Decimal(0);

  if (s.datumOdtujitve) {
    const dispStr = s.datumOdtujitve;
    const dispYear = parseInt(dispStr.slice(0, 4), 10);
    if (!isNaN(dispYear) && dispYear === leto) {
      // Odtujeno v tem letu:
      //   izlocitveNV = skupna NV vseh doknjižb (zacNV + noveNabave)
      //   izlocitvePV = zacPV + amortObdobja + oslabiteVObdobja (akumulirani PV do odtujitve)
      // Rezultat: konNV = konPV = konNed = 0 (razknjiženo)
      izlocitveNV = zacNV.plus(noveNabave);
      izlocitvePV = zacPV.plus(amortObdobja).plus(oslabiteVObdobja);
    }
    // dispYear < leto → klic. bi moral filtrirati, ampak varovalka: vrni ničle
    // dispYear > leto → odtujitev v prihodnosti → ne vpliva na ta register
  }

  // Sklop 3 — končno stanje (konPV vključuje amort + oslabitev tega leta)
  const konNV = zacNV.plus(noveNabave).minus(izlocitveNV);
  const konPV = zacPV.plus(amortObdobja).plus(oslabiteVObdobja).minus(izlocitvePV);
  const konNed = konNV.minus(konPV);

  return {
    id: s.id,
    inventarnaSt: s.inventarnaSt,
    naziv: s.naziv,
    skupinaId: s.skupinaId,
    status: s.status,
    steviloDoknjizb: s.steviloDoknjizb,

    zacNV: zacNV.toFixed(2),
    zacPV: zacPV.toFixed(2),
    zacNed: zacNed.toFixed(2),

    noveNabave: noveNabave.toFixed(2),
    amortObdobja: amortObdobja.toFixed(2),
    oslabiteVObdobja: oslabiteVObdobja.toFixed(2),
    izlocitveNV: izlocitveNV.toFixed(2),
    izlocitvePV: izlocitvePV.toFixed(2),

    konNV: konNV.toFixed(2),
    konPV: konPV.toFixed(2),
    konNed: konNed.toFixed(2),
  };
}

/**
 * Seštevki vseh vrstic medletnega registra.
 */
export function calcMedletniSeštevki(
  vrstice: MedletniRegisterVrstica[],
): MedletniSeštevki {
  function sumCol(key: keyof MedletniRegisterVrstica): string {
    return vrstice
      .reduce((s, v) => s.plus(new Decimal(v[key] as string)), new Decimal(0))
      .toFixed(2);
  }

  return {
    zacNV: sumCol("zacNV"),
    zacPV: sumCol("zacPV"),
    zacNed: sumCol("zacNed"),
    noveNabave: sumCol("noveNabave"),
    amortObdobja: sumCol("amortObdobja"),
    oslabiteVObdobja: sumCol("oslabiteVObdobja"),
    izlocitveNV: sumCol("izlocitveNV"),
    izlocitvePV: sumCol("izlocitvePV"),
    konNV: sumCol("konNV"),
    konPV: sumCol("konPV"),
    konNed: sumCol("konNed"),
  };
}

/**
 * Razširjena vrstica registra — doda SRS metapodatke (stopnja, datumi, konti)
 * ki so pridobljeni prek JOIN v route handlerju, ne v čistem kalkulatorju.
 */
export interface EnrichedMedletniVrstica extends MedletniRegisterVrstica {
  /** Koda amortizacijske skupine (npr. "II.5"). */
  skupinaKoda: string | null;
  /** Naziv amortizacijske skupine. */
  skupinaNaziv: string | null;
  /** Računovodska amortizacijska stopnja (npr. "2.50"). */
  racunovodskaStonja: string | null;
  /** Davčna amortizacijska stopnja (npr. "2.50"). */
  davcnaStonja: string | null;
  /** Datum nabave iz seq=0 doknjizbe. */
  datumNabave: string | null;
  /** Datum aktivacije iz seq=0 doknjizbe. */
  datumAktivacije: string | null;
  /** Koda konta OS (iz accounts prek accountId). */
  accountCode: string | null;
  /** Koda konta popravka vrednosti. */
  kontoPopravkaCode: string | null;
  /** Koda konta amortizacijskega stroška. */
  kontoStroskaCode: string | null;
  /** Koda stroškovnega mesta. */
  costCenterCode: string | null;

  // ── Polja za urejanje sredstva (UUID-ji, ki jih potrebuje edit dialog) ──────
  /** UUID stroškovnega mesta (za edit dialog). */
  costCenterId?: string | null;
  /** UUID konta OS (za edit dialog). */
  accountId?: string | null;
  /** UUID konta popravka vrednosti (za edit dialog). */
  kontoPopravkaId?: string | null;
  /** UUID konta amortizacijskega stroška (za edit dialog). */
  kontoStroskaId?: string | null;
  /** Opomba na glavi (za edit dialog). */
  opomba?: string | null;
  /** Datum odtujitve (za edit dialog). */
  datumOdtujitve?: string | null;
  /** Razlog izločitve (za edit dialog). */
  razlogIzlocitve?: string | null;
}

export function emptyMedletniSeštevki(): MedletniSeštevki {
  return {
    zacNV: "0.00", zacPV: "0.00", zacNed: "0.00",
    noveNabave: "0.00", amortObdobja: "0.00", oslabiteVObdobja: "0.00",
    izlocitveNV: "0.00", izlocitvePV: "0.00",
    konNV: "0.00", konPV: "0.00", konNed: "0.00",
  };
}
