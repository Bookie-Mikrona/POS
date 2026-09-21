/**
 * osKronoloskiPregled.ts — Kronološki pregled gibanja vrednosti OS
 *
 * Čista funkcija brez dostopa do baze.
 * Vhod: doknjizbe + obracuni (naloženi od klicatelja).
 * Izhod: urejena zaporedje DOGODKOV s tekočo NV in kumulativnim PV.
 *
 * Veriženje:
 *   - NV raste ob nabavah/dogradilih
 *   - PV (akumulirani popravek vrednosti) = Σ uvožena_odpisana VSEH dok. + Σ obračunov + Σ oslabitev
 *     (velja za osnovo IN dograditve — uvožene dograditve imajo odpisana>0)
 *   - Neodpisana = tekoča NV − kumulativni PV (nikoli < 0)
 *
 * Oslabitev (SRS 1.35+):
 *   - Vnese se na zaključen letni obračun leta N.
 *   - V kronološkem pregledu se prikaže kot LOČENA vrstica (tip="oslabitev"),
 *     ki poveča skupni PV in zmanjša neodpisano vrednost.
 *   - Datum: 31.12.N (isti kot letni obračun, po obračunu).
 *
 * Veriga za 0001454:
 *   31.10.2024 Aktivacija: NV +1469, PV 0,    ned 1469
 *   31.12.2024 Letni obr. (2 mes.): AM 61,21, PV 61,21,  ned 1407,79
 *   31.07.2025 Medletni obr. (7 mes.): AM 214,23, PV 275,44, ned 1193,56
 */

import Decimal from "decimal.js";
import { lastDayOfMonthIso } from "./osRegisterMedletni";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ─── Vhodni tipi ─────────────────────────────────────────────────────────────

export interface KronoloskiDoknjizbaInput {
  seq: number;
  nabavnaVrednost: string;    // "1469.00"
  odpisanaVrednost: string;   // "0.00" ali uvožena za stara sredstva
  datumNabave: string;        // "YYYY-MM-DD"
  datumAktivacije: string | null;
  status: string;
  nazivVlaganja: string | null;
}

export interface KronoloskiObracunInput {
  leto: number;
  doMeseca: number;
  obracunano: string;   // "61.21"
  status: string;
  /**
   * Oslabitev vnesena na ta zaključen obračun (status=zakljucen).
   * "0.00" ali undefined = ni oslabitve za to leto.
   */
  oslabitev?: string;
  /**
   * Metoda oslabitve: 1 ali 2. Prikaže se v opisu kronološke vrstice.
   */
  oslabitevMetoda?: number;
  /**
   * Preračunana nova letna AM po oslabitvi (= nova_knjižna / preostala_doba).
   * Prikaže se v opisu kronološke vrstice oslabitve.
   */
  oslabitevNovaLetnaAmRac?: string | null;
  /**
   * Nova preostala doba v letih (Metoda 2). Prikaže se v opisu.
   */
  oslabitevNovaDobeLet?: number | null;
}

// ─── Izhodni tipi ─────────────────────────────────────────────────────────────

export interface KronoloskiDogodek {
  /** Datum dogodka "YYYY-MM-DD" */
  datum: string;
  /** Opis: "Aktivacija / nabava", "Dograditev — naziv", "Letni obračun (N mes.)", … */
  opis: string;
  /** Sprememba nabavne vrednosti (+NNN.NN ali "0.00") */
  spremembaNv: string;
  /** Obračunana amortizacija tega obdobja ("0.00" ali pozitivno) */
  obracunanaAm: string;
  /** Kumulativni popravek vrednosti ob koncu tega dogodka (amortizacija + oslabitev) */
  skupniPv: string;
  /** Neodpisana = tekoča NV − skupni PV */
  neodpisana: string;
  /**
   * Oslabitev tega leta (samo za dogodke z tip="oslabitev").
   * undefined = ni oslabitev-ereignis.
   */
  oslabitev?: string;
  /**
   * Metoda oslabitve (samo za tip="oslabitev"): 1 ali 2.
   * undefined = ni oslabitev-ereignis.
   */
  oslabitevMetoda?: number;
}

// ─── Pomožne čiste funkcije ───────────────────────────────────────────────────

