/**
 * osAmortizacijaKnjizenje.ts — Knjiženje amortizacije v GK kot OSNUTEK (Faza 3c/2)
 *
 * NIKOLI ne ustvari potrjene temeljnice. Vedno status = "draft".
 * Ročna potrditev je obvezna.
 *
 * Varnostne kontrole:
 * - Vse poizvedbe po kontih so skope na companyId (prepreči cross-company reference)
 * - Konti morajo biti: aktivni (isActive=true), dovoljeni za knjiženje (allowsPosting=true)
 * - Dimenzije: requiresPartner / requiresProject → 400 (amortizacija ne vsebuje); requiresCostCenter zadosti z costCenterId sredstva
 * - Datumi: documentDate = period.endDate (amortizacija za celo obdobje); entryDate = clamp(today, startDate, endDate)
 *
 * Routes:
 *   GET  /os/:companyId/amortizacija/nastavitve
 *   PATCH /os/:companyId/amortizacija/nastavitve
 *   GET  /os/:companyId/amortizacija/izpis?leto=YYYY&format=pdf|csv   ← NEODVISNO od GLK
 *   POST  /os/:companyId/amortizacija/knjizenje   { leto, mesec?, dryRun }
 *         ← periodId ODSTRANJEN; GLK obdobje se izpelje samodejno iz leta/meseca
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, like, sql, lte, lt, gte, desc, gt, or, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { resolveStatusSredstvo } from "./osHelpers";
import { loadObracunaniOdpisi } from "./osStatusOdpisi";
import { savedAmortizationExcel, savedAmortizationPdf } from "../lib/os-amortizacija-export";
import {
  ExportSavedAmortizationParams, ExportSavedAmortizationQueryParams,
  ListSavedAmortizationYearsParams, ListSavedAmortizationYearsResponse,
  GetOsAmortizacijaArhivParams, GetOsAmortizacijaArhivResponse,
} from "@workspace/api-zod";
import {
  db,
  osAmortizacijskeSkupineTable,
  osnovnaSredstvaTable,
  osDoknjizbeTable,
  osRolesTable,
  osAmortizacijaNastavitveTable,
  companyModulesTable,
  accountsTable,
  companiesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  accountingPeriodsTable,
  osAmortizacijaObracunTable,
  osAmortizacijaObracunSredstvoTable,
} from "@workspace/db";

// ─── GLK osnutek: poišče GLK (erp) modul za podjetje ─────────────────────────
async function hasGlkModule(companyId: string): Promise<boolean> {
  const [row] = await db
    .select({ module: companyModulesTable.module })
    .from(companyModulesTable)
    .where(and(eq(companyModulesTable.companyId, companyId), eq(companyModulesTable.module, "erp")))
    .limit(1);
  return !!row;
}

// ─── GLK osnutek: poišče računovodsko obdobje za leto ────────────────────────
// Vrne prvo ne-zaklenjeno obdobje, ki se prekriva z letom.
async function findPeriodForLeto(
  companyId: string,
  leto: number,
): Promise<{ id: string; startDate: string; endDate: string } | null> {
  const letoStart = `${leto}-01-01`;
  const letoEnd   = `${leto}-12-31`;
  const [period] = await db
    .select({
      id: accountingPeriodsTable.id,
      startDate: accountingPeriodsTable.startDate,
      endDate: accountingPeriodsTable.endDate,
      status: accountingPeriodsTable.status,
    })
    .from(accountingPeriodsTable)
    .where(
      and(
        eq(accountingPeriodsTable.companyId, companyId),
        lte(accountingPeriodsTable.startDate, letoEnd),
        gte(accountingPeriodsTable.endDate, letoStart),
      ),
    )
    .limit(1);
  if (!period || period.status === "locked") return null;
  return { id: period.id, startDate: period.startDate, endDate: period.endDate };
}

// ─── GLK osnutek: poišče računovodsko obdobje za booking (letni ALI mesečni) ──
// mesec=undefined → period mora pokrivati celotno leto
// mesec=1-12      → period mora pokrivati samo ta mesec
async function findPeriodForBooking(
  companyId: string,
  leto: number,
  mesec?: number,
): Promise<{ id: string; startDate: string; endDate: string } | null> {
  const rangeStart = mesec !== undefined
    ? `${leto}-${String(mesec).padStart(2, "0")}-01`
    : `${leto}-01-01`;
  const rangeEnd = mesec !== undefined
    ? lastDayOfMonth(leto, mesec)
    : `${leto}-12-31`;
  const [period] = await db
    .select({
      id: accountingPeriodsTable.id,
      startDate: accountingPeriodsTable.startDate,
      endDate: accountingPeriodsTable.endDate,
      status: accountingPeriodsTable.status,
    })
    .from(accountingPeriodsTable)
    .where(
      and(
        eq(accountingPeriodsTable.companyId, companyId),
        lte(accountingPeriodsTable.startDate, rangeEnd),
        gte(accountingPeriodsTable.endDate, rangeStart),
      ),
    )
    .limit(1);
  if (!period || period.status === "locked") return null;
  return { id: period.id, startDate: period.startDate, endDate: period.endDate };
}

// ─── Zadnji dan meseca ────────────────────────────────────────────────────────
function lastDayOfMonth(leto: number, mesec: number): string {
  const d = new Date(Date.UTC(leto, mesec, 0)); // mesec je 1-based, mesec+1 day 0 = zadnji dan meseca
  return d.toISOString().slice(0, 10);
}
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { isSuperAdmin } from "../middlewares/requireSuperAdmin";
import {
  calcAmortizacijaObracun,
  computeVhodniPodpis,
  calcOsnova,
  calcLetna,
  calcObracunana,
  type SredstvoInput,
  type DoknjizbaInput,
  type PraviloZacetkaAmortizacije,
} from "./osAmortizacijaEngine";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ─── Sentinel za signalizacijo konfliktov iz transakcije ──────────────────────
// Definiran na ravni modula (ne znotraj handlerja), da instanceof deluje zanesljivo.
const AMORT_CONFLICT = Symbol("amort-conflict");
interface AmortConflict {
  [AMORT_CONFLICT]: true;
  httpStatus: number;
  body: Record<string, unknown>;
}
function makeAmortConflict(httpStatus: number, body: Record<string, unknown>): AmortConflict {
  return { [AMORT_CONFLICT]: true, httpStatus, body } as AmortConflict;
}
function isAmortConflict(e: unknown): e is AmortConflict {
  return !!e && typeof e === "object" && (e as Record<symbol, unknown>)[AMORT_CONFLICT] === true;
}

const router: IRouter = Router();

// Arhivski izvoz ne potrebuje kontov ali ponovnega obračuna.
router.get("/os/:companyId/amortizacija/obracun/izvozi", requireAuth, async (req, res): Promise<void> => {
  const params = ExportSavedAmortizationParams.safeParse(req.params);
  const parsed = ExportSavedAmortizationQueryParams.safeParse(req.query);
  if (!params.success || !parsed.success || !Number.isInteger(parsed.data.leto)) {
    res.status(400).json({ error: "Izberite podjetje, leto (1990–2100) in format pdf ali xlsx." }); return;
  }
  const { companyId } = params.data;
  if (!(await resolveOsModuleRole((req as AuthenticatedRequest).clerkUserId, companyId, res))) return;
  const { leto, format } = parsed.data;
  const snapshot = await db.transaction(async (tx) => {
    const [head] = await tx.select().from(osAmortizacijaObracunTable).where(and(
      eq(osAmortizacijaObracunTable.companyId, companyId),
      eq(osAmortizacijaObracunTable.leto, leto),
    )).limit(1);
    if (!head) return null;
    const [company] = await tx.select({
      naziv: companiesTable.naziv, naslov: companiesTable.naslov,
      podjetjeDavcna: companiesTable.podjetjeDavcna,
    }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    const rows = await tx.select({
      inventarnaSt: osnovnaSredstvaTable.inventarnaSt,
      naziv: osnovnaSredstvaTable.naziv,
      osnova: osAmortizacijaObracunSredstvoTable.osnova,
      stopnja: osAmortizacijaObracunSredstvoTable.stopnja,
      obracunano: osAmortizacijaObracunSredstvoTable.obracunano,
    }).from(osAmortizacijaObracunSredstvoTable).innerJoin(osnovnaSredstvaTable, and(
      eq(osnovnaSredstvaTable.id, osAmortizacijaObracunSredstvoTable.sredstvoId),
      eq(osnovnaSredstvaTable.companyId, companyId),
    )).where(eq(osAmortizacijaObracunSredstvoTable.obracunId, head.id))
      .orderBy(osnovnaSredstvaTable.inventarnaSt);
    return { ...head, company, rows, printedAt: new Date() };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if (!snapshot) {
    res.status(404).json({ error: `Za leto ${leto} ni shranjenega obračuna.` }); return;
  }
  const buffer = format === "pdf" ? await savedAmortizationPdf(snapshot) : await savedAmortizationExcel(snapshot);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="amortizacijski-obracun-${leto}.${format}"`);
  res.send(buffer);
});

router.get("/os/:companyId/amortizacija/obracun/leta", requireAuth, async (req, res): Promise<void> => {
  const params = ListSavedAmortizationYearsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Neveljavno podjetje." }); return;
  }
  const { companyId } = params.data;
  if (!(await resolveOsModuleRole((req as AuthenticatedRequest).clerkUserId, companyId, res))) return;
  const years = await db.select({
    leto: osAmortizacijaObracunTable.leto,
    doMeseca: osAmortizacijaObracunTable.doMeseca,
    status: osAmortizacijaObracunTable.status,
  }).from(osAmortizacijaObracunTable).where(eq(osAmortizacijaObracunTable.companyId, companyId))
    .orderBy(desc(osAmortizacijaObracunTable.leto));
  res.setHeader("Cache-Control", "no-store");
  res.json(ListSavedAmortizationYearsResponse.parse(years));
});

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface KnjizenjeVrstica {
  kontoStroskaId: string;
  kontoStroskaCode: string | null;
  kontoStroskaName: string | null;
  kontoPopravkaId: string;
  kontoPopravkaCode: string | null;
  kontoPopravkaName: string | null;
  /** Stroškovno mesto sredstev v tej vrstici (NULL, kadar ni nastavljeno na nobenem sredstvu) */
  costCenterId: string | null;
  znesek: string;
  steviloSredstev: number;
}

export interface KnjizenjePredogled {
  referenca: string;
  leto: number;
  mesec: number | null;
  skupajBreme: string;
  skupajDobro: string;
  uravnotezeno: boolean;
  steviloSredstev: number;
  /** Sredstva izpuščena zaradi: manjkajočega konta, neaktivnega konta, skupinskega konta, manjkajoče dimenzije */
  brezKontov: number;
  vrstice: KnjizenjeVrstica[];
}

// ─── Razširjen AccountMap z validacijskimi polji ───────────────────────────────

interface AccountInfo {
  code: string;
  name: string;
  isActive: boolean;
  allowsPosting: boolean;
  requiresCostCenter: boolean;
  costCenterPolicy?: "not_allowed" | "allowed" | "required";
  requiresPartner: boolean;
  requiresProject: boolean;
}

// ─── Čiste pomožne funkcije (exportirane za testiranje) ───────────────────────

/**
 * Ali je doknjižba aktivna v danem mesecu leta?
 */
export function isActiveInMonth(
  datumAktivacije: string | null,
  datumIzpisa: string | null,
  leto: number,
  mesec: number,
): boolean {
  if (!datumAktivacije) return false;
  const ay = parseInt(datumAktivacije.slice(0, 4), 10);
  const am = parseInt(datumAktivacije.slice(5, 7), 10);
  if (ay > leto || (ay === leto && am > mesec)) return false;
  if (datumIzpisa) {
    const iy = parseInt(datumIzpisa.slice(0, 4), 10);
    const im = parseInt(datumIzpisa.slice(5, 7), 10);
    if (iy < leto || (iy === leto && im < mesec)) return false;
  }
  return true;
}

/**
 * Agregacija po trojici (kontoStroskaId, kontoPopravkaId, costCenterId).
 *
 * Validacija po konto:
 * - Konto mora biti v accountMap (sicer → brezKontov)
 * - isActive=true in allowsPosting=true (sicer → brezKontov)
 * - requiresPartner=false in requiresProject=false (sicer → brezKontov — ni dimenzij)
 * - Če requiresCostCenter=true in costCenterId=null → brezKontov
 */
