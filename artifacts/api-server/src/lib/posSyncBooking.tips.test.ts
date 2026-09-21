import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountsTable,
  companiesTable,
  db,
  enoteTable,
  journalEntriesTable,
  journalEntryLinesTable,
  narocilaTable,
  pool,
  posBookingSettingsTable,
  postavkeTable,
  racuniTable,
} from "@workspace/db";
import { syncPosBookingForDay } from "./posSyncBooking";

const DATE = "2026-08-21";
const DATE_WITHOUT_TIPS_ACCOUNT = "2026-08-22";
const STORNO_DATE = "2026-08-23";
const EMPLOYER_DATE = "2026-08-24";
const RUN_ID = Math.random().toString(36).slice(2, 10).toUpperCase();
let companyId = "";
let unitId = 0;
let cardAccountId = "";
let tipsLiabilityAccountId = "";
let revenueAccountId = "";
let vatAccountId = "";
let tipsRevenueAccountId = "";
let tipsVatAccountId = "";
let tipsCardFeeExpenseAccountId = "";

async function account(code: string, type: "asset" | "liability" | "revenue" | "expense") {
  const [row] = await db.insert(accountsTable).values({
    companyId, code: `${code}${RUN_ID}`.slice(0, 7), name: `Tip test ${code}`, type,
  }).returning({ id: accountsTable.id });
  return row.id;
}

async function receipt(date: string, number: string, storno = false, employerControlled = false) {
  const sale = storno ? "-12.00" : "12.00";
  const card = storno ? "-15.00" : "15.00";
  const tip = storno ? "-3.00" : "3.00";
  const [order] = await db.insert(narocilaTable).values({
    enotaId: unitId, status: "zakljuceno", skupaj: sale,
  }).returning({ id: narocilaTable.id });
  const [racun] = await db.insert(racuniTable).values({
    enotaId: unitId, narociloId: order.id, stevilkaRacuna: number,
    skupaj: sale, osnova: storno ? "-9.84" : "9.84", ddv: storno ? "-2.16" : "2.16", placilnaNacin: "kartica",
    status: "poslan", datumCas: new Date(`${date}T10:00:00+02:00`),
    znesekGotovina: "0", znesekKartica: card, znesekNapitnina: tip,
    znesekBon: "0", znesekBonPica: "0", znesekNegotovinsko: "0",
    tipPolicyMode: employerControlled ? "employer_controlled" : "direct_employee",
    tipCardFeeKind: employerControlled ? "percentage" : "none",
    tipCardFeeTreatment: "employer_expense",
    tipCardFeeAmount: employerControlled ? "0.06" : "0",
    tipVatAmount: employerControlled ? "0.54" : "0",
    tipPaymentMethod: "card",
  }).returning({ id: racuniTable.id });
  await db.insert(postavkeTable).values({
    narociloId: order.id, racunId: racun.id, ime: "Prodaja brez napitnine",
    kolicina: storno ? -1 : 1, cenaKos: "12.00", skupaj: sale, davek: "22.00", vrstaArtikla: "storitev",
  });
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TIP_${RUN_ID}`, naziv: `Napitnine ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  await db.insert(accountingPeriodsTable).values({
    companyId, name: "Test 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  });
  [cardAccountId, tipsLiabilityAccountId, revenueAccountId, vatAccountId, tipsRevenueAccountId, tipsVatAccountId, tipsCardFeeExpenseAccountId] = await Promise.all([
    account("109", "asset"), account("230", "liability"), account("760", "revenue"), account("260", "liability"),
    account("761", "revenue"), account("261", "liability"), account("415", "expense"),
  ]);
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: "Tip enota" }).returning({ id: enoteTable.id });
  unitId = unit.id;
  await db.insert(posBookingSettingsTable).values({
    companyId, cardAccountId, tipsLiabilityAccountId,
    revenueService22AccountId: revenueAccountId, vat22AccountId: vatAccountId,
    tipsRevenueAccountId, tipsVatAccountId, tipsCardFeeExpenseAccountId,
  });
  await receipt(DATE, `TIP-${RUN_ID}-1`);
});

