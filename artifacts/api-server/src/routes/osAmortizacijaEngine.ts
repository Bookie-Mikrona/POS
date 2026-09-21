/**
 * osAmortizacijaEngine.ts — Čisti izračun amortizacije osnovnih sredstev (Faza 3c)
 *
 * BREZ zapisovanja v bazo. Samo izračun po pravilih:
 *   1. Osnova = nabavna × (100 − neamortizljivi_del_pct) / 100
 *   2. Letna amortizacija = osnova × stopnja / 100 (računovodska IN davčna ločeno)
 *   3. Mesečno angažiranje: od datum_aktivacije do konca leta (ali datum_izpisa)
 *   4. Ustavitev pri polni odpisanosti: min(proporcionalna, preostalo)
 *   5. Agregacija po vseh doknjižbah sredstva (dograditve prevzamejo skupino glave)
 *   6. Sredstva brez skupine → označena, amortizacija 0
 *   7. Oslabitev (SRS 1.35+): oslabitevPrevLeto zmanjša efektivni preostalo za amort. N+1
 *      — porazdeljena sorazmerno po preostali vrednosti posameznih doknjižb.
 *
 * Natančnost: Decimal.js za vse aritmetične operacije.
 */

import Decimal from "decimal.js";
import { createHash } from "node:crypto";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ─── Vhodne strukture ────────────────────────────────────────────────────────

export interface DoknjizbaInput {
  id: string;
  seq: number;
  nabavnaVrednost: string;
  odpisanaVrednost: string;
  neamortizljiviDelPct: string;
  datumAktivacije: string | null; // "YYYY-MM-DD"
  datumIzpisa: string | null;     // "YYYY-MM-DD"
  status: string;
}

export interface SkupinaInput {
  id: string;
  koda: string;
  naziv: string;
  racunovodskaStonja: string; // numeric string, npr. "10.000"
  davcnaStonja: string;
}

export interface SredstvoInput {
  id: string;
  inventarnaSt: string;
  naziv: string;
  skupinaId: string | null;
  skupinaNaziv: string | null;
  skupinaKoda: string | null;
  racunovodskaStonja: string | null;
  davcnaStonja: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  status: string;
  doknjizbe: DoknjizbaInput[];
  /**
   * Datum prodaje / odtujitve celotnega sredstva (glava-raven).
   * Ko je nastavljeno, se za VSE doknjižbe tega sredstva uporabi ta datum
   * namesto per-doknjižba datumIzpisa.
   * Mesec odtujitve se NE šteje (endMonth = mesec_odtujitve − 1).
   * Sredstvo odtujeno PRED začetkom leta → stMesecev = 0 za vse doknjižbe.
   */
  datumOdtujitve?: string | null;
  /**
   * Oslabitev vrednosti iz zaključenega obračuna PRETEKLEGA leta (N-1).
   * Zmanjša efektivni preostali znesek (osnovo amortizacije) za to leto (N).
   * Vrednost "0.00" ali undefined = brez oslabitve.
   */
  oslabitevPrevLeto?: string;
  /**
   * Metoda oslabitve (1 ali 2) — za prikaz v UI in kronološkem pregledu.
   * Ni več neposredno v engine izračunu (engine uporablja oslabitevNovaLetnaAmRac).
   */
  oslabitevPrevLetoMetoda?: number;
  /**
   * Preračunana nova letna RAČUNOVODSKA amortizacija po oslabitvi
   * (= nova_knjižna_vrednost / preostala_doba).
   * Ko je > 0: NADOMESTI standardno stopnja×osnova za RAC amortizacijo tega sredstva.
   * Izračunana in shranjena v DB ob vnosu oslabitve; loading koda jo prenese od
   * najnovejšega leta z oslabitev_nova_letna_am_rac > 0.
   * "0.00" ali undefined = ni preračunane letne AM → standardna formula.
   */
  oslabitevNovaLetnaAmRac?: string;
}

// ─── Izhodne strukture ───────────────────────────────────────────────────────