export function buildKnjizenjePredogled(
  data: Array<{
    skupnaObracunana: string;
    kontoStroskaId: string | null;
    kontoPopravkaId: string | null;
    costCenterId: string | null;
  }>,
  defaultKontoStroskaId: string | null,
  defaultKontoPopravkaId: string | null,
  accountMap: Map<string, AccountInfo>,
  referenca: string,
  leto: number,
  mesec: number | null,
): KnjizenjePredogled {
  type Entry = {
    kontoStroskaId: string;
    kontoPopravkaId: string;
    costCenterId: string | null;
    znesek: Decimal;
    steviloSredstev: number;
  };

  const pairMap = new Map<string, Entry>();
  let brezKontov = 0;
  let skupajSredstev = 0;

  for (const s of data) {
    const obr = new Decimal(s.skupnaObracunana);
    if (obr.lte(0)) continue;
    skupajSredstev++;

    const stroskaId = s.kontoStroskaId ?? defaultKontoStroskaId;
    const popravkaId = s.kontoPopravkaId ?? defaultKontoPopravkaId;

    // Preveri obstoj in veljavnost kontov (skoped na companyId že v accountMap)
    if (!stroskaId || !popravkaId) { brezKontov++; continue; }
    const stroskaInfo = accountMap.get(stroskaId);
    const popravkaInfo = accountMap.get(popravkaId);
    if (!stroskaInfo || !popravkaInfo) { brezKontov++; continue; }
    if (!stroskaInfo.isActive || !stroskaInfo.allowsPosting) { brezKontov++; continue; }
    if (!popravkaInfo.isActive || !popravkaInfo.allowsPosting) { brezKontov++; continue; }

    // Dimenzije — requiresPartner / requiresProject → ne moremo zadostiti
    if (stroskaInfo.requiresPartner || stroskaInfo.requiresProject) { brezKontov++; continue; }
    if (popravkaInfo.requiresPartner || popravkaInfo.requiresProject) { brezKontov++; continue; }

    // requiresCostCenter — zadovolji z lastnim costCenterjem sredstva
    const costCenterId = s.costCenterId ?? null;
    if ((stroskaInfo.costCenterPolicy === "required" || (!stroskaInfo.costCenterPolicy && stroskaInfo.requiresCostCenter)) && !costCenterId) { brezKontov++; continue; }
    if ((popravkaInfo.costCenterPolicy === "required" || (!popravkaInfo.costCenterPolicy && popravkaInfo.requiresCostCenter)) && !costCenterId) { brezKontov++; continue; }
    if (stroskaInfo.costCenterPolicy === "not_allowed" && costCenterId) { brezKontov++; continue; }
    if (popravkaInfo.costCenterPolicy === "not_allowed" && costCenterId) { brezKontov++; continue; }

    // Agregacija — ključ vključuje costCenterId, da se ohranjajo dimenzije
    const key = `${stroskaId}::${popravkaId}::${costCenterId ?? ""}`;
    const existing = pairMap.get(key) ?? {
      kontoStroskaId: stroskaId,
      kontoPopravkaId: popravkaId,
      costCenterId,
      znesek: new Decimal(0),
      steviloSredstev: 0,
    };
    existing.znesek = existing.znesek.plus(obr);
    existing.steviloSredstev++;
    pairMap.set(key, existing);
  }

  const vrstice: KnjizenjeVrstica[] = Array.from(pairMap.values()).map((e) => ({
    kontoStroskaId: e.kontoStroskaId,
    kontoStroskaCode: accountMap.get(e.kontoStroskaId)?.code ?? null,
    kontoStroskaName: accountMap.get(e.kontoStroskaId)?.name ?? null,
    kontoPopravkaId: e.kontoPopravkaId,
    kontoPopravkaCode: accountMap.get(e.kontoPopravkaId)?.code ?? null,
    kontoPopravkaName: accountMap.get(e.kontoPopravkaId)?.name ?? null,
    costCenterId: e.costCenterId,
    znesek: e.znesek.toFixed(2),
    steviloSredstev: e.steviloSredstev,
  }));

  const skupajBreme = vrstice.reduce((s, v) => s.plus(v.znesek), new Decimal(0));

  return {
    referenca,
    leto,
    mesec,
    skupajBreme: skupajBreme.toFixed(2),
    skupajDobro: skupajBreme.toFixed(2),
    uravnotezeno: true,
    steviloSredstev: skupajSredstev,
    brezKontov,
    vrstice,
  };
}

// ─── Pomožna: dostop OS ───────────────────────────────────────────────────────

async function resolveOsModuleRole(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<string | null> {
  if (isSuperAdmin(clerkUserId)) return "os_admin";

  const [mod] = await db
    .select({ module: companyModulesTable.module })
    .from(companyModulesTable)
    .where(and(eq(companyModulesTable.companyId, companyId), eq(companyModulesTable.module, "osnovna_sredstva")))
    .limit(1);
  if (!mod) {
    res.status(403).json({ error: "Modul Osnovna sredstva ni aktiviran za to podjetje" });
    return null;
  }

  const [row] = await db
    .select({ role: osRolesTable.role })
    .from(osRolesTable)
    .where(and(eq(osRolesTable.clerkUserId, clerkUserId), eq(osRolesTable.companyId, companyId)))
    .limit(1);
  if (!row) {
    res.status(403).json({ error: "Dostop do modula Osnovna sredstva ni dodeljen" });
    return null;
  }
  return row.role;
}

// ─── Pomožna: naloži konte za prikaz (GET/PATCH nastavitve) — skoped na companyId ─────

async function loadAccountDisplayInfo(
  accountIds: (string | null)[],
  companyId: string,
): Promise<Map<string, { code: string; name: string }>> {
  const { inArray } = await import("drizzle-orm");
  const ids = accountIds.filter((id): id is string => !!id);
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name })
    .from(accountsTable)
    // Varnostna omejitev: konto mora biti iz istega podjetja
    .where(and(inArray(accountsTable.id, ids), eq(accountsTable.companyId, companyId)));

  return new Map(rows.map((a) => [a.id, { code: a.code, name: a.name }]));
}

// ─── Pomožna: naloži validiran AccountMap za knjiženje — skoped na companyId ──

async function loadValidatedAccountMap(
  accountIds: (string | null)[],
  companyId: string,
): Promise<Map<string, AccountInfo>> {
  const { inArray } = await import("drizzle-orm");
  const ids = [...new Set(accountIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      id: accountsTable.id,
      code: accountsTable.code,
      name: accountsTable.name,
      isActive: accountsTable.isActive,
      allowsPosting: accountsTable.allowsPosting,
      requiresCostCenter: accountsTable.requiresCostCenter,
      costCenterPolicy: accountsTable.costCenterPolicy,
      requiresPartner: accountsTable.requiresPartner,
      requiresProject: accountsTable.requiresProject,
    })
    .from(accountsTable)
    // Varnostna omejitev: konto mora biti iz istega podjetja
    .where(and(inArray(accountsTable.id, ids), eq(accountsTable.companyId, companyId)));

  return new Map(rows.map((a) => [a.id, a]));
}

// ─── Pomožna: naloži sredstva za obračun ─────────────────────────────────────

type GlavaRow = {
  id: string;
  inventarnaSt: string;
  naziv: string;
  skupinaId: string | null;
  costCenterId: string | null;
  accountId: string | null;
  kontoStroskaId: string | null;
  kontoPopravkaId: string | null;
  status: string;
  datumOdtujitve: string | null;
};

async function loadSredstvaData(companyId: string): Promise<{
  glaveRows: GlavaRow[];
  doknjizbeByGlava: Map<string, DoknjizbaInput[]>;
  skupineMap: Map<string, { id: string; koda: string; naziv: string; racunovodskaStonja: string; davcnaStonja: string }>;
}> {
  const skupineRows = await db
    .select({
      id: osAmortizacijskeSkupineTable.id,
      koda: osAmortizacijskeSkupineTable.koda,
      naziv: osAmortizacijskeSkupineTable.naziv,
      racunovodskaStonja: osAmortizacijskeSkupineTable.racunovodskaStonja,
      davcnaStonja: osAmortizacijskeSkupineTable.davcnaStonja,
    })
    .from(osAmortizacijskeSkupineTable)
    .where(eq(osAmortizacijskeSkupineTable.companyId, companyId));
  const skupineMap = new Map(skupineRows.map((s) => [s.id, s]));

  const glaveRows: GlavaRow[] = await db
    .select({
      id: osnovnaSredstvaTable.id,
      inventarnaSt: osnovnaSredstvaTable.inventarnaSt,
      naziv: osnovnaSredstvaTable.naziv,
      skupinaId: osnovnaSredstvaTable.skupinaId,
      costCenterId: osnovnaSredstvaTable.costCenterId,
      accountId: osnovnaSredstvaTable.accountId,
      kontoStroskaId: osnovnaSredstvaTable.kontoStroskaId,
      kontoPopravkaId: osnovnaSredstvaTable.kontoPopravkaId,
      status: osnovnaSredstvaTable.status,
      datumOdtujitve: osnovnaSredstvaTable.datumOdtujitve,
    })
    .from(osnovnaSredstvaTable)
    .where(eq(osnovnaSredstvaTable.companyId, companyId));

  const sredstvoIds = glaveRows.map((g) => g.id);
  const doknjizbeByGlava = new Map<string, DoknjizbaInput[]>();

  if (sredstvoIds.length > 0) {
    const { inArray } = await import("drizzle-orm");
    const doknjizbeRows = await db
      .select({
        id: osDoknjizbeTable.id,
        sredstvoId: osDoknjizbeTable.sredstvoId,
        seq: osDoknjizbeTable.seq,
        nabavnaVrednost: osDoknjizbeTable.nabavnaVrednost,
        odpisanaVrednost: osDoknjizbeTable.odpisanaVrednost,
        neamortizljiviDelPct: osDoknjizbeTable.neamortizljiviDelPct,
        datumAktivacije: osDoknjizbeTable.datumAktivacije,
        datumIzpisa: osDoknjizbeTable.datumIzpisa,
        status: osDoknjizbeTable.status,
      })
      .from(osDoknjizbeTable)
      .where(inArray(osDoknjizbeTable.sredstvoId, sredstvoIds));

    for (const d of doknjizbeRows) {
      const list = doknjizbeByGlava.get(d.sredstvoId) ?? [];
      list.push({
        id: d.id,
        seq: d.seq,
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        neamortizljiviDelPct: d.neamortizljiviDelPct,
        datumAktivacije: d.datumAktivacije,
        datumIzpisa: d.datumIzpisa,
        status: d.status,
      });
      doknjizbeByGlava.set(d.sredstvoId, list);
    }
  }

  return { glaveRows, doknjizbeByGlava, skupineMap };
}

// ─── Pomožna: mesečni izračun amortizacije ────────────────────────────────────

/**
 * Mesečna amortizacija za mesec M, upoštevaje kumulativ mesecev 1..M-1.
 *
 * Brez tega bi se pri skoraj-izpisanem sredstvu (preostalo < mesecnaRac) vsak mesec
 * znova knjižil isti preostali znesek, ker odpisanaVrednost v bazi ni posodobljena
 * do potrditve osnutka. Z zaporednim izračunom mesec za mesecem se zagotovi, da
 * skupni letni znesek ne preseže osnove.
 */
function calcMesecnaAmortizacija(
  glaveRows: GlavaRow[],
  doknjizbeByGlava: Map<string, DoknjizbaInput[]>,
  skupineMap: Map<string, { racunovodskaStonja: string; davcnaStonja: string }>,
  leto: number,
  mesec: number,
): Map<string, string> {
  const result = new Map<string, string>();

  for (const g of glaveRows) {
    const skupina = g.skupinaId ? skupineMap.get(g.skupinaId) : undefined;
    if (!skupina) { result.set(g.id, "0.00"); continue; }

    const doknjizbe = (doknjizbeByGlava.get(g.id) ?? []).sort((a, b) => a.seq - b.seq);
    let skupnaObMesec = new Decimal(0);

    for (const d of doknjizbe) {
      if (!d.datumAktivacije) continue;

      const osnova = calcOsnova(d.nabavnaVrednost, d.neamortizljiviDelPct);
      const odpisana = new Decimal(d.odpisanaVrednost);
      const preostaloTotal = Decimal.max(0, new Decimal(osnova).minus(odpisana));
      if (preostaloTotal.lte(0)) continue;

      const letnaRac = calcLetna(osnova, skupina.racunovodskaStonja);
      const mesecnaRac = new Decimal(letnaRac).div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      // Seštej, koliko bi se amortiziralo v mesecih 1..(mesec-1) z istim algoritmom.
      // S tem zmanjšamo razpoložljivi preostali znesek za mesec M, kar prepreči
      // prekomerno amortizacijo pri skoraj-povsem-odpisanih sredstvih.
      let cumulativePrior = new Decimal(0);
      for (let m = 1; m < mesec; m++) {
        if (!isActiveInMonth(d.datumAktivacije, d.datumIzpisa, leto, m)) continue;
        const preostaloAtM = Decimal.max(0, preostaloTotal.minus(cumulativePrior));
        if (preostaloAtM.lte(0)) break;
        cumulativePrior = cumulativePrior.plus(Decimal.min(mesecnaRac, preostaloAtM));
      }

      if (!isActiveInMonth(d.datumAktivacije, d.datumIzpisa, leto, mesec)) continue;
      const effectivePreostalo = Decimal.max(0, preostaloTotal.minus(cumulativePrior));
      if (effectivePreostalo.lte(0)) continue;

      skupnaObMesec = skupnaObMesec.plus(Decimal.min(mesecnaRac, effectivePreostalo));
    }

    result.set(g.id, skupnaObMesec.toFixed(2));
  }

  return result;
}