/**
 * Izračuna dejansko število mesecev amortiziranja v danem obdobju.
 *
 * Pravilo "naslednji dan": aktivacija na zadnji dan meseca M →
 * amortizacija od 1. meseca M+1 dalje.
 * Za sredstva aktivirana pred letom → polno obdobje od januarja.
 *
 * @param firstAktivacija  Datum aktivacije seq=0 doknjizbe (ali null)
 * @param firstNabava      Datum nabave seq=0 doknjizbe (rezerva)
 * @param leto             Leto obračuna
 * @param doMeseca         Zadnji mesec obračuna (1–12)
 */
export function calcNMesecev(
  firstAktivacija: string | null,
  firstNabava: string,
  leto: number,
  doMeseca: number,
): number {
  const refDate = firstAktivacija ?? firstNabava;
  if (!refDate || refDate.length < 7) return doMeseca;

  const activYear = parseInt(refDate.slice(0, 4), 10);
  const activMonth = parseInt(refDate.slice(5, 7), 10);
  if (isNaN(activYear) || isNaN(activMonth)) return doMeseca;

  if (activYear < leto) {
    // Aktivirano pred tem letom → polno obdobje od januarja
    return doMeseca;
  }
  if (activYear > leto) {
    // Aktivirano po tem letu → ni amortizacije
    return 0;
  }
  // Aktivirano v tem letu → amortizacija od naslednjega meseca po aktivaciji
  const firstAmortMonth = activMonth + 1;
  if (firstAmortMonth > doMeseca) return 0;
  return doMeseca - firstAmortMonth + 1;
}

// ─── Glavna čista funkcija ────────────────────────────────────────────────────

/**
 * Izračuna kronološki pregled gibanja vrednosti za kartico OS.
 * Čista funkcija — brez dostopa do baze.
 *
 * Dogodki so urejeni kronološko po datumu; doknjizba-dogodki pred
 * obračun-dogodki na isti datum; oslabitev-dogodki po amortizacijo-događkih
 * na isti datum.
 *
 * @param datumOdtujitve  Datum prodaje/odtujitve celotnega sredstva (neobvezno).
 *                        Ko je nastavljeno, se na konec doda vrstica "Izločitev"
 *                        z negativno spremembo NV in ničelno neodpisano (razknjiženo).
 * @param razlogIzlocitve Besedilni razlog izločitve (prodaja/odpis/…).
 */
