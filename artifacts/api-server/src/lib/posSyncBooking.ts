/**
 * POS → ERP samodejno knjiženje
 * ─────────────────────────────────────────────────────────────────────────────
 * Za vsak dan generira do 4 osnutke temeljnic + KIR vrstice:
 *
 *   1. POS:PRODAJA:YYYY-MM-DD   — dnevna prodaja (Z-poročilo)
 *      Debet:  gotovina / kartica / darilni boni / ostalo
 *      Kredit: prihodki po vrsti artikla × DDV stopnji + DDV po stopnji
 *      Izdaja darilnega bona: D prejeto plačilo / K predplačila (230), brez DDV.
 *      ⚠ Izključuje lastna_poraba in reprezentanca račune (ti gredo v T4).
 *
 *   2. POS:PREJEMNICA:YYYY-MM-DD — prejemnice blaga
 *      Debet:  zaloga materiala + zaloga blaga
 *      Kredit: obveznosti do dobaviteljev
 *
 *   3. POS:PORABA:YYYY-MM-DD    — razknjižba zalog (COGS)
 *      Debet:  stroški materiala + NVPB blaga
 *      Kredit: zmanjšanje ustrezne zaloge
 *
 *   4. POS:LASTREPR:YYYY-MM-DD  — lastna poraba + reprezentanca
 *      DDV se obračuna na face value (vrednost postavk, skupaj=0).
 *      Debet:  odhodki lastne porabe / odhodki reprezentance (bruto)
 *      Kredit: prihodki po vrsti × DDV (neto) + DDV po stopnji
 *
 *   KIR (Knjiga izdanih računov):
 *      B2C: en zbirni ERP invoice na dan (fizične osebe)
 *      B2B: posamičen ERP invoice za vsak račun z davčno številko ali negotovinskim plačilom
 *      Lastna/repr: ločen ERP invoice z DDV osnovo iz face value
 *      Pogoj: nastavljen kir_ar_account_id v pos_booking_settings
 *
 * Analitika:
 *   - vrsta_artikla: 'material' | 'blago' | 'storitev'
 *   - davek: 9.5 | 22 | 0  (DDV stopnja v %)
 *
 * Funkcija je idempotentna: obstoječe osnutke z istim ref pobriše in ustvari
 * nove. Potrjene temeljnice (status='posted') nikoli ne briše.
 * KIR invoices: briše stare pos-sync invoices za ta datum in ustvari nove.
 */

import Decimal from "decimal.js";
import { and, eq, inArray, isNull, lt, lte, gte, not, notInArray, sql, isNotNull, or, like } from "drizzle-orm";
import {
  db,
  pool,
  posBookingSettingsTable,
  posCategoryRevenueAccountsTable,
  accountingPeriodsTable,
  enoteTable,
  racuniTable,
  prejemniceTable,
  prejemnicePostavkeTable,
  postavkeTable,
  zalogaGibiTable,
  artikliTable,
  journalEntriesTable as erpEntriesTable,
  journalEntryLinesTable as erpLinesTable,
  posBookingDraftsTable,
  posBookingDraftLinesTable,
  posReceiptBookingSourcesTable,
  invoicesTable,
  invoiceLinesTable,
  counterpartiesTable,
  zacetneZalogeTable,
  zacetneZalogePostavkeTable,
  costCentersTable,
  preparedFoodDailyLedgersTable,
  partnerCenikiTable,
} from "@workspace/db";
import { createVatLedgerEntries, type EntryMeta, type VatLine } from "./vatLedger";
import { businessDateForInstant, getBusinessDayBounds } from "./pos-business-day";
import { resolvePosBookingPeriod } from "./posBookingPeriod";

import { slovenskiDatumZaSporocilo } from "./slovenian-date-message";

// ── Tipi ─────────────────────────────────────────────────────────────────────

interface SyncLine {
  accountId: string;
  side: "debit" | "credit";
  amount: Decimal;
  desc?: string;
  /** Poslovni partner za saldakontno analitiko. */
  partnerId?: string | null;
  /** Izvorna POS enota — uporablja se za varno združevanje vrstic. */
  enotaId?: number;
  /** Stroškovno mesto POS enote za analitiko GLK. */
  costCenterId?: string | null;
  /** FURS DDV koda (FK na vat_code.id) — nastavi za DDV vrstice da gredo v vat_ledger */
  vatCodeId?: string | null;
  /** Znesek DDV za to vrstico (pri DDV vrstici: znesek celotnega DDV) */
  vatAmount?: string | null;
}

interface SyncResult {
  created: string[];
  skipped: Array<{ ref: string; reason: string }>;
}

export interface ZZPostavka {
  vrstaArtikla: string | null;
  kolicina: number;
  cenaKos: number;
  drobniInventar?: boolean;
}

// Ista računovodska pravila, dve fizično ločeni shrambi. Izbor je nespremenljiv
// za celoten sync, zato so sočasne sinhronizacije različnih podjetij varne.
function createBookingEngine(
  journalEntriesTable: typeof erpEntriesTable | typeof posBookingDraftsTable,
  journalEntryLinesTable: typeof erpLinesTable | typeof posBookingDraftLinesTable,
) {
// ── Helpers ───────────────────────────────────────────────────────────────────

function dec(v: string | number | null | undefined): Decimal {
  if (v == null || v === "") return new Decimal(0);
  return new Decimal(String(v));
}

/** Knjiži neto agregat; negativni storno obrne stran in vedno uporabi absolutni znesek. */
function pushSignedLine(
  lines: SyncLine[], accountId: string, normalSide: "debit" | "credit", amount: Decimal,
  desc: string, extra: Omit<SyncLine, "accountId" | "side" | "amount" | "desc"> = {},
): void {
  if (amount.abs().lte("0.005")) return;
  lines.push({
    accountId,
    side: amount.isNegative() ? (normalSide === "debit" ? "credit" : "debit") : normalSide,
    amount: amount.abs(),
    desc,
    ...extra,
  });
}

/**
 * Ne-gotovinski račun postane terjatev samo, ko je izdan na znanega kupca.
 * Tako Sodexo in druga takojšnja plačila brez kupca ostanejo v dnevnem zbirniku.
 */
function isBusinessReceivableReceipt(receipt: {
  placilnaNacin: string;
  kupecDavcnaStevilka: string | null;
  kupecId: number | string | null;
  kupecCpId: string | null;
}): boolean {
  return receipt.placilnaNacin === "negotovinsko" && Boolean(
    receipt.kupecDavcnaStevilka?.trim() || receipt.kupecId || receipt.kupecCpId,
  );
}

function isContractMealReceipt(receipt: {
  placilnaNacin: string;
  kupecCpId: string | null;
  hasPartnerPriceList?: boolean;
}): boolean {
  return receipt.placilnaNacin === "negotovinsko"
    && Boolean(receipt.kupecCpId)
    && receipt.hasPartnerPriceList === true;
}

function addDaysToDate(date: string, days: number | null): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + Math.max(0, Number(days ?? 0)));
  return result.toISOString().slice(0, 10);
}

function isBalanced(lines: SyncLine[]): boolean {
  const debit = lines.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
  const credit = lines.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
  return debit.minus(credit).abs().lt("0.01");
}

/**
 * Sešteje vrstice z istim accountId, stranjo in analitičnimi oznakami v eno vrstico.
 * vatCodeId: ohrani kodo prve vrstice (vse DDV vrstice na istem kontu morajo
 * imeti enako kodo — če ne, bi to bila napaka v konfiguraciji).
 * vatAmount: sešteje (vsaka vrstica nosi cel znesek DDV te stopnje).
 */
function mergeLines(lines: SyncLine[]): SyncLine[] {
  const map = new Map<string, SyncLine>();
  for (const l of lines) {
    const key = `${l.accountId}|${l.side}|${l.partnerId ?? ""}|${l.costCenterId ?? ""}|${l.enotaId ?? ""}`;
    const ex = map.get(key);
    if (ex) {
      ex.amount = ex.amount.plus(l.amount);
      if (l.desc && ex.desc && !ex.desc.includes(l.desc)) {
        ex.desc = `${ex.desc}, ${l.desc}`;
      }
      // vatAmount seštejemo — vsaka stopnja prispeva k skupnemu DDV na tem kontu
      if (l.vatAmount != null) {
        const prev = new Decimal(ex.vatAmount ?? "0");
        ex.vatAmount = prev.plus(new Decimal(l.vatAmount)).toFixed(2);
      }
      // vatCodeId: obdrži kodo prve vrstice (fallback: prevzemi, če obstoječa ni nastavljena)
      if (!ex.vatCodeId && l.vatCodeId) ex.vatCodeId = l.vatCodeId;
    } else {
      map.set(key, { ...l });
    }
  }
  return [...map.values()].filter(l => l.amount.gt("0.005"));
}

async function deleteExistingDrafts(companyId: string, ref: string): Promise<void> {
  await db
    .delete(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, ref),
        eq(journalEntriesTable.status, "draft"),
      ),
    );
}

/** Ob prehodu na temeljnice po enotah odstrani le stare zbirne POS osnutke. */
async function deleteLegacyDailyDrafts(companyId: string, datum: string): Promise<void> {
  await db
    .delete(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "draft"),
        eq(journalEntriesTable.createdBy, "pos-sync"),
        inArray(journalEntriesTable.reference, [
          `POS:PRODAJA:${datum}`,
          `POS:PORABA:${datum}`,
          `POS:LASTREPR:${datum}`,
        ]),
      ),
    );
}

/** Potrjene stare zbirne temeljnice so računovodska zgodovina in blokirajo migracijo po enotah. */
async function hasPostedLegacyDailyEntry(
  companyId: string,
  datum: string,
  type: "PRODAJA" | "PREJEMNICA" | "PORABA" | "LASTREPR",
): Promise<boolean> {
  const [entry] = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "posted"),
        eq(journalEntriesTable.createdBy, "pos-sync"),
        eq(journalEntriesTable.reference, `POS:${type}:${datum}`),
      ),
    )
    .limit(1);
  return Boolean(entry);
}

/**
 * Odstrani osnutke posamezne enote ne glede na trenutno kodo SM.
 * Nova referenca uporablja stabilen ID enote; legacy reference s kodo SM
 * še vedno prepoznamo zaradi varnega prehoda in čiščenja starih osnutkov.
 */
async function deleteExistingUnitDrafts(
  companyId: string,
  datum: string,
  enotaId: number,
  type: "PRODAJA" | "PREJEMNICA" | "PORABA" | "LASTREPR",
): Promise<void> {
  const stableRef = `POS:${type}:${datum}:E${enotaId}`;
  const legacyCodeRef = `POS:${type}:${datum}:%:E${enotaId}`;

  await db
    .delete(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "draft"),
        eq(journalEntriesTable.createdBy, "pos-sync"),
        or(
          eq(journalEntriesTable.reference, stableRef),
          like(journalEntriesTable.reference, legacyCodeRef),
        ),
      ),
    );
}

/** Potrjena temeljnica je računovodska listina in je POS sync ne sme podvojiti. */
async function hasPostedUnitEntry(
  companyId: string,
  datum: string,
  enotaId: number,
  type: "PRODAJA" | "PREJEMNICA" | "PORABA" | "LASTREPR",
): Promise<boolean> {
  const stableRef = `POS:${type}:${datum}:E${enotaId}`;
  const legacyCodeRef = `POS:${type}:${datum}:%:E${enotaId}`;
  const [entry] = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "posted"),
        eq(journalEntriesTable.createdBy, "pos-sync"),
        or(
          eq(journalEntriesTable.reference, stableRef),
          like(journalEntriesTable.reference, legacyCodeRef),
        ),
      ),
    )
    .limit(1);
  return Boolean(entry);
}

type BookingModule = "PRODAJA" | "PORABA" | "LASTREPR";
type BookingFrequency = "daily" | "monthly";

function getEffectiveBookingFrequency(
  settings: {
    salesBookingFrequency?: string | null;
    consumptionBookingFrequency?: string | null;
    frequencyEffectiveFrom?: string | null;
    salesBookingFrequencyPrevious?: string | null;
    consumptionBookingFrequencyPrevious?: string | null;
  },
  module: "PRODAJA" | "PORABA",
  date: string,
): BookingFrequency {
  const fallback: BookingFrequency = module === "PRODAJA" ? "daily" : "monthly";
  const configured = module === "PRODAJA"
    ? settings.salesBookingFrequency
    : settings.consumptionBookingFrequency;
  const previous = module === "PRODAJA"
    ? settings.salesBookingFrequencyPrevious
    : settings.consumptionBookingFrequencyPrevious;
  const monthStart = `${date.slice(0, 7)}-01`;
  if (settings.frequencyEffectiveFrom && settings.frequencyEffectiveFrom > monthStart) {
    return previous === "daily" || previous === "monthly" ? previous : fallback;
  }
  return configured === "daily" || configured === "monthly" ? configured : fallback;
}

function monthBounds(month: string): { start: string; nextStart: string; end: string } {
  const [yearText, monthText] = month.split("-");
  const next = new Date(Date.UTC(Number(yearText), Number(monthText), 1));
  const end = new Date(Date.UTC(Number(yearText), Number(monthText), 0));
  return {
    start: `${month}-01`,
    nextStart: next.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function isMonthlyUnitReference(
  module: BookingModule,
  month: string,
  enotaId: number,
) {
  return or(
    eq(journalEntriesTable.reference, `POS:${module}:${month}:E${enotaId}`),
    like(journalEntriesTable.reference, `POS:${module}:${month}:%:E${enotaId}`),
  );
}

async function hasAnyDailyEntryForMonth(
  companyId: string,
  month: string,
  enotaId: number,
  module: BookingModule,
): Promise<boolean> {
  const [entry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.createdBy, "pos-sync"),
      like(journalEntriesTable.reference, `POS:${module}:${month}-%:E${enotaId}`),
    ))
    .limit(1);
  return Boolean(entry);
}

async function hasAnyMonthlyEntry(
  companyId: string,
  month: string,
  enotaId: number,
  module: BookingModule,
): Promise<boolean> {
  const [entry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.createdBy, "pos-sync"),
      isMonthlyUnitReference(module, month, enotaId),
    ))
    .limit(1);
  return Boolean(entry);
}

async function hasPostedMonthlyEntry(
  companyId: string,
  month: string,
  enotaId: number,
  module: BookingModule,
): Promise<boolean> {
  const [entry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.createdBy, "pos-sync"),
      eq(journalEntriesTable.status, "posted"),
      isMonthlyUnitReference(module, month, enotaId),
    ))
    .limit(1);
  return Boolean(entry);
}

async function deleteExistingMonthlyDraft(
  companyId: string,
  month: string,
  enotaId: number,
  module: BookingModule,
): Promise<void> {
  await db.delete(journalEntriesTable).where(and(
    eq(journalEntriesTable.companyId, companyId),
    eq(journalEntriesTable.createdBy, "pos-sync"),
    eq(journalEntriesTable.status, "draft"),
    isMonthlyUnitReference(module, month, enotaId),
  ));
}