export interface DoknjizbaAmortResult {
  id: string;
  seq: number;
  nabavnaVrednost: string;
  odpisanaVrednost: string;
  neamortizljiviDelPct: string;
  datumAktivacije: string | null;
  datumIzpisa: string | null;
  status: string;
  osnova: string;
  preostalo: string;
  stMesecev: number;
  letnaRacunovodska: string;
  letnaDavcna: string;
  obracunanaRacunovodska: string;
  obracunanaDavcna: string;
  /** preostalo − obracunanaRacunovodska (sedanja vrednost te doknjižbe po obračunu) */
  sedanjaVrednostPoObracunu: string;
  /** Pojasnilo: null = normalno, "brez_aktivacije", "polno_odpisano", "brez_skupine", "negativna_osnova" */
  opomba: string | null;
}

export interface SredstvoAmortResult {
  id: string;
  inventarnaSt: string;
  naziv: string;
  skupinaId: string | null;
  skupinaKoda: string | null;
  skupinaNaziv: string | null;
  racunovodskaStonja: string | null;
  davcnaStonja: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  status: string;
  brezSkupine: boolean;
  doknjizbe: DoknjizbaAmortResult[];
  skupnaOsnova: string;
  /** Preostalo PRED oslabitvijo — NV na začetku tega leta */
  skupnaPreostalo: string;
  /**
   * Oslabitev iz prejšnjega leta, ki je bila aplicirana na osnovo tega leta.
   * "0.00" = brez oslabitve.
   */
  skupnaOslabitev: string;
  skupnaObracunanaRacunovodska: string;
  skupnaObracunanaDavcna: string;
  /** skupnaPreostalo − skupnaOslabitev − skupnaObracunanaRacunovodska */
  sedanjaVrednostPoObracunu: string;
  /** true ko je skupnaObracunanaRacunovodska == "0.00" ker je že polno odpisano */
  polnoOdpisano: boolean;
  /**
   * Nova letna AM po oslabitvi (RAC). Prisotno ko oslabitevNovaLetnaAmRac > 0.
   * = nova_knjižna / preostala_doba, fiksna vrednost za vse kasnejše obračune.
   */
  novaLetnaAmPoOslabitvi?: string;
  /**
   * Nova amortizacijska stopnja po oslabitvi (%) = novaLetnaAmPoOslabitvi / skupnaOsnova × 100.
   * Prisotno ko novaLetnaAmPoOslabitvi > 0.
   */
  novaStopnjaPoOslabitvi?: string;
  /**
   * Leto aktivacije osnovne doknjižbe (seq=0), izpeljano iz datumAktivacije.
   * Potrebno za izračun pretečene dobe v UI predogledu oslabitve.
   */
  activationYear?: number;
}

export interface AmortizacijaVsote {
  skupajRacunovodska: string;
  skupajDavcna: string;
}

export interface AmortObracunResult {
  leto: number;
  skupajRacunovodska: string;
  skupajDavcna: string;
  steviloSredstev: number;
  brezSkupine: number;
  polnoOdpisanih: number;
  aktivnih: number; // ima amortizacijo > 0
  sredstva: SredstvoAmortResult[];
  /** Vsote po konto (accountCode) */
  poKontih: Array<{
    accountCode: string | null;
    accountName: string | null;
    skupajRacunovodska: string;
    skupajDavcna: string;
    stevilaSredstev: number;
  }>;
  /** Vsote po stroškovnem mestu */
  poStroskovnihMestih: Array<{
    costCenterCode: string | null;
    costCenterName: string | null;
    skupajRacunovodska: string;
    skupajDavcna: string;
    stevilaSredstev: number;
  }>;
}

// ─── Pomožne čiste funkcije (exportirane za testiranje) ──────────────────────

/**
 * Izračuna število mesecev angažiranja doknjižbe v danem letu.
 *
 * Pravila:
 * - brez datumAktivacije → 0
 * - aktivacija po koncu leta → 0
 * - aktivacija pred letom → startMonth = 1
 * - aktivacija v letu → startMonth = mesec aktivacije
 * - izpis pred letom → 0
 * - izpis v letu → endMonth = mesec izpisa
 * - brez izpisa ali izpis po letu → endMonth = 12
 * - doMeseca (opcijsko) → cap endMonth na doMeseca
 */