afterAll(async () => {
  if (!companyId) return;
  const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  if (entries.length) await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, entries.map(e => e.id)));
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
  const receipts = await db.select({ id: racuniTable.id }).from(racuniTable).where(eq(racuniTable.enotaId, unitId));
  if (receipts.length) await db.delete(postavkeTable).where(inArray(postavkeTable.racunId, receipts.map(r => r.id)));
  await db.delete(racuniTable).where(eq(racuniTable.enotaId, unitId));
  await db.delete(narocilaTable).where(eq(narocilaTable.enotaId, unitId));
  await db.delete(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId));
  await db.delete(enoteTable).where(eq(enoteTable.id, unitId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("POS → ERP kartične napitnine", () => {
  it("debetira celotno kartično bremenitev, napitnino pa ločeno knjiži v kredit obveznosti", async () => {
    const result = await syncPosBookingForDay(companyId, DATE);
    expect(result.skipped.some(s => s.ref === `POS:PRODAJA:${DATE}:E${unitId}`)).toBe(false);
    const [entry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE}:E${unitId}`),
    ));
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId, side: journalEntryLinesTable.side, amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id));
    expect(lines).toContainEqual({ accountId: cardAccountId, side: "debit", amount: "15.00" });
    expect(lines).toContainEqual({ accountId: tipsLiabilityAccountId, side: "credit", amount: "3.00" });
    const debit = lines.filter(l => l.side === "debit").reduce((sum, l) => sum + Number(l.amount), 0);
    const credit = lines.filter(l => l.side === "credit").reduce((sum, l) => sum + Number(l.amount), 0);
    expect(debit).toBeCloseTo(credit, 2);
  });

  it("brez konta napitnin jasno preskoči osnutek", async () => {
    await db.update(posBookingSettingsTable).set({ tipsLiabilityAccountId: null })
      .where(eq(posBookingSettingsTable.companyId, companyId));
    await receipt(DATE_WITHOUT_TIPS_ACCOUNT, `TIP-${RUN_ID}-2`);
    const result = await syncPosBookingForDay(companyId, DATE_WITHOUT_TIPS_ACCOUNT);
    expect(result.created).not.toContain(`POS:PRODAJA:${DATE_WITHOUT_TIPS_ACCOUNT}:E${unitId}`);
    expect(result.skipped).toContainEqual(expect.objectContaining({
      ref: `POS:PRODAJA:${DATE_WITHOUT_TIPS_ACCOUNT}:E${unitId}`,
      reason: expect.stringContaining("konto obveznosti za napitnine ni nastavljen"),
    }));
    const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE_WITHOUT_TIPS_ACCOUNT}:E${unitId}`),
    ));
    expect(entries).toHaveLength(0);
  });

  it("čisti storno obrne kartico, prihodke/DDV in obveznost napitnine", async () => {
    // Ponovno nastavimo konto, ker predhodni test preveri manjkajočo nastavitev.
    await db.update(posBookingSettingsTable).set({ tipsLiabilityAccountId })
      .where(eq(posBookingSettingsTable.companyId, companyId));
    await receipt(STORNO_DATE, `TIP-${RUN_ID}-STORNO`, true);
    const result = await syncPosBookingForDay(companyId, STORNO_DATE);
    expect(result.skipped.some(s => s.ref === `POS:PRODAJA:${STORNO_DATE}:E${unitId}`)).toBe(false);
    const [entry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, `POS:PRODAJA:${STORNO_DATE}:E${unitId}`),
    ));
    const lines = await db.select({ accountId: journalEntryLinesTable.accountId, side: journalEntryLinesTable.side, amount: journalEntryLinesTable.amount })
      .from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id));
    expect(lines).toContainEqual({ accountId: cardAccountId, side: "credit", amount: "15.00" });
    expect(lines).toContainEqual({ accountId: tipsLiabilityAccountId, side: "debit", amount: "3.00" });
  });

  it("napitnino pod nadzorom delodajalca knjiži na ločene konte prihodka, DDV in odstotne provizije", async () => {
    await receipt(EMPLOYER_DATE, `TIP-${RUN_ID}-EMPLOYER`, false, true);

    const result = await syncPosBookingForDay(companyId, EMPLOYER_DATE);
    expect(result.skipped.some(s => s.ref === `POS:PRODAJA:${EMPLOYER_DATE}:E${unitId}`)).toBe(false);
    const [entry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.reference, `POS:PRODAJA:${EMPLOYER_DATE}:E${unitId}`),
    ));
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id));
    expect(lines).toContainEqual({ accountId: tipsRevenueAccountId, side: "credit", amount: "2.46" });
    expect(lines).toContainEqual({ accountId: tipsVatAccountId, side: "credit", amount: "0.54" });
    expect(lines).toContainEqual({ accountId: tipsCardFeeExpenseAccountId, side: "debit", amount: "0.06" });
    expect(lines).toContainEqual({ accountId: cardAccountId, side: "credit", amount: "0.06" });
    const debit = lines.filter(line => line.side === "debit").reduce((sum, line) => sum + Number(line.amount), 0);
    const credit = lines.filter(line => line.side === "credit").reduce((sum, line) => sum + Number(line.amount), 0);
    expect(debit).toBeCloseTo(credit, 2);
  });
});