/**
 * Izbriše mesečni PRODAJA osnutek skupaj s povezanim SŠP draft invoicem.
 *
 * VRSTNI RED JE OBVEZEN: invoices.linked_entry_id → journal_entries.id nima
 * ON DELETE CASCADE, zato je treba najprej pobrisati invoice, šele nato
 * journal entry, drugače PG zavrne brisanje z FK napako.
 *
 * Obe brisanji sta oviti v transakcijo, da ne ostane "sirotski" invoice brez
 * journal entry ali obratno, če pride do prekinitve med korakoma.
 */
async function deleteMonthlySalesDraft(
  companyId: string,
  month: string,
  enotaId: number,
): Promise<void> {
  const sspInvoiceNumber = `POS-SSP-${month}-E${enotaId}`;
  await db.transaction(async tx => {
    // 1. Pobriši SŠP draft invoice (kaskadira na invoice_lines)
    if (journalEntriesTable === erpEntriesTable) await tx.delete(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.invoiceNumber, sspInvoiceNumber),
      eq(invoicesTable.status, "draft"),
      eq(invoicesTable.createdBy, "pos-sync"),
    ));
    // 2. Zdaj je FK sproščen — pobriši journal entry osnutek
    await tx.delete(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.createdBy, "pos-sync"),
      eq(journalEntriesTable.status, "draft"),
      isMonthlyUnitReference("PRODAJA", month, enotaId),
    ));
  });
}

/**
 * Odstrani osnutek otvoritvene temeljnice ene enote ne glede na trenutno
 * kodo SM. ID enote je stabilen ključ, zato preimenovanje SM ne podvaja
 * temeljnic. Zbirni osnutek iz stare različice se odstrani samo, dokler je
 * še v osnutku; potrjenih temeljnic nikoli ne spreminjamo.
 */
async function deleteExistingOpeningStockDrafts(
  companyId: string,
  leto: number,
  enotaId: number,
): Promise<void> {
  const legacyRef = `POS:ZZ:${leto}`;
  const stableRef = `POS:ZZ:${leto}:E${enotaId}`;
  const codeRef = `POS:ZZ:${leto}:%:E${enotaId}`;

  await db
    .delete(journalEntriesTable)
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "draft"),
        eq(journalEntriesTable.createdBy, "pos-sync"),
        or(
          eq(journalEntriesTable.reference, legacyRef),
          eq(journalEntriesTable.reference, stableRef),
          like(journalEntriesTable.reference, codeRef),
        ),
      ),
    );
}

async function insertEntry(
  companyId: string,
  periodId: string | null,
  datum: string,
  description: string,
  ref: string,
  lines: SyncLine[],
  receiptSources?: Array<{ prejemnicaId: number; netAmount: Decimal }>,
): Promise<string> {
  return db.transaction(async tx => {
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        companyId,
        periodId,
        entryDate: datum,
        documentDate: datum,
        description,
        reference: ref,
        status: "draft",
        sourceType: "document",
        createdBy: "pos-sync",
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalEntryLinesTable).values(
      lines.map((l, i) => ({
        entryId: entry.id,
        accountId: l.accountId,
        side: l.side,
        amount: l.amount.toFixed(2),
        description: l.desc ?? null,
        sequence: i,
        partnerId: l.partnerId ?? null,
        costCenterId: l.costCenterId ?? null,
        vatCodeId: l.vatCodeId ?? null,
        vatAmount: l.vatAmount ?? null,
      })),
    );
    if (receiptSources && receiptSources.length > 0) {
      await tx.insert(posReceiptBookingSourcesTable).values(
        receiptSources.map((source) => ({
          prejemnicaId: source.prejemnicaId,
          journalEntryId: entry.id,
          netAmount: source.netAmount.toFixed(2),
        })),
      );
    }
    return entry.id;
  });
}

/**
 * Poišče poslovnega partnerja po davčni številki, nato po imenu.
 * Če ga ni, ga ustvari.
 */
async function ensureCounterparty(
  companyId: string,
  name: string,
  taxId: string | null | undefined,
  address?: string | null,
  vatPayer?: boolean,
): Promise<string> {
  // 1. Poišči po davčni številki
  if (taxId?.trim()) {
    const [found] = await db
      .select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(
        and(
          eq(counterpartiesTable.companyId, companyId),
          eq(counterpartiesTable.taxId, taxId.trim()),
        ),
      )
      .limit(1);
    if (found) return found.id;
  }

  // 2. Poišči po imenu
  const [foundByName] = await db
    .select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(
      and(
        eq(counterpartiesTable.companyId, companyId),
        eq(counterpartiesTable.name, name),
      ),
    )
    .limit(1);
  if (foundByName) return foundByName.id;

  // 3. Ustvari novega
  const [created] = await db
    .insert(counterpartiesTable)
    .values({
      companyId,
      type: "customer",
      name,
      taxId: taxId?.trim() ?? null,
      address: address ?? null,
      vatPayer: vatPayer ?? false,
    })
    .returning({ id: counterpartiesTable.id });

  return created.id;
}

// ── Prihodkovni konto za vrsta × DDV (deljeno med T1, T4, KIR) ───────────────

function getRevenueAccount(
  vrsta: string,
  davekPct: Decimal,
  settings: {
    revenueMaterial95AccountId?: string | null;
    revenueMaterial22AccountId?: string | null;
    revenueMaterial5AccountId?: string | null;
    revenueGoods95AccountId?: string | null;
    revenueGoods22AccountId?: string | null;
    revenueGoods5AccountId?: string | null;
    revenueService22AccountId?: string | null;
    revenueService95AccountId?: string | null;
    revenueService5AccountId?: string | null;
    revenueAccountId?: string | null;
  },
): string | null | undefined {
  const map: Record<string, string | null | undefined> = {
    "material|9.50":  settings.revenueMaterial95AccountId,
    "material|22.00": settings.revenueMaterial22AccountId,
    "material|5.00":  settings.revenueMaterial5AccountId,
    "blago|9.50":     settings.revenueGoods95AccountId,
    "blago|22.00":    settings.revenueGoods22AccountId,
    "blago|5.00":     settings.revenueGoods5AccountId,
    "storitev|22.00": settings.revenueService22AccountId,
    "storitev|9.50":  settings.revenueService95AccountId,
    "storitev|5.00":  settings.revenueService5AccountId,
    "storitev|0.00":  settings.revenueService22AccountId,
    "material|0.00":  settings.revenueMaterial95AccountId,
    "blago|0.00":     settings.revenueGoods95AccountId,
  };
  const key = `${vrsta}|${davekPct.toFixed(2)}`;
  // Pri znanih kombinacijah je manjkajoča nastavitev napaka konfiguracije,
  // ne razlog za tiho knjiženje na splošni konto.
  if (key in map) return map[key];
  return settings.revenueAccountId;
}

async function loadCategoryRevenueAccounts(companyId: string): Promise<Map<number, string>> {
  const rows = await db
    .select({
      categoryId: posCategoryRevenueAccountsTable.categoryId,
      accountId: posCategoryRevenueAccountsTable.accountId,
    })
    .from(posCategoryRevenueAccountsTable)
    .where(eq(posCategoryRevenueAccountsTable.companyId, companyId));
  return new Map(rows.map((row) => [row.categoryId, row.accountId]));
}

function getCategoryRevenueAccount(
  categoryId: number | null,
  vrsta: string,
  davekPct: Decimal,
  settings: Parameters<typeof getRevenueAccount>[2],
  categoryAccounts: Map<number, string>,
): string | null | undefined {
  if (categoryId !== null) {
    return categoryAccounts.get(categoryId)
      ?? settings.revenueAccountId
      ?? getRevenueAccount(vrsta, davekPct, settings);
  }
  return settings.revenueAccountId ?? getRevenueAccount(vrsta, davekPct, settings);
}

// ── Glavna funkcija ───────────────────────────────────────────────────────────