/**
 * Robustno pretvori datum v ISO string "YYYY-MM-DD".
 * Brani pred Date objekti, ki jih drizzle/pg lahko vrne namesto stringa.
 */
function toIsoDateStr(d: string | null): string {
  if (!d) return "";
  // Če je pg/drizzle pri izvajanju vrnil Date objekt (kljub tipizaciji string)
  if (typeof d === "object") {
    try {
      return (d as unknown as Date).toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }
  return d;
}

export type PraviloZacetkaAmortizacije = "naslednji_dan" | "naslednji_mesec";

export function calcMeseci(
  datumAktivacije: string | null,
  datumIzpisa: string | null,
  leto: number,
  doMeseca?: number,
  pravilo: PraviloZacetkaAmortizacije = "naslednji_dan",
): number {
  const effectiveDoMeseca = doMeseca ?? 12;
  const aktivStr = toIsoDateStr(datumAktivacije);
  if (!aktivStr || aktivStr.length < 7) return 0;

  const aktivYear = parseInt(aktivStr.slice(0, 4), 10);
  const aktivMonth = parseInt(aktivStr.slice(5, 7), 10);
  const aktivDay   = parseInt(aktivStr.slice(8, 10) || "1", 10);

  if (isNaN(aktivYear) || isNaN(aktivMonth)) return 0;
  if (aktivYear > leto) return 0; // aktivacija po letu

  // Izpis pred začetkom leta → 0
  const izpisStr = toIsoDateStr(datumIzpisa);
  if (izpisStr && izpisStr.length >= 7) {
    const izpisYear  = parseInt(izpisStr.slice(0, 4), 10);
    const izpisMonth = parseInt(izpisStr.slice(5, 7), 10);
    if (!isNaN(izpisYear)) {
      if (izpisYear < leto) return 0;
    }
  }

  // Določi startMonth
  let startMonth: number;
  if (aktivYear < leto) {
    startMonth = 1;
  } else {
    // aktivYear === leto
    if (pravilo === "naslednji_mesec") {
      startMonth = aktivMonth + 1;
    } else {
      // naslednji_dan: ali smo na zadnjem dnevu meseca?
      const lastDay = new Date(Date.UTC(aktivYear, aktivMonth, 0)).getUTCDate();
      if (aktivDay >= lastDay) {
        startMonth = aktivMonth + 1; // zadnji dan → amortizacija od naslednjega meseca
      } else {
        startMonth = aktivMonth;     // med mesecem → amortizacija od tega meseca
      }
    }
  }

  if (startMonth > effectiveDoMeseca) return 0;

  // Določi endMonth
  let endMonth = effectiveDoMeseca;
  if (izpisStr && izpisStr.length >= 7) {
    const izpisYear  = parseInt(izpisStr.slice(0, 4), 10);
    const izpisMonth = parseInt(izpisStr.slice(5, 7), 10);
    if (!isNaN(izpisYear) && !isNaN(izpisMonth)) {
      if (izpisYear === leto) {
        // Mesec izpisa se NE šteje (SRS: izloči pred koncem meseca → ta mesec 0)
        endMonth = Math.min(endMonth, izpisMonth - 1);
      }
      // izpisYear > leto → endMonth ostane effectiveDoMeseca
    }
  }

  return Math.max(0, endMonth - startMonth + 1);
}

export function calcOsnova(nabavnaVrednost: string, neamortizljiviDelPct: string): string {
  const nv = new Decimal(nabavnaVrednost);
  const pct = new Decimal(neamortizljiviDelPct);
  if (pct.gte(100)) return "0.00";
  return nv.mul(new Decimal(100).minus(pct)).div(100).toFixed(2);
}

export function calcLetna(osnova: string, stopnja: string): string {
  return new Decimal(osnova).mul(new Decimal(stopnja)).div(100).toFixed(2);
}

export function calcObracunana(
  letnaAmort: string,
  stMesecev: number,
  preostalo: string,
): string {
  if (stMesecev === 0) return "0.00";
  // Negativna ali nič letna amortizacija (npr. negativna NV = korekcijska doknjižba) → 0
  // Zaščita pred Decimal.min(negativna, pozitivna) = negativna
  if (new Decimal(letnaAmort).lte(0)) return "0.00";
  const proporcionalna = new Decimal(letnaAmort)
    .mul(stMesecev)
    .div(12)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const preostalaD = new Decimal(preostalo);
  if (preostalaD.lte(0)) return "0.00";
  // Dolimitiraj: ne sme preseči preostanka
  return Decimal.min(proporcionalna, preostalaD).toFixed(2);
}

// ─── Vhodni podpis za zastarelost ─────────────────────────────────────────────

/**
 * Izračuna SHA-256 hash vhodnih podatkov za zastarelostno primerjavo.
 * Vhod: pravilo + sortirane doknjižbe po sredstvih.
 */
export function computeVhodniPodpis(
  pravilo: string,
  doknjizbe: Array<{
    sredstvoId: string;
    seq: number;
    nabavnaVrednost: string;
    odpisanaVrednost: string;
    neamortizljiviDelPct: string;
    datumAktivacije: string | null;
    datumIzpisa: string | null;
    status: string;
  }>,
): string {
  const sorted = [...doknjizbe].sort((a, b) => {
    const c = a.sredstvoId.localeCompare(b.sredstvoId);
    return c !== 0 ? c : a.seq - b.seq;
  });
  const payload = JSON.stringify({ pravilo, doknjizbe: sorted });
  return createHash("sha256").update(payload).digest("hex");
}

// ─── Glavna funkcija izračuna ────────────────────────────────────────────────

/**
 * Izračuna amortizacijo za dano leto za seznam sredstev.
 * Brez dostopa do baze — vhod je že naložen seznam.
 * NE zapisuje ničesar.
 *
 * @param doMeseca - opcijsko: izračunaj samo do tega meseca (1–12). Brez: polno leto (12).
 *
 * Oslabitev (SRS 1.35+):
 *   s.oslabitevPrevLeto = oslabitev vnesena na zaključen obračun leta N-1.
 *   Zmanjša efektivni preostali znesek (cap) za amortizacijo tega leta (N).
 *   Porazdeljena sorazmerno po surovih preostalih vrednostih posameznih doknjižb.
 *
 *   s.oslabitevNovaLetnaAmRac = preračunana nova letna AM (nova_knjižna / preostala_doba),
 *   izračunana in shranjena ob vnosu oslabitve (PUT endpoint).
 *   Ko je > 0: NADOMESTI standardno formulo stopnja×osnova za RAČUNOVODSKO AM za to sredstvo.
 *   DAV amortizacija ostane po standardni formuli (davčna pravila so neodvisna od SRS oslabitve).
 *   Vrednost je fiksna (ne se preračunava vsako leto) — engine jo prejme od loading kode.
 */
export function calcAmortizacijaObracun(
  sredstva: SredstvoInput[],
  leto: number,
  doMeseca?: number,
  pravilo: PraviloZacetkaAmortizacije = "naslednji_dan",
): AmortObracunResult {
  const results: SredstvoAmortResult[] = [];

  let skupajRac = new Decimal(0);
  let skupajDav = new Decimal(0);
  let brezSkupineCount = 0;
  let polnoOdpisanihCount = 0;
  let aktivnihCount = 0;

  for (const s of sredstva) {
    const brezSkupine = !s.skupinaId || !s.racunovodskaStonja;

    // ── Faza 0: surovi preostali zneski po doknjižbah (za porazdelitev oslabitve) ──
    // Vedno izračunamo, tudi ko brezSkupine (safe default 0).
    let skupnaRawPreostalo = new Decimal(0);
    if (!brezSkupine) {
      for (const d of s.doknjizbe) {
        const osnova = calcOsnova(d.nabavnaVrednost, d.neamortizljiviDelPct);
        const odpisana = new Decimal(d.odpisanaVrednost);
        skupnaRawPreostalo = skupnaRawPreostalo.plus(
          Decimal.max(0, new Decimal(osnova).minus(odpisana)),
        );
      }
    }

    // Oslabitev iz prejšnjega leta: aplicira se na surovi preostali (cap)
    const oslabitevD = new Decimal(s.oslabitevPrevLeto ?? "0");
    const oslabitevApplied =
      skupnaRawPreostalo.gt(0)
        ? Decimal.min(oslabitevD, skupnaRawPreostalo)
        : new Decimal(0);

    // ── Faza 0.5: predhodni seštevek effectivePreostalo (za proporcionalno porazdelitev nova letna AM) ──
    // Samo ko je oslabitevNovaLetnaAmRac > 0 — nadomesti standardno stopnja×osnova formulo.
    const novaLetnaAmRacD = new Decimal(s.oslabitevNovaLetnaAmRac ?? "0");
    let effectivePreostaloTotal = new Decimal(0);
    if (novaLetnaAmRacD.gt(0) && !brezSkupine) {
      for (const d of s.doknjizbe) {
        const osnova = calcOsnova(d.nabavnaVrednost, d.neamortizljiviDelPct);
        const odpisana = new Decimal(d.odpisanaVrednost);
        const preostaloD = Decimal.max(0, new Decimal(osnova).minus(odpisana));
        let effectiveP = preostaloD;
        if (oslabitevApplied.gt(0) && skupnaRawPreostalo.gt(0)) {
          const reduction = oslabitevApplied
            .mul(preostaloD).div(skupnaRawPreostalo)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          effectiveP = Decimal.max(0, preostaloD.minus(reduction));
        }
        effectivePreostaloTotal = effectivePreostaloTotal.plus(effectiveP);
      }
    }

    // ── Faza 1: izračun amortizacije (z upoštevanjem oslabitve) ──────────────
    const dokResults: DoknjizbaAmortResult[] = [];
    let skupnaOsnova = new Decimal(0);
    let skupnaPreostalo = new Decimal(0); // raw preostalo (pred oslabitvijo)
    let skupnaObRac = new Decimal(0);
    let skupnaObDav = new Decimal(0);

    for (const d of s.doknjizbe) {
      const osnova = calcOsnova(d.nabavnaVrednost, d.neamortizljiviDelPct);
      const odpisana = new Decimal(d.odpisanaVrednost);
      const osnD = new Decimal(osnova);
      const preostaloD = Decimal.max(0, osnD.minus(odpisana));
      const preostalo = preostaloD.toFixed(2);

      // Efektivni preostali znesek po proporcionalni oslabitvi
      let effectivePreostaloD = preostaloD;
      if (oslabitevApplied.gt(0) && skupnaRawPreostalo.gt(0)) {
        const reduction = oslabitevApplied
          .mul(preostaloD)
          .div(skupnaRawPreostalo)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        effectivePreostaloD = Decimal.max(0, preostaloD.minus(reduction));
      }
      const effectivePreostalo = effectivePreostaloD.toFixed(2);

      let opomba: string | null = null;
      let obRac = "0.00";
      let obDav = "0.00";
      let letnaRac = "0.00";
      let letnaDav = "0.00";
      let stMesecev = 0;

      if (brezSkupine) {
        opomba = "brez_skupine";
      } else if (!d.datumAktivacije) {
        opomba = "brez_aktivacije";
      } else if (preostaloD.lte(0)) {
        opomba = "polno_odpisano";
      } else if (osnD.lt(0)) {
        // Negativna osnova = uvožena korekcijska doknjižba (storno dograditve).
        // Ne amortiziramo — amortizacija je 0. calcObracunana ima isto zaščito,
        // ampak dodamo opombo za preglednost v izpisu.
        opomba = "negativna_osnova";
      } else {
        // Glava-raven datumOdtujitve ima prednost pred per-doknjižba datumIzpisa
        const effectiveIzpis = s.datumOdtujitve ?? d.datumIzpisa;
        stMesecev = calcMeseci(d.datumAktivacije, effectiveIzpis, leto, doMeseca, pravilo);

        if (novaLetnaAmRacD.gt(0) && effectivePreostaloTotal.gt(0)) {
          // ── SRS 1.35+ oslabitev: nova letna AM = nova_knjižna / preostala_doba ──
          // Vrednost je preračunana in shranjena ob vnosu oslabitve.
          // Porazdeli proporcionalno po effectivePreostalo posameznih doknjižb.
          const fraction = effectivePreostaloD.div(effectivePreostaloTotal);
          letnaRac = novaLetnaAmRacD.mul(fraction)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
          // DAV ostane po standardni formuli (davčna pravila neodvisna od SRS oslabitve)
          letnaDav = calcLetna(osnova, s.davcnaStonja!);
        } else {
          // ── Standardna formula: letna = osnova × stopnja / 100 ──
          letnaRac = calcLetna(osnova, s.racunovodskaStonja!);
          letnaDav = calcLetna(osnova, s.davcnaStonja!);
        }
        // Cap: amortizacija ne sme preseči efektivnega preostanka
        obRac = calcObracunana(letnaRac, stMesecev, effectivePreostalo);
        obDav = calcObracunana(letnaDav, stMesecev, effectivePreostalo);
      }

      // sedanjaVrednostPoObracunu: NV po obračunu = preostalo_raw - oslabitev_fraction - amort
      const oslabitevFrakcija =
        oslabitevApplied.gt(0) && skupnaRawPreostalo.gt(0)
          ? oslabitevApplied
              .mul(preostaloD)
              .div(skupnaRawPreostalo)
              .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : new Decimal(0);
      const sedanjaPoObracunu = Decimal.max(
        0,
        preostaloD.minus(oslabitevFrakcija).minus(new Decimal(obRac)),
      ).toFixed(2);

      skupnaOsnova = skupnaOsnova.plus(osnD);
      skupnaPreostalo = skupnaPreostalo.plus(preostaloD); // raw
      skupnaObRac = skupnaObRac.plus(new Decimal(obRac));
      skupnaObDav = skupnaObDav.plus(new Decimal(obDav));

      dokResults.push({
        id: d.id,
        seq: d.seq,
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        neamortizljiviDelPct: d.neamortizljiviDelPct,
        datumAktivacije: d.datumAktivacije,
        datumIzpisa: d.datumIzpisa,
        status: d.status,
        osnova,
        preostalo,
        stMesecev,
        letnaRacunovodska: letnaRac,
        letnaDavcna: letnaDav,
        obracunanaRacunovodska: obRac,
        obracunanaDavcna: obDav,
        sedanjaVrednostPoObracunu: sedanjaPoObracunu,
        opomba,
      });
    }

    skupajRac = skupajRac.plus(skupnaObRac);
    skupajDav = skupajDav.plus(skupnaObDav);

    const isBrezSkupine = brezSkupine;
    const isPolnoOdpisano =
      !isBrezSkupine &&
      skupnaPreostalo.lte(0) &&
      s.doknjizbe.some((d) => !!d.datumAktivacije);
    const hasAmort = skupnaObRac.gt(0);

    if (isBrezSkupine) brezSkupineCount++;
    if (isPolnoOdpisano) polnoOdpisanihCount++;
    if (hasAmort) aktivnihCount++;

    // sedanjaVrednostPoObracunu na ravni sredstva
    const sedanjaVrednost = Decimal.max(
      0,
      skupnaPreostalo.minus(oslabitevApplied).minus(skupnaObRac),
    ).toFixed(2);

    // Nova letna AM in stopnja za prikaz (ko velja SRS 1.35+ preračun)
    const novaLetnaAmPoOslabitvi = novaLetnaAmRacD.gt(0)
      ? novaLetnaAmRacD.toFixed(2) : undefined;
    const novaStopnjaPoOslabitvi = (novaLetnaAmRacD.gt(0) && skupnaOsnova.gt(0))
      ? novaLetnaAmRacD.div(skupnaOsnova).mul(100)
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4)
      : undefined;

    // Leto aktivacije (seq=0 doknjizba) — za UI predogled oslabitve
    const seq0Aktivacija = s.doknjizbe.find((d) => d.seq === 0 && d.datumAktivacije)?.datumAktivacije;
    const activationYear = seq0Aktivacija
      ? parseInt((typeof seq0Aktivacija === "string" ? seq0Aktivacija : (seq0Aktivacija as unknown as Date).toISOString()).slice(0, 4), 10)
      : undefined;

    results.push({
      id: s.id,
      inventarnaSt: s.inventarnaSt,
      naziv: s.naziv,
      skupinaId: s.skupinaId,
      skupinaKoda: s.skupinaKoda,
      skupinaNaziv: s.skupinaNaziv,
      racunovodskaStonja: s.racunovodskaStonja,
      davcnaStonja: s.davcnaStonja,
      accountId: s.accountId,
      accountCode: s.accountCode,
      accountName: s.accountName,
      costCenterId: s.costCenterId,
      costCenterCode: s.costCenterCode,
      costCenterName: s.costCenterName,
      status: s.status,
      brezSkupine: isBrezSkupine,
      doknjizbe: dokResults,
      skupnaOsnova: skupnaOsnova.toFixed(2),
      skupnaPreostalo: skupnaPreostalo.toFixed(2),
      skupnaOslabitev: oslabitevApplied.toFixed(2),
      skupnaObracunanaRacunovodska: skupnaObRac.toFixed(2),
      skupnaObracunanaDavcna: skupnaObDav.toFixed(2),
      sedanjaVrednostPoObracunu: sedanjaVrednost,
      polnoOdpisano: isPolnoOdpisano,
      novaLetnaAmPoOslabitvi,
      novaStopnjaPoOslabitvi,
      activationYear: isNaN(activationYear ?? NaN) ? undefined : activationYear,
    });
  }

  // ─── Vsote po kontih ─────────────────────────────────────────────────────
  const kontiMap = new Map<
    string,
    { accountCode: string | null; accountName: string | null; rac: Decimal; dav: Decimal; cnt: number }
  >();
  for (const sr of results) {
    const key = sr.accountCode ?? "__NULL__";
    const entry = kontiMap.get(key) ?? {
      accountCode: sr.accountCode,
      accountName: sr.accountName,
      rac: new Decimal(0),
      dav: new Decimal(0),
      cnt: 0,
    };
    entry.rac = entry.rac.plus(new Decimal(sr.skupnaObracunanaRacunovodska));
    entry.dav = entry.dav.plus(new Decimal(sr.skupnaObracunanaDavcna));
    entry.cnt++;
    kontiMap.set(key, entry);
  }
  const poKontih = Array.from(kontiMap.values())
    .map((e) => ({
      accountCode: e.accountCode,
      accountName: e.accountName,
      skupajRacunovodska: e.rac.toFixed(2),
      skupajDavcna: e.dav.toFixed(2),
      stevilaSredstev: e.cnt,
    }))
    .sort((a, b) => (a.accountCode ?? "").localeCompare(b.accountCode ?? ""));

  // ─── Vsote po STM ────────────────────────────────────────────────────────
  const stmMap = new Map<
    string,
    { costCenterCode: string | null; costCenterName: string | null; rac: Decimal; dav: Decimal; cnt: number }
  >();
  for (const sr of results) {
    const key = sr.costCenterCode ?? "__NULL__";
    const entry = stmMap.get(key) ?? {
      costCenterCode: sr.costCenterCode,
      costCenterName: sr.costCenterName,
      rac: new Decimal(0),
      dav: new Decimal(0),
      cnt: 0,
    };
    entry.rac = entry.rac.plus(new Decimal(sr.skupnaObracunanaRacunovodska));
    entry.dav = entry.dav.plus(new Decimal(sr.skupnaObracunanaDavcna));
    entry.cnt++;
    stmMap.set(key, entry);
  }
  const poStroskovnihMestih = Array.from(stmMap.values())
    .map((e) => ({
      costCenterCode: e.costCenterCode,
      costCenterName: e.costCenterName,
      skupajRacunovodska: e.rac.toFixed(2),
      skupajDavcna: e.dav.toFixed(2),
      stevilaSredstev: e.cnt,
    }))
    .sort((a, b) => (a.costCenterCode ?? "ž").localeCompare(b.costCenterCode ?? "ž"));

  return {
    leto,
    skupajRacunovodska: skupajRac.toFixed(2),
    skupajDavcna: skupajDav.toFixed(2),
    steviloSredstev: sredstva.length,
    brezSkupine: brezSkupineCount,
    polnoOdpisanih: polnoOdpisanihCount,
    aktivnih: aktivnihCount,
    sredstva: results,
    poKontih,
    poStroskovnihMestih,
  };
}