export function calcKronoloskiPregled(
  doknjizbe: KronoloskiDoknjizbaInput[],
  obracuni: KronoloskiObracunInput[],
  datumOdtujitve?: string | null,
  razlogIzlocitve?: string | null,
): KronoloskiDogodek[] {
  if (doknjizbe.length === 0) return [];

  // ── Interni tip za vmesno ureditev ──────────────────────────────────────
  type InternalEv =
    | { type: "dok"; datum: string; d: KronoloskiDoknjizbaInput }
    | { type: "obr"; datum: string; ob: KronoloskiObracunInput }
    | { type: "osl"; datum: string; ob: KronoloskiObracunInput; znesek: Decimal };

  const events: InternalEv[] = [];

  for (const d of doknjizbe) {
    const datum = d.datumAktivacije ?? d.datumNabave;
    events.push({ type: "dok", datum, d });
  }

  const sortedOb = [...obracuni].sort((a, b) =>
    a.leto !== b.leto ? a.leto - b.leto : a.doMeseca - b.doMeseca,
  );
  for (const ob of sortedOb) {
    const datum = lastDayOfMonthIso(ob.leto, ob.doMeseca);
    events.push({ type: "obr", datum, ob });

    // Oslabitev kot ločen dogodek na istem datumu (po amort. obračunu)
    const oslD = new Decimal(ob.oslabitev ?? "0");
    if (oslD.gt(0)) {
      events.push({ type: "osl", datum, ob, znesek: oslD });
    }
  }

  // Uredi kronološko; na isti datum: doknjizba → amort → oslabitev
  events.sort((a, b) => {
    const cmp = a.datum.localeCompare(b.datum);
    if (cmp !== 0) return cmp;
    const order = { dok: 0, obr: 1, osl: 2 };
    return order[a.type] - order[b.type];
  });

  // Seq=0 doknjizba za izračun N mesecev
  const firstDok = doknjizbe.find((d) => d.seq === 0) ?? doknjizbe[0];

  let tekocaNv = new Decimal(0);
  let tekociPv = new Decimal(0);
  const result: KronoloskiDogodek[] = [];

  for (const ev of events) {
    if (ev.type === "dok") {
      const nv = new Decimal(ev.d.nabavnaVrednost);
      const ov = new Decimal(ev.d.odpisanaVrednost);
      tekocaNv = tekocaNv.plus(nv);
      // Uvožena odpisana prispeva k PV za VSE doknjižbe (osnova IN dograditve).
      // Sveže dograditve imajo odpisana="0.00" → +0, brez učinka.
      // Uvožene dograditve iz starega sistema imajo odpisana>0 → pravi začetni PV.
      tekociPv = tekociPv.plus(ov);
      const neodpisana = Decimal.max(0, tekocaNv.minus(tekociPv));
      const opis =
        ev.d.seq === 0
          ? "Aktivacija / nabava"
          : ev.d.nazivVlaganja
            ? `Dograditev — ${ev.d.nazivVlaganja}`
            : "Dograditev";
      result.push({
        datum: ev.datum,
        opis,
        spremembaNv: nv.toFixed(2),
        obracunanaAm: "0.00",
        skupniPv: tekociPv.toFixed(2),
        neodpisana: neodpisana.toFixed(2),
      });
    } else if (ev.type === "obr") {
      const am = new Decimal(ev.ob.obracunano);
      tekociPv = tekociPv.plus(am);
      const neodpisana = Decimal.max(0, tekocaNv.minus(tekociPv));
      const n = calcNMesecev(
        firstDok.datumAktivacije,
        firstDok.datumNabave,
        ev.ob.leto,
        ev.ob.doMeseca,
      );
      const vrsta = ev.ob.doMeseca === 12 ? "Letni obračun" : "Medletni obračun";
      const opis = n > 0 ? `${vrsta} (${n} mes.)` : vrsta;
      result.push({
        datum: ev.datum,
        opis,
        spremembaNv: "0.00",
        obracunanaAm: am.toFixed(2),
        skupniPv: tekociPv.toFixed(2),
        neodpisana: neodpisana.toFixed(2),
      });
    } else {
      // type === "osl" — oslabitev (ločena postavka)
      tekociPv = tekociPv.plus(ev.znesek);
      const neodpisana = Decimal.max(0, tekocaNv.minus(tekociPv));
      const metoda = ev.ob.oslabitevMetoda ?? 1;
      const novaAmStr = ev.ob.oslabitevNovaLetnaAmRac && parseFloat(ev.ob.oslabitevNovaLetnaAmRac) > 0
        ? `, nova AM: ${parseFloat(ev.ob.oslabitevNovaLetnaAmRac).toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/leto`
        : "";
      result.push({
        datum: ev.datum,
        opis: `Oslabitev (${ev.ob.leto}, M${metoda}${novaAmStr})`,
        spremembaNv: "0.00",
        obracunanaAm: "0.00",
        skupniPv: tekociPv.toFixed(2),
        neodpisana: neodpisana.toFixed(2),
        oslabitev: ev.znesek.toFixed(2),
        oslabitevMetoda: metoda,
      });
    }
  }

  // ── Izločitev / odtujitev ────────────────────────────────────────────────────
  if (datumOdtujitve && datumOdtujitve.length >= 10 && result.length > 0) {
    // Vrstica izločitve:
    //  - Sprememba NV = −skupna_NV (razknjiženje nabavne vrednosti)
    //  - AM = 0.00
    //  - skupniPv = 0.00 (razknjiženje akumuliranega popravka vrednosti)
    //  - neodpisana = 0.00 (razknjižena celotna vrednost)
    const razlogStr = razlogIzlocitve?.trim()
      ? razlogIzlocitve.trim()
      : "odtujitev";
    const opisIzlocitev = `Izločitev — ${razlogStr}`;
    result.push({
      datum: datumOdtujitve.slice(0, 10),
      opis: opisIzlocitev,
      // Negativna sprememba NV (razknjiženje)
      spremembaNv: `-${tekocaNv.toFixed(2)}`,
      obracunanaAm: "0.00",
      skupniPv: "0.00",
      neodpisana: "0.00",
    });
  }

  return result;
}