async function syncPosBookingForDayUnlocked(
  companyId: string,
  datum: string, // YYYY-MM-DD v Ljubljana času
): Promise<SyncResult> {
  const created: string[] = [];
  const skipped: Array<{ ref: string; reason: string }> = [];

  // 1. Nastavitve knjiženja
  const [settings] = await db
    .select()
    .from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, companyId))
    .limit(1);

  if (!settings) {
    return { created: [], skipped: [{ ref: "vse", reason: "POS nastavitve knjiženja niso konfigurirane" }] };
  }
  const categoryRevenueAccounts = await loadCategoryRevenueAccounts(companyId);
  const salesFrequency = getEffectiveBookingFrequency(settings, "PRODAJA", datum);
  const consumptionFrequency = getEffectiveBookingFrequency(settings, "PORABA", datum);

  // 2. Obdobje je obvezno samo za interno GK, ne za samostojni POS.
  const period = await resolvePosBookingPeriod(companyId, datum);

  if (!period) {
    return {
      created: [],
      skipped: [{ ref: "vse", reason: `Ni odprtega računovodskega obdobja za ${slovenskiDatumZaSporocilo(datum)}` }],
    };
  }

  // 3. POS enote tega podjetja
  const enote = await db
    .select({
      id: enoteTable.id,
      ime: enoteTable.ime,
      costCenterId: enoteTable.costCenterId,
      costCenterCode: costCentersTable.code,
    })
    .from(enoteTable)
    .leftJoin(
      costCentersTable,
      and(
        eq(costCentersTable.id, enoteTable.costCenterId),
        eq(costCentersTable.companyId, companyId),
      ),
    )
    .where(eq(enoteTable.companyId, companyId));

  const enotaIds = enote.map(e => e.id);
  if (enotaIds.length === 0) {
    return { created: [], skipped: [{ ref: "vse", reason: "Podjetje nima POS enot" }] };
  }

  // Vsaka enota ima lahko svoj začetek gostinskega dne. Meje so vključujoče
  // spodaj in izključujoče zgoraj, zato račun točno ob prehodu sodi v novi dan.
  const datumWhere = sql`
    ${racuniTable.datumCas} >= (
      ${datum}::date + COALESCE((
        SELECT e.zacetek_dneva_ura::time FROM enote e WHERE e.id = ${racuniTable.enotaId}
      ), '04:00'::time)
    ) AT TIME ZONE 'Europe/Ljubljana'
    AND ${racuniTable.datumCas} < (
      ${datum}::date + INTERVAL '1 day' + COALESCE((
        SELECT e.zacetek_dneva_ura::time FROM enote e WHERE e.id = ${racuniTable.enotaId}
      ), '04:00'::time)
    ) AT TIME ZONE 'Europe/Ljubljana'
  `;
  const statusOk = notInArray(racuniTable.status, ["storniran"]);
  // Ko je POS A-račun že knjižen, je številka POS računa njegova stabilna
  // povezava z invoiceom. Izključimo ga iz vseh ponovnih dnevnih seštevkov,
  // tudi če se na izvornem računu kasneje spremeni kupec ali način plačila.
  const retainedPostedArWhere = sql`EXISTS (
    SELECT 1
    FROM ${invoicesTable}
    WHERE ${invoicesTable.companyId} = ${companyId}
      AND ${invoicesTable.createdBy} = 'pos-sync'
      AND ${invoicesTable.invoiceNumber} = ('POS-' || ${racuniTable.stevilkaRacuna})
      AND ${invoicesTable.linkedEntryId} IS NOT NULL
      AND ${invoicesTable.status} IN ('posted', 'paid')
  )`;

  // Prejšnje različice so ustvarjale zbirne osnutke brez oznake enote. Ob prvem
  // prenosu po nadgradnji jih varno odstranimo, da se isti dnevni promet ne podvoji.
  await deleteLegacyDailyDrafts(companyId, datum);
  const hasPostedLegacyReceipt = await hasPostedLegacyDailyEntry(companyId, datum, "PREJEMNICA");
  const hasPostedLegacySales = await hasPostedLegacyDailyEntry(companyId, datum, "PRODAJA");
  const postedSalesUnitIds = new Set<number>(
    (await Promise.all(enotaIds.map(async enotaId =>
      (await hasPostedUnitEntry(companyId, datum, enotaId, "PRODAJA")) ? enotaId : null,
    ))).filter((enotaId): enotaId is number => enotaId != null),
  );
  const hasPostedSalesForUnit = (enotaId: number) =>
    hasPostedLegacySales || postedSalesUnitIds.has(enotaId);
  // A-račune knjižimo pred dnevnimi zbirniki. Šele uspešno povezana in
  // potrjena terjatev je izključena iz zbirnika, zato manjkajoče nastavitve
  // ne morejo povzročiti tihe izgube prihodkov ali DDV.
  await syncKir();

  // Dnevne temeljnice se ustvarjajo ločeno za vsako POS enoto. KIR spodaj
  // namenoma ostane podjetniško zbiren; začetne zaloge pa so interne
  // otvoritvene temeljnice in so zato ločene po enotah.
  for (const enota of enote) {
    // SM je opcijska analitika. Če je povezava neveljavna ali manjka, se
    // temeljnica vseeno ustvari z NULL, referenca pa je vedno po ID-ju enote.
    const costCenterId = enota.costCenterId && enota.costCenterCode
      ? enota.costCenterId
      : null;
    const enotaRef = `E${enota.id}`;
    const enotaOk = eq(racuniTable.enotaId, enota.id);
    const prodajaRef = `POS:PRODAJA:${datum}:${enotaRef}`;
    const prejemnicaRef = `POS:PREJEMNICA:${datum}:${enotaRef}`;
    const porabaRef = `POS:PORABA:${datum}:${enotaRef}`;
    const lastReprRef = `POS:LASTREPR:${datum}:${enotaRef}`;
    const withEnotaDimensions = (lines: SyncLine[]): SyncLine[] =>
      lines.map(line => ({
        ...line,
        enotaId: enota.id,
        costCenterId,
      }));

    // ── TEMELJNICA 1: PRODAJA ──────────────────────────────────────────────────
    await (async () => {
    const month = datum.slice(0, 7);
    if (salesFrequency !== "daily") {
      return;
    }
    if (await hasAnyMonthlyEntry(companyId, month, enota.id, "PRODAJA")) {
      skipped.push({
        ref: prodajaRef,
        reason: "Mesečna temeljnica prodaje že obstaja — dnevni sync je ne sme podvojiti",
      });
      return;
    }
    // 1a. Dnevni seštevki redne prodaje — BREZ lastna_poraba, reprezentanca
    // in samostojne izdaje darilnih bonov. Izdaja bona je predplačilo, ne promet.
    const [sales] = await db
      .select({
        gotovina:      sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekGotovina} AS numeric)), 0)`,
        kartica:       sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekKartica} AS numeric)), 0)`,
        napitnineObveznost: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} IN ('direct_employee','independent_pool') THEN CAST(${racuniTable.znesekNapitnina} AS numeric) - CASE WHEN ${racuniTable.tipPaymentMethod} = 'card' AND ${racuniTable.tipCardFeeTreatment} = 'deduct_from_tip' THEN CAST(${racuniTable.tipCardFeeAmount} AS numeric) ELSE 0 END ELSE 0 END), 0)`,
        napitninePrihodek: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} = 'employer_controlled' THEN CAST(${racuniTable.znesekNapitnina} AS numeric) ELSE 0 END), 0)`,
        napitnineDdv: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} = 'employer_controlled' THEN CAST(${racuniTable.tipVatAmount} AS numeric) ELSE 0 END), 0)`,
        napitnineKarticnaProvizija: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPaymentMethod} = 'card' AND ${racuniTable.tipCardFeeTreatment} = 'employer_expense' AND ${racuniTable.tipCardFeeKind} = 'percentage' THEN CAST(${racuniTable.tipCardFeeAmount} AS numeric) ELSE 0 END), 0)`,
        bon:           sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekBon} AS numeric)), 0)`,
        bonPica:       sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekBonPica} AS numeric)), 0)`,
        subvencija:    sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekSubvencija} AS numeric)), 0)`,
        negotovinsko:  sql<string>`COALESCE(SUM(CASE WHEN NOT (
          ${racuniTable.placilnaNacin} = 'negotovinsko'
          AND ${racuniTable.kupecCpId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ${partnerCenikiTable}
            WHERE ${partnerCenikiTable.kupecId} = ${racuniTable.kupecCpId}
              AND ${partnerCenikiTable.enotaId} = ${racuniTable.enotaId}
          )
        ) THEN CAST(${racuniTable.znesekNegotovinsko} AS numeric) ELSE 0 END), 0)`,
        pogodbeno: sql<string>`COALESCE(SUM(CASE WHEN (
          ${racuniTable.placilnaNacin} = 'negotovinsko'
          AND ${racuniTable.kupecCpId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ${partnerCenikiTable}
            WHERE ${partnerCenikiTable.kupecId} = ${racuniTable.kupecCpId}
              AND ${partnerCenikiTable.enotaId} = ${racuniTable.enotaId}
          )
        ) THEN CAST(${racuniTable.znesekNegotovinsko} AS numeric) ELSE 0 END), 0)`,
        skupaj:        sql<string>`COALESCE(SUM(CAST(${racuniTable.skupaj} AS numeric)), 0)`,
      })
      .from(racuniTable)
      .where(
        and(
          enotaOk,
          datumWhere,
          statusOk,
          not(retainedPostedArWhere),
          notInArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
          eq(racuniTable.jeDarilniBonIzdaja, false),
        ),
      );

    // Samostojna izdaja darilnega bona se vodi ločeno: denar se ob prejemu
    // ne sme pomešati z dnevno prodajo in ne sme ustvariti prihodka/DDV.
    const [giftVoucherIssues] = await db
      .select({
        gotovina: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekGotovina} AS numeric)), 0)`,
        kartica: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekKartica} AS numeric)), 0)`,
        negotovinsko: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekNegotovinsko} AS numeric)), 0)`,
        skupaj: sql<string>`COALESCE(SUM(CAST(${racuniTable.skupaj} AS numeric)), 0)`,
      })
      .from(racuniTable)
      .where(and(enotaOk, datumWhere, statusOk, not(retainedPostedArWhere), eq(racuniTable.jeDarilniBonIzdaja, true)));

    const skupaj = dec(sales.skupaj);
    const izdaniDarilniBoni = dec(giftVoucherIssues.skupaj);
    if (skupaj.abs().lte("0.005") && izdaniDarilniBoni.abs().lte("0.005")) {
        await deleteExistingUnitDrafts(companyId, datum, enota.id, "PRODAJA");
      return;
    }

    // 1b. Prihodki in DDV po vrsti artikla × DDV stopnji — BREZ lastna/repr postavk
    const prodajaVrstice = await db
      .select({
        kategorijaId: sql<number | null>`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
        vrstaArtikla: postavkeTable.vrstaArtikla,
        davek:        postavkeTable.davek,
        bruto:        sql<string>`COALESCE(SUM(CAST(${postavkeTable.skupaj} AS numeric)), 0)`,
      })
      .from(postavkeTable)
      .innerJoin(racuniTable, eq(racuniTable.id, postavkeTable.racunId))
      .leftJoin(artikliTable, eq(artikliTable.id, postavkeTable.artikelId))
      .where(
        and(
          enotaOk,
          datumWhere,
          statusOk,
          not(retainedPostedArWhere),
          notInArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
          eq(racuniTable.jeDarilniBonIzdaja, false),
        ),
      )
      .groupBy(
        sql`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
        postavkeTable.vrstaArtikla,
        postavkeTable.davek,
      );

    // ── Debet: plačilni načini ───────────────────────────────────────────────

    const lines: SyncLine[] = [];

    const gotovina     = dec(sales.gotovina);
    const kartica      = dec(sales.kartica);
    const napitnine    = dec(sales.napitnineObveznost);
    const darilniBoni  = dec(sales.bon);
    const boniZaPico   = dec(sales.bonPica);
    const subvencija   = dec(sales.subvencija);
    const negotovinsko = dec(sales.negotovinsko);
    const pogodbeno = dec(sales.pogodbeno);

    if (gotovina.abs().gt("0.005")) {
      if (!settings.cashAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Gotovina (${gotovina.toFixed(2)} €): konto blagajne ni nastavljen` });
        return;
      }
      pushSignedLine(lines, settings.cashAccountId, "debit", gotovina, "Gotovina");
    }
    if (kartica.abs().gt("0.005")) {
      if (!settings.cardAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Kartica (${kartica.toFixed(2)} €): konto POS terminala ni nastavljen` });
        return;
      }
      pushSignedLine(lines, settings.cardAccountId, "debit", kartica, "Kartica / POS terminal");
    }
    if (napitnine.abs().gt("0.005")) {
      if (!settings.tipsLiabilityAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Napitnine (${napitnine.toFixed(2)} €): konto obveznosti za napitnine ni nastavljen` });
        return;
      }
      pushSignedLine(lines, settings.tipsLiabilityAccountId, "credit", napitnine, "Napitnine za tuj račun – obveznost do osebja");
    }
    if (darilniBoni.abs().gt("0.005")) {
      if (!settings.advancePaymentsAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Darilni boni (${darilniBoni.toFixed(2)} €): konto predplačil 230 ni nastavljen` });
        return;
      }
      pushSignedLine(lines, settings.advancePaymentsAccountId, "debit", darilniBoni, "Unovčitev darilnih bonov");
    }
    // Bon za pico ostane obstoječi, samostojen tok. Nikoli ga ne združujemo z
    // darilnimi boni oziroma s kontom predplačil 230.
    if (boniZaPico.abs().gt("0.005")) {
      if (!settings.voucherAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Bon za pico (${boniZaPico.toFixed(2)} €): konto bonov ni nastavljen` });
        return;
      }
      pushSignedLine(lines, settings.voucherAccountId, "debit", boniZaPico, "Bon za pico");
    }
    if (subvencija.abs().gt("0.005")) {
      if (!settings.subsidyReceivableAccountId || !settings.subsidyCounterpartyId) {
        skipped.push({
          ref: prodajaRef,
          reason: `Študentski boni (${subvencija.toFixed(2)} €): nastavite konto terjatve 165 in partnerja MDDSZ/ŠOS`,
        });
        return;
      }
      pushSignedLine(lines, settings.subsidyReceivableAccountId, "debit", subvencija, "Študentski boni – terjatev do države", { partnerId: settings.subsidyCounterpartyId });
    }
    if (negotovinsko.abs().gt("0.005")) {
      if (!settings.otherPaymentAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Ostala negotovinska plačila (${negotovinsko.toFixed(2)} €): konto ni nastavljen` });
        return;
      }
      pushSignedLine(lines, settings.otherPaymentAccountId, "debit", negotovinsko, "Ostala negot. plačila (Sodexo, TRR…)");
    }
    if (pogodbeno.abs().gt("0.005")) {
      if (!settings.contractReceivableTransitAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Pogodbene malice (${pogodbeno.toFixed(2)} €): prehodni konto terjatev 16… ni nastavljen` });
        return;
      }
      pushSignedLine(
        lines,
        settings.contractReceivableTransitAccountId,
        "debit",
        pogodbeno,
        "Pogodbene malice — prehodna terjatev do mesečnega A-računa",
      );
    }

    // ── Izdaja darilnih bonov: D plačilo / K predplačila ──────────────────────
    if (izdaniDarilniBoni.gt("0.005")) {
      if (!settings.advancePaymentsAccountId) {
        skipped.push({ ref: prodajaRef, reason: `Izdani darilni boni (${izdaniDarilniBoni.toFixed(2)} €): konto predplačil 230 ni nastavljen` });
        return;
      }
      const izdanaGotovina = dec(giftVoucherIssues.gotovina);
      const izdanaKartica = dec(giftVoucherIssues.kartica);
      const izdanoNegotovinsko = dec(giftVoucherIssues.negotovinsko);
      if (izdanaGotovina.gt("0.005")) {
        if (!settings.cashAccountId) {
          skipped.push({ ref: prodajaRef, reason: "Izdani darilni boni: konto blagajne ni nastavljen" });
          return;
        }
        lines.push({ accountId: settings.cashAccountId, side: "debit", amount: izdanaGotovina, desc: "Prodaja darilnih bonov – gotovina" });
      }
      if (izdanaKartica.gt("0.005")) {
        if (!settings.cardAccountId) {
          skipped.push({ ref: prodajaRef, reason: "Izdani darilni boni: konto POS terminala ni nastavljen" });
          return;
        }
        lines.push({ accountId: settings.cardAccountId, side: "debit", amount: izdanaKartica, desc: "Prodaja darilnih bonov – kartica" });
      }
      if (izdanoNegotovinsko.gt("0.005")) {
        if (!settings.otherPaymentAccountId) {
          skipped.push({ ref: prodajaRef, reason: "Izdani darilni boni: konto ostalih plačil ni nastavljen" });
          return;
        }
        lines.push({ accountId: settings.otherPaymentAccountId, side: "debit", amount: izdanoNegotovinsko, desc: "Prodaja darilnih bonov – negotovinsko" });
      }
      lines.push({ accountId: settings.advancePaymentsAccountId, side: "credit", amount: izdaniDarilniBoni, desc: "Izdani darilni boni – predplačila" });
    }

    // ── Kredit: prihodki in DDV ─────────────────────────────────────────────

    const vatMap: Record<string, string | null | undefined> = {
      "5.00":  settings.vat5AccountId,
      "9.50":  settings.vat95AccountId,
      "22.00": settings.vat22AccountId,
    };

    const ddvPo: Record<string, Decimal> = {};
    let skupajBruto = new Decimal(0);

    for (const row of prodajaVrstice) {
      const bruto    = dec(row.bruto);
      const davekPct = dec(row.davek);
      if (bruto.abs().lte("0.005")) continue;

      const neto = davekPct.gt(0)
        ? bruto.times(100).div(davekPct.plus(100)).toDecimalPlaces(2)
        : bruto;
      const ddv  = bruto.minus(neto);

      skupajBruto = skupajBruto.plus(bruto);

      const vrsta  = row.vrstaArtikla ?? "storitev";
      const revAcc = getCategoryRevenueAccount(
        row.kategorijaId,
        vrsta,
        davekPct,
        settings,
        categoryRevenueAccounts,
      );

      if (!revAcc) {
        skipped.push({
          ref: prodajaRef,
          reason: `Prihodki (kategorija ${row.kategorijaId ?? "ni določena"}, ${bruto.toFixed(2)} €): konto ni nastavljen`,
        });
        return;
      }
      pushSignedLine(
        lines,
        revAcc,
        "credit",
        neto,
        `Prihodki kategorije ${row.kategorijaId ?? "brez kategorije"}`,
      );

      if (ddv.abs().gt("0.005")) {
        const davekKey = davekPct.toFixed(2);
        ddvPo[davekKey] = (ddvPo[davekKey] ?? new Decimal(0)).plus(ddv);
      }
    }
    const employerTipGross = dec(sales.napitninePrihodek);
    const employerTipVat = dec(sales.napitnineDdv);
    const tipCardFeeExpense = dec(sales.napitnineKarticnaProvizija);
    if (employerTipGross.abs().gt("0.005")) {
      const tipRevenueAccount = settings.tipsRevenueAccountId ?? settings.revenueService22AccountId ?? settings.revenueAccountId;
      if (!tipRevenueAccount) {
        skipped.push({ ref: prodajaRef, reason: "Prihodkovni konto za obdavčljive napitnine ni nastavljen" });
        return;
      }
      skupajBruto = skupajBruto.plus(employerTipGross);
      pushSignedLine(lines, tipRevenueAccount, "credit", employerTipGross.minus(employerTipVat), "Napitnine pod nadzorom delodajalca – prihodek");
      ddvPo["22.00"] = (ddvPo["22.00"] ?? new Decimal(0)).plus(employerTipVat);
    }
    if (tipCardFeeExpense.abs().gt("0.005")) {
      if (!settings.tipsCardFeeExpenseAccountId || !settings.cardAccountId) {
        skipped.push({ ref: prodajaRef, reason: "Kartična provizija napitnin: nastavite konto stroška in konto kartic" });
        return;
      }
      pushSignedLine(lines, settings.tipsCardFeeExpenseAccountId, "debit", tipCardFeeExpense, "Kartična provizija napitnin – strošek delodajalca");
      pushSignedLine(lines, settings.cardAccountId, "credit", tipCardFeeExpense, "Kartična provizija napitnin – zmanjšanje terjatve do izdajatelja");
    }

    const vatCodeMap: Record<string, string | null | undefined> = {
      "5.00":  settings.vat5VatCodeId,
      "9.50":  settings.vat95VatCodeId,
      "22.00": settings.vat22VatCodeId,
    };

    for (const [davekKey, ddvZnesek] of Object.entries(ddvPo)) {
      const tipVat = davekKey === "22.00" && settings.tipsVatAccountId ? employerTipVat : new Decimal(0);
      const regularVat = ddvZnesek.minus(tipVat);
      if (regularVat.abs().lte("0.005")) continue;
      const vatAcc = vatMap[davekKey] ?? settings.vatLiabilityAccountId;
      if (!vatAcc) {
        skipped.push({
          ref: prodajaRef,
          reason: `DDV ${davekKey}% (${regularVat.toFixed(2)} €): konto DDV obveznosti ni nastavljen`,
        });
        return;
      }
      const vatCodeId = vatCodeMap[davekKey] ?? null;
      if (vatCodeId == null) {
        // Vidno opozorilo — NE blokiramo knjiženja (temeljnica nastane brez DDV oznake za to stopnjo)
        console.warn(
          `[POS sync] DDV koda za stopnjo ${davekKey}% ni nastavljena v pos_booking_settings ` +
          `(podjetje ${companyId}, datum ${datum}). ` +
          `Promet DDV ${regularVat.toFixed(2)} € te stopnje NE bo vpisan v KIR evidenco.`
        );
      }
      pushSignedLine(lines, vatAcc, "credit", regularVat, `Izhodni DDV ${davekKey.replace(".00", "")}%`, { vatCodeId, vatAmount: regularVat.abs().toFixed(2) });
    }
    if (employerTipVat.abs().gt("0.005") && settings.tipsVatAccountId) {
      pushSignedLine(lines, settings.tipsVatAccountId, "credit", employerTipVat, "DDV napitnin pod nadzorom delodajalca", {
        vatCodeId: settings.vat22VatCodeId ?? null,
        vatAmount: employerTipVat.abs().toFixed(2),
      });
    }

    // Fallback: brez postavk
    if (skupaj.abs().gt("0.005") && (prodajaVrstice.length === 0 || skupajBruto.abs().lte("0.005"))) {
      const fallbackAcc = settings.revenueAccountId;
      if (!fallbackAcc) {
        skipped.push({ ref: prodajaRef, reason: "Ni postavk in splošni konto prihodkov ni nastavljen" });
        return;
      }
      pushSignedLine(lines, fallbackAcc, "credit", skupaj, "Prihodki od prodaje (neto, fallback)");
    }

    const merged = mergeLines(withEnotaDimensions(lines));
    if (merged.length === 0) return;

    if (!isBalanced(merged)) {
      const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      skipped.push({ ref: prodajaRef, reason: `Temeljnica ni uravnotežena: debet ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)}` });
      return;
    }

    // SŠP odprta postavka je dokumentarno vezana na isto dnevno temeljnico.
    // Pred ponovno izdelavo osnutka odstranimo le star neknjižen dokument;
    // potrjene oziroma plačane zgodovine nikoli ne spreminjamo.
    const sspInvoiceNumber = `POS-SSP-${datum}-E${enota.id}`;
    if (period.id && subvencija.gt("0.005")) {
      await db.delete(invoicesTable).where(and(
        eq(invoicesTable.companyId, companyId),
        eq(invoicesTable.invoiceNumber, sspInvoiceNumber),
        eq(invoicesTable.status, "draft"),
        eq(invoicesTable.createdBy, "pos-sync"),
      ));
    }
    await deleteExistingUnitDrafts(companyId, datum, enota.id, "PRODAJA");
    const salesEntryId = await insertEntry(companyId, period.id, datum, `Dnevna prodaja POS — ${datum}`, prodajaRef, merged);
    if (period.id && subvencija.gt("0.005") && settings.subsidyReceivableAccountId && settings.subsidyCounterpartyId) {
      const [existingSspInvoice] = await db.select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(and(
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.invoiceNumber, sspInvoiceNumber),
        ))
        .limit(1);
      if (!existingSspInvoice) {
        await db.transaction(async (tx) => {
          const [invoice] = await tx.insert(invoicesTable).values({
            companyId,
            type: "issued",
            counterpartyId: settings.subsidyCounterpartyId!,
            periodId: period.id,
            invoiceNumber: sspInvoiceNumber,
            invoiceDate: datum,
            dueDate: null,
            status: "draft",
            arApAccountId: settings.subsidyReceivableAccountId!,
            linkedEntryId: salesEntryId,
            notes: `SŠP subvencije POS enote ${enota.ime} za ${datum}; znesek iz dnevne temeljnice.`,
            createdBy: "pos-sync",
          }).returning({ id: invoicesTable.id });
          // Gre za poravnalni dokument terjatve. Prihodki in DDV so že na
          // povezani dnevni temeljnici, zato ta vrstica nima dodatnega DDV.
          await tx.insert(invoiceLinesTable).values({
            invoiceId: invoice.id,
            description: `SŠP subvencije POS — ${datum}`,
            quantity: "1",
            unitPrice: subvencija.toFixed(4),
            vatRate: "0.00",
            vatBase: subvencija.toFixed(2),
            vatAmount: "0.00",
            accountId: settings.subsidyReceivableAccountId!,
            sequence: 0,
          });
        });
      }
    }
    created.push(prodajaRef);
    })();

    // ── TEMELJNICA 2: PREJEMNICE ───────────────────────────────────────────────
    // Prejemnice se odslej knjižijo izključno posamično prek POS:NABAVA:<id>.
    // Stare potrjene zbirne knjižbe ostanejo nedotaknjene.
    if (hasPostedLegacyReceipt) {
      skipped.push({
        ref: prejemnicaRef,
        reason: "Potrjena zbirna temeljnica prejemnic je ohranjena; novi osnutki se ustvarjajo po posamezni prejemnici",
      });
    }

    // ── TEMELJNICA 3: PORABA BLAGA (COGS) ──────────────────────────────────────
    await (async () => {
    const month = datum.slice(0, 7);
    if (consumptionFrequency !== "daily") {
      return;
    }
    if (await hasAnyMonthlyEntry(companyId, month, enota.id, "PORABA")) {
      skipped.push({
        ref: porabaRef,
        reason: "Mesečna temeljnica porabe že obstaja — dnevni sync je ne sme podvojiti",
      });
      return;
    }
    const porabaBounds = await getBusinessDayBounds(enota.id, datum);
    const porabaRows = await db
      .select({
        vrstaArtikla: artikliTable.vrstaArtikla,
        porabljeno: sql<string>`COALESCE(SUM(ABS(CAST(${zalogaGibiTable.vrednost} AS numeric))), 0)`,
      })
      .from(zalogaGibiTable)
      .innerJoin(artikliTable, eq(artikliTable.id, zalogaGibiTable.artikelId))
      .where(
        and(
          eq(artikliTable.enotaId, enota.id),
          eq(zalogaGibiTable.tip, "poraba"),
          gte(zalogaGibiTable.ustvarjeno, porabaBounds.start),
          lt(zalogaGibiTable.ustvarjeno, porabaBounds.end),
        ),
      )
      .groupBy(artikliTable.vrstaArtikla);

    const skupajPorabljeno = porabaRows.reduce((s, r) => s.plus(dec(r.porabljeno)), new Decimal(0));
    const [dailyWaste] = await db.select({
      value: sql<string>`COALESCE(SUM(CAST(${preparedFoodDailyLedgersTable.wasteValue} AS numeric)), 0)`,
    }).from(preparedFoodDailyLedgersTable).where(and(
      eq(preparedFoodDailyLedgersTable.enotaId, enota.id),
      eq(preparedFoodDailyLedgersTable.businessDate, datum),
      isNotNull(preparedFoodDailyLedgersTable.closedAt),
    ));
    const dailyWasteValue = dec(dailyWaste?.value ?? "0");
    if (skupajPorabljeno.lte(0) && dailyWasteValue.lte("0.005")) {
      await deleteExistingUnitDrafts(companyId, datum, enota.id, "PORABA");
      return;
    }

    const lines: SyncLine[] = [];

    for (const row of porabaRows) {
      const znesek = dec(row.porabljeno);
      if (znesek.lte("0.005")) continue;
      const vrsta = row.vrstaArtikla ?? "material";

      let cogsAcc: string | null | undefined;
      let invAcc:  string | null | undefined;

      if (vrsta === "material") {
        cogsAcc = settings.cogsMaterialAccountId ?? settings.cogsAccountId;
        invAcc  = settings.inventoryMaterialAccountId ?? settings.inventoryAccountId;
      } else if (vrsta === "blago") {
        cogsAcc = settings.cogsGoodsAccountId ?? settings.cogsAccountId;
        invAcc  = settings.inventoryGoodsAccountId ?? settings.inventoryAccountId;
      } else {
        cogsAcc = settings.cogsAccountId;
        invAcc  = settings.inventoryAccountId;
      }

      if (!cogsAcc || !invAcc) {
        skipped.push({
          ref: porabaRef,
          reason: `Konto COGS ali zalog za vrsto '${vrsta}' (${znesek.toFixed(2)} €) ni nastavljen`,
        });
        return;
      }

      lines.push({ accountId: cogsAcc, side: "debit",  amount: znesek, desc: `Stroški ${vrsta === "blago" ? "prodanega blaga" : "materiala"}` });
      lines.push({ accountId: invAcc,  side: "credit", amount: znesek, desc: `Zmanjšanje zalog ${vrsta}` });
    }

    // Kala is not a second inventory movement: preparation already expensed
    // materials. Reclassify the closed daily waste from material COGS to its
    // configured waste expense account. Opposite-side lines are intentional:
    // mergeLines normalizes a net negative material expense correctly.
    const wasteValue = dailyWasteValue;
    if (wasteValue.gt("0.005")) {
      const materialCogs = settings.cogsMaterialAccountId ?? settings.cogsAccountId;
      if (!settings.wasteAccountId || !materialCogs) {
        skipped.push({ ref: porabaRef, reason: "Konto kala ali stroškov materiala ni nastavljen" });
        return;
      }
      lines.push({ accountId: settings.wasteAccountId, side: "debit", amount: wasteValue, desc: "Kala pripravljene hrane" });
      lines.push({ accountId: materialCogs, side: "credit", amount: wasteValue, desc: "Prenos kala iz stroškov materiala" });
    }

    const merged = mergeLines(withEnotaDimensions(lines));
    if (merged.length === 0) return;

    if (!isBalanced(merged)) {
      const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      skipped.push({ ref: porabaRef, reason: `COGS temeljnica ni uravnotežena: debet ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)}` });
      return;
    }

    await deleteExistingUnitDrafts(companyId, datum, enota.id, "PORABA");
    await insertEntry(companyId, period.id, datum, `POS poraba blaga/materiala — ${datum}`, porabaRef, merged);
    created.push(porabaRef);
    })();

    // ── TEMELJNICA 4: LASTNA PORABA + REPREZENTANCA ────────────────────────────
    await (async () => {
    const month = datum.slice(0, 7);
    if (salesFrequency !== "daily") {
      return;
    }
    if (await hasAnyMonthlyEntry(companyId, month, enota.id, "LASTREPR")) {
      skipped.push({
        ref: lastReprRef,
        reason: "Mesečna T4 temeljnica že obstaja — dnevni sync je ne sme podvojiti",
      });
      return;
    }
    // Face value: vsota postavk za lastna_poraba in reprezentanca račune
    const lastreprVrstice = await db
      .select({
        placilnaNacin: racuniTable.placilnaNacin,
        kategorijaId: sql<number | null>`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
        vrstaArtikla:  postavkeTable.vrstaArtikla,
        davek:         postavkeTable.davek,
        faceValue:     sql<string>`COALESCE(SUM(CAST(${postavkeTable.skupaj} AS numeric)), 0)`,
      })
      .from(postavkeTable)
      .innerJoin(racuniTable, eq(racuniTable.id, postavkeTable.racunId))
      .leftJoin(artikliTable, eq(artikliTable.id, postavkeTable.artikelId))
      .where(
        and(
          enotaOk,
          datumWhere,
          statusOk,
          not(retainedPostedArWhere),
          inArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
          isNull(postavkeTable.parentPostavkaId),
        ),
      )
      .groupBy(
        racuniTable.placilnaNacin,
        sql`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
        postavkeTable.vrstaArtikla,
        postavkeTable.davek,
      );

    // Seštej face value po tipu (za debet) in po vrsta×davek (za kredit)
    const totalLastna    = lastreprVrstice.filter(r => r.placilnaNacin === "lastna_poraba")
                            .reduce((s, r) => s.plus(dec(r.faceValue)), new Decimal(0));
    const totalRepr      = lastreprVrstice.filter(r => r.placilnaNacin === "reprezentanca")
                            .reduce((s, r) => s.plus(dec(r.faceValue)), new Decimal(0));
    const skupajFace     = totalLastna.plus(totalRepr);

    if (skupajFace.lte("0.005")) {
      await deleteExistingUnitDrafts(companyId, datum, enota.id, "LASTREPR");
      return;
    }

    const lines: SyncLine[] = [];

    // Debet: odhodki po tipu
    if (totalLastna.gt("0.005")) {
      const acc = settings.lastnaPorabaAccountId;
      if (!acc) {
        skipped.push({ ref: lastReprRef, reason: `Lastna poraba (${totalLastna.toFixed(2)} €): konto odhodkov ni nastavljen` });
        return;
      }
      lines.push({ accountId: acc, side: "debit", amount: totalLastna, desc: "Odhodki — lastna poraba (face value)" });
    }
    if (totalRepr.gt("0.005")) {
      const acc = settings.reprezentancaAccountId;
      if (!acc) {
        skipped.push({ ref: lastReprRef, reason: `Reprezentanca (${totalRepr.toFixed(2)} €): konto odhodkov ni nastavljen` });
        return;
      }
      lines.push({ accountId: acc, side: "debit", amount: totalRepr, desc: "Odhodki — reprezentanca (face value)" });
    }

    // Kredit: prihodki (neto) + DDV po vrsta × davek
    const vatMap: Record<string, string | null | undefined> = {
      "5.00":  settings.vat5AccountId,
      "9.50":  settings.vat95AccountId,
      "22.00": settings.vat22AccountId,
    };
    const ddvPo: Record<string, Decimal> = {};

    for (const row of lastreprVrstice) {
      const bruto    = dec(row.faceValue);
      const davekPct = dec(row.davek);
      if (bruto.lte("0.005")) continue;

      const neto = davekPct.gt(0)
        ? bruto.times(100).div(davekPct.plus(100)).toDecimalPlaces(2)
        : bruto;
      const ddv  = bruto.minus(neto);

      const vrsta  = row.vrstaArtikla ?? "storitev";
      const revAcc = getCategoryRevenueAccount(
        row.kategorijaId,
        vrsta,
        davekPct,
        settings,
        categoryRevenueAccounts,
      );

      if (!revAcc) {
        skipped.push({
          ref: lastReprRef,
          reason: `Prihodki T4 (${vrsta} ${davekPct.toFixed(1)}%, ${bruto.toFixed(2)} €): konto ni nastavljen`,
        });
        return;
      }
      lines.push({
        accountId: revAcc,
        side: "credit",
        amount: neto,
        desc: `Prihodki kategorije ${row.kategorijaId ?? "brez kategorije"} (lastna/repr)`,
      });

      if (ddv.gt("0.005")) {
        const davekKey = davekPct.toFixed(2);
        ddvPo[davekKey] = (ddvPo[davekKey] ?? new Decimal(0)).plus(ddv);
      }
    }

    const vatCodeMapT4: Record<string, string | null | undefined> = {
      "5.00":  settings.vat5VatCodeId,
      "9.50":  settings.vat95VatCodeId,
      "22.00": settings.vat22VatCodeId,
    };

    for (const [davekKey, ddvZnesek] of Object.entries(ddvPo)) {
      const vatAcc = vatMap[davekKey] ?? settings.vatLiabilityAccountId;
      if (!vatAcc) {
        skipped.push({
          ref: lastReprRef,
          reason: `DDV T4 ${davekKey}% (${ddvZnesek.toFixed(2)} €): konto DDV ni nastavljen`,
        });
        return;
      }
      const vatCodeId = vatCodeMapT4[davekKey] ?? null;
      if (vatCodeId == null) {
        console.warn(
          `[POS sync T4] DDV koda za stopnjo ${davekKey}% ni nastavljena v pos_booking_settings ` +
          `(podjetje ${companyId}, datum ${datum}). ` +
          `DDV ${ddvZnesek.toFixed(2)} € te stopnje NE bo vpisan v KIR evidenco.`
        );
      }
      lines.push({
        accountId: vatAcc,
        side: "credit",
        amount: ddvZnesek,
        desc: `Izhodni DDV ${davekKey.replace(".00", "")}% (lastna/repr)`,
        vatCodeId,
        vatAmount: ddvZnesek.toFixed(2),
      });
    }

    const merged = mergeLines(withEnotaDimensions(lines));
    if (merged.length === 0) return;

    if (!isBalanced(merged)) {
      const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
      skipped.push({ ref: lastReprRef, reason: `T4 temeljnica ni uravnotežena: debet ${d.toFixed(2)} ≠ kredit ${c.toFixed(2)}` });
      return;
    }

    await deleteExistingUnitDrafts(companyId, datum, enota.id, "LASTREPR");
    await insertEntry(companyId, period.id, datum, `POS lastna poraba / reprezentanca — ${datum}`, lastReprRef, merged);
    created.push(lastReprRef);
    })();
  }

  // ── KIR: Knjiga izdanih računov ──────────────────────────────────────────────
  async function syncKir(): Promise<void> {
    // Samostojni POS pripravi temeljnice, ne knjiži interne GK/KIR.
    if (!period?.id) return;
    const kirPeriodId = period.id;
    if (!settings.kirArAccountId) {
      skipped.push({ ref: `POS:KIR:${datum}`, reason: "KIR AR konto (terjatve do kupcev) ni nastavljen — KIR preskočen" });
      return;
    }
    const arAcc = settings.kirArAccountId;

    // Vsi veljavni računi tega dne, brez izdaj darilnih bonov. Izdaja je
    // predplačilo brez prihodka in DDV, zato ne sodi niti v KIR.
    const vsiRacuni = await db
      .select({
        id:                  racuniTable.id,
        stevilkaRacuna:      racuniTable.stevilkaRacuna,
        placilnaNacin:       racuniTable.placilnaNacin,
        skupaj:              racuniTable.skupaj,
        kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
        kupecNaziv:          racuniTable.kupecNaziv,
        kupecNaslov:         racuniTable.kupecNaslov,
        kupecZavezanecDdv:   racuniTable.kupecZavezanecDdv,
        kupecId:             racuniTable.kupecId,
        kupecCpId:           racuniTable.kupecCpId,
        hasPartnerPriceList: sql<boolean>`EXISTS (
          SELECT 1 FROM ${partnerCenikiTable}
          WHERE ${partnerCenikiTable.kupecId} = ${racuniTable.kupecCpId}
            AND ${partnerCenikiTable.enotaId} = ${racuniTable.enotaId}
        )`,
        dniOdloga:           racuniTable.dniOdloga,
        enotaId:             racuniTable.enotaId,
      })
      .from(racuniTable)
      .where(and(
        inArray(racuniTable.enotaId, enotaIds),
        datumWhere,
        statusOk,
        not(retainedPostedArWhere),
        eq(racuniTable.jeDarilniBonIzdaja, false),
      ));

    if (vsiRacuni.length === 0) return;

    // Razdeli na kategorije
    const b2cRacuni    = vsiRacuni.filter(r =>
      r.placilnaNacin !== "lastna_poraba" &&
      r.placilnaNacin !== "reprezentanca" &&
      !r.kupecDavcnaStevilka?.trim() &&
      !isBusinessReceivableReceipt(r),
    );
    const b2bRacuni    = vsiRacuni.filter(r =>
      r.placilnaNacin !== "lastna_poraba" &&
      r.placilnaNacin !== "reprezentanca" &&
      (!!r.kupecDavcnaStevilka?.trim() || isBusinessReceivableReceipt(r)),
    );
    const lastReprRacuni = vsiRacuni.filter(r =>
      r.placilnaNacin === "lastna_poraba" || r.placilnaNacin === "reprezentanca",
    );

    // Dnevni KIR izpeljani vnosi se lahko osvežijo. Vse POS invoicee, ki so
    // že povezani s potrjeno temeljnico, ohranimo ne glede na trenutno stanje
    // izvornega računa; sicer bi poznejša sprememba kupca ali stornacija lahko
    // izbrisala odprto oziroma že plačano terjatev.
    const historicalSalesInvoiceNumbers = b2bRacuni
      .filter(receipt =>
        isBusinessReceivableReceipt(receipt) && hasPostedSalesForUnit(receipt.enotaId),
      )
      .map(receipt => `POS-${receipt.stevilkaRacuna}`);
    const deleteKirWhere = and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.invoiceDate, datum),
      eq(invoicesTable.createdBy, "pos-sync"),
      eq(invoicesTable.type, "issued"),
      not(and(
        isNotNull(invoicesTable.linkedEntryId),
        inArray(invoicesTable.status, ["posted", "paid"]),
      )!),
      ...(historicalSalesInvoiceNumbers.length > 0
        ? [notInArray(invoicesTable.invoiceNumber, historicalSalesInvoiceNumbers)]
        : []),
    );
    await db
      .delete(invoicesTable)
      .where(deleteKirWhere);

    const allRacunIds = vsiRacuni.map(r => r.id);

    // Vsi postavke za ta datum (za KIR vrstice)
    const vsePostavke = allRacunIds.length > 0
      ? await db
          .select({
            racunId:      postavkeTable.racunId,
            kategorijaId: sql<number | null>`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
            vrstaArtikla: postavkeTable.vrstaArtikla,
            davek:        postavkeTable.davek,
            skupaj:       sql<string>`CAST(${postavkeTable.skupaj} AS numeric)`,
          })
          .from(postavkeTable)
          .leftJoin(artikliTable, eq(artikliTable.id, postavkeTable.artikelId))
          .where(
            and(
              inArray(postavkeTable.racunId, allRacunIds),
              isNull(postavkeTable.parentPostavkaId),
            ),
          )
      : [];

    // Helper: zgradi invoice lines iz seznam postavk za dano skupino računov
    function buildInvoiceLines(
      racunIdsFilter: number[],
    ): Array<{ kategorijaId: number | null; vrstaArtikla: string; davekPct: Decimal; bruto: Decimal }> {
      const filterSet = new Set(racunIdsFilter);
      const agg = new Map<string, Decimal>();
      for (const p of vsePostavke) {
        if (!filterSet.has(p.racunId ?? 0)) continue;
        const vrsta = p.vrstaArtikla ?? "storitev";
        const davek = dec(p.davek).toFixed(2);
        const key   = `${p.kategorijaId ?? ""}|${vrsta}|${davek}`;
        agg.set(key, (agg.get(key) ?? new Decimal(0)).plus(dec(p.skupaj)));
      }
      return [...agg.entries()].map(([key, bruto]) => {
        const [kategorijaStr, vrstaArtikla, davekStr] = key.split("|");
        return {
          kategorijaId: kategorijaStr === "" ? null : Number(kategorijaStr),
          vrstaArtikla,
          davekPct: new Decimal(davekStr),
          bruto,
        };
      });
    }

    // Helper: vstavi invoice + invoice_lines. Za A-račun v isti transakciji
    // ustvari tudi potrjeno temeljnico D 120 / K prihodki + DDV.
    async function insertKirInvoice(params: {
      invoiceNumber: string;
      invoiceDate:   string;
      counterpartyId: string;
      lines: Array<{ kategorijaId: number | null; vrstaArtikla: string; davekPct: Decimal; bruto: Decimal }>;
      notes?: string;
      dueDate?: string | null;
      status?: "paid" | "posted";
      receivable?: { reference: string; costCenterId: string | null };
    }): Promise<boolean> {
      if (params.lines.length === 0) return false;
      const totalBruto = params.lines.reduce((s, l) => s.plus(l.bruto), new Decimal(0));
      if (totalBruto.lte("0.005")) return false;

      const preparedLines: Array<{
        kategorijaId: number | null;
        vrstaArtikla: string;
        davekPct: Decimal;
        bruto: Decimal;
        neto: Decimal;
        ddv: Decimal;
        revenueAccountId: string;
      }> = [];
      for (const l of params.lines) {
        const revAcc = getCategoryRevenueAccount(
          l.kategorijaId,
          l.vrstaArtikla,
          l.davekPct,
          settings,
          categoryRevenueAccounts,
        );
        if (!revAcc) {
          skipped.push({
            ref: params.receivable?.reference ?? `POS:KIR:${params.invoiceDate}`,
            reason: `Prihodki (kategorija ${l.kategorijaId ?? "ni določena"}): konto ni nastavljen`,
          });
          return false;
        }
        const neto = l.davekPct.gt(0)
          ? l.bruto.times(100).div(l.davekPct.plus(100)).toDecimalPlaces(2)
          : l.bruto;
        preparedLines.push({
          ...l,
          neto,
          ddv: l.bruto.minus(neto),
          revenueAccountId: revAcc,
        });
      }

      const vatMap: Record<string, string | null | undefined> = {
        "5.00": settings.vat5AccountId,
        "9.50": settings.vat95AccountId,
        "22.00": settings.vat22AccountId,
      };
      const vatCodeMap: Record<string, string | null | undefined> = {
        "5.00": settings.vat5VatCodeId,
        "9.50": settings.vat95VatCodeId,
        "22.00": settings.vat22VatCodeId,
      };
      const vatTotals = new Map<string, Decimal>();
      for (const line of preparedLines) {
        if (line.ddv.gt("0.005")) {
          const key = line.davekPct.toFixed(2);
          vatTotals.set(key, (vatTotals.get(key) ?? new Decimal(0)).plus(line.ddv));
        }
      }

      const vatJournalLines: SyncLine[] = [];
      for (const [rate, amount] of vatTotals) {
        const vatAccountId = vatMap[rate] ?? settings.vatLiabilityAccountId;
        if (!vatAccountId) {
          skipped.push({
            ref: params.receivable?.reference ?? `POS:KIR:${params.invoiceDate}`,
            reason: `DDV ${rate}% (${amount.toFixed(2)} €): konto DDV obveznosti ni nastavljen`,
          });
          return false;
        }
        vatJournalLines.push({
          accountId: vatAccountId,
          side: "credit",
          amount,
          desc: `Izhodni DDV ${rate.replace(".00", "")}%`,
          costCenterId: params.receivable?.costCenterId ?? null,
          vatCodeId: vatCodeMap[rate] ?? null,
          vatAmount: amount.toFixed(2),
        });
      }

      return db.transaction(async (tx) => {
        // Serijaliziraj dva sočasna POS synca istega računa, tudi če DB nima
        // posebne unique omejitve na invoice_number.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${params.invoiceNumber}`}))`);
        const [existing] = await tx
          .select({ id: invoicesTable.id })
          .from(invoicesTable)
          .where(and(
            eq(invoicesTable.companyId, companyId),
            eq(invoicesTable.invoiceNumber, params.invoiceNumber),
            eq(invoicesTable.createdBy, "pos-sync"),
          ))
          .limit(1);
        if (existing) return false;

        const [inv] = await tx
          .insert(invoicesTable)
          .values({
            companyId,
            type: "issued",
            sourceType: "pos-sync",
            counterpartyId: params.counterpartyId,
            periodId: kirPeriodId,
            invoiceNumber: params.invoiceNumber,
            invoiceDate: params.invoiceDate,
            dueDate: params.dueDate ?? null,
            status: params.status ?? "paid",
            arApAccountId: arAcc,
            notes: params.notes ?? null,
            createdBy: "pos-sync",
          })
          .returning({ id: invoicesTable.id });

        await tx.insert(invoiceLinesTable).values(
          preparedLines.map((l, sequence) => ({
            invoiceId: inv.id,
            description: `POS kategorija ${l.kategorijaId ?? "brez kategorije"} · ${l.davekPct.eq(0) ? "0 %" : l.davekPct.toFixed(1) + " %"}`,
            quantity: "1.000",
            unitPrice: l.neto.toFixed(4),
            vatRate: l.davekPct.toFixed(2),
            accountId: l.revenueAccountId,
            sequence,
            vatBase: l.neto.toFixed(2),
            vatAmount: l.ddv.toFixed(2),
          })),
        );

        if (!params.receivable) return true;

        const journalLines = mergeLines([
          {
            accountId: arAcc,
            side: "debit",
            amount: totalBruto,
            desc: `Terjatev do kupca — ${params.invoiceNumber}`,
            partnerId: params.counterpartyId,
          },
          ...preparedLines.map((l): SyncLine => ({
            accountId: l.revenueAccountId,
            side: "credit",
            amount: l.neto,
            desc: `Prihodki kategorije ${l.kategorijaId ?? "brez kategorije"}`,
            costCenterId: params.receivable!.costCenterId,
          })),
          ...vatJournalLines,
        ]);
        if (!isBalanced(journalLines)) {
          throw new Error(`POS A-račun ${params.invoiceNumber} nima uravnotežene temeljnice`);
        }

        const [entry] = await tx
          .insert(journalEntriesTable)
          .values({
            companyId,
            periodId: period.id,
            entryDate: params.invoiceDate,
            documentDate: params.invoiceDate,
            taxDate: params.invoiceDate,
            receiptDate: params.invoiceDate,
            description: `POS A-račun ${params.invoiceNumber}`,
            reference: params.receivable.reference,
            status: "posted",
            postedAt: new Date(),
            sourceType: "document",
            createdBy: "pos-sync",
          })
          .returning({ id: journalEntriesTable.id });
        await tx.insert(journalEntryLinesTable).values(
          journalLines.map((l, sequence) => ({
            entryId: entry.id,
            accountId: l.accountId,
            side: l.side,
            amount: l.amount.toFixed(2),
            description: l.desc ?? null,
            sequence,
            partnerId: l.partnerId ?? null,
            costCenterId: l.costCenterId ?? null,
            vatCodeId: l.vatCodeId ?? null,
            vatAmount: l.vatAmount ?? null,
          })),
        );

        // KIR osnova je neto promet, ne znesek kreditne DDV vrstice. Vrstice
        // gradimo iz pripravljenih prihodkovnih vrstic in DDV seštevkov, ker
        // imajo DDV temeljnicne vrstice za `amount` namenoma samo DDV znesek.
        const vatLedgerLines: VatLine[] = [...vatTotals.entries()]
          .flatMap(([rate, vatAmount], index) => {
            const vatCodeId = vatCodeMap[rate] ?? null;
            if (!vatCodeId) return [];
            const netBase = preparedLines
              .filter(line => line.davekPct.toFixed(2) === rate)
              .reduce((sum, line) => sum.plus(line.neto), new Decimal(0));
            return [{
              lineId: `pos-ar-${inv.id}-vat-${index}`,
              vatCodeId,
              amount: netBase.toFixed(2),
              vatAmount: vatAmount.toFixed(2),
              vatDeductionPercent: "100.00",
              partnerId: params.counterpartyId,
              description: `Izhodni DDV ${rate.replace(".00", "")}%`,
            }];
          });
        if (vatLedgerLines.length > 0) {
          const entryMeta: EntryMeta = {
            id: entry.id,
            companyId,
            documentDate: params.invoiceDate,
            entryDate: params.invoiceDate,
            taxDate: params.invoiceDate,
            receiptDate: params.invoiceDate,
            reference: params.invoiceNumber,
            sourceType: "document",
          };
          await createVatLedgerEntries(tx, entryMeta, vatLedgerLines, "pos-sync", inv.id);
        }
        await tx.update(invoicesTable)
          .set({ linkedEntryId: entry.id })
          .where(eq(invoicesTable.id, inv.id));
        return true;
      });
    }

    let kirCount = 0;

    // ── B2C: zbirni invoice ──────────────────────────────────────────────────
    if (b2cRacuni.length > 0) {
      const b2cCounterpartyId = await ensureCounterparty(
        companyId,
        "Fizične osebe (dnevni promet POS)",
        null,
      );
      const b2cLines = buildInvoiceLines(b2cRacuni.map(r => r.id));
      await insertKirInvoice({
        invoiceNumber:  `POS-B2C-${datum}`,
        invoiceDate:    datum,
        counterpartyId: b2cCounterpartyId,
        lines:          b2cLines,
        notes:          `POS dnevni zbirnik B2C — ${b2cRacuni.length} računov`,
      });
      kirCount++;
    }

    // ── B2B: posamični invoices ──────────────────────────────────────────────
    for (const r of b2bRacuni) {
      const isContractMeal = isContractMealReceipt(r);
      const isReceivable = isBusinessReceivableReceipt(r) && !isContractMeal;
      if (isReceivable && hasPostedSalesForUnit(r.enotaId)) {
        skipped.push({
          ref: `POS:AR:${r.stevilkaRacuna}`,
          reason: "Potrjena dnevna temeljnica prodaje že vsebuje ta promet — POS sync ne ustvari druge prihodkovne temeljnice. Za pretvorbo v odprto terjatev je potreben ločen računovodski popravek.",
        });
        continue;
      }
      const naziv  = r.kupecNaziv?.trim() || `Kupec ${r.kupecDavcnaStevilka ?? r.id}`;
      const taxId  = r.kupecDavcnaStevilka?.trim() || null;
      const [selectedCounterparty] = r.kupecCpId
        ? await db
            .select({ id: counterpartiesTable.id })
            .from(counterpartiesTable)
            .where(and(
              eq(counterpartiesTable.id, r.kupecCpId),
              eq(counterpartiesTable.companyId, companyId),
            ))
            .limit(1)
        : [];
      const cpId = selectedCounterparty?.id ?? await ensureCounterparty(
        companyId,
        naziv,
        taxId,
        r.kupecNaslov ?? null,
        r.kupecZavezanecDdv ?? false,
      );
      const b2bLines = buildInvoiceLines([r.id]);
      const wasInserted = await insertKirInvoice({
        invoiceNumber:  `POS-${r.stevilkaRacuna}`,
        invoiceDate:    datum,
        counterpartyId: cpId,
        lines:          b2bLines,
        notes:          isContractMeal
          ? `POS pogodbena malica — mesečni zbirni A-račun · ${naziv}${taxId ? ` (${taxId})` : ""}`
          : `POS B2B — ${naziv}${taxId ? ` (${taxId})` : ""}`,
        ...(isReceivable
          ? {
              status: "posted" as const,
              dueDate: addDaysToDate(datum, r.dniOdloga),
              receivable: {
                reference: `POS:AR:${r.stevilkaRacuna}`,
                costCenterId: enote.find(enota => enota.id === r.enotaId)?.costCenterId ?? null,
              },
            }
          : {}),
      });
      if (wasInserted) kirCount++;
    }

    // ── Lastna poraba / Reprezentanca ────────────────────────────────────────
    if (lastReprRacuni.length > 0) {
      const lrCounterpartyId = await ensureCounterparty(
        companyId,
        "Lastna poraba / Reprezentanca (POS)",
        null,
      );
      const lrLines = buildInvoiceLines(lastReprRacuni.map(r => r.id));
      await insertKirInvoice({
        invoiceNumber:  `POS-LASTREPR-${datum}`,
        invoiceDate:    datum,
        counterpartyId: lrCounterpartyId,
        lines:          lrLines,
        notes:          `POS lastna poraba/reprezentanca — ${lastReprRacuni.length} računov (face value)`,
      });
      kirCount++;
    }

    if (kirCount > 0) {
      created.push(`POS:KIR:${datum} (${kirCount} invoice-ov)`);
    }
  }

  // ── Začetne zaloge (ZZ) — samo če datum sovpada z datumom vnosa ─────────────
  {
    const leto = parseInt(datum.slice(0, 4));
    // Poišči začetne zaloge za enote tega podjetja z datumom = sync datum
    const zzDocs = await db
      .select({
        id: zacetneZalogeTable.id,
        enotaId: zacetneZalogeTable.enotaId,
        leto: zacetneZalogeTable.leto,
        datum: zacetneZalogeTable.datum,
      })
      .from(zacetneZalogeTable)
      .where(
        and(
          inArray(zacetneZalogeTable.enotaId, enotaIds),
          sql`${zacetneZalogeTable.datum}::date = ${datum}::date`,
          eq(zacetneZalogeTable.leto, leto),
        ),
      );

    for (const zz of zzDocs) {
      const zzPostavke = await db
        .select({
          vrstaArtikla: artikliTable.vrstaArtikla,
          drobniInventar: artikliTable.drobniInventar,
          kolicina: zacetneZalogePostavkeTable.kolicina,
          cenaKos: zacetneZalogePostavkeTable.cenaKos,
        })
        .from(zacetneZalogePostavkeTable)
        .leftJoin(artikliTable, eq(artikliTable.id, zacetneZalogePostavkeTable.artikelId))
        .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, zz.id));

      const zzDatum = zz.datum instanceof Date
        ? zz.datum.toISOString().slice(0, 10)
        : String(zz.datum).slice(0, 10);

      const zzResult = await bookZacetnaZaloga(
        companyId,
        zz.enotaId,
        zz.leto,
        zzDatum,
        zzPostavke.map(p => ({
          vrstaArtikla: p.vrstaArtikla ?? null,
          drobniInventar: p.drobniInventar === true,
          kolicina: Number(p.kolicina),
          cenaKos: Number(p.cenaKos),
        })),
      ).catch(err => { console.warn("[ZZ sync]", err); return null; });

      if (zzResult?.created) {
        created.push(zzResult.created);
      } else if (zzResult?.skipped) {
        skipped.push({ ref: `POS:ZZ:${zz.leto}:E${zz.enotaId}`, reason: zzResult.skipped.reason });
      }
    }
  }

  return { created, skipped };
}