// ─── Pomožna: clamp datuma znotraj obdobja ────────────────────────────────────

function clampDate(dateStr: string, startDate: string, endDate: string): string {
  if (dateStr < startDate) return startDate;
  if (dateStr > endDate) return endDate;
  return dateStr;
}

// ─── GET /os/:companyId/amortizacija/obracun — arhiv shranjenih glav ───────────

router.get(
  "/os/:companyId/amortizacija/obracun",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = GetOsAmortizacijaArhivParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Neveljaven ID podjetja" });
      return;
    }
    const { companyId } = params.data;
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;
    if (!(await resolveOsModuleRole(clerkUserId, companyId, res))) return;

    const rows = await db
      .select({
        id: osAmortizacijaObracunTable.id,
        leto: osAmortizacijaObracunTable.leto,
        doMeseca: osAmortizacijaObracunTable.doMeseca,
        status: osAmortizacijaObracunTable.status,
        updatedAt: osAmortizacijaObracunTable.updatedAt,
        skupajAmortizacija: sql<string>`coalesce(sum(${osAmortizacijaObracunSredstvoTable.obracunano}), 0)::numeric(20, 2)::text`,
      })
      .from(osAmortizacijaObracunTable)
      .leftJoin(
        osAmortizacijaObracunSredstvoTable,
        eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id),
      )
      .where(eq(osAmortizacijaObracunTable.companyId, companyId))
      .groupBy(osAmortizacijaObracunTable.id)
      .orderBy(desc(osAmortizacijaObracunTable.leto));

    res.json(GetOsAmortizacijaArhivResponse.parse(
      rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    ));
  },
);

// ─── GET /os/:companyId/amortizacija/nastavitve ───────────────────────────────

router.get(
  "/os/:companyId/amortizacija/nastavitve",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;
    if (!(await resolveOsModuleRole(clerkUserId, companyId, res))) return;

    const [row] = await db
      .select({
        kontoStroskaId: osAmortizacijaNastavitveTable.kontoStroskaId,
        kontoPopravkaId: osAmortizacijaNastavitveTable.kontoPopravkaId,
        osLeto: osAmortizacijaNastavitveTable.osLeto,
        praviloZacetkaAmortizacije: osAmortizacijaNastavitveTable.praviloZacetkaAmortizacije,
      })
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
      .limit(1);

    // Zadnje leto shranjenega obračuna — za privzeto leto ob vstopu na stran
    const [zadnjiObracunRow] = await db
      .select({ leto: osAmortizacijaObracunTable.leto })
      .from(osAmortizacijaObracunTable)
      .where(eq(osAmortizacijaObracunTable.companyId, companyId))
      .orderBy(desc(osAmortizacijaObracunTable.leto))
      .limit(1);

    // Prikaz kont — OBVEZNO skoped na companyId (preprečuje cross-company uhajanje)
    const accMap = await loadAccountDisplayInfo([row?.kontoStroskaId ?? null, row?.kontoPopravkaId ?? null], companyId);

    const glkEnabled = await hasGlkModule(companyId);
    res.json({
      kontoStroskaId: row?.kontoStroskaId ?? null,
      kontoStroskaCode: row?.kontoStroskaId ? (accMap.get(row.kontoStroskaId)?.code ?? null) : null,
      kontoStroskaName: row?.kontoStroskaId ? (accMap.get(row.kontoStroskaId)?.name ?? null) : null,
      kontoPopravkaId: row?.kontoPopravkaId ?? null,
      kontoPopravkaCode: row?.kontoPopravkaId ? (accMap.get(row.kontoPopravkaId)?.code ?? null) : null,
      kontoPopravkaName: row?.kontoPopravkaId ? (accMap.get(row.kontoPopravkaId)?.name ?? null) : null,
      osLeto: row?.osLeto ?? null,
      praviloZacetkaAmortizacije: (row?.praviloZacetkaAmortizacije ?? "naslednji_dan") as PraviloZacetkaAmortizacije,
      hasGlkModule: glkEnabled,
      /** Leto zadnjega shranjenega obračuna (MAX iz os_amortizacija_obracun). null = ni obračuna. */
      zadnjiObracunLeto: zadnjiObracunRow?.leto ?? null,
    });
  },
);

// ─── PATCH /os/:companyId/amortizacija/nastavitve ────────────────────────────

router.patch(
  "/os/:companyId/amortizacija/nastavitve",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;

    const role = await resolveOsModuleRole(clerkUserId, companyId, res);
    if (!role) return;
    if (role !== "os_admin" && !isSuperAdmin(clerkUserId)) {
      res.status(403).json({ error: "Nastavitve amortizacije lahko ureja samo os_admin" });
      return;
    }

    const { kontoStroskaId, kontoPopravkaId, kontoStroskaKoda, kontoPopravkaKoda, osLeto, praviloZacetkaAmortizacije } = req.body as {
      kontoStroskaId?: string | null;
      kontoPopravkaId?: string | null;
      kontoStroskaKoda?: string;
      kontoPopravkaKoda?: string;
      /** Lastno leto amortizacije OS (null = počisti, undefined = ne spremeni). */
      osLeto?: number | null;
      /** Pravilo prvega meseca amortizacije: 'naslednji_dan' | 'naslednji_mesec'. */
      praviloZacetkaAmortizacije?: "naslednji_dan" | "naslednji_mesec";
    };

    // Validacija osLeto (če je podano)
    if (osLeto !== undefined && osLeto !== null) {
      if (typeof osLeto !== "number" || !Number.isInteger(osLeto) || osLeto < 1990 || osLeto > 2100) {
        res.status(400).json({ error: "Neveljavno OS leto (pričakovano: celo število 1990–2100)" }); return;
      }
    }

    // Validacija praviloZacetkaAmortizacije (če je podano)
    if (praviloZacetkaAmortizacije !== undefined) {
      if (praviloZacetkaAmortizacije !== "naslednji_dan" && praviloZacetkaAmortizacije !== "naslednji_mesec") {
        res.status(400).json({ error: "Neveljavno pravilo začetka amortizacije (dovoljeno: 'naslednji_dan' | 'naslednji_mesec')" }); return;
      }
    }

    let resolvedStroskaId: string | null | undefined = kontoStroskaId;
    let resolvedPopravkaId: string | null | undefined = kontoPopravkaId;

    // Resolviraj kode → ID-je, skoped na companyId
    if (kontoStroskaKoda || kontoPopravkaKoda) {
      const { inArray } = await import("drizzle-orm");
      const kodesToResolve = [kontoStroskaKoda, kontoPopravkaKoda].filter(Boolean) as string[];
      if (kodesToResolve.length > 0) {
        const accRows = await db
          .select({ id: accountsTable.id, code: accountsTable.code })
          .from(accountsTable)
          .where(and(eq(accountsTable.companyId, companyId), inArray(accountsTable.code, kodesToResolve)));
        const codeToId = new Map(accRows.map((a) => [a.code, a.id]));

        if (kontoStroskaKoda) {
          const found = codeToId.get(kontoStroskaKoda);
          if (!found) { res.status(400).json({ error: `Konto stroška '${kontoStroskaKoda}' ni najden v kontnem načrtu podjetja` }); return; }
          resolvedStroskaId = found;
        }
        if (kontoPopravkaKoda) {
          const found = codeToId.get(kontoPopravkaKoda);
          if (!found) { res.status(400).json({ error: `Konto popravka '${kontoPopravkaKoda}' ni najden v kontnem načrtu podjetja` }); return; }
          resolvedPopravkaId = found;
        }
      }
    }

    // Validacija ID-jev: konto mora biti iz istega podjetja
    const idsToValidate = [resolvedStroskaId, resolvedPopravkaId].filter((id): id is string => typeof id === "string");
    if (idsToValidate.length > 0) {
      const { inArray } = await import("drizzle-orm");
      const validAcc = await db
        .select({ id: accountsTable.id, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting, code: accountsTable.code })
        .from(accountsTable)
        .where(and(eq(accountsTable.companyId, companyId), inArray(accountsTable.id, idsToValidate)));
      const validIds = new Map(validAcc.map((a) => [a.id, a]));

      if (resolvedStroskaId && !validIds.has(resolvedStroskaId)) {
        res.status(400).json({ error: `Konto stroška id=${resolvedStroskaId} ni najden v kontnem načrtu tega podjetja` }); return;
      }
      if (resolvedPopravkaId && !validIds.has(resolvedPopravkaId)) {
        res.status(400).json({ error: `Konto popravka id=${resolvedPopravkaId} ni najden v kontnem načrtu tega podjetja` }); return;
      }
    }

    // Upsert
    const existing = await db.select({ id: osAmortizacijaNastavitveTable.id })
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
      .limit(1);

    if (existing.length > 0) {
      const updates: Record<string, unknown> = {};
      if (resolvedStroskaId !== undefined) updates.kontoStroskaId = resolvedStroskaId;
      if (resolvedPopravkaId !== undefined) updates.kontoPopravkaId = resolvedPopravkaId;
      if (osLeto !== undefined) updates.osLeto = osLeto;  // null = počisti, number = nastavi
      if (praviloZacetkaAmortizacije !== undefined) updates.praviloZacetkaAmortizacije = praviloZacetkaAmortizacije;
      if (Object.keys(updates).length > 0) {
        await db.update(osAmortizacijaNastavitveTable).set(updates).where(eq(osAmortizacijaNastavitveTable.companyId, companyId));
      }
    } else {
      await db.insert(osAmortizacijaNastavitveTable).values({
        companyId,
        kontoStroskaId: resolvedStroskaId ?? null,
        kontoPopravkaId: resolvedPopravkaId ?? null,
        osLeto: osLeto ?? null,
        praviloZacetkaAmortizacije: praviloZacetkaAmortizacije ?? "naslednji_dan",
      });
    }

    const [updated] = await db
      .select({
        kontoStroskaId: osAmortizacijaNastavitveTable.kontoStroskaId,
        kontoPopravkaId: osAmortizacijaNastavitveTable.kontoPopravkaId,
        osLeto: osAmortizacijaNastavitveTable.osLeto,
        praviloZacetkaAmortizacije: osAmortizacijaNastavitveTable.praviloZacetkaAmortizacije,
      })
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
      .limit(1);

    const accMap2 = await loadAccountDisplayInfo([updated?.kontoStroskaId ?? null, updated?.kontoPopravkaId ?? null], companyId);

    const glkEnabledPatch = await hasGlkModule(companyId);
    res.json({
      kontoStroskaId: updated?.kontoStroskaId ?? null,
      kontoStroskaCode: updated?.kontoStroskaId ? (accMap2.get(updated.kontoStroskaId)?.code ?? null) : null,
      kontoStroskaName: updated?.kontoStroskaId ? (accMap2.get(updated.kontoStroskaId)?.name ?? null) : null,
      kontoPopravkaId: updated?.kontoPopravkaId ?? null,
      kontoPopravkaCode: updated?.kontoPopravkaId ? (accMap2.get(updated.kontoPopravkaId)?.code ?? null) : null,
      kontoPopravkaName: updated?.kontoPopravkaId ? (accMap2.get(updated.kontoPopravkaId)?.name ?? null) : null,
      osLeto: updated?.osLeto ?? null,
      praviloZacetkaAmortizacije: (updated?.praviloZacetkaAmortizacije ?? "naslednji_dan") as PraviloZacetkaAmortizacije,
      hasGlkModule: glkEnabledPatch,
    });
  },
);

