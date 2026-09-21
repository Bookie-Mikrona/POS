/**
 * osUvoz.ts — Uvozna funkcija za register osnovnih sredstev (Faza 3 — uvoz)
 *
 * POST /os/:companyId/uvoz?dryRun=true|false
 *   multipart/form-data, polje "file" (.xlsx ali .csv)
 *
 * Vrstni red uvoza:
 *   1. Amortizacijske_skupine → upsert os_amortizacijske_skupine
 *   2. Stroskovna_mesta       → upsert cost_centers
 *   3. Sredstva               → insert osnovna_sredstva + os_doknjizbe (seq≥0)
 *      - stolpec "doknjizba" (int, privzeto 0): 0=glava, 1/2/3=dograditve
 *      - vrstice z isto inventarno se grupirajo; glava=seq0, dograditve=seq>0
 *      - sirota (ni seq=0): najnižji seq postane glava, opozorilo v napake[]
 *
 * dryRun=true  → samo validacija, NI zapisov v DB; vrne predogled
 * dryRun=false → polni vpis v transakciji
 */

import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import multer from "multer";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  osAmortizacijskeSkupineTable,
  osnovnaSredstvaTable,
  osDoknjizbeTable,
  osRolesTable,
  companyModulesTable,
  costCentersTable,
  accountsTable,
  counterpartiesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { isSuperAdmin } from "../middlewares/requireSuperAdmin";
import {
  XlsxBranjeNapaka,
  matrikaVObjekte,
  matrikaVObjekteZVrednostmi,
  preberiXlsxObjekte,
  preberiXlsxTipizirano,
  xlsxMatrikaZaStevilskeStolpce,
} from "../lib/uvoz/xlsx-branje";
import { preberiCsvMatriko } from "../lib/uvoz/parser-csv";