/**
 * One company/unit/day sync is a single serialized critical section.  The
 * bookkeeping implementation uses the shared Drizzle pool for many short
 * transactions, so the advisory transaction is deliberately held on a
 * dedicated client while those transactions run.  This still gives competing
 * manual/automatic callers a real pg_advisory_xact_lock without adding a
 * fragile uniqueness constraint to historical journal references.  The
 * month key is acquired before the day key, matching the monthly wrapper.
 */
async function syncPosBookingForDay(
  companyId: string,
  datum: string,
): Promise<SyncResult> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("BEGIN");
    const units = await lockClient.query<{ id: number }>(
      "SELECT id FROM enote WHERE company_id = $1 ORDER BY id",
      [companyId],
    );
    for (const unit of units.rows) {
      await lockClient.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`pos-sync:${companyId}:${unit.id}:${datum.slice(0, 7)}`],
      );
      await lockClient.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`pos-sync:${companyId}:${unit.id}:${datum}`],
      );
    }
    return await syncPosBookingForDayUnlocked(companyId, datum);
  } finally {
    try { await lockClient.query("COMMIT"); } finally { lockClient.release(); }
  }
}

/**
 * Mesečni zbirnik T1/T3. KIR, A-računi, blagajniški premiki in prejemnice
 * namenoma ne vstopajo sem: njihovi lastni tokovi ostanejo dnevni oziroma
 * posamični tudi, ko je GL prodaja mesečna.
 */