// ─── GET /os/:companyId/amortizacija/izpis ───────────────────────────────────
//
// Samostojen izpis temeljnice amortizacije — NEODVISEN od GLK.
// Dostop: katera koli OS vloga (os_admin, os_user, os_viewer).
// Brez periodId, brez accounting_periods, brez accounting_roles.
// Query: ?leto=YYYY (privzeto: osLeto iz nastavitev ali tekoče leto)
//        &format=pdf|csv (privzeto: pdf)

router.get(
  "/os/:companyId/amortizacija/izpis",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;

    // Katera koli OS vloga zadosti — NE zahteva ERP vloge
    const role = await resolveOsModuleRole(clerkUserId, companyId, res);
    if (!role) return;

    const { format = "pdf", leto: letoParam } = req.query as { format?: string; leto?: string };

    if (format !== "pdf" && format !== "csv") {
      res.status(400).json({ error: "Neveljaven format. Podprti: pdf, csv" }); return;
    }

    // ── Naloži nastavitve (OS leto + privzeta konta) ────────────────────────
    const [nastavitve] = await db
      .select({
        kontoStroskaId: osAmortizacijaNastavitveTable.kontoStroskaId,
        kontoPopravkaId: osAmortizacijaNastavitveTable.kontoPopravkaId,
        osLeto: osAmortizacijaNastavitveTable.osLeto,
      })
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
      .limit(1);

    // Resolviraj leto: param → osLeto iz nastavitev → tekoče leto
    const resolvedLeto = letoParam
      ? parseInt(letoParam, 10)
      : (nastavitve?.osLeto ?? new Date().getFullYear());

    if (isNaN(resolvedLeto) || resolvedLeto < 1990 || resolvedLeto > 2100) {
      res.status(400).json({ error: "Neveljavno leto (1990–2100)" }); return;
    }

    if (!nastavitve?.kontoStroskaId || !nastavitve?.kontoPopravkaId) {
      res.status(400).json({
        error: "Privzeta konta amortizacije niso nastavljena. Nastavi ju v Nastavitve kontov.",
        code: "MISSING_AMORT_ACCOUNTS",
      }); return;
    }

    // ── Podatki podjetja (za glavo PDF) ────────────────────────────────────
    const [company] = await db
      .select({ naziv: companiesTable.naziv, podjetjeDavcna: companiesTable.podjetjeDavcna })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .limit(1);

    // ── Preberi shranjeni obračun (glava) ───────────────────────────────────
    // Izpis temelji IZKLJUČNO na shranjenem obračunu — enak vir kot GLK osnutek.
    const [savedObracun] = await db
      .select({
        id: osAmortizacijaObracunTable.id,
        doMeseca: osAmortizacijaObracunTable.doMeseca,
        status: osAmortizacijaObracunTable.status,
      })
      .from(osAmortizacijaObracunTable)
      .where(and(
        eq(osAmortizacijaObracunTable.companyId, companyId),
        eq(osAmortizacijaObracunTable.leto, resolvedLeto),
      ))
      .limit(1);

    if (!savedObracun) {
      res.status(404).json({
        error: `Za leto ${resolvedLeto} ni shranjenega obračuna. Najprej zaženi obračun na strani Amortizacijski obračun.`,
        code: "NO_OBRACUN",
      });
      return;
    }

    const doMeseca = savedObracun.doMeseca;

    // ── Preberi shranjene vrstice (po sredstvih) — identični zneski kot GLK osnutek ─
    const savedVrstice = await db
      .select({
        sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
        obracunano: osAmortizacijaObracunSredstvoTable.obracunano,
        kontoStroskaId: osnovnaSredstvaTable.kontoStroskaId,
        kontoPopravkaId: osnovnaSredstvaTable.kontoPopravkaId,
        costCenterId: osnovnaSredstvaTable.costCenterId,
      })
      .from(osAmortizacijaObracunSredstvoTable)
      .innerJoin(
        osnovnaSredstvaTable,
        eq(osAmortizacijaObracunSredstvoTable.sredstvoId, osnovnaSredstvaTable.id),
      )
      .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, savedObracun.id));

    // ── Zberi konto ID-je za prikaz kod/naziva ──────────────────────────────
    const allAccountIds = [
      nastavitve.kontoStroskaId,
      nastavitve.kontoPopravkaId,
      ...savedVrstice.map((v) => v.kontoStroskaId).filter(Boolean) as string[],
      ...savedVrstice.map((v) => v.kontoPopravkaId).filter(Boolean) as string[],
    ];
    const accountMap = await loadValidatedAccountMap(allAccountIds, companyId);

    // ── amortData iz shranjenih zneskov — NE recalc, enako kot GLK osnutek ──
    const amortData = savedVrstice.map((v) => ({
      id: v.sredstvoId,
      skupnaObracunana: v.obracunano,
      kontoStroskaId: v.kontoStroskaId ?? null,
      kontoPopravkaId: v.kontoPopravkaId ?? null,
      costCenterId: v.costCenterId ?? null,
    }));

    const referenca = doMeseca < 12
      ? `AMORT:${resolvedLeto}/${String(doMeseca).padStart(2, "0")}`
      : `AMORT:${resolvedLeto}`;
    const predogled = buildKnjizenjePredogled(
      amortData,
      nastavitve.kontoStroskaId,
      nastavitve.kontoPopravkaId,
      accountMap,
      referenca,
      resolvedLeto,
      null,
    );

    // Datum izpisa v dd.mm.yyyy — razčlenimo ISO niz (brez timezone zamika)
    const datumIzpisaIso = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Ljubljana" }); // YYYY-MM-DD
    const [diy, dim, did] = datumIzpisaIso.split("-");
    const datumIzpisa = `${did}.${dim}.${diy}`;

    // ── Prazna amortizacija — jasen odgovor, ne 500 ───────────────────────
    if (predogled.vrstice.length === 0) {
      const vzrok = predogled.steviloSredstev === 0
        ? `Ni aktivnih sredstev z veljavnimi konti za leto ${resolvedLeto}.`
        : predogled.brezKontov > 0
          ? `Vsa sredstva (${predogled.brezKontov}) imajo nekonfiguriran, neaktiven ali skupinski konto amortizacije.`
          : `Ni amortizacije za leto ${resolvedLeto} — sredstva so morda v celoti odpisana.`;
      const sporocilo = `${vzrok} Nastavi OS leto v nastavitvah kontov amortizacije.`;
      res.status(400).json({ error: sporocilo, code: "NO_AMORTIZATION" }); return;
    }

    // ── CSV ─────────────────────────────────────────────────────────────────
    const obdobjeNapis = doMeseca < 12
      ? `${resolvedLeto} do ${doMeseca}/${resolvedLeto}`
      : String(resolvedLeto);
    const filenameSuffix = doMeseca < 12
      ? `${resolvedLeto}-do${String(doMeseca).padStart(2, "0")}`
      : String(resolvedLeto);

    if (format === "csv") {
      const bom = "\uFEFF";
      const header = "Konto breme;Naziv konta breme;Konto dobro;Naziv konta dobro;Znesek V breme;Znesek V dobro;Opis;Datum izpisa\n";
      const rows = predogled.vrstice.map((v) => {
        const opis = `Amortizacija OS ${obdobjeNapis}`;
        return [
          v.kontoStroskaCode ?? "",
          v.kontoStroskaName ?? "",
          v.kontoPopravkaCode ?? "",
          v.kontoPopravkaName ?? "",
          v.znesek.replace(".", ","),
          v.znesek.replace(".", ","),
          opis,
          datumIzpisa,
        ].join(";");
      }).join("\n");

      const skupajRow = `;;;SKUPAJ;${predogled.skupajBreme.replace(".", ",")};${predogled.skupajDobro.replace(".", ",")};;`;
      const csv = bom + header + rows + (rows ? "\n" : "") + skupajRow;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="amortizacija-temeljnica-${filenameSuffix}.csv"`);
      res.send(csv);
      return;
    }

    // ── PDF ─────────────────────────────────────────────────────────────────
    const { generateAmortizacijaTemeljnicaPdf } = await import("../lib/report-pdf");
    const pdfBuffer = await generateAmortizacijaTemeljnicaPdf({
      companyName: company?.naziv ?? companyId,
      companyTaxId: company?.podjetjeDavcna ?? null,
      leto: resolvedLeto,
      doMeseca,
      datumIzpisa,
      vrstice: predogled.vrstice,
      skupajBreme: predogled.skupajBreme,
      skupajDobro: predogled.skupajDobro,
      uravnotezeno: predogled.uravnotezeno,
      brezKontov: predogled.brezKontov,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="amortizacija-temeljnica-${filenameSuffix}.pdf"`);
    res.send(pdfBuffer);
  },
);

// ─── POST /os/:companyId/amortizacija/knjizenje ───────────────────────────────