const router: IRouter = Router();
type OsXlsxVrednost = string | number;
type OsXlsxVrstica = Record<string, OsXlsxVrednost>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function ep(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// ─── Dostop (pisanje: os_admin ali os_user) ───────────────────────────────────

async function resolveOsWriteAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<boolean> {
  if (isSuperAdmin(clerkUserId)) return true;
  const [moduleRow] = await db
    .select({ module: companyModulesTable.module })
    .from(companyModulesTable)
    .where(
      and(
        eq(companyModulesTable.companyId, companyId),
        eq(companyModulesTable.module, "osnovna_sredstva"),
      ),
    )
    .limit(1);
  if (!moduleRow) {
    res.status(403).json({ error: "Modul Osnovna sredstva ni aktiviran za to podjetje" });
    return false;
  }
  const [row] = await db
    .select({ role: osRolesTable.role })
    .from(osRolesTable)
    .where(
      and(
        eq(osRolesTable.clerkUserId, clerkUserId),
        eq(osRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (!row || (row.role !== "os_admin" && row.role !== "os_user")) {
    res.status(403).json({ error: "Uvoz zahteva vlogo os_admin ali os_user" });
    return false;
  }
  return true;
}

// ─── Čiste pomožne funkcije (izvožene za teste) ───────────────────────────────

/**
 * Razčleni slovensko številsko obliko: "21.907,86" → 21907.86
 * Podpira: pika=tisočice, vejica=decimalno ločilo; že število.
 */
export function parseSloCurrency(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

/**
 * Razčleni slovensko obliko datuma: "31.12.2022" → "2022-12-31"
 * Podpira: dd.mm.yyyy, d.m.yyyy, ISO, XLSX serijski datum, Date objekt.
 */
export function parseSloDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && raw > 0) {
    // XLSX serijski datum (dni od 1900-01-01)
    const epoch = (raw - 25569) * 86400 * 1000;
    const d = new Date(epoch);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;
  // Object-mode ExcelJS adapter uporablja raw:false besedilo. Serijski datum je
  // zato lahko niz, medtem ko ga je SheetJS object-mode prej vrnil kot number.
  if (/^\d+(?:\.0+)?$/.test(s)) {
    return parseSloDate(Number(s));
  }
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const ameriskiKratek = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (ameriskiKratek) {
    return `20${ameriskiKratek[3]}-${ameriskiKratek[1].padStart(2, "0")}-${ameriskiKratek[2].padStart(2, "0")}`;
  }
  const ameriskiPolni = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ameriskiPolni) {
    return `${ameriskiPolni[3]}-${ameriskiPolni[1].padStart(2, "0")}-${ameriskiPolni[2].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/**
 * Poišče ID konta po šifri s tremi strategijami:
 * 1) natančno ujemanje
 * 2) 7-mestna (npr. 0400000) → 3-mestna (040)
 * 3) 3-mestna (040) → 7-mestna (0400000)
 */
export function resolveAccountId(
  code: unknown,
  accountIndex: Map<string, string>,
): string | null {
  if (code === null || code === undefined) return null;
  const c = String(code).trim();
  if (!c) return null;
  if (accountIndex.has(c)) return accountIndex.get(c)!;
  if (c.length === 7 && c.endsWith("0000")) {
    const short = c.slice(0, 3);
    if (accountIndex.has(short)) return accountIndex.get(short)!;
  }
  if (c.length === 3) {
    const long = c + "0000";
    if (accountIndex.has(long)) return accountIndex.get(long)!;
  }
  return null;
}

/**
 * Poišče ID stroškovnega mesta:
 * 1) Natančno ujemanje po kodi
 * 2) Fallback po nazivu (case-insensitive)
 */
export function resolveCostCenterId(
  stmCode: string,
  stmNaziv: string,
  codeIndex: Map<string, string>,
  nameIndex: Map<string, string>,
): string | null {
  if (!stmCode && !stmNaziv) return null;
  if (stmCode && codeIndex.has(stmCode)) return codeIndex.get(stmCode)!;
  if (stmNaziv && nameIndex.has(stmNaziv.toLowerCase())) return nameIndex.get(stmNaziv.toLowerCase())!;
  return null;
}

/**
 * Poišče ID partnerja/dobavitelja:
 * 1) Natančno ujemanje po davčni številki (strippa SI/si prefix pred primerjavo)
 * 2) Fallback po nazivu (case-insensitive)
 * Index taxIdIndex hrani ključe BREZ SI prefiksa.
 */
export function resolvePartnerId(
  davcna: string,
  naziv: string,
  taxIdIndex: Map<string, string>,
  nameIndex: Map<string, string>,
): string | null {
  if (!davcna && !naziv) return null;
  if (davcna) {
    const stripped = davcna.replace(/^SI/i, "").trim();
    if (stripped && taxIdIndex.has(stripped)) return taxIdIndex.get(stripped)!;
    if (davcna && taxIdIndex.has(davcna)) return taxIdIndex.get(davcna)!;
  }
  if (naziv && nameIndex.has(naziv.toLowerCase())) return nameIndex.get(naziv.toLowerCase())!;
  return null;
}

/**
 * Preslikava za uvoz-obogatitev: glede na resolved vrednosti in trenutno DB stanje
 * vrne, katera polja je treba napolniti (samo IS NULL polja). Čista funkcija — testabilna.
 */
export interface ObogatitvePlan {
  sredstvoId: string;
  /** Napolni costCenterId le, če resolved !== null IN obstoječe IS NULL */
  costCenterId: string | null;
  kontoPopravkaId: string | null;
  kontoStroskaId: string | null;
  /** ID seq=0 doknjižbe, ki ji napolniti partnerId */
  doknjizbaId: string | null;
  partnerId: string | null;
}

export function buildObogatitvePlan(
  existing: {
    id: string;
    costCenterId: string | null;
    kontoPopravkaId: string | null;
    kontoStroskaId: string | null;
  } | null,
  resolved: {
    costCenterId: string | null;
    kontoPopravkaId: string | null;
    kontoStroskaId: string | null;
    partnerId: string | null;
  },
  seq0: { id: string; partnerId: string | null } | null,
): ObogatitvePlan | null {
  if (!existing) return null;
  return {
    sredstvoId: existing.id,
    costCenterId: resolved.costCenterId !== null && existing.costCenterId === null ? resolved.costCenterId : null,
    kontoPopravkaId: resolved.kontoPopravkaId !== null && existing.kontoPopravkaId === null ? resolved.kontoPopravkaId : null,
    kontoStroskaId: resolved.kontoStroskaId !== null && existing.kontoStroskaId === null ? resolved.kontoStroskaId : null,
    doknjizbaId: seq0?.id ?? null,
    partnerId: resolved.partnerId !== null && seq0 !== null && seq0.partnerId === null ? resolved.partnerId : null,
  };
}

/**
 * Določi status sredstva:
 * - odpisan=DA → "odpisano"
 * - datum_aktivacije podan → "v_uporabi"
 * - sicer → "v_teku"
 */
export function buildSredstvoStatus(
  odpisanFlag: boolean,
  nabavna: number | null,
  odpisana: number | null,
  datumAktivacije: string | null,
): "odpisano" | "v_uporabi" | "v_teku" {
  if (odpisanFlag) return "odpisano";
  if (datumAktivacije) return "v_uporabi";
  return "v_teku";
}

/** "DA"/"da"/"x"/"1"/"true" → true; vse ostalo → false */
export function parseBoolean(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw).trim().toLowerCase();
  return s === "da" || s === "yes" || s === "true" || s === "1" || s === "x";
}

/**
 * Razčleni stolpec "doknjizba": int ≥ 0.
 * Prazno/""/null → 0 (osnovni nakup). Negativno → 0 + opozorilo v klicatelju.
 */
export function parseDoknjizba(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
  const n = parseInt(String(raw).trim(), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface UvozNapaka {
  sheet: string;
  vrstica: number;
  polje: string;
  opis: string;
}

export interface UvozPreview {
  dryRun: true;
  skupineCount: number;
  stmCount: number;
  sredstvaCount: number;    // število glav (edinstvenih inventarnih)
  dograditveCount: number;  // število doknjižb seq>0
  napake: UvozNapaka[];
}

export interface UvozRezultat {
  dryRun: false;
  skupineUpserted: number;
  stmUpserted: number;
  sredstvaInserted: number;
  dograditveInserted: number;
  preskocena: number;
  napake: UvozNapaka[];
}

// ─── Grupiranje sredstev po inventarni ────────────────────────────────────────

export interface SredstvoVrstica {
  vrstica: number;
  inventarna: string;
  naziv: string;
  skupina: string;
  konto: string;
  /** Koda stroškovnega mesta (iz stolpca stm/STM/stroskovno_mesto). */
  stm: string;
  /** Koda konta popravka vrednosti (opcijsko — če je v XLSX). */
  kontoPopravka: string;
  /** Koda konta amortizacijskega stroška (opcijsko — če je v XLSX). */
  kontoStroska: string;
  /** Davčna številka dobavitelja (opcijsko — za lookup v counterparties). */
  partnerDavcna: string;
  /** Naziv dobavitelja (opcijsko — fallback za lookup po imenu). */
  partnerNaziv: string;
  nabavna: number | null;
  odpisana: number | null;
  datumNabave: string | null;
  datumAktivacije: string | null;
  odpisan: boolean;
  doknjizba: number;
}

export interface SredstvoGrupa {
  inventarna: string;
  glava: SredstvoVrstica;        // vrstica z doknjizba=0 (ali najnižji seq pri siroti)
  dograditve: SredstvoVrstica[]; // vrstice z doknjizba>0, sortirane naraščajoče
  sirota: boolean;               // true = ni bilo vrstice z doknjizba=0
}

/**
 * Grupira razčlenjene vrstice po inventarni.
 * Podvojeni seq znotraj iste inventarne → napaka + preskok (ostane prvi).
 * Sirota (ni seq=0): najnižji seq postane glava, opozorilo v napake[].
 */
export function groupByInventarna(
  rows: SredstvoVrstica[],
  napake: UvozNapaka[],
): SredstvoGrupa[] {
  const byInv = new Map<string, SredstvoVrstica[]>();
  for (const row of rows) {
    if (!byInv.has(row.inventarna)) byInv.set(row.inventarna, []);
    byInv.get(row.inventarna)!.push(row);
  }

  const result: SredstvoGrupa[] = [];

  for (const [inventarna, vrstice] of byInv) {
    // Dedupliciranje po seq — prvi zmaga, ostali v napake[]
    const seqSeen = new Map<number, SredstvoVrstica>();
    for (const v of vrstice) {
      if (seqSeen.has(v.doknjizba)) {
        napake.push({
          sheet: "Sredstva", vrstica: v.vrstica, polje: "doknjizba",
          opis: `Podvojena doknjižba seq=${v.doknjizba} za ${inventarna} (prvič v vrstici ${seqSeen.get(v.doknjizba)!.vrstica}) — preskočeno`,
        });
      } else {
        seqSeen.set(v.doknjizba, v);
      }
    }
    const unique = Array.from(seqSeen.values()).sort((a, b) => a.doknjizba - b.doknjizba);

    // Glava: seq=0; sirota: najnižji seq prevzame vlogo glave
    const glavaVrstica = unique.find(v => v.doknjizba === 0) ?? null;
    const sirota = glavaVrstica === null;
    const glava = glavaVrstica ?? unique[0];

    if (sirota) {
      napake.push({
        sheet: "Sredstva", vrstica: glava.vrstica, polje: "doknjizba",
        opis: `Sirota: inventarna ${inventarna} nima vrstice seq=0 — vrstica z najnižjim seq=${glava.doknjizba} postane glava`,
      });
    }

    const dograditve = unique.filter(v => v !== glava);
    result.push({ inventarna, glava, dograditve, sirota });
  }

  return result;
}

// ─── Jedro: procesiranje XLSX/CSV ─────────────────────────────────────────────

async function preberiOsXlsxList(
  buffer: Buffer,
  imeLista: string,
  fallbackIndex: number,
): Promise<OsXlsxVrstica[] | null> {
  try {
    const tipizirane = await preberiXlsxTipizirano(buffer, imeLista, fallbackIndex);
    const naslovi = tipizirane[0] ?? [];
    const stevilskiNaslovi = new Set([
      "stopnja_%",
      "stopnja",
      "nabavna",
      "nabavna_vrednost",
      "odpisana",
      "odpisana_vrednost",
    ]);
    const stevilskiStolpci = naslovi.flatMap((celica, indeks) => {
      const naslov = celica.text.trim().toLowerCase().replace(/\s+/g, "_");
      return stevilskiNaslovi.has(naslov) ? [indeks] : [];
    });

    return matrikaVObjekteZVrednostmi(
      xlsxMatrikaZaStevilskeStolpce(tipizirane, stevilskiStolpci),
    );
  } catch (napaka) {
    // Enako kot prejšnji findSheet: manjkajoči list zapišemo v predogled,
    // ne prekinemo celotnega dry-run uvoza. Neveljaven XLSX oziroma .xls pa
    // ostaneta blokirni napaki ZAJ018.
    if (napaka instanceof XlsxBranjeNapaka && napaka.koda === "ZAJ010") return null;
    throw napaka;
  }
}

export async function processUvoz(
  buffer: Buffer,
  companyId: string,
  dryRun: boolean,
  format: "xlsx" | "csv" = "xlsx",
): Promise<UvozPreview | UvozRezultat> {
  const napake: UvozNapaka[] = [];

  // CSV ima en list podatkov za sredstva. XLSX ohrani tri liste, imensko
  // normalizacijo in fallback po indeksu kot stari SheetJS findSheet.
  const [skupineVrstice, stmVrstice, sredstvaVrstice] = format === "csv"
    ? [[], [], matrikaVObjekte(preberiCsvMatriko(buffer))]
    : await Promise.all([
        preberiOsXlsxList(buffer, "Amortizacijske_skupine", 0),
        preberiOsXlsxList(buffer, "Stroskovna_mesta", 1),
        preberiOsXlsxList(buffer, "Sredstva", 2),
      ]);

  if (!skupineVrstice && format === "xlsx")
    napake.push({ sheet: "—", vrstica: 0, polje: "list", opis: "List 'Amortizacijske_skupine' ni najden" });
  if (!stmVrstice && format === "xlsx")
    napake.push({ sheet: "—", vrstica: 0, polje: "list", opis: "List 'Stroskovna_mesta' ni najden" });
  if (!sredstvaVrstice)
    napake.push({ sheet: "—", vrstica: 0, polje: "list", opis: "List 'Sredstva' ni najden" });

  // ── Parsiranje skupin ────────────────────────────────────────────────────
  type SkupinaRow = { koda: string; naziv: string; leto: number; stopnja: number };
  const skupineByKoda = new Map<string, SkupinaRow>();

  if (skupineVrstice) {
    skupineVrstice.forEach((row, i) => {
      const vrstica = i + 2;
      const koda = String(row["koda"] ?? row["Koda"] ?? "").trim();
      const naziv = String(row["naziv"] ?? row["Naziv"] ?? "").trim();
      const letoRaw = row["leto"] ?? row["Leto"] ?? "";
      const stopnjaRaw = row["stopnja_%"] ?? row["Stopnja_%"] ?? row["stopnja"] ?? row["Stopnja"] ?? "";
      if (!koda) {
        napake.push({ sheet: "Amortizacijske_skupine", vrstica, polje: "koda", opis: "Manjkajoča koda — preskočeno" });
        return;
      }
      const stopnja = parseSloCurrency(stopnjaRaw);
      if (stopnja === null) {
        napake.push({ sheet: "Amortizacijske_skupine", vrstica, polje: "stopnja_%", opis: `Neveljavna stopnja "${stopnjaRaw}" za ${koda}` });
      }
      const leto = parseInt(String(letoRaw)) || 0;
      const obstoječa = skupineByKoda.get(koda);
      if (!obstoječa || leto >= obstoječa.leto) {
        skupineByKoda.set(koda, { koda, naziv: naziv || `Skupina ${koda}`, leto, stopnja: stopnja ?? 0 });
      }
    });
  }

  // ── Parsiranje STM ───────────────────────────────────────────────────────
  type StmRow = { sifra: string; naziv: string };
  const stmByCode = new Map<string, StmRow>();

  if (stmVrstice) {
    stmVrstice.forEach((row, i) => {
      const vrstica = i + 2;
      const sifra = String(
        row["sifra"] ?? row["Sifra"] ?? row["šifra"] ?? row["Šifra"] ?? "",
      ).trim();
      const naziv = String(row["naziv"] ?? row["Naziv"] ?? "").trim();
      if (!sifra) {
        napake.push({ sheet: "Stroskovna_mesta", vrstica, polje: "sifra", opis: "Manjkajoča šifra — preskočeno" });
        return;
      }
      stmByCode.set(sifra, { sifra, naziv: naziv || `STM ${sifra}` });
    });
  }

  // ── Parsiranje sredstev ──────────────────────────────────────────────────
  const sredstvaRows: SredstvoVrstica[] = [];

  if (sredstvaVrstice) {
    sredstvaVrstice.forEach((row, i) => {
      const vrstica = i + 2;
      const inventarna = String(
        row["inventarna"] ?? row["Inventarna"] ?? row["inventarna_st"] ?? "",
      ).trim();
      const naziv = String(row["naziv"] ?? row["Naziv"] ?? "").trim();
      const skupina = String(row["skupina"] ?? row["Skupina"] ?? "").trim();
      const konto = String(row["konto"] ?? row["Konto"] ?? "").trim();
      const stm = String(
        row["stm"] ?? row["STM"] ?? row["stroskovno_mesto"] ?? row["Stroskovno_mesto"] ?? "",
      ).trim();
      const kontoPopravka = String(
        row["konto_popravka"] ?? row["Konto_popravka"] ?? row["konto_pv"] ?? row["Konto_pv"] ?? "",
      ).trim();
      const kontoStroska = String(
        row["konto_stroska"] ?? row["Konto_stroska"] ?? row["konto_am"] ?? row["Konto_am"] ?? "",
      ).trim();
      const partnerDavcna = String(
        row["partner_davcna"] ?? row["davcna"] ?? row["davčna"] ?? row["Davčna"] ?? row["dobavitelj_davcna"] ?? "",
      ).trim();
      const partnerNaziv = String(
        row["partner_naziv"] ?? row["dobavitelj"] ?? row["Dobavitelj"] ?? row["partner"] ?? "",
      ).trim();
      const nabavnaRaw = row["nabavna"] ?? row["Nabavna"] ?? row["nabavna_vrednost"] ?? "";
      const odpisanaRaw = row["odpisana"] ?? row["Odpisana"] ?? row["odpisana_vrednost"] ?? "";
      const datumNabaveRaw = row["datum_nabave"] ?? row["Datum_nabave"] ?? row["datum nabave"] ?? "";
      const datumAktivacijeRaw = row["datum_aktivacije"] ?? row["Datum_aktivacije"] ?? "";
      const odpisanRaw = row["odpisan"] ?? row["Odpisan"] ?? "";
      const doknjizbaRaw = row["doknjizba"] ?? row["Doknjizba"] ?? "";

      if (!inventarna) {
        napake.push({ sheet: "Sredstva", vrstica, polje: "inventarna", opis: "Manjkajoča inventarna — preskočeno" });
        return;
      }

      const nabavna = parseSloCurrency(nabavnaRaw);
      const odpisana = parseSloCurrency(odpisanaRaw);
      const datumNabave = parseSloDate(datumNabaveRaw);
      const datumAktivacije = parseSloDate(datumAktivacijeRaw);
      const odpisan = parseBoolean(odpisanRaw);
      const doknjizba = parseDoknjizba(doknjizbaRaw);

      if (datumNabaveRaw !== "" && datumNabave === null) {
        napake.push({ sheet: "Sredstva", vrstica, polje: "datum_nabave", opis: `Neveljaven datum "${datumNabaveRaw}" za ${inventarna}` });
      }

      sredstvaRows.push({
        vrstica, inventarna, naziv: naziv || inventarna,
        skupina, konto, stm, kontoPopravka, kontoStroska,
        partnerDavcna, partnerNaziv,
        nabavna, odpisana,
        datumNabave, datumAktivacije, odpisan, doknjizba,
      });
    });
  }

  // ── Grupiranje po inventarni (skupno za dryRun in vpis) ─────────────────
  const grupe = groupByInventarna(sredstvaRows, napake);

  // Opozorila za neznane skupiny (samo na glavi — dograditve prevzamejo skupino glave)
  for (const g of grupe) {
    const glavaSkupina = g.glava.skupina;
    if (glavaSkupina && !skupineByKoda.has(glavaSkupina)) {
      napake.push({
        sheet: "Sredstva", vrstica: g.glava.vrstica, polje: "skupina",
        opis: `Neznana skupina "${glavaSkupina}" za ${g.inventarna} — uvoziti brez skupine`,
      });
    }
  }

  const dograditveCount = grupe.reduce((sum, g) => sum + g.dograditve.length, 0);

  // ── dryRun=true: vrni predogled brez vpisa ───────────────────────────────
  if (dryRun) {
    return {
      dryRun: true,
      skupineCount: skupineByKoda.size,
      stmCount: stmByCode.size,
      sredstvaCount: grupe.length,
      dograditveCount,
      napake,
    };
  }

  // ── dryRun=false: polni vpis v transakciji ────────────────────────────────
  let skupineUpserted = 0;
  let stmUpserted = 0;
  let sredstvaInserted = 0;
  let dograditveInserted = 0;
  let preskocena = 0;

  await db.transaction(async (tx) => {
    // ── 1. Upsert skupiny ─────────────────────────────────────────────────
    const obstojeceSkupineRows = await tx
      .select({ id: osAmortizacijskeSkupineTable.id, koda: osAmortizacijskeSkupineTable.koda })
      .from(osAmortizacijskeSkupineTable)
      .where(eq(osAmortizacijskeSkupineTable.companyId, companyId));
    const skupineMap = new Map(obstojeceSkupineRows.map(r => [r.koda, r.id]));

    for (const [, s] of skupineByKoda) {
      if (skupineMap.has(s.koda)) {
        await tx
          .update(osAmortizacijskeSkupineTable)
          .set({
            naziv: s.naziv,
            racunovodskaStonja: String(s.stopnja),
            davcnaStonja: String(s.stopnja),
          })
          .where(
            and(
              eq(osAmortizacijskeSkupineTable.companyId, companyId),
              eq(osAmortizacijskeSkupineTable.koda, s.koda),
            ),
          );
      } else {
        const [inserted] = await tx
          .insert(osAmortizacijskeSkupineTable)
          .values({
            companyId,
            koda: s.koda,
            naziv: s.naziv,
            racunovodskaStonja: String(s.stopnja),
            davcnaStonja: String(s.stopnja),
            aktivno: true,
          })
          .returning({ id: osAmortizacijskeSkupineTable.id });
        skupineMap.set(s.koda, inserted.id);
      }
      skupineUpserted++;
    }

    // ── 2. Upsert STM ─────────────────────────────────────────────────────
    const obstojeceStmRows = await tx
      .select({ id: costCentersTable.id, code: costCentersTable.code })
      .from(costCentersTable)
      .where(eq(costCentersTable.companyId, companyId));
    const stmMap = new Map(obstojeceStmRows.map(r => [r.code, r.id]));

    for (const [, stm] of stmByCode) {
      if (stmMap.has(stm.sifra)) {
        await tx
          .update(costCentersTable)
          .set({ name: stm.naziv })
          .where(
            and(
              eq(costCentersTable.companyId, companyId),
              eq(costCentersTable.code, stm.sifra),
            ),
          );
      } else {
        const [inserted] = await tx.insert(costCentersTable).values({
          companyId,
          code: stm.sifra,
          name: stm.naziv,
          isActive: true,
        }).returning({ id: costCentersTable.id });
        stmMap.set(stm.sifra, inserted.id);
      }
      stmUpserted++;
    }

    // Popoln costCenter index (koda→id IN naziv→id) — po vseh upsertih
    const vsaStmRows = await tx
      .select({ id: costCentersTable.id, code: costCentersTable.code, name: costCentersTable.name })
      .from(costCentersTable)
      .where(eq(costCentersTable.companyId, companyId));
    const ccCodeIndex = new Map(vsaStmRows.map(r => [r.code, r.id]));
    const ccNameIndex = new Map(vsaStmRows.map(r => [r.name.toLowerCase(), r.id]));

    // Counterparties index za partner lookup (taxId_brez_SI→id IN naziv→id)
    const vsaCpRows = await tx
      .select({ id: counterpartiesTable.id, taxId: counterpartiesTable.taxId, name: counterpartiesTable.name })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.companyId, companyId));
    const cpTaxIdIndex = new Map(
      vsaCpRows
        .filter(c => c.taxId)
        .map(c => [c.taxId!.replace(/^SI/i, "").trim(), c.id]),
    );
    const cpNameIndex = new Map(vsaCpRows.map(c => [c.name.toLowerCase(), c.id]));

    // ── 3. Sredstva (grupirano po inventarni) ──────────────────────────────
    const obstojeceInvRows = await tx
      .select({ inventarnaSt: osnovnaSredstvaTable.inventarnaSt })
      .from(osnovnaSredstvaTable)
      .where(eq(osnovnaSredstvaTable.companyId, companyId));
    const obstojeceSet = new Set(obstojeceInvRows.map(r => r.inventarnaSt));

    const vsiKontiRows = await tx
      .select({ id: accountsTable.id, code: accountsTable.code })
      .from(accountsTable)
      .where(eq(accountsTable.companyId, companyId));
    const accountIndex = new Map(vsiKontiRows.map(r => [r.code, r.id]));

    for (const g of grupe) {
      const gl = g.glava;

      // Preskoči celotno grupo, če inventarna že obstaja
      if (obstojeceSet.has(g.inventarna)) {
        napake.push({
          sheet: "Sredstva", vrstica: gl.vrstica, polje: "inventarna",
          opis: `Inventarna ${g.inventarna} že obstaja — preskočeno (${1 + g.dograditve.length} vrstice)`,
        });
        preskocena++;
        continue;
      }

      // Skupina iz glave (dograditve jo prevzamejo)
      const skupinaId = gl.skupina ? (skupineMap.get(gl.skupina) ?? null) : null;
      if (gl.skupina && !skupinaId) {
        napake.push({
          sheet: "Sredstva", vrstica: gl.vrstica, polje: "skupina",
          opis: `Neznana skupina "${gl.skupina}" za ${g.inventarna} — uvozito brez skupine`,
        });
      }

      // Konto OS iz glave
      const accountId = resolveAccountId(gl.konto, accountIndex);
      if (gl.konto && !accountId) {
        napake.push({
          sheet: "Sredstva", vrstica: gl.vrstica, polje: "konto",
          opis: `Konto "${gl.konto}" ni najden — uvozito brez konta`,
        });
      }

      // Stroškovno mesto — lookup po kodi (sifra), fallback: isti niz kot naziv
      // Če gl.stm ne ujame kot koda, ga preizkusi kot naziv (code-or-name vedenje)
      const costCenterId = resolveCostCenterId(gl.stm, gl.stm, ccCodeIndex, ccNameIndex);
      if (gl.stm && !costCenterId) {
        napake.push({
          sheet: "Sredstva", vrstica: gl.vrstica, polje: "stm",
          opis: `STM "${gl.stm}" ni najdeno v stroškovnih mestih — uvozito brez STM`,
        });
      }

      // Konto popravka vrednosti (opcijsko — če je v XLSX)
      const kontoPopravkaId = resolveAccountId(gl.kontoPopravka, accountIndex);
      if (gl.kontoPopravka && !kontoPopravkaId) {
        napake.push({
          sheet: "Sredstva", vrstica: gl.vrstica, polje: "konto_popravka",
          opis: `Konto popravka "${gl.kontoPopravka}" ni najden — uvozito brez konta popravka`,
        });
      }

      // Konto amortizacijskega stroška (opcijsko — če je v XLSX)
      const kontoStroskaId = resolveAccountId(gl.kontoStroska, accountIndex);
      if (gl.kontoStroska && !kontoStroskaId) {
        napake.push({
          sheet: "Sredstva", vrstica: gl.vrstica, polje: "konto_stroska",
          opis: `Konto stroška "${gl.kontoStroska}" ni najden — uvozito brez konta stroška`,
        });
      }

      // Status glave (glede na odpisanost in datum aktivacije)
      const status = buildSredstvoStatus(gl.odpisan, gl.nabavna, gl.odpisana, gl.datumAktivacije);

      // Vstavi glavo osnovna_sredstva
      const [glavaRow] = await tx
        .insert(osnovnaSredstvaTable)
        .values({
          companyId,
          inventarnaSt: g.inventarna,
          naziv: gl.naziv,
          ...(skupinaId ? { skupinaId } : {}),
          ...(accountId ? { accountId } : {}),
          ...(costCenterId ? { costCenterId } : {}),
          ...(kontoPopravkaId ? { kontoPopravkaId } : {}),
          ...(kontoStroskaId ? { kontoStroskaId } : {}),
          status,
        })
        .returning({ id: osnovnaSredstvaTable.id });

      // Vstavi vse doknjižbe (seq=0 je glava/nakup, seq>0 so dograditve)
      const vseVrstice: SredstvoVrstica[] = [gl, ...g.dograditve];
      // Preslikaj seq: glava dobi seq=0 (celo pri siroti), ostale ohranijo doknjizba vrednost
      for (let idx = 0; idx < vseVrstice.length; idx++) {
        const v = vseVrstice[idx];
        const seq = idx === 0 ? 0 : v.doknjizba;  // glava vedno seq=0

        const datumNabaveFinal = v.datumNabave ?? "1900-01-01";
        if (!v.datumNabave) {
          napake.push({
            sheet: "Sredstva", vrstica: v.vrstica, polje: "datum_nabave",
            opis: `Manjkajoč datum nabave za ${g.inventarna} seq=${seq} — nastavljeno na 1900-01-01`,
          });
        }

        const seqStatus = buildSredstvoStatus(v.odpisan, v.nabavna, v.odpisana, v.datumAktivacije);

        // Partner (dobavitelj) lookup — po davčni, fallback po nazivu
        const partnerId = resolvePartnerId(v.partnerDavcna, v.partnerNaziv, cpTaxIdIndex, cpNameIndex);
        if ((v.partnerDavcna || v.partnerNaziv) && !partnerId) {
          napake.push({
            sheet: "Sredstva", vrstica: v.vrstica, polje: "partner",
            opis: `Partner "${v.partnerDavcna || v.partnerNaziv}" za ${g.inventarna} seq=${seq} ni najden v šifrantu — uvozito brez dobavitelja`,
          });
        }

        await tx.insert(osDoknjizbeTable).values({
          sredstvoId: glavaRow.id,
          seq,
          nazivVlaganja: idx === 0 ? (g.sirota ? "Začetni vnos — sirota (uvoz)" : "Začetni vnos (uvoz)") : (v.naziv || `Dograditev ${seq}`),
          nabavnaVrednost: String(v.nabavna ?? 0),
          odpisanaVrednost: String(v.odpisana ?? 0),
          neamortizljiviDelPct: "0",
          datumNabave: datumNabaveFinal,
          ...(v.datumAktivacije ? { datumAktivacije: v.datumAktivacije } : {}),
          ...(partnerId ? { partnerId } : {}),
          status: seqStatus,
        });

        if (idx > 0) dograditveInserted++;
      }

      obstojeceSet.add(g.inventarna);
      sredstvaInserted++;
    }
  });

  return {
    dryRun: false,
    skupineUpserted,
    stmUpserted,
    sredstvaInserted,
    dograditveInserted,
    preskocena,
    napake,
  };
}

// ─── POST /os/:companyId/uvoz ─────────────────────────────────────────────────

router.post(
  "/os/:companyId/uvoz",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as unknown as AuthenticatedRequest;
    const companyId = ep(req.params["companyId"] ?? "");
    const dryRun = req.query["dryRun"] !== "false";

    const hasAccess = await resolveOsWriteAccess(authReq.clerkUserId, companyId, res);
    if (!hasAccess) return;

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Datoteka ni bila poslana (polje 'file')" });
      return;
    }

    const ext = (file.originalname ?? "").toLowerCase().split(".").pop();
    if (ext !== "xlsx" && ext !== "xls" && ext !== "csv") {
      res.status(400).json({ error: "Podprte so samo datoteke .xlsx ali .csv", koda: "ZAJ018" });
      return;
    }

    try {
      const result = await processUvoz(
        file.buffer,
        companyId,
        dryRun,
        ext === "csv" ? "csv" : "xlsx",
      );
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof XlsxBranjeNapaka) {
        res.status(400).json({ error: err.message, koda: err.koda });
        return;
      }
      const msg = err instanceof Error ? err.message : "neznana napaka";
      res.status(500).json({ error: `Napaka pri obdelavi datoteke: ${msg}` });
    }
  },
);

// ─── POST /os/:companyId/uvoz-obogatitev ──────────────────────────────────────
// Naknadno napolni cost_center_id / konto_popravka_id / konto_stroska_id na
// obstoječih osnovna_sredstva in partner_id na os_doknjizbe (seq=0) iz XLSX.
//
// Brez datoteke (brez multipart): vrne stanje (koliko sredstev nima STM/partnerja).
// Z datoteko: parsira XLSX, poišče ujemanja v šifrantih, UPDATE-a samo prazna polja.
//   Obstoječe vrednosti nikoli ne prepiše (samo IS NULL vrstice).

router.post(
  "/os/:companyId/uvoz-obogatitev",
  requireAuth,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as unknown as AuthenticatedRequest;
    const companyId = ep(req.params["companyId"] ?? "");
    const dryRun = req.query["dryRun"] !== "false";

    const hasAccess = await resolveOsWriteAccess(authReq.clerkUserId, companyId, res);
    if (!hasAccess) return;

    try {
      // ── Stanje brez datoteke ───────────────────────────────────────────────
      if (!req.file) {
        const [brezStmRows, brezPartnerjaRows] = await Promise.all([
          db
            .select({ id: osnovnaSredstvaTable.id })
            .from(osnovnaSredstvaTable)
            .where(and(eq(osnovnaSredstvaTable.companyId, companyId), isNull(osnovnaSredstvaTable.costCenterId))),
          db
            .select({ id: osDoknjizbeTable.id })
            .from(osDoknjizbeTable)
            .innerJoin(osnovnaSredstvaTable, eq(osDoknjizbeTable.sredstvoId, osnovnaSredstvaTable.id))
            .where(and(eq(osnovnaSredstvaTable.companyId, companyId), eq(osDoknjizbeTable.seq, 0), isNull(osDoknjizbeTable.partnerId))),
        ]);
        res.json({
          datoteka: false,
          brezStm: brezStmRows.length,
          brezPartnerja: brezPartnerjaRows.length,
          navodilo:
            "Pošljite XLSX (polje 'file') s stolpci inventarna + stm + partner_davcna/partner_naziv. " +
            "Endpoint bo UPDATE-al samo prazna polja (IS NULL) na obstoječih sredstvih.",
        });
        return;
      }

      // ── Parsiranje XLSX/CSV ────────────────────────────────────────────────
      const ext = (req.file.originalname ?? "").toLowerCase().split(".").pop();
      if (ext !== "xlsx" && ext !== "xls" && ext !== "csv") {
        res.status(400).json({ error: "Podprte so samo datoteke .xlsx ali .csv", koda: "ZAJ018" });
        return;
      }
      const xlsxRows = ext === "csv"
        ? matrikaVObjekte(preberiCsvMatriko(req.file.buffer))
        : await preberiXlsxObjekte(req.file.buffer, "Sredstva", 0);

      // ── Šifranti in obstoječe DB stanje (vse v paraleli) ────────────────────
      const [stmRows, kontiRows, cpRows, obstojecaRows, seq0Rows] = await Promise.all([
        db.select({ id: costCentersTable.id, code: costCentersTable.code, name: costCentersTable.name })
          .from(costCentersTable).where(eq(costCentersTable.companyId, companyId)),
        db.select({ id: accountsTable.id, code: accountsTable.code })
          .from(accountsTable).where(eq(accountsTable.companyId, companyId)),
        db.select({ id: counterpartiesTable.id, taxId: counterpartiesTable.taxId, name: counterpartiesTable.name })
          .from(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId)),
        // Obstoječa sredstva z vsemi nullable preslikavami — za per-field eligibility check
        db.select({
          id: osnovnaSredstvaTable.id,
          inventarnaSt: osnovnaSredstvaTable.inventarnaSt,
          costCenterId: osnovnaSredstvaTable.costCenterId,
          kontoPopravkaId: osnovnaSredstvaTable.kontoPopravkaId,
          kontoStroskaId: osnovnaSredstvaTable.kontoStroskaId,
        }).from(osnovnaSredstvaTable).where(eq(osnovnaSredstvaTable.companyId, companyId)),
        // seq=0 doknjižbe z partnerId — za partner eligibility check
        db.select({
          id: osDoknjizbeTable.id,
          sredstvoId: osDoknjizbeTable.sredstvoId,
          partnerId: osDoknjizbeTable.partnerId,
        }).from(osDoknjizbeTable)
          .innerJoin(osnovnaSredstvaTable, eq(osDoknjizbeTable.sredstvoId, osnovnaSredstvaTable.id))
          .where(and(eq(osnovnaSredstvaTable.companyId, companyId), eq(osDoknjizbeTable.seq, 0))),
      ]);

      const ccCodeIdx = new Map(stmRows.map(r => [r.code, r.id]));
      const ccNameIdx = new Map(stmRows.map(r => [r.name.toLowerCase(), r.id]));
      const accIdx = new Map(kontiRows.map(r => [r.code, r.id]));
      const cpTaxIdx = new Map(cpRows.filter(c => c.taxId).map(c => [c.taxId!.replace(/^SI/i, "").trim(), c.id]));
      const cpNameIdx = new Map(cpRows.map(c => [c.name.toLowerCase(), c.id]));
      // inventarna → obstoječa glava (z nullable polji)
      const invMap = new Map(obstojecaRows.map(r => [r.inventarnaSt, r]));
      // sredstvoId → seq=0 doknjižba
      const seq0Map = new Map(seq0Rows.map(r => [r.sredstvoId, r]));

      // ── Obogatitev ─────────────────────────────────────────────────────────
      const napake: UvozNapaka[] = [];
      let stmNapolnjenih = 0;
      let kontoPopravkaNapolnjenih = 0;
      let kontoStroskaaNapolnjenih = 0;
      let partnerjevNapolnjenih = 0;
      let neznanaInventarna = 0;

      for (let i = 0; i < xlsxRows.length; i++) {
        const row = xlsxRows[i]!;
        const vrstica = i + 2;

        const inventarna = String(
          row["inventarna"] ?? row["Inventarna"] ?? row["inventarna_st"] ?? "",
        ).trim();
        if (!inventarna) continue;

        const existing = invMap.get(inventarna) ?? null;
        if (!existing) {
          neznanaInventarna++;
          napake.push({ sheet: "Sredstva", vrstica, polje: "inventarna", opis: `Inventarna "${inventarna}" ni najdena — preskočeno` });
          continue;
        }

        const stmRaw = String(row["stm"] ?? row["STM"] ?? row["stroskovno_mesto"] ?? row["Stroskovno_mesto"] ?? "").trim();
        const kontoPopRaw = String(row["konto_popravka"] ?? row["Konto_popravka"] ?? "").trim();
        const kontoStrRaw = String(row["konto_stroska"] ?? row["Konto_stroska"] ?? "").trim();
        const partnerDavcna = String(row["partner_davcna"] ?? row["davcna"] ?? row["davčna"] ?? "").trim();
        const partnerNaziv = String(row["partner_naziv"] ?? row["dobavitelj"] ?? row["Dobavitelj"] ?? "").trim();

        const resolvedCc = stmRaw ? resolveCostCenterId(stmRaw, stmRaw, ccCodeIdx, ccNameIdx) : null;
        const resolvedKontoPop = resolveAccountId(kontoPopRaw, accIdx);
        const resolvedKontoStr = resolveAccountId(kontoStrRaw, accIdx);
        const resolvedPartner = resolvePartnerId(partnerDavcna, partnerNaziv, cpTaxIdx, cpNameIdx);

        if (stmRaw && !resolvedCc)
          napake.push({ sheet: "Sredstva", vrstica, polje: "stm", opis: `STM "${stmRaw}" ni najdeno — preskočeno` });
        if ((partnerDavcna || partnerNaziv) && !resolvedPartner)
          napake.push({ sheet: "Sredstva", vrstica, polje: "partner", opis: `Partner "${partnerDavcna || partnerNaziv}" ni najden — preskočeno` });

        const seq0 = seq0Map.get(existing.id) ?? null;
        // buildObogatitvePlan preverja per-polje IS NULL iz dejanske DB vrednosti
        const plan = buildObogatitvePlan(existing, {
          costCenterId: resolvedCc,
          kontoPopravkaId: resolvedKontoPop,
          kontoStroskaId: resolvedKontoStr,
          partnerId: resolvedPartner,
        }, seq0);
        if (!plan) continue;

        // Štejemo glede na plan (ne glede na resolved) — torej le dejansko prazna polja
        if (plan.costCenterId) stmNapolnjenih++;
        if (plan.kontoPopravkaId) kontoPopravkaNapolnjenih++;
        if (plan.kontoStroskaId) kontoStroskaaNapolnjenih++;
        if (plan.partnerId) partnerjevNapolnjenih++;

        if (!dryRun) {
          // Ločeni UPDATE klici per-polje — vsak z lastnim IS NULL predikatom
          if (plan.costCenterId)
            await db.update(osnovnaSredstvaTable)
              .set({ costCenterId: plan.costCenterId })
              .where(and(eq(osnovnaSredstvaTable.id, plan.sredstvoId), isNull(osnovnaSredstvaTable.costCenterId)));

          if (plan.kontoPopravkaId)
            await db.update(osnovnaSredstvaTable)
              .set({ kontoPopravkaId: plan.kontoPopravkaId })
              .where(and(eq(osnovnaSredstvaTable.id, plan.sredstvoId), isNull(osnovnaSredstvaTable.kontoPopravkaId)));

          if (plan.kontoStroskaId)
            await db.update(osnovnaSredstvaTable)
              .set({ kontoStroskaId: plan.kontoStroskaId })
              .where(and(eq(osnovnaSredstvaTable.id, plan.sredstvoId), isNull(osnovnaSredstvaTable.kontoStroskaId)));

          if (plan.partnerId && plan.doknjizbaId)
            await db.update(osDoknjizbeTable)
              .set({ partnerId: plan.partnerId })
              .where(and(eq(osDoknjizbeTable.id, plan.doknjizbaId), isNull(osDoknjizbeTable.partnerId)));
        }
      }

      res.json({
        dryRun,
        stmNapolnjenih,
        kontoPopravkaNapolnjenih,
        kontoStroskaaNapolnjenih,
        partnerjevNapolnjenih,
        neznanaInventarna,
        napake,
      });
    } catch (err: unknown) {
      if (err instanceof XlsxBranjeNapaka) {
        res.status(400).json({ error: err.message, koda: err.koda });
        return;
      }
      const msg = err instanceof Error ? err.message : "neznana napaka";
      res.status(500).json({ error: `Napaka: ${msg}` });
    }
  },
);

export default router;