async function syncPosBookingForMonthUnlocked(
  companyId: string,
  month: string,
): Promise<SyncResult> {
  const created: string[] = [];
  const skipped: Array<{ ref: string; reason: string }> = [];
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return { created, skipped: [{ ref: "vse", reason: "Neveljaven mesec — pričakujem YYYY-MM" }] };
  }

  const { start, nextStart, end } = monthBounds(month);

  const [settings] = await db.select().from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, companyId)).limit(1);
  if (!settings) {
    return { created, skipped: [{ ref: "vse", reason: "POS nastavitve knjiženja niso konfigurirane" }] };
  }
  const categoryRevenueAccounts = await loadCategoryRevenueAccounts(companyId);
  const period = await resolvePosBookingPeriod(companyId, start, end);
  if (!period) {
    return { created, skipped: [{ ref: "vse", reason: `Ni odprtega računovodskega obdobja za cel mesec ${slovenskiDatumZaSporocilo(month)}` }] };
  }

  const enote = await db.select({
    id: enoteTable.id,
    ime: enoteTable.ime,
    zacetekDnevaUra: enoteTable.zacetekDnevaUra,
    costCenterId: enoteTable.costCenterId,
    costCenterCode: costCentersTable.code,
  }).from(enoteTable)
    .leftJoin(costCentersTable, and(
      eq(costCentersTable.id, enoteTable.costCenterId),
      eq(costCentersTable.companyId, companyId),
    ))
    .where(eq(enoteTable.companyId, companyId));
  if (enote.length === 0) {
    return { created, skipped: [{ ref: "vse", reason: "Podjetje nima POS enot" }] };
  }

  const now = new Date();
  if (enote.some(enota => businessDateForInstant(now, enota.zacetekDnevaUra ?? "04:00") < nextStart)) {
    return {
      created,
      skipped: [{ ref: "vse", reason: "Mesečni zbirnik je dovoljen šele po zaključenem celotnem mesecu" }],
    };
  }

  const salesFrequency = getEffectiveBookingFrequency(settings, "PRODAJA", start);
  const consumptionFrequency = getEffectiveBookingFrequency(settings, "PORABA", start);
  const rangeWhere = sql`
    ${racuniTable.datumCas} >= (
      ${start}::date + COALESCE((
        SELECT e.zacetek_dneva_ura::time FROM enote e WHERE e.id = ${racuniTable.enotaId}
      ), '04:00'::time)
    ) AT TIME ZONE 'Europe/Ljubljana'
    AND ${racuniTable.datumCas} < (
      ${nextStart}::date + COALESCE((
        SELECT e.zacetek_dneva_ura::time FROM enote e WHERE e.id = ${racuniTable.enotaId}
      ), '04:00'::time)
    ) AT TIME ZONE 'Europe/Ljubljana'
  `;
  const statusOk = notInArray(racuniTable.status, ["storniran"]);
  const retainedPostedArWhere = sql`EXISTS (
    SELECT 1 FROM ${invoicesTable}
    WHERE ${invoicesTable.companyId} = ${companyId}
      AND ${invoicesTable.createdBy} = 'pos-sync'
      AND ${invoicesTable.invoiceNumber} = ('POS-' || ${racuniTable.stevilkaRacuna})
      AND ${invoicesTable.linkedEntryId} IS NOT NULL
      AND ${invoicesTable.status} IN ('posted', 'paid')
  )`;

  for (const enota of enote) {
    // SM je opcijska analitika; referenca mora biti stabilna tudi brez kode SM.
    const costCenterId = enota.costCenterId && enota.costCenterCode
      ? enota.costCenterId
      : null;
    const enotaRef = `E${enota.id}`;
    const withDimensions = (lines: SyncLine[]) => lines.map((line) => ({
      ...line,
      enotaId: enota.id,
      costCenterId,
    }));

    // ── PRODAJA ───────────────────────────────────────────────────────────────
    const prodajaRef = `POS:PRODAJA:${month}:${enotaRef}`;
    if (salesFrequency !== "monthly") {
      skipped.push({ ref: prodajaRef, reason: "Prodaja za ta mesec ni nastavljena na mesečno knjiženje" });
    } else if (await hasAnyDailyEntryForMonth(companyId, month, enota.id, "PRODAJA")) {
      skipped.push({
        ref: prodajaRef,
        reason: "Za mesec že obstaja dnevna temeljnica prodaje — potrebna je ročna uskladitev",
      });
    } else if (await hasPostedMonthlyEntry(companyId, month, enota.id, "PRODAJA")) {
      skipped.push({ ref: prodajaRef, reason: "Potrjena mesečna temeljnica prodaje že obstaja" });
    } else {
      const enotaOk = eq(racuniTable.enotaId, enota.id);
      const [sales] = await db.select({
        gotovina: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekGotovina} AS numeric)), 0)`,
        kartica: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekKartica} AS numeric)), 0)`,
        napitnineObveznost: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} IN ('direct_employee','independent_pool') THEN CAST(${racuniTable.znesekNapitnina} AS numeric) - CASE WHEN ${racuniTable.tipPaymentMethod} = 'card' AND ${racuniTable.tipCardFeeTreatment} = 'deduct_from_tip' THEN CAST(${racuniTable.tipCardFeeAmount} AS numeric) ELSE 0 END ELSE 0 END), 0)`,
        napitninePrihodek: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} = 'employer_controlled' THEN CAST(${racuniTable.znesekNapitnina} AS numeric) ELSE 0 END), 0)`,
        napitnineDdv: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} = 'employer_controlled' THEN CAST(${racuniTable.tipVatAmount} AS numeric) ELSE 0 END), 0)`,
        napitnineKarticnaProvizija: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPaymentMethod} = 'card' AND ${racuniTable.tipCardFeeTreatment} = 'employer_expense' AND ${racuniTable.tipCardFeeKind} = 'percentage' THEN CAST(${racuniTable.tipCardFeeAmount} AS numeric) ELSE 0 END), 0)`,
        bon: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekBon} AS numeric)), 0)`,
        bonPica: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekBonPica} AS numeric)), 0)`,
        subvencija: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekSubvencija} AS numeric)), 0)`,
        negotovinsko: sql<string>`COALESCE(SUM(CASE WHEN NOT (
          ${racuniTable.placilnaNacin} = 'negotovinsko'
          AND ${racuniTable.kupecCpId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ${partnerCenikiTable}
            WHERE ${partnerCenikiTable.kupecId} = ${racuniTable.kupecCpId}
              AND ${partnerCenikiTable.enotaId} = ${racuniTable.enotaId}
          )
        ) THEN CAST(${racuniTable.znesekNegotovinsko} AS numeric) ELSE 0 END), 0)`,
        pogodbeno: sql<string>`COALESCE(SUM(CASE WHEN (
          ${racuniTable.placilnaNacin} = 'negotovinsko'
          AND ${racuniTable.kupecCpId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ${partnerCenikiTable}
            WHERE ${partnerCenikiTable.kupecId} = ${racuniTable.kupecCpId}
              AND ${partnerCenikiTable.enotaId} = ${racuniTable.enotaId}
          )
        ) THEN CAST(${racuniTable.znesekNegotovinsko} AS numeric) ELSE 0 END), 0)`,
        skupaj: sql<string>`COALESCE(SUM(CAST(${racuniTable.skupaj} AS numeric)), 0)`,
      }).from(racuniTable).where(and(
        enotaOk, rangeWhere, statusOk, not(retainedPostedArWhere),
        notInArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
        eq(racuniTable.jeDarilniBonIzdaja, false),
      ));
      const [giftIssues] = await db.select({
        gotovina: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekGotovina} AS numeric)), 0)`,
        kartica: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekKartica} AS numeric)), 0)`,
        negotovinsko: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekNegotovinsko} AS numeric)), 0)`,
        skupaj: sql<string>`COALESCE(SUM(CAST(${racuniTable.skupaj} AS numeric)), 0)`,
      }).from(racuniTable).where(and(
        enotaOk, rangeWhere, statusOk, not(retainedPostedArWhere),
        eq(racuniTable.jeDarilniBonIzdaja, true),
      ));
      const skupaj = dec(sales.skupaj);
      const issuedVouchers = dec(giftIssues.skupaj);
      if (skupaj.abs().lte("0.005") && issuedVouchers.abs().lte("0.005")) {
        await deleteMonthlySalesDraft(companyId, month, enota.id);
      } else {
        const revenueRows = await db.select({
          kategorijaId: sql<number | null>`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
          vrstaArtikla: postavkeTable.vrstaArtikla,
          davek: postavkeTable.davek,
          bruto: sql<string>`COALESCE(SUM(CAST(${postavkeTable.skupaj} AS numeric)), 0)`,
        }).from(postavkeTable)
          .innerJoin(racuniTable, eq(racuniTable.id, postavkeTable.racunId))
          .leftJoin(artikliTable, eq(artikliTable.id, postavkeTable.artikelId))
          .where(and(
            enotaOk, rangeWhere, statusOk, not(retainedPostedArWhere),
            notInArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
            eq(racuniTable.jeDarilniBonIzdaja, false),
          ))
          .groupBy(
            sql`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
            postavkeTable.vrstaArtikla,
            postavkeTable.davek,
          );
        const lines: SyncLine[] = [];
        const addDebit = (
          amount: Decimal,
          accountId: string | null | undefined,
          description: string,
          reason: string,
          partnerId?: string | null,
        ) => {
          if (amount.abs().lte("0.005")) return true;
          if (!accountId) {
            skipped.push({ ref: prodajaRef, reason });
            return false;
          }
          pushSignedLine(lines, accountId, "debit", amount, description, { partnerId });
          return true;
        };
        if (!addDebit(dec(sales.gotovina), settings.cashAccountId, "Gotovina", "Gotovina: konto blagajne ni nastavljen")
          || !addDebit(dec(sales.kartica), settings.cardAccountId, "Kartica / POS terminal", "Kartica: konto POS terminala ni nastavljen")
          || !addDebit(dec(sales.bon), settings.advancePaymentsAccountId, "Unovčitev darilnih bonov", "Darilni boni: konto predplačil 230 ni nastavljen")
          || !addDebit(dec(sales.bonPica), settings.voucherAccountId, "Bon za pico", "Bon za pico: konto bonov ni nastavljen")
          || !addDebit(dec(sales.subvencija), settings.subsidyReceivableAccountId, "Študentski boni – terjatev do države", "Študentski boni: nastavite konto terjatve 165", settings.subsidyCounterpartyId)
          || !addDebit(dec(sales.negotovinsko), settings.otherPaymentAccountId, "Ostala negot. plačila", "Ostala negotovinska plačila: konto ni nastavljen")
          || !addDebit(dec(sales.pogodbeno), settings.contractReceivableTransitAccountId, "Pogodbene malice — prehodna terjatev", "Pogodbene malice: prehodni konto 16… ni nastavljen")) {
          continue;
        }
        const napitnine = dec(sales.napitnineObveznost);
        if (napitnine.abs().gt("0.005")) {
          if (!settings.tipsLiabilityAccountId) {
            skipped.push({ ref: prodajaRef, reason: `Napitnine (${napitnine.toFixed(2)} €): konto obveznosti za napitnine ni nastavljen` });
            continue;
          }
          pushSignedLine(lines, settings.tipsLiabilityAccountId, "credit", napitnine, "Napitnine za tuj račun – obveznost do osebja");
        }
        if (dec(sales.subvencija).gt("0.005") && !settings.subsidyCounterpartyId) {
          skipped.push({ ref: prodajaRef, reason: "Študentski boni: partner MDDSZ/ŠOS ni nastavljen" });
          continue;
        }
        if (issuedVouchers.gt("0.005")) {
          if (!settings.advancePaymentsAccountId
            || !addDebit(dec(giftIssues.gotovina), settings.cashAccountId, "Prodaja darilnih bonov – gotovina", "Izdani darilni boni: konto blagajne ni nastavljen")
            || !addDebit(dec(giftIssues.kartica), settings.cardAccountId, "Prodaja darilnih bonov – kartica", "Izdani darilni boni: konto POS terminala ni nastavljen")
            || !addDebit(dec(giftIssues.negotovinsko), settings.otherPaymentAccountId, "Prodaja darilnih bonov – negotovinsko", "Izdani darilni boni: konto ostalih plačil ni nastavljen")) {
            if (!settings.advancePaymentsAccountId) skipped.push({ ref: prodajaRef, reason: "Izdani darilni boni: konto predplačil 230 ni nastavljen" });
            continue;
          }
          lines.push({ accountId: settings.advancePaymentsAccountId, side: "credit", amount: issuedVouchers, desc: "Izdani darilni boni – predplačila" });
        }
        const vatAccounts: Record<string, string | null | undefined> = {
          "5.00": settings.vat5AccountId, "9.50": settings.vat95AccountId, "22.00": settings.vat22AccountId,
        };
        const vatCodes: Record<string, string | null | undefined> = {
          "5.00": settings.vat5VatCodeId, "9.50": settings.vat95VatCodeId, "22.00": settings.vat22VatCodeId,
        };
        const vatByRate: Record<string, Decimal> = {};
        let grossLines = new Decimal(0);
        let configurationError = false;
        for (const row of revenueRows) {
          const gross = dec(row.bruto);
          const rate = dec(row.davek);
          if (gross.abs().lte("0.005")) continue;
          const net = rate.gt(0) ? gross.times(100).div(rate.plus(100)).toDecimalPlaces(2) : gross;
          const vat = gross.minus(net);
          const vrsta = row.vrstaArtikla ?? "storitev";
          const accountId = getCategoryRevenueAccount(
            row.kategorijaId,
            vrsta,
            rate,
            settings,
            categoryRevenueAccounts,
          );
          if (!accountId) {
            skipped.push({ ref: prodajaRef, reason: `Prihodkovni konto za kategorijo ${row.kategorijaId ?? "brez kategorije"} ni nastavljen` });
            configurationError = true;
            break;
          }
          grossLines = grossLines.plus(gross);
          pushSignedLine(lines, accountId, "credit", net, `Prihodki kategorije ${row.kategorijaId ?? "brez kategorije"}`);
          if (vat.abs().gt("0.005")) {
            const key = rate.toFixed(2);
            vatByRate[key] = (vatByRate[key] ?? new Decimal(0)).plus(vat);
          }
        }
        const employerTipGross = dec(sales.napitninePrihodek);
        const employerTipVat = dec(sales.napitnineDdv);
        const tipCardFeeExpense = dec(sales.napitnineKarticnaProvizija);
        if (employerTipGross.abs().gt("0.005")) {
          const tipRevenueAccount = settings.tipsRevenueAccountId ?? settings.revenueService22AccountId ?? settings.revenueAccountId;
          if (!tipRevenueAccount) {
            skipped.push({ ref: prodajaRef, reason: "Prihodkovni konto za obdavčljive napitnine ni nastavljen" });
            continue;
          }
          grossLines = grossLines.plus(employerTipGross);
          pushSignedLine(lines, tipRevenueAccount, "credit", employerTipGross.minus(employerTipVat), "Napitnine pod nadzorom delodajalca – prihodek");
          vatByRate["22.00"] = (vatByRate["22.00"] ?? new Decimal(0)).plus(employerTipVat);
        }
        if (tipCardFeeExpense.abs().gt("0.005")) {
          if (!settings.tipsCardFeeExpenseAccountId || !settings.cardAccountId) {
            skipped.push({ ref: prodajaRef, reason: "Kartična provizija napitnin: nastavite konto stroška in konto kartic" });
            continue;
          }
          pushSignedLine(lines, settings.tipsCardFeeExpenseAccountId, "debit", tipCardFeeExpense, "Kartična provizija napitnin – strošek delodajalca");
          pushSignedLine(lines, settings.cardAccountId, "credit", tipCardFeeExpense, "Kartična provizija napitnin – zmanjšanje terjatve do izdajatelja");
        }
        if (configurationError) continue;
        for (const [rate, amount] of Object.entries(vatByRate)) {
          const tipVat = rate === "22.00" && settings.tipsVatAccountId ? employerTipVat : new Decimal(0);
          const regularVat = amount.minus(tipVat);
          if (regularVat.abs().lte("0.005")) continue;
          const accountId = vatAccounts[rate] ?? settings.vatLiabilityAccountId;
          if (!accountId) {
            skipped.push({ ref: prodajaRef, reason: `Konto izstopnega DDV ${rate}% ni nastavljen` });
            configurationError = true;
            break;
          }
          pushSignedLine(lines, accountId, "credit", regularVat, `Izhodni DDV ${rate.replace(".00", "")}%`, { vatCodeId: vatCodes[rate] ?? null, vatAmount: regularVat.abs().toFixed(2) });
        }
        if (employerTipVat.abs().gt("0.005") && settings.tipsVatAccountId) {
          pushSignedLine(lines, settings.tipsVatAccountId, "credit", employerTipVat, "DDV napitnin pod nadzorom delodajalca", {
            vatCodeId: settings.vat22VatCodeId ?? null,
            vatAmount: employerTipVat.abs().toFixed(2),
          });
        }
        if (configurationError) continue;
        if (skupaj.abs().gt("0.005") && (revenueRows.length === 0 || grossLines.abs().lte("0.005"))) {
          if (!settings.revenueAccountId) {
            skipped.push({ ref: prodajaRef, reason: "Ni postavk in splošni konto prihodkov ni nastavljen" });
            continue;
          }
          pushSignedLine(lines, settings.revenueAccountId, "credit", skupaj, "Prihodki od prodaje (fallback)");
        }
        const merged = mergeLines(withDimensions(lines));
        if (!isBalanced(merged)) {
          skipped.push({ ref: prodajaRef, reason: "Mesečna temeljnica prodaje ni uravnotežena" });
          continue;
        }
        // deleteMonthlySalesDraft briše SSP draft invoice PRED journal entryjem
        // (FK invoices.linked_entry_id → journal_entries.id nima ON DELETE CASCADE).
        await deleteMonthlySalesDraft(companyId, month, enota.id);
        const entryId = await insertEntry(companyId, period.id, end, `Mesečna prodaja POS — ${month}`, prodajaRef, merged);
        const subsidy = dec(sales.subvencija);
        const sspInvoiceNumber = `POS-SSP-${month}-E${enota.id}`;
        if (period.id && subsidy.gt("0.005") && settings.subsidyReceivableAccountId && settings.subsidyCounterpartyId) {
          // SSP draft invoice je bil že izbrisan v deleteMonthlySalesDraft —
          // preverimo le, da ga drug proces ni vmes ustvaril (race guard).
          const [existing] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
            .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.invoiceNumber, sspInvoiceNumber))).limit(1);
          if (!existing) {
            const [invoice] = await db.insert(invoicesTable).values({
              companyId, type: "issued", counterpartyId: settings.subsidyCounterpartyId, periodId: period.id,
              invoiceNumber: sspInvoiceNumber, invoiceDate: end, dueDate: null, status: "draft",
              arApAccountId: settings.subsidyReceivableAccountId, linkedEntryId: entryId,
              notes: `SŠP subvencije POS enote ${enota.ime} za ${month}; znesek iz mesečne temeljnice.`,
              createdBy: "pos-sync",
            }).returning({ id: invoicesTable.id });
            await db.insert(invoiceLinesTable).values({
              invoiceId: invoice.id, description: `SŠP subvencije POS — ${month}`, quantity: "1",
              unitPrice: subsidy.toFixed(4), vatRate: "0.00", vatBase: subsidy.toFixed(2),
              vatAmount: "0.00", accountId: settings.subsidyReceivableAccountId, sequence: 0,
            });
          }
        }
        created.push(prodajaRef);
      }
    }

    // ── LASTNA PORABA / REPREZENTANCA (T4 sledi frekvenci prodaje) ────────────
    const lastReprRef = `POS:LASTREPR:${month}:${enotaRef}`;
    if (salesFrequency !== "monthly") {
      skipped.push({ ref: lastReprRef, reason: "T4 sledi dnevni frekvenci prodaje" });
    } else if (await hasAnyDailyEntryForMonth(companyId, month, enota.id, "LASTREPR")) {
      skipped.push({
        ref: lastReprRef,
        reason: "Za mesec že obstaja dnevna T4 temeljnica — potrebna je ročna uskladitev",
      });
    } else if (await hasPostedMonthlyEntry(companyId, month, enota.id, "LASTREPR")) {
      skipped.push({ ref: lastReprRef, reason: "Potrjena mesečna T4 temeljnica že obstaja" });
    } else {
      const rows = await db.select({
        placilnaNacin: racuniTable.placilnaNacin,
        kategorijaId: sql<number | null>`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
        vrstaArtikla: postavkeTable.vrstaArtikla,
        davek: postavkeTable.davek,
        faceValue: sql<string>`COALESCE(SUM(CAST(${postavkeTable.skupaj} AS numeric)), 0)`,
      }).from(postavkeTable)
        .innerJoin(racuniTable, eq(racuniTable.id, postavkeTable.racunId))
        .leftJoin(artikliTable, eq(artikliTable.id, postavkeTable.artikelId))
        .where(and(
          eq(racuniTable.enotaId, enota.id), rangeWhere, statusOk, not(retainedPostedArWhere),
          inArray(racuniTable.placilnaNacin, ["lastna_poraba", "reprezentanca"]),
          isNull(postavkeTable.parentPostavkaId),
        ))
        .groupBy(
          racuniTable.placilnaNacin,
          sql`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
          postavkeTable.vrstaArtikla,
          postavkeTable.davek,
        );
      const totalLastna = rows.filter((row) => row.placilnaNacin === "lastna_poraba")
        .reduce((sum, row) => sum.plus(dec(row.faceValue)), new Decimal(0));
      const totalRepr = rows.filter((row) => row.placilnaNacin === "reprezentanca")
        .reduce((sum, row) => sum.plus(dec(row.faceValue)), new Decimal(0));
      if (totalLastna.plus(totalRepr).lte("0.005")) {
        await deleteExistingMonthlyDraft(companyId, month, enota.id, "LASTREPR");
      } else if ((!settings.lastnaPorabaAccountId && totalLastna.gt("0.005"))
        || (!settings.reprezentancaAccountId && totalRepr.gt("0.005"))) {
        skipped.push({ ref: lastReprRef, reason: "Konto lastne porabe oziroma reprezentance ni nastavljen" });
      } else {
        const lines: SyncLine[] = [];
        if (totalLastna.gt("0.005")) lines.push({
          accountId: settings.lastnaPorabaAccountId!, side: "debit", amount: totalLastna,
          desc: "Odhodki — lastna poraba (face value)",
        });
        if (totalRepr.gt("0.005")) lines.push({
          accountId: settings.reprezentancaAccountId!, side: "debit", amount: totalRepr,
          desc: "Odhodki — reprezentanca (face value)",
        });
        const vatAccounts: Record<string, string | null | undefined> = {
          "5.00": settings.vat5AccountId, "9.50": settings.vat95AccountId, "22.00": settings.vat22AccountId,
        };
        const vatCodes: Record<string, string | null | undefined> = {
          "5.00": settings.vat5VatCodeId, "9.50": settings.vat95VatCodeId, "22.00": settings.vat22VatCodeId,
        };
        const vatByRate: Record<string, Decimal> = {};
        let configurationError = false;
        for (const row of rows) {
          const gross = dec(row.faceValue);
          const rate = dec(row.davek);
          if (gross.lte("0.005")) continue;
          const net = rate.gt(0) ? gross.times(100).div(rate.plus(100)).toDecimalPlaces(2) : gross;
          const accountId = getCategoryRevenueAccount(
            row.kategorijaId,
            row.vrstaArtikla ?? "storitev",
            rate,
            settings,
            categoryRevenueAccounts,
          );
          if (!accountId) {
            skipped.push({ ref: lastReprRef, reason: "Prihodkovni konto za T4 ni nastavljen" });
            configurationError = true;
            break;
          }
          lines.push({
            accountId,
            side: "credit",
            amount: net,
            desc: `Prihodki kategorije ${row.kategorijaId ?? "brez kategorije"} (lastna/repr)`,
          });
          const vat = gross.minus(net);
          if (vat.gt("0.005")) {
            const key = rate.toFixed(2);
            vatByRate[key] = (vatByRate[key] ?? new Decimal(0)).plus(vat);
          }
        }
        for (const [rate, amount] of Object.entries(vatByRate)) {
          const accountId = vatAccounts[rate] ?? settings.vatLiabilityAccountId;
          if (!accountId) {
            skipped.push({ ref: lastReprRef, reason: `Konto DDV T4 ${rate}% ni nastavljen` });
            configurationError = true;
            break;
          }
          lines.push({ accountId, side: "credit", amount, desc: `Izhodni DDV ${rate}% (lastna/repr)`, vatCodeId: vatCodes[rate] ?? null, vatAmount: amount.toFixed(2) });
        }
        if (!configurationError) {
          const merged = mergeLines(withDimensions(lines));
          if (!isBalanced(merged)) {
            skipped.push({ ref: lastReprRef, reason: "Mesečna T4 temeljnica ni uravnotežena" });
          } else {
            await deleteExistingMonthlyDraft(companyId, month, enota.id, "LASTREPR");
            await insertEntry(companyId, period.id, end, `POS lastna poraba / reprezentanca — ${month}`, lastReprRef, merged);
            created.push(lastReprRef);
          }
        }
      }
    }

    // ── PORABA ────────────────────────────────────────────────────────────────
    const porabaRef = `POS:PORABA:${month}:${enotaRef}`;
    if (consumptionFrequency !== "monthly") {
      skipped.push({ ref: porabaRef, reason: "Poraba za ta mesec ni nastavljena na mesečno knjiženje" });
    } else if (await hasAnyDailyEntryForMonth(companyId, month, enota.id, "PORABA")) {
      skipped.push({
        ref: porabaRef,
        reason: "Za mesec že obstaja dnevna temeljnica porabe — potrebna je ročna uskladitev",
      });
    } else if (await hasPostedMonthlyEntry(companyId, month, enota.id, "PORABA")) {
      skipped.push({ ref: porabaRef, reason: "Potrjena mesečna temeljnica porabe že obstaja" });
    } else {
      const consumptionBounds = await getBusinessDayBounds(enota.id, start);
      const nextConsumptionBounds = await getBusinessDayBounds(enota.id, nextStart);
      const rows = await db.select({
        vrstaArtikla: artikliTable.vrstaArtikla,
        porabljeno: sql<string>`COALESCE(SUM(ABS(CAST(${zalogaGibiTable.vrednost} AS numeric))), 0)`,
      }).from(zalogaGibiTable)
        .innerJoin(artikliTable, eq(artikliTable.id, zalogaGibiTable.artikelId))
        .where(and(
          eq(artikliTable.enotaId, enota.id),
          eq(zalogaGibiTable.tip, "poraba"),
          gte(zalogaGibiTable.ustvarjeno, consumptionBounds.start),
          lt(zalogaGibiTable.ustvarjeno, nextConsumptionBounds.start),
        ))
        .groupBy(artikliTable.vrstaArtikla);
      const lines: SyncLine[] = [];
      for (const row of rows) {
        const amount = dec(row.porabljeno);
        if (amount.lte("0.005")) continue;
        const type = row.vrstaArtikla ?? "material";
        const cogs = type === "material"
          ? settings.cogsMaterialAccountId ?? settings.cogsAccountId
          : type === "blago"
            ? settings.cogsGoodsAccountId ?? settings.cogsAccountId
            : settings.cogsAccountId;
        const inventory = type === "material"
          ? settings.inventoryMaterialAccountId ?? settings.inventoryAccountId
          : type === "blago"
            ? settings.inventoryGoodsAccountId ?? settings.inventoryAccountId
            : settings.inventoryAccountId;
        if (!cogs || !inventory) {
          skipped.push({ ref: porabaRef, reason: `Konto COGS ali zalog za vrsto '${type}' ni nastavljen` });
          lines.length = 0;
          break;
        }
        lines.push({ accountId: cogs, side: "debit", amount, desc: `Stroški ${type}` });
        lines.push({ accountId: inventory, side: "credit", amount, desc: `Zmanjšanje zalog ${type}` });
      }
      const [monthlyWaste] = await db.select({
        value: sql<string>`COALESCE(SUM(CAST(${preparedFoodDailyLedgersTable.wasteValue} AS numeric)), 0)`,
      }).from(preparedFoodDailyLedgersTable).where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enota.id),
        isNotNull(preparedFoodDailyLedgersTable.closedAt),
        sql`${preparedFoodDailyLedgersTable.businessDate} >= ${start}::date AND ${preparedFoodDailyLedgersTable.businessDate} < ${nextStart}::date`,
      ));
      const wasteValue = dec(monthlyWaste?.value ?? "0");
      if (wasteValue.gt("0.005")) {
        const materialCogs = settings.cogsMaterialAccountId ?? settings.cogsAccountId;
        if (!settings.wasteAccountId || !materialCogs) {
          skipped.push({ ref: porabaRef, reason: "Konto kala ali stroškov materiala ni nastavljen" });
          lines.length = 0;
        } else {
          lines.push({ accountId: settings.wasteAccountId, side: "debit", amount: wasteValue, desc: "Kala pripravljene hrane" });
          lines.push({ accountId: materialCogs, side: "credit", amount: wasteValue, desc: "Prenos kala iz stroškov materiala" });
        }
      }
      if (lines.length === 0) {
        await deleteExistingMonthlyDraft(companyId, month, enota.id, "PORABA");
      } else {
        const merged = mergeLines(withDimensions(lines));
        if (!isBalanced(merged)) {
          skipped.push({ ref: porabaRef, reason: "Mesečna temeljnica porabe ni uravnotežena" });
        } else {
          await deleteExistingMonthlyDraft(companyId, month, enota.id, "PORABA");
          await insertEntry(companyId, period.id, end, `POS poraba blaga/materiala — ${month}`, porabaRef, merged);
          created.push(porabaRef);
        }
      }
    }
  }
  return { created, skipped };
}