router.post(
  "/os/:companyId/amortizacija/knjizenje",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;

    const role = await resolveOsModuleRole(clerkUserId, companyId, res);
    if (!role) return;
    if (role === "os_viewer") {
      res.status(403).json({ error: "Za knjiženje amortizacije potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const { leto, mesec, dryRun } = req.body as {
      leto?: number;
      mesec?: number;
      dryRun?: boolean;
    };

    if (!leto || typeof leto !== "number" || leto < 1990 || leto > 2100) {
      res.status(400).json({ error: "Neveljavno leto (pričakovano: 1990–2100)" }); return;
    }
    if (mesec !== undefined && (typeof mesec !== "number" || mesec < 1 || mesec > 12)) {
      res.status(400).json({ error: "Neveljavni mesec (pričakovano: 1–12)" }); return;
    }

    // ── Vzajemni izklop letni/mesečni se preverja ZNOTRAJ transakcije (pod advisory lock)
    // → glejte spodaj pri db.transaction()
    // ── GLK modul + samodejno GLK obdobje se preverita po dryRun/brezKontov preverbi (glejte spodaj)

    // ── Naloži nastavitve ─────────────────────────────────────────────────────
    const [nastavitve] = await db
      .select({
        kontoStroskaId: osAmortizacijaNastavitveTable.kontoStroskaId,
        kontoPopravkaId: osAmortizacijaNastavitveTable.kontoPopravkaId,
        praviloZacetkaAmortizacije: osAmortizacijaNastavitveTable.praviloZacetkaAmortizacije,
      })
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
      .limit(1);

    if (!nastavitve?.kontoStroskaId || !nastavitve?.kontoPopravkaId) {
      res.status(400).json({
        error: "Privzeta konta amortizacije niso nastavljena.",
        code: "MISSING_AMORT_ACCOUNTS",
      }); return;
    }

    const pravilo: PraviloZacetkaAmortizacije =
      (nastavitve.praviloZacetkaAmortizacije as PraviloZacetkaAmortizacije) ?? "naslednji_dan";

    // ── Validacija privzetih kontov (upfront, pred izračunom) ─────────────────
    // Varnostna omejitev: konti morajo biti iz istega podjetja
    const defaultAccValidation = await loadValidatedAccountMap(
      [nastavitve.kontoStroskaId, nastavitve.kontoPopravkaId],
      companyId,
    );

    const defaultStroskAcc = defaultAccValidation.get(nastavitve.kontoStroskaId);
    const defaultPopravkaAcc = defaultAccValidation.get(nastavitve.kontoPopravkaId);

    if (!defaultStroskAcc) {
      res.status(400).json({ error: `Privzeti konto stroška (id=${nastavitve.kontoStroskaId}) ni najden v kontnem načrtu tega podjetja. Možno cross-company zaporedje.` }); return;
    }
    if (!defaultPopravkaAcc) {
      res.status(400).json({ error: `Privzeti konto popravka (id=${nastavitve.kontoPopravkaId}) ni najden v kontnem načrtu tega podjetja. Možno cross-company zaporedje.` }); return;
    }
    if (!defaultStroskAcc.isActive) {
      res.status(400).json({ error: `Privzeti konto stroška ${defaultStroskAcc.code} ni aktiven. Nastavi aktiven konto v nastavitvah.` }); return;
    }
    if (!defaultStroskAcc.allowsPosting) {
      res.status(400).json({ error: `Privzeti konto stroška ${defaultStroskAcc.code} je skupinski konto — knjiženje ni dovoljeno. Izberi listni konto.` }); return;
    }
    if (!defaultPopravkaAcc.isActive) {
      res.status(400).json({ error: `Privzeti konto popravka ${defaultPopravkaAcc.code} ni aktiven.` }); return;
    }
    if (!defaultPopravkaAcc.allowsPosting) {
      res.status(400).json({ error: `Privzeti konto popravka ${defaultPopravkaAcc.code} je skupinski konto — knjiženje ni dovoljeno.` }); return;
    }
    if (defaultStroskAcc.requiresPartner) {
      res.status(400).json({ error: `Privzeti konto stroška ${defaultStroskAcc.code} zahteva poslovnega partnerja, ki ga amortizacijska knjižba ne vsebuje.` }); return;
    }
    if (defaultStroskAcc.requiresProject) {
      res.status(400).json({ error: `Privzeti konto stroška ${defaultStroskAcc.code} zahteva projekt, ki ga amortizacijska knjižba ne vsebuje.` }); return;
    }
    if (defaultPopravkaAcc.requiresPartner) {
      res.status(400).json({ error: `Privzeti konto popravka ${defaultPopravkaAcc.code} zahteva poslovnega partnerja, ki ga amortizacijska knjižba ne vsebuje.` }); return;
    }
    if (defaultPopravkaAcc.requiresProject) {
      res.status(400).json({ error: `Privzeti konto popravka ${defaultPopravkaAcc.code} zahteva projekt, ki ga amortizacijska knjižba ne vsebuje.` }); return;
    }

    // ── Naloži podatke ────────────────────────────────────────────────────────
    const { glaveRows, doknjizbeByGlava, skupineMap } = await loadSredstvaData(companyId);

    // Zberi vse relevantne konto ID-je (privzeti + per-asset) — skoped na companyId v loadValidatedAccountMap
    const allAccountIds = [
      nastavitve.kontoStroskaId,
      nastavitve.kontoPopravkaId,
      ...glaveRows.map((g) => g.kontoStroskaId).filter(Boolean) as string[],
      ...glaveRows.map((g) => g.kontoPopravkaId).filter(Boolean) as string[],
    ];

    const accountMap = await loadValidatedAccountMap(allAccountIds, companyId);

    // ── Izračun amortizacije ──────────────────────────────────────────────────
    let amortData: Array<{
      id: string;
      skupnaObracunana: string;
      kontoStroskaId: string | null;
      kontoPopravkaId: string | null;
      costCenterId: string | null;
    }>;

    if (mesec !== undefined) {
      const mesecneVrednosti = calcMesecnaAmortizacija(glaveRows, doknjizbeByGlava, skupineMap, leto, mesec);
      amortData = glaveRows.map((g) => ({
        id: g.id,
        skupnaObracunana: mesecneVrednosti.get(g.id) ?? "0.00",
        kontoStroskaId: g.kontoStroskaId ?? null,
        kontoPopravkaId: g.kontoPopravkaId ?? null,
        costCenterId: g.costCenterId ?? null,
      }));
    } else {
      const sredstvaInput: SredstvoInput[] = glaveRows.map((g) => {
        const skupina = g.skupinaId ? skupineMap.get(g.skupinaId) : undefined;
        const doknjizbe = (doknjizbeByGlava.get(g.id) ?? []).sort((a, b) => a.seq - b.seq);
        return {
          id: g.id,
          inventarnaSt: g.inventarnaSt,
          naziv: g.naziv,
          skupinaId: g.skupinaId ?? null,
          skupinaNaziv: skupina?.naziv ?? null,
          skupinaKoda: skupina?.koda ?? null,
          racunovodskaStonja: skupina?.racunovodskaStonja ?? null,
          davcnaStonja: skupina?.davcnaStonja ?? null,
          accountId: g.accountId ?? null,
          accountCode: null,
          accountName: null,
          costCenterId: g.costCenterId ?? null,
          costCenterCode: null,
          costCenterName: null,
          status: g.status,
          doknjizbe,
        };
      });
      const obracun = calcAmortizacijaObracun(sredstvaInput, leto, undefined, pravilo);
      amortData = obracun.sredstva.map((s) => {
        const glava = glaveRows.find((g) => g.id === s.id);
        return {
          id: s.id,
          skupnaObracunana: s.skupnaObracunanaRacunovodska,
          kontoStroskaId: glava?.kontoStroskaId ?? null,
          kontoPopravkaId: glava?.kontoPopravkaId ?? null,
          costCenterId: glava?.costCenterId ?? null,
        };
      });
    }

    // ── Agregacija in predogled ───────────────────────────────────────────────
    const referenca = mesec !== undefined
      ? `AMORT:${leto}-${String(mesec).padStart(2, "0")}`
      : `AMORT:${leto}`;

    const predogled = buildKnjizenjePredogled(
      amortData,
      nastavitve.kontoStroskaId,
      nastavitve.kontoPopravkaId,
      accountMap,
      referenca,
      leto,
      mesec ?? null,
    );

    // ── DryRun → vrni predogled ───────────────────────────────────────────────
    if (dryRun) {
      res.json(predogled);
      return;
    }

    // ── Blokiraj kreacijo, ko katerikoli amortizirajoče sredstvo nima veljavnih kontov ──
    // Delna temeljnica bi napačno podreportirala amortizacijo brez opozorila.
    // Vse napake (neaktiven konto, skupinski konto, manjkajoča dimenzija, cross-company ID)
    // so bile zaznane v buildKnjizenjePredogled in štete v brezKontov.
    if (predogled.brezKontov > 0) {
      res.status(400).json({
        error: `${predogled.brezKontov} od ${predogled.steviloSredstev} amortiziranih sredstev nima veljavnih knjižbenih kontov (neaktiven, skupinski, cross-company konto ali manjkajoča obvezna dimenzija). Popravi konte za ta sredstva pred ustvarjanjem temeljnice.`,
        code: "INCOMPLETE_ACCOUNTS",
        brezKontov: predogled.brezKontov,
        steviloSredstev: predogled.steviloSredstev,
      });
      return;
    }

    if (predogled.vrstice.length === 0) {
      res.status(400).json({ error: "Ni sredstev z amortizacijo za izbrano obdobje — temeljnica bi bila prazna." });
      return;
    }

    // ── Non-dryRun: preveri GLK modul in samodejno poišči računovodsko obdobje ──
    // Pogoj: podjetje mora imeti ERP (GLK) modul; period se izpelje iz leta/meseca.
    // OS-only podjetja (brez GLK): pošljejo izpis PDF/CSV — temeljnica ni podprta.
    const glkEnabledKnjizenje = await hasGlkModule(companyId);
    if (!glkEnabledKnjizenje) {
      res.status(403).json({
        error: "Podjetje nima GLK modula. Amortizacijo shranite kot izpis (PDF/CSV) — za GLK temeljnico je potreben ERP modul.",
        code: "NO_GLK_MODULE",
      });
      return;
    }

    const period = await findPeriodForBooking(companyId, leto, mesec);
    if (!period) {
      const oznaka = mesec !== undefined
        ? `${String(mesec).padStart(2, "0")}/${leto}`
        : `leto ${leto}`;
      res.status(400).json({
        error: `Ni odprtega GLK računovodskega obdobja za ${oznaka}. Ustvari ali odkleni ustrezno računovodsko obdobje v nastavitvah GLK.`,
        code: "NO_PERIOD_FOR_LETO",
      });
      return;
    }

    // ── Datumi: documentDate = konec obdobja; entryDate = clamp(today, start, end) ─
    const today = new Date().toISOString().slice(0, 10);
    const documentDate = period.endDate;                          // amortizacija velja za celotno obdobje
    const entryDate = clampDate(today, period.startDate, period.endDate); // knjiženje mora biti v obdobju

    const opis = mesec !== undefined
      ? `Amortizacija OS ${String(mesec).padStart(2, "0")}/${leto}`
      : `Amortizacija OS ${leto}`;

    // ── Ustvari OSNUTEK temeljnice (NIKOLI auto-posted) ───────────────────────
    //
    // Transakcija vsebuje:
    //   1. pg_advisory_xact_lock — serializes vsa hkratna knjiženja za isto podjetje+leto,
    //      s čimer preprečimo race condition med letnim in mesečnim obračunom.
    //   2. Conflict-check (MONTHLY_EXISTS_FOR_YEAR / ANNUAL_EXISTS_FOR_YEAR) znotraj zaklepanja.
    //   3. INSERT journal_entries + journal_entry_lines.
    //   4. Parcialni UNIQUE indeks za aktivne (draft/posted) amortizacijske temeljnice
    //      ujame morebitne preostale duplikate in vrže 23505.
    //
    const lockKey = `amort:${companyId}:${leto}`;

    let entry: { id: string };
    try {
      entry = await db.transaction(async (tx) => {
        // 1. Pridobi advisory lock za (podjetje, leto) — samodejno sprosti ob koncu transakcije
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        // 2. Preveri vzajemni izklop letni↔mesečni pod zaklenitvijo
        if (mesec === undefined) {
          const mesecne = await tx
            .select({ entryId: journalEntriesTable.id, status: journalEntriesTable.status })
            .from(journalEntriesTable)
            .where(
              and(
                eq(journalEntriesTable.companyId, companyId),
                eq(journalEntriesTable.sourceType, "amortizacija"),
                inArray(journalEntriesTable.status, ["draft", "posted"]),
                like(journalEntriesTable.reference, `AMORT:${leto}-%`),
              ),
            );
          if (mesecne.length > 0) {
            // makeAmortConflict vrže objekt z AMORT_CONFLICT sentinelom — ni razred,
            // da se izognemo težavam z instanceof v async kontekstu.
            throw makeAmortConflict(409, {
              error: `Za leto ${leto} že obstajajo mesečne amortizacijske temeljnice. Letni obračun ni dovoljen, ko so mesečni zapisi prisotni za isto leto.`,
              code: "MONTHLY_EXISTS_FOR_YEAR",
              existingEntries: mesecne,
            });
          }
        } else {
          const letne = await tx
            .select({ entryId: journalEntriesTable.id, status: journalEntriesTable.status })
            .from(journalEntriesTable)
            .where(
              and(
                eq(journalEntriesTable.companyId, companyId),
                eq(journalEntriesTable.sourceType, "amortizacija"),
                inArray(journalEntriesTable.status, ["draft", "posted"]),
                eq(journalEntriesTable.reference, `AMORT:${leto}`),
              ),
            );
          if (letne.length > 0) {
            throw makeAmortConflict(409, {
              error: `Za leto ${leto} že obstaja letna amortizacijska temeljnica (AMORT:${leto}). Mesečni obračun ni dovoljen, ko letni zapis obstaja za isto leto.`,
              code: "ANNUAL_EXISTS_FOR_YEAR",
              existingEntries: letne,
            });
          }
        }

        // 3. Aktivni osnutki in knjižene temeljnice preprečijo dvojnik.
        //    Izbrisani osnutki in stornirane temeljnice ne blokirajo ponovnega vnosa.
        //    Pod advisory lockom — varen pred race condition.
        const existingEntries = await tx
          .select({ entryId: journalEntriesTable.id, status: journalEntriesTable.status })
          .from(journalEntriesTable)
          .where(
            and(
              eq(journalEntriesTable.companyId, companyId),
              eq(journalEntriesTable.sourceType, "amortizacija"),
              inArray(journalEntriesTable.status, ["draft", "posted"]),
              eq(journalEntriesTable.reference, referenca),
            ),
          );

        if (existingEntries.length > 0) {
          throw makeAmortConflict(409, {
            error: `Temeljnica za obdobje ${referenca} že obstaja. Odpri obstoječo temeljnico; za nov vnos najprej izbriši osnutek ali storniraj knjiženo temeljnico.`,
            code: "DUPLICATE_PERIOD",
            existingEntries,
            existingEntryId: existingEntries[0].entryId,
            existingStatus: existingEntries[0].status,
          });
        }
        const [newEntry] = await tx
          .insert(journalEntriesTable)
          .values({
            companyId,
            periodId: period.id,
            documentDate,
            entryDate,
            description: opis,
            reference: referenca,
            status: "draft",
            postedAt: null,
            sourceType: "amortizacija",
            approvedBy: null,
            createdBy: clerkUserId,
          })
          .returning({ id: journalEntriesTable.id });
        const entryId = newEntry.id;

        // Vstavi vrstice novega osnutka.
        const lines: Array<{
          entryId: string;
          accountId: string;
          side: "debit" | "credit";
          amount: string;
          description: string;
          sequence: number;
          costCenterId: string | null;
        }> = [];

        let seq = 0;
        for (const v of predogled.vrstice) {
          lines.push({
            entryId,
            accountId: v.kontoStroskaId,
            side: "debit",
            amount: v.znesek,
            description: opis,
            sequence: seq++,
            costCenterId: v.costCenterId,
          });
          lines.push({
            entryId,
            accountId: v.kontoPopravkaId,
            side: "credit",
            amount: v.znesek,
            description: opis,
            sequence: seq++,
            costCenterId: v.costCenterId,
          });
        }

        await tx.insert(journalEntryLinesTable).values(lines);
        return { id: entryId };
      });
    } catch (err: unknown) {
      // Conflict signaliziran iz transakcije (advisory lock je aktiven)
      if (isAmortConflict(err)) {
        res.status(err.httpStatus).json(err.body);
        return;
      }
      // Varnostna mreža: PostgreSQL unique_violation (parcialni indeks za amortizacija)
      // Ob normalnem delovanju ne sme priti do sem — zaklep zgoraj pokrije duplikate.
      const pgCode = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : undefined;
      if (pgCode === "23505") {
        const existingEntries = await db
          .select({ entryId: journalEntriesTable.id, status: journalEntriesTable.status })
          .from(journalEntriesTable)
          .where(and(
            eq(journalEntriesTable.companyId, companyId),
            eq(journalEntriesTable.sourceType, "amortizacija"),
            inArray(journalEntriesTable.status, ["draft", "posted"]),
            eq(journalEntriesTable.reference, referenca),
          ));
        if (existingEntries.length === 0) throw err;
        res.status(409).json({
          error: `Temeljnica za obdobje ${referenca} že obstaja.`,
          code: "DUPLICATE_PERIOD",
          existingEntries,
          existingEntryId: existingEntries[0].entryId,
          existingStatus: existingEntries[0].status,
        });
        return;
      }
      throw err;
    }

    // Poveži journal_entry z os_amortizacija_obracun, da ne nastane sirota.
    // Če za to podjetje+leto obstaja obračun brez (ali z napačno) glk_temeljnica_id → shrani.
    if (mesec === undefined) {
      const [obracunZaLink] = await db
        .select({ id: osAmortizacijaObracunTable.id, glkTemeljnicaId: osAmortizacijaObracunTable.glkTemeljnicaId })
        .from(osAmortizacijaObracunTable)
        .where(and(eq(osAmortizacijaObracunTable.companyId, companyId), eq(osAmortizacijaObracunTable.leto, leto)))
        .limit(1);
      if (obracunZaLink && obracunZaLink.glkTemeljnicaId !== entry.id) {
        await db
          .update(osAmortizacijaObracunTable)
          .set({ glkTemeljnicaId: entry.id, updatedAt: new Date() })
          .where(eq(osAmortizacijaObracunTable.id, obracunZaLink.id));
      }
    }

    res.status(201).json({
      entryId: entry.id,
      referenca,
      status: "draft",
      skupajBreme: predogled.skupajBreme,
      skupajDobro: predogled.skupajDobro,
      steviloVrstic: predogled.vrstice.length * 2,
      documentDate,
      entryDate,
      opis,
    });
  },
);

// ─── POST /os/:companyId/amortizacija/obracun ─────────────────────────────────
//
// Shrani / ažurira mesečni obračun amortizacije za dano leto in mesec.
// UPSERT logika: ena glava na leto, vrstice se ažurirajo ob ponovnem zagonu.
//
// Zaklep: leto Y+1 je blokiran, dokler Y ni zakljucen (december ali prazen obračun).
// Dostop: samo os_admin.

router.post(
  "/os/:companyId/amortizacija/obracun",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;

    const role = await resolveOsModuleRole(clerkUserId, companyId, res);
    if (!role) return;
    if (role !== "os_admin" && !isSuperAdmin(clerkUserId)) {
      res.status(403).json({ error: "Mesečni obračun amortizacije lahko izvede samo os_admin" });
      return;
    }

    const { leto, doMeseca } = req.body as { leto?: number; doMeseca?: number };

    if (!leto || typeof leto !== "number" || !Number.isInteger(leto) || leto < 1990 || leto > 2100) {
      res.status(400).json({ error: "Neveljavno leto (pričakovano: celo število 1990–2100)" }); return;
    }
    if (!doMeseca || typeof doMeseca !== "number" || !Number.isInteger(doMeseca) || doMeseca < 1 || doMeseca > 12) {
      res.status(400).json({ error: "Neveljavni doMeseca (pričakovano: celo število 1–12)" }); return;
    }

    // ── Zaklep: preveri obračun za (leto - 1) ────────────────────────────────
    // Dovoli, ko (leto-1) ne obstaja ali je zakljucen. Blokiraj, ko je odprt.
    const prevLeto = leto - 1;
    const [prevObracun] = await db
      .select({ id: osAmortizacijaObracunTable.id, status: osAmortizacijaObracunTable.status, doMeseca: osAmortizacijaObracunTable.doMeseca })
      .from(osAmortizacijaObracunTable)
      .where(and(eq(osAmortizacijaObracunTable.companyId, companyId), eq(osAmortizacijaObracunTable.leto, prevLeto)))
      .limit(1);

    // Odsotnost vrstic ni dovolj za prazen obračun: preveri še register podjetja.
    let prazenPrejsnjiObracun = false;
    if (prevObracun?.status === "odprt") {
      const [vrstice, sredstva] = await Promise.all([
        db.select({ id: osAmortizacijaObracunSredstvoTable.id })
          .from(osAmortizacijaObracunSredstvoTable)
          .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, prevObracun.id))
          .limit(1),
        db.select({ id: osnovnaSredstvaTable.id })
          .from(osnovnaSredstvaTable)
          .where(eq(osnovnaSredstvaTable.companyId, companyId))
          .limit(1),
      ]);
      prazenPrejsnjiObracun = vrstice.length === 0 && sredstva.length === 0;
    }
    if (prevObracun && prevObracun.status !== "zakljucen" && !prazenPrejsnjiObracun) {
      res.status(409).json({
        error: `Obračun za leto ${prevLeto} ni dokončan za celo leto. Najprej zaključi leto ${prevLeto} (obračun do decembra), nato lahko obračunaš leto ${leto}.`,
        code: "PREV_YEAR_NOT_CLOSED",
        prevLeto,
        prevDoMeseca: prevObracun.doMeseca,
      });
      return;
    }

    // ── Oslabitev preteklega leta (N-1) za izračun osnove tega leta ──────────
    const oslabitevPrevLetoMap = new Map<string, string>();
    const oslabitevPrevLetoMetodaMap = new Map<string, number>();
    if (prevObracun?.id) {
      const prevOslVrstice = await db
        .select({
          sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
          oslabitev: osAmortizacijaObracunSredstvoTable.oslabitev,
          oslabitevMetoda: osAmortizacijaObracunSredstvoTable.oslabitevMetoda,
        })
        .from(osAmortizacijaObracunSredstvoTable)
        .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, prevObracun.id));
      for (const v of prevOslVrstice) {
        if (parseFloat(v.oslabitev) > 0) {
          oslabitevPrevLetoMap.set(v.sredstvoId, v.oslabitev);
          oslabitevPrevLetoMetodaMap.set(v.sredstvoId, v.oslabitevMetoda ?? 1);
        }
      }
    }

    // ── Nova letna AM: iz NAJNOVEJŠEGA leta z oslabitev_nova_letna_am_rac > 0 ──
    // Velja za VSA naslednja leta po oslabitvi (ne samo N+1).
    const oslabitevNovaLetnaAmMap = new Map<string, string>();
    {
      const novaLetnaRows = await db
        .select({
          sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
          oslabitevNovaLetnaAmRac: osAmortizacijaObracunSredstvoTable.oslabitevNovaLetnaAmRac,
        })
        .from(osAmortizacijaObracunSredstvoTable)
        .innerJoin(
          osAmortizacijaObracunTable,
          eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id),
        )
        .where(
          and(
            eq(osAmortizacijaObracunTable.companyId, companyId),
            lt(osAmortizacijaObracunTable.leto, leto),
          ),
        )
        .orderBy(desc(osAmortizacijaObracunTable.leto));
      for (const row of novaLetnaRows) {
        if (!oslabitevNovaLetnaAmMap.has(row.sredstvoId) && row.oslabitevNovaLetnaAmRac) {
          const val = parseFloat(row.oslabitevNovaLetnaAmRac);
          if (val > 0) oslabitevNovaLetnaAmMap.set(row.sredstvoId, row.oslabitevNovaLetnaAmRac);
        }
      }
    }

    // ── Naloži nastavitve ─────────────────────────────────────────────────────
    const [nastavitve] = await db
      .select({
        kontoStroskaId: osAmortizacijaNastavitveTable.kontoStroskaId,
        kontoPopravkaId: osAmortizacijaNastavitveTable.kontoPopravkaId,
        praviloZacetkaAmortizacije: osAmortizacijaNastavitveTable.praviloZacetkaAmortizacije,
      })
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
      .limit(1);

    if (!nastavitve?.kontoStroskaId || !nastavitve?.kontoPopravkaId) {
      res.status(400).json({
        error: "Privzeta konta amortizacije niso nastavljena. Nastavi ju v Nastavitve kontov.",
        code: "MISSING_AMORT_ACCOUNTS",
      }); return;
    }

    const pravilo: PraviloZacetkaAmortizacije =
      (nastavitve.praviloZacetkaAmortizacije as PraviloZacetkaAmortizacije) ?? "naslednji_dan";

    // ── Naloži sredstva + skupne ──────────────────────────────────────────────
    const { glaveRows, doknjizbeByGlava, skupineMap } = await loadSredstvaData(companyId);

    const allAccountIds = [
      nastavitve.kontoStroskaId,
      nastavitve.kontoPopravkaId,
      ...glaveRows.map((g) => g.kontoStroskaId).filter(Boolean) as string[],
      ...glaveRows.map((g) => g.kontoPopravkaId).filter(Boolean) as string[],
    ];
    const accountMap = await loadValidatedAccountMap(allAccountIds, companyId);

    // ── Izračun z doMeseca ────────────────────────────────────────────────────
    const sredstvaInput: SredstvoInput[] = glaveRows.map((g) => {
      const skupina = g.skupinaId ? skupineMap.get(g.skupinaId) : undefined;
      const doknjizbe = (doknjizbeByGlava.get(g.id) ?? []).sort((a, b) => a.seq - b.seq);
      return {
        id: g.id,
        inventarnaSt: g.inventarnaSt,
        naziv: g.naziv,
        skupinaId: g.skupinaId ?? null,
        skupinaNaziv: skupina?.naziv ?? null,
        skupinaKoda: skupina?.koda ?? null,
        racunovodskaStonja: skupina?.racunovodskaStonja ?? null,
        davcnaStonja: skupina?.davcnaStonja ?? null,
        accountId: g.accountId ?? null,
        accountCode: null,
        accountName: null,
        costCenterId: g.costCenterId ?? null,
        costCenterCode: null,
        costCenterName: null,
        status: g.status,
        doknjizbe,
        oslabitevPrevLeto: oslabitevPrevLetoMap.get(g.id) ?? "0.00",
        oslabitevPrevLetoMetoda: oslabitevPrevLetoMetodaMap.get(g.id) ?? 1,
        oslabitevNovaLetnaAmRac: oslabitevNovaLetnaAmMap.get(g.id),
      };
    });

    const obracunResult = calcAmortizacijaObracun(sredstvaInput, leto, doMeseca, pravilo);

    // ── Predogled (za odgovor) ────────────────────────────────────────────────
    const amortData = obracunResult.sredstva.map((s) => {
      const glava = glaveRows.find((g) => g.id === s.id);
      return {
        id: s.id,
        skupnaObracunana: s.skupnaObracunanaRacunovodska,
        kontoStroskaId: glava?.kontoStroskaId ?? null,
        kontoPopravkaId: glava?.kontoPopravkaId ?? null,
        costCenterId: glava?.costCenterId ?? null,
      };
    });

    const referenca = doMeseca < 12
      ? `AMORT:${leto}/${String(doMeseca).padStart(2, "0")}`
      : `AMORT:${leto}`;

    const predogled = buildKnjizenjePredogled(
      amortData,
      nastavitve.kontoStroskaId,
      nastavitve.kontoPopravkaId,
      accountMap,
      referenca,
      leto,
      doMeseca,
    );

    // ── Vhodni podpis (za zastarelost v pregledu) ────────────────────────────
    // Hash pravila + vseh doknjižb; shrani se skupaj z glavo.
    // Ob pregledu (GET /amortizacija) se aktualn hash primerja s shranjenim.
    const flatDoknjizbeForHash: Array<{
      sredstvoId: string; seq: number; nabavnaVrednost: string;
      odpisanaVrednost: string; neamortizljiviDelPct: string;
      datumAktivacije: string | null; datumIzpisa: string | null; status: string;
    }> = [];
    for (const [sredstvoId, doknjizbe] of doknjizbeByGlava) {
      for (const d of doknjizbe) {
        flatDoknjizbeForHash.push({ sredstvoId, seq: d.seq,
          nabavnaVrednost: d.nabavnaVrednost, odpisanaVrednost: d.odpisanaVrednost,
          neamortizljiviDelPct: d.neamortizljiviDelPct, datumAktivacije: d.datumAktivacije,
          datumIzpisa: d.datumIzpisa, status: d.status });
      }
    }
    const vhodniPodpis = computeVhodniPodpis(pravilo, flatDoknjizbeForHash);

    // ── UPSERT glava ──────────────────────────────────────────────────────────
    // Prazen obračun ne sme blokirati naslednjega leta.
    const novStatus = doMeseca >= 12 || obracunResult.sredstva.length === 0 ? "zakljucen" : "odprt";

    const [glava] = await db
      .insert(osAmortizacijaObracunTable)
      .values({
        companyId,
        leto,
        doMeseca,
        status: novStatus,
        praviloZacetkaAmortizacije: pravilo,
        vhodniPodpis,
      })
      .onConflictDoUpdate({
        target: [osAmortizacijaObracunTable.companyId, osAmortizacijaObracunTable.leto],
        set: {
          doMeseca,
          status: novStatus,
          praviloZacetkaAmortizacije: pravilo,
          vhodniPodpis,
          updatedAt: new Date(),
        },
      })
      .returning();

    // ── UPSERT vrstice ────────────────────────────────────────────────────────
    if (obracunResult.sredstva.length > 0) {
      const vrsticeValues = obracunResult.sredstva
        .filter((s) => !s.brezSkupine)
        .map((s) => ({
          obracunId: glava.id,
          sredstvoId: s.id,
          osnova: s.skupnaOsnova,
          stopnja: s.racunovodskaStonja ?? "0",
          obracunano: s.skupnaObracunanaRacunovodska,
          updatedAt: new Date(),
        }));

      if (vrsticeValues.length > 0) {
        await db
          .insert(osAmortizacijaObracunSredstvoTable)
          .values(vrsticeValues)
          .onConflictDoUpdate({
            target: [
              osAmortizacijaObracunSredstvoTable.obracunId,
              osAmortizacijaObracunSredstvoTable.sredstvoId,
            ],
            set: {
              osnova: sql`excluded.osnova`,
              stopnja: sql`excluded.stopnja`,
              obracunano: sql`excluded.obracunano`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    }

    // ── GLK integracija: osnutek temeljnice za GLK-podjetja ──────────────────
    // Samo za podjetja z erp modulom. OS-only podjetja preskočijo ta blok.
    let glkOsnutek: {
      ustvarjen: boolean;
      posodobljen: boolean;
      temeljnicaId: string | null;
      sporocilo: string;
    } = {
      ustvarjen: false,
      posodobljen: false,
      temeljnicaId: null,
      sporocilo: "OS-only podjetje: samostojni izpis na voljo",
    };

    const jeGlkPodjetje = await hasGlkModule(companyId);
    if (jeGlkPodjetje) {
      const period = await findPeriodForLeto(companyId, leto);

      if (!period) {
        glkOsnutek = {
          ustvarjen: false,
          posodobljen: false,
          temeljnicaId: null,
          sporocilo: `GLK modul aktiven, a za leto ${leto} ni odprtega računovodskega obdobja. Ustvari obdobje in ponovi obračun.`,
        };
      } else {
        // Datum temeljnice: zadnji dan doMeseca v letu (capped na endDate obdobja)
        const zeljeniDatum = lastDayOfMonth(leto, doMeseca);
        const entryDate   = zeljeniDatum > period.endDate ? period.endDate : zeljeniDatum;
        const opisGlk     = `Amortizacija OS za leto ${leto}${doMeseca < 12 ? ` (do ${doMeseca}/${leto})` : ""}`;
        const glkRef      = `OS-AMO:${leto}`;

        const obstojeci = glava.glkTemeljnicaId ?? null;

        let temeljnicaId: string;

        if (obstojeci) {
          // POSODOBI obstoječi osnutek: zamenjaj vrstice
          await db
            .delete(journalEntryLinesTable)
            .where(eq(journalEntryLinesTable.entryId, obstojeci));
          await db
            .update(journalEntriesTable)
            .set({
              entryDate,
              documentDate: entryDate,
              description: opisGlk,
              reference: glkRef,
              periodId: period.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(journalEntriesTable.id, obstojeci),
                eq(journalEntriesTable.companyId, companyId),
                eq(journalEntriesTable.status, "draft"),
              ),
            );
          temeljnicaId = obstojeci;
          glkOsnutek.posodobljen = true;
        } else {
          // USTVARI nov osnutek
          const [novaTemeljnica] = await db
            .insert(journalEntriesTable)
            .values({
              companyId,
              periodId: period.id,
              documentDate: entryDate,
              entryDate,
              description: opisGlk,
              reference: glkRef,
              status: "draft",
              sourceType: "amortizacija",
              createdBy: clerkUserId,
              approvedBy: null,
            })
            .returning({ id: journalEntriesTable.id });
          temeljnicaId = novaTemeljnica.id;
          glkOsnutek.ustvarjen = true;
        }

        // Vstavi vrstice (ena breme+dobro na konto-par, agregirano iz predogled)
        if (predogled.vrstice.length > 0) {
          const lines: Array<{
            entryId: string;
            accountId: string;
            side: "debit" | "credit";
            amount: string;
            description: string;
            sequence: number;
            costCenterId: string | null;
          }> = [];
          let seq = 0;
          for (const v of predogled.vrstice) {
            lines.push({
              entryId: temeljnicaId,
              accountId: v.kontoStroskaId,
              side: "debit",
              amount: v.znesek,
              description: opisGlk,
              sequence: seq++,
              costCenterId: v.costCenterId,
            });
            lines.push({
              entryId: temeljnicaId,
              accountId: v.kontoPopravkaId,
              side: "credit",
              amount: v.znesek,
              description: opisGlk,
              sequence: seq++,
              costCenterId: v.costCenterId,
            });
          }
          await db.insert(journalEntryLinesTable).values(lines);
        }

        // Shrani glk_temeljnica_id na OS obračun (za 3b/3c)
        if (!obstojeci) {
          await db
            .update(osAmortizacijaObracunTable)
            .set({ glkTemeljnicaId: temeljnicaId, updatedAt: new Date() })
            .where(eq(osAmortizacijaObracunTable.id, glava.id));
        }

        glkOsnutek.temeljnicaId = temeljnicaId;
        glkOsnutek.sporocilo    = glkOsnutek.posodobljen
          ? `Obstoječi GLK osnutek posodobljen (ref: ${glkRef})`
          : `Osnutek temeljnice dodan v glavno knjigo (ref: ${glkRef})`;
      }
    }

    // Shranjeni status uskladi šele ob zaključku leta, iz vrednosti PO obračunu.
    // Nabavnih/odpisanih vrednosti doknjižb ne spreminjamo (ponovni obračun je upsert).
    if (novStatus === "zakljucen") {
      const glaveById = new Map(glaveRows.map((g) => [g.id, g]));
      const odpisi = await loadObracunaniOdpisi(companyId, glaveRows.map(g => g.id));
      for (const sredstvo of obracunResult.sredstva) {
        const g = glaveById.get(sredstvo.id)!;
        const computedStatus = resolveStatusSredstvo(
          g.status,
          {
            nabavna: sredstvo.doknjizbe.reduce((sum, d) => sum + Number(d.nabavnaVrednost), 0),
            odpisana: sredstvo.doknjizbe.reduce((sum, d) => sum + Number(d.odpisanaVrednost), 0),
            hasAktivirana: sredstvo.doknjizbe.some((d) => !!d.datumAktivacije),
            obracunaniOdpisi: odpisi.get(g.id) ?? 0,
          },
          g.datumOdtujitve,
        );
        if (computedStatus !== g.status) {
          await db.update(osnovnaSredstvaTable)
            .set({ status: computedStatus, updatedAt: new Date() })
            .where(and(
              eq(osnovnaSredstvaTable.id, g.id),
              eq(osnovnaSredstvaTable.companyId, companyId),
            ));
        }
      }
    }

    res.status(201).json({
      ...predogled,
      obracunId: glava.id,
      leto,
      doMeseca,
      status: novStatus,
      glkOsnutek,
    });
  },
);

// ─── POST /os/:companyId/amortizacija/obracun/storno ──────────────────────────
//
// Razveljavi ZADNJI letni obračun amortizacije za podjetje.
// "Zadnji" = obračun z najvišjim letom (os_amortizacija_obracun).
//
// Varovalo zaporednosti: storno dovoljuje samo za zadnje (najvišje) leto.
// Poskus stornacije ne-zadnjega leta vrne 409 z navodilom vrstnega reda.
//
// GLK integracija:
//   - Obračun brez GLK osnutka (OS-only podjetje) → vedno dovoljeno.
//   - Obračun z GLK osnutkom status=draft → osnutek (vrstice + glava) se pobriše.
//   - Obračun z GLK osnutkom status=posted → 409 FIKSIRANO (Korak 3c bo urejal).
//
// Dostop: samo os_admin.

router.post(
  "/os/:companyId/amortizacija/obracun/storno",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;

    // ── Dostop: samo os_admin ─────────────────────────────────────────────────
    const role = await resolveOsModuleRole(clerkUserId, companyId, res);
    if (!role) return;
    if (role !== "os_admin" && !isSuperAdmin(clerkUserId)) {
      res.status(403).json({ error: "Stornacijo obračuna amortizacije lahko izvede samo os_admin" });
      return;
    }

    // ── Body: leto ────────────────────────────────────────────────────────────
    const { leto } = req.body as { leto?: number };
    if (!leto || !Number.isInteger(leto) || leto < 1990 || leto > 2100) {
      res.status(400).json({ error: "Neveljavno leto (pričakovano: celo število 1990–2100)" });
      return;
    }

    // ── Varovalo zaporednosti: preveri ali obstaja kak obračun z VIŠJIM letom ──
    // Stornacija je dovoljena le za ZADNJE (NAJVIŠJE) leto.
    // Pristop: eksplicitno preverimo leto > zahtevanega (ne orderBy desc — zanesljivejše).
    const [visjiObracun] = await db
      .select({ leto: osAmortizacijaObracunTable.leto })
      .from(osAmortizacijaObracunTable)
      .where(
        and(
          eq(osAmortizacijaObracunTable.companyId, companyId),
          gt(osAmortizacijaObracunTable.leto, leto),
        ),
      )
      .orderBy(desc(osAmortizacijaObracunTable.leto))
      .limit(1);

    if (visjiObracun) {
      res.status(409).json({
        error: `Stornacija ni dovoljena. Najprej stornirajte obračun za leto ${visjiObracun.leto} (zadnje leto), nato lahko stornirate leto ${leto}.`,
        code: "NOT_LAST_OBRACUN",
        zadnjeLeto: visjiObracun.leto,
        zahtevanoLeto: leto,
      });
      return;
    }

    // ── Poišči konkreten obračun za zahtevano leto ────────────────────────────
    const [obracun] = await db
      .select({
        id: osAmortizacijaObracunTable.id,
        glkTemeljnicaId: osAmortizacijaObracunTable.glkTemeljnicaId,
      })
      .from(osAmortizacijaObracunTable)
      .where(
        and(
          eq(osAmortizacijaObracunTable.companyId, companyId),
          eq(osAmortizacijaObracunTable.leto, leto),
        ),
      )
      .limit(1);

    if (!obracun) {
      res.status(404).json({ error: `Za to podjetje ni obračuna za leto ${leto}.` });
      return;
    }

    // ── GLK temeljnica: preveri status ────────────────────────────────────────
    let glkOsnutekObrisan = false;
    if (obracun.glkTemeljnicaId) {
      const [temeljnica] = await db
        .select({ status: journalEntriesTable.status })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.id, obracun.glkTemeljnicaId))
        .limit(1);

      if (temeljnica?.status === "posted") {
        res.status(409).json({
          error: `Obračun za leto ${leto} je fiksirano — GLK temeljnica je že poknjižena in je ni mogoče brisati. Za razveljavitev se obrnite na računovodjo (postopek bo podprt v koraku 3c).`,
          code: "GLK_POSTED",
          leto,
        });
        return;
      }

      // Temeljnica je draft (ali izginila med tem) → pobriši vrstice + glavo
      if (temeljnica) {
        await db
          .delete(journalEntryLinesTable)
          .where(eq(journalEntryLinesTable.entryId, obracun.glkTemeljnicaId));
        await db
          .delete(journalEntriesTable)
          .where(eq(journalEntriesTable.id, obracun.glkTemeljnicaId));
        glkOsnutekObrisan = true;
      }
    }

    // ── Pobriši vrstice obračuna, nato glavo ──────────────────────────────────
    await db
      .delete(osAmortizacijaObracunSredstvoTable)
      .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, obracun.id));
    await db
      .delete(osAmortizacijaObracunTable)
      .where(eq(osAmortizacijaObracunTable.id, obracun.id));

    // ── Varovalo: pobriši morebitne osirotele AMORT:{leto} draft temeljnice ──
    // Nastanejo, ko je /knjizenje ustvaril JE brez glk_temeljnica_id povezave
    // (historični zapisi ali edge case). Briše se SAMO draft — posted pusti nedotaknjen.
    const sirotskiJeZaBrisanje = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(
        and(
          eq(journalEntriesTable.companyId, companyId),
          eq(journalEntriesTable.status, "draft"),
          or(
            eq(journalEntriesTable.reference, `AMORT:${leto}`),
            like(journalEntriesTable.reference, `AMORT:${leto}/%`),
          ),
        ),
      );

    if (sirotskiJeZaBrisanje.length > 0) {
      const sirotskiIds = sirotskiJeZaBrisanje.map((r) => r.id);
      await db
        .delete(journalEntryLinesTable)
        .where(inArray(journalEntryLinesTable.entryId, sirotskiIds));
      await db
        .delete(journalEntriesTable)
        .where(inArray(journalEntriesTable.id, sirotskiIds));
      glkOsnutekObrisan = true;
    }

    res.status(200).json({
      ok: true,
      storniranLeto: leto,
      glkOsnutekObrisan,
      siroteBrisane: sirotskiJeZaBrisanje.length,
    });
  },
);