/**
 * Monthly and daily POS syncs acquire the same ordered per-unit advisory keys.
 * Holding the transaction lock across the complete operation prevents a
 * scheduler run and a manual frequency-switch run from racing on drafts.
 */
async function syncPosBookingForMonth(
  companyId: string,
  month: string,
): Promise<SyncResult> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("BEGIN");
    const units = await lockClient.query<{ id: number }>(
      "SELECT id FROM enote WHERE company_id = $1 ORDER BY id",
      [companyId],
    );
    for (const unit of units.rows) {
      await lockClient.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`pos-sync:${companyId}:${unit.id}:${month}`],
      );
    }
    return await syncPosBookingForMonthUnlocked(companyId, month);
  } finally {
    try { await lockClient.query("COMMIT"); } finally { lockClient.release(); }
  }
}

// ── Začetna zaloga — otvoritvena temeljnica ───────────────────────────────────

/**
 * Ustvari ali osveži otvoritveno temeljnico za začetne zaloge:
 *   DR 310/300 (konto zalog) / CR 990 (otvoritveni konto)
 *
 * Referenca: POS:ZZ:{leto}:E{enotaId}
 * Idempotentna — obstoječi osnutek iste enote pobriše in ustvari novega.
 * Potrjene temeljnice ne briše.
 */
async function bookZacetnaZaloga(
  companyId: string,
  enotaId: number,
  leto: number,
  datum: string, // YYYY-MM-DD
  postavke: ZZPostavka[],
): Promise<{ created: string | null; skipped: { reason: string } | null }> {
  const vrednotljivePostavke = postavke.filter((postavka) => !postavka.drobniInventar);
  if (vrednotljivePostavke.length === 0) {
    await deleteExistingOpeningStockDrafts(companyId, leto, enotaId);
    return { created: null, skipped: null };
  }
  // SM je opcijska analitika otvoritvene temeljnice. Če je povezava neveljavna
  // ali manjka, knjižimo z NULL; enota ostane stabilno identificirana z ID-jem.
  const [enota] = await db
    .select({
      id: enoteTable.id,
      ime: enoteTable.ime,
      costCenterId: enoteTable.costCenterId,
      costCenterCode: costCentersTable.code,
    })
    .from(enoteTable)
    .leftJoin(
      costCentersTable,
      and(
        eq(costCentersTable.id, enoteTable.costCenterId),
        eq(costCentersTable.companyId, companyId),
      ),
    )
    .where(
      and(
        eq(enoteTable.id, enotaId),
        eq(enoteTable.companyId, companyId),
      ),
    )
    .limit(1);

  if (!enota) {
    await deleteExistingOpeningStockDrafts(companyId, leto, enotaId);
    return {
      created: null,
      skipped: {
        reason: `Enota ${enotaId} ni najdena — otvoritvena temeljnica začetnih zalog ni ustvarjena`,
      },
    };
  }

  const costCenterId = enota.costCenterId && enota.costCenterCode
    ? enota.costCenterId
    : null;
  const ref = `POS:ZZ:${leto}:E${enota.id}`;

  // Nastavitve knjiženja
  const [settings] = await db
    .select()
    .from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, companyId))
    .limit(1);

  if (!settings) {
    return { created: null, skipped: { reason: "POS nastavitve knjiženja niso konfigurirane" } };
  }

  if (!settings.openingBalanceAccountId) {
    return { created: null, skipped: { reason: "Otvoritveni konto bilance stanja (990/900) ni nastavljen v POS nastavitvah" } };
  }

  const period = await resolvePosBookingPeriod(companyId, datum);

  if (!period) {
    return { created: null, skipped: { reason: `Ni odprtega računovodskega obdobja za ${slovenskiDatumZaSporocilo(datum)}` } };
  }

  // Seštej vrednost po vrsti artikla
  const byVrsta = new Map<string, Decimal>();
  for (const p of vrednotljivePostavke) {
    const vrsta = p.vrstaArtikla ?? "material";
    const val = new Decimal(p.kolicina).times(new Decimal(p.cenaKos)).toDecimalPlaces(2);
    byVrsta.set(vrsta, (byVrsta.get(vrsta) ?? new Decimal(0)).plus(val));
  }

  const skupaj = [...byVrsta.values()].reduce((s, v) => s.plus(v), new Decimal(0));
  if (skupaj.lte("0.005")) {
    await deleteExistingOpeningStockDrafts(companyId, leto, enota.id);
    return { created: null, skipped: null }; // nič za knjižiti
  }

  const lines: SyncLine[] = [];

  for (const [vrsta, znesek] of byVrsta) {
    if (znesek.lte("0.005")) continue;

    let invAcc: string | null | undefined;
    if (vrsta === "material") {
      invAcc = settings.inventoryMaterialAccountId ?? settings.inventoryAccountId;
    } else if (vrsta === "blago") {
      invAcc = settings.inventoryGoodsAccountId ?? settings.inventoryAccountId;
    } else {
      invAcc = settings.inventoryAccountId;
    }

    if (!invAcc) {
      return {
        created: null,
        skipped: { reason: `Konto zalog za vrsto '${vrsta}' (${znesek.toFixed(2)} €) ni nastavljen v T2` },
      };
    }

    lines.push({
      accountId: invAcc,
      side: "debit",
      amount: znesek,
      desc: `Začetna zaloga ${vrsta} ${leto}`,
    });
  }

  lines.push({
    accountId: settings.openingBalanceAccountId,
    side: "credit",
    amount: skupaj,
    desc: `Otvoritev bilance ${leto}`,
  });

  const merged = mergeLines(
    lines.map(line => ({
      ...line,
      enotaId: enota.id,
      costCenterId,
    })),
  );
  if (!isBalanced(merged)) {
    const d = merged.filter(l => l.side === "debit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const c = merged.filter(l => l.side === "credit").reduce((s, l) => s.plus(l.amount), new Decimal(0));
    return { created: null, skipped: { reason: `Otvoritvena temeljnica ni uravnotežena: D ${d.toFixed(2)} ≠ K ${c.toFixed(2)}` } };
  }

  await deleteExistingOpeningStockDrafts(companyId, leto, enota.id);
  await insertEntry(companyId, period.id, datum, `POS začetne zaloge ${leto}`, ref, merged);

  return { created: ref, skipped: null };
}