// ─── PUT /os/:companyId/amortizacija/obracun/oslabitev ───────────────────────
//
// Vnos / popravek oslabitve vrednosti OS na ZAKLJUČENEM letnem obračunu.
// Oslabitev zmanjša osnovo amortizacije naslednjega leta (SRS 1.35+).
//
// Body: { leto: number, sredstvoId: string, oslabitev: string }
// Dostop: samo os_admin; samo ko je status obračuna "zakljucen".

router.put(
  "/os/:companyId/amortizacija/obracun/oslabitev",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;

    const role = await resolveOsModuleRole(clerkUserId, companyId, res);
    if (!role) return;
    if (role !== "os_admin" && !isSuperAdmin(clerkUserId)) {
      res.status(403).json({ error: "Oslabitev vrednosti OS lahko vnaša samo os_admin" });
      return;
    }

    const { leto, sredstvoId, oslabitev, metodaOslabitve, novaDoba } = req.body as {
      leto?: number;
      sredstvoId?: string;
      oslabitev?: string;
      metodaOslabitve?: number;
      /** Metoda 2: nova (krajša) preostala doba v letih. */
      novaDoba?: number;
    };

    if (!leto || typeof leto !== "number" || !Number.isInteger(leto) || leto < 1990 || leto > 2100) {
      res.status(400).json({ error: "Neveljavno leto" }); return;
    }
    if (!sredstvoId || typeof sredstvoId !== "string") {
      res.status(400).json({ error: "Manjka sredstvoId" }); return;
    }
    if (oslabitev === undefined || oslabitev === null) {
      res.status(400).json({ error: "Manjka oslabitev" }); return;
    }
    const oslabitevNum = parseFloat(String(oslabitev));
    if (isNaN(oslabitevNum) || oslabitevNum < 0) {
      res.status(400).json({ error: "Oslabitev mora biti nenegativen decimalni znesek" }); return;
    }
    const oslabitevStr = oslabitevNum.toFixed(2);

    // Metoda oslabitve (1 ali 2, privzeto 1)
    const metodaNum = metodaOslabitve === 2 ? 2 : 1;

    // nova doba za M2: celo število, min 1
    const novaDobaNum = typeof novaDoba === "number" && Number.isFinite(novaDoba) && novaDoba >= 1
      ? Math.round(novaDoba) : null;

    // Preveri obračun — mora biti zakljucen
    const [obracun] = await db
      .select({ id: osAmortizacijaObracunTable.id, status: osAmortizacijaObracunTable.status, doMeseca: osAmortizacijaObracunTable.doMeseca })
      .from(osAmortizacijaObracunTable)
      .where(
        and(
          eq(osAmortizacijaObracunTable.companyId, companyId),
          eq(osAmortizacijaObracunTable.leto, leto),
        ),
      )
      .limit(1);

    if (!obracun) {
      res.status(404).json({ error: `Obračun za leto ${leto} ne obstaja. Najprej izvedi letni obračun.` }); return;
    }
    if (obracun.status !== "zakljucen" || obracun.doMeseca < 12) {
      res.status(409).json({
        error: `Oslabitev je mogoče vnesti samo na zaključen letni obračun (do meseca 12). Obračun za leto ${leto} je ${obracun.status} do meseca ${obracun.doMeseca}.`,
        code: "OBRACUN_NOT_CLOSED",
      }); return;
    }

    // Preveri vrstico obračuna za to sredstvo — mora obstajati
    const [vrstica] = await db
      .select({ sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId })
      .from(osAmortizacijaObracunSredstvoTable)
      .where(
        and(
          eq(osAmortizacijaObracunSredstvoTable.obracunId, obracun.id),
          eq(osAmortizacijaObracunSredstvoTable.sredstvoId, sredstvoId),
        ),
      )
      .limit(1);

    if (!vrstica) {
      res.status(404).json({
        error: `Sredstvo ${sredstvoId} ni del obračuna za leto ${leto}. Morda nima amortizacijske skupine ali pa ni bilo aktivno v tem letu.`,
      }); return;
    }

    // ── Preračun nova_letna_am_rac ─────────────────────────────────────────────
    // Izračunamo dejansko preostalo vrednost na koncu leta N (oslabitev leto).
    // Dejanski preostalo = skupna_osnova − začetna_odpisana − Σ(obracunano vseh let ≤ N).
    let novaLetnaAmRacStr: string | null = null;
    let novaStopnjaRac: string | null = null;
    let preostalaDobaCelota: number | null = null;
    let pretecenaLeta: number | null = null;

    if (oslabitevNum > 0) {
      // Naloži doknjizbe za to sredstvo
      const doknjizbeRows = await db
        .select({
          seq: osDoknjizbeTable.seq,
          nabavnaVrednost: osDoknjizbeTable.nabavnaVrednost,
          odpisanaVrednost: osDoknjizbeTable.odpisanaVrednost,
          neamortizljiviDelPct: osDoknjizbeTable.neamortizljiviDelPct,
          datumAktivacije: osDoknjizbeTable.datumAktivacije,
        })
        .from(osDoknjizbeTable)
        .where(eq(osDoknjizbeTable.sredstvoId, sredstvoId));

      let skupnaOsnova = new Decimal(0);
      let skupnaInitOdpisana = new Decimal(0);
      let activationYear: number | null = null;
      for (const d of doknjizbeRows) {
        const osnova = new Decimal(calcOsnova(d.nabavnaVrednost, d.neamortizljiviDelPct));
        skupnaOsnova = skupnaOsnova.plus(osnova);
        skupnaInitOdpisana = skupnaInitOdpisana.plus(d.odpisanaVrednost);
        if (d.seq === 0 && d.datumAktivacije) {
          const yr = parseInt(String(d.datumAktivacije).slice(0, 4), 10);
          if (!isNaN(yr)) activationYear = yr;
        }
      }

      // Seštevek VSEH sistemsko obračunanih zneskov za to sredstvo do leta N (vključno)
      const allObracunVrstice = await db
        .select({
          obracunano: osAmortizacijaObracunSredstvoTable.obracunano,
        })
        .from(osAmortizacijaObracunSredstvoTable)
        .innerJoin(
          osAmortizacijaObracunTable,
          eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id),
        )
        .where(
          and(
            eq(osAmortizacijaObracunSredstvoTable.sredstvoId, sredstvoId),
            eq(osAmortizacijaObracunTable.companyId, companyId),
            lte(osAmortizacijaObracunTable.leto, leto),
          ),
        );
      const totalSystemAmort = allObracunVrstice.reduce(
        (s, v) => s.plus(v.obracunano), new Decimal(0),
      );

      // Dejanski preostalo na koncu leta N (po amortizaciji, pred oslabitivjo)
      const skupnaPreostaloAtN = Decimal.max(
        0, skupnaOsnova.minus(skupnaInitOdpisana).minus(totalSystemAmort),
      );

      // Nova knjižna vrednost po oslabitvi
      const novaKnjizna = Decimal.max(0, skupnaPreostaloAtN.minus(oslabitevNum));

      if (novaKnjizna.gt(0)) {
        // Naloži računovodsko stopnjo iz amortizacijske skupine
        const skupinaRow = await db
          .select({ racunovodskaStonja: osAmortizacijskeSkupineTable.racunovodskaStonja })
          .from(osnovnaSredstvaTable)
          .innerJoin(
            osAmortizacijskeSkupineTable,
            eq(osnovnaSredstvaTable.skupinaId, osAmortizacijskeSkupineTable.id),
          )
          .where(
            and(
              eq(osnovnaSredstvaTable.id, sredstvoId),
              eq(osnovnaSredstvaTable.companyId, companyId),
            ),
          )
          .limit(1);

        const racStonja = skupinaRow[0]?.racunovodskaStonja
          ? parseFloat(skupinaRow[0].racunovodskaStonja) : 0;

        // Preostala doba
        let preostalaDoba: number;
        if (metodaNum === 2 && novaDobaNum !== null && novaDobaNum >= 1) {
          // M2: uporabnik vpiše novo (krajšo) preostalo dobo
          preostalaDoba = novaDobaNum;
        } else {
          // M1: celotna doba − pretečena leta
          const celtna = racStonja > 0 ? 100 / racStonja : 0;
          // pretečena = oslabitev_leto − aktivacija_leto + 1
          const pretecena = activationYear !== null ? leto - activationYear + 1 : 0;
          preostalaDoba = Math.max(1, Math.round(celtna - pretecena));
          pretecenaLeta = pretecena;
          preostalaDobaCelota = Math.round(celtna);
        }

        // Nova letna AM = nova knjižna / preostala doba
        const novaLetnaAmD = novaKnjizna.div(preostalaDoba)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        novaLetnaAmRacStr = novaLetnaAmD.toFixed(2);

        // Nova stopnja % = nova letna AM / skupna osnova × 100
        if (skupnaOsnova.gt(0)) {
          novaStopnjaRac = novaLetnaAmD.div(skupnaOsnova).mul(100)
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
        }

        preostalaDobaCelota = preostalaDobaCelota ?? preostalaDoba;
      }
    }

    // Posodobi oslabitev + metodo + nova letna AM
    const [updated] = await db
      .update(osAmortizacijaObracunSredstvoTable)
      .set({
        oslabitev: oslabitevStr,
        oslabitevMetoda: metodaNum,
        oslabitevNovaDobeLet: metodaNum === 2 ? novaDobaNum : null,
        oslabitevNovaLetnaAmRac: novaLetnaAmRacStr,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(osAmortizacijaObracunSredstvoTable.obracunId, obracun.id),
          eq(osAmortizacijaObracunSredstvoTable.sredstvoId, sredstvoId),
        ),
      )
      .returning();

    res.json({
      ok: true,
      leto,
      sredstvoId,
      oslabitev: updated.oslabitev,
      metodaOslabitve: updated.oslabitevMetoda ?? 1,
      novaDoba: updated.oslabitevNovaDobeLet ?? null,
      novaLetnaAmRac: updated.oslabitevNovaLetnaAmRac ?? null,
      novaStopnjaRac,
      pretecenaLeta,
      preostalaDoba: preostalaDobaCelota,
      opomba: parseFloat(updated.oslabitev) > 0
        ? `Oslabitev ${oslabitevStr} € (M${metodaNum}): nova letna AM = ${novaLetnaAmRacStr ?? "—"} €/leto.`
        : `Oslabitev za leto ${leto} odstranjana.`,
    });
  },
);

export default router;