return { pushSignedLine, getEffectiveBookingFrequency, getRevenueAccount,
  getCategoryRevenueAccount, syncPosBookingForDay, syncPosBookingForMonth, bookZacetnaZaloga };
}

const erpEngine = createBookingEngine(erpEntriesTable, erpLinesTable);
const posEngine = createBookingEngine(posBookingDraftsTable, posBookingDraftLinesTable);
export const pushSignedLine = erpEngine.pushSignedLine;
export const getEffectiveBookingFrequency = erpEngine.getEffectiveBookingFrequency;
export const getRevenueAccount = erpEngine.getRevenueAccount;
export const getCategoryRevenueAccount = erpEngine.getCategoryRevenueAccount;

async function bookingEngine(companyId: string, from: string, to = from) {
  const period = await resolvePosBookingPeriod(companyId, from, to);
  return period?.id === null ? posEngine : erpEngine;
}

export async function syncPosBookingForDay(companyId: string, datum: string) {
  return (await bookingEngine(companyId, datum)).syncPosBookingForDay(companyId, datum);
}

export async function syncPosBookingForMonth(companyId: string, month: string) {
  return (await bookingEngine(companyId, `${month}-01`)).syncPosBookingForMonth(companyId, month);
}

export async function bookZacetnaZaloga(companyId: string, enotaId: number, leto: number, datum: string, postavke: ZZPostavka[]) {
  return (await bookingEngine(companyId, datum)).bookZacetnaZaloga(companyId, enotaId, leto, datum, postavke);
}
