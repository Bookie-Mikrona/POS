import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";

// Keep real SQL and nested application transactions, but roll back the entire
// suite so posted A-invoices and their append-only VAT records do not persist.
const state = vi.hoisted(() => ({ db: null as object | null }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...original,
    db: new Proxy(original.db, {
      get(_target, key) {
        const current = state.db ?? original.db;
        const value = Reflect.get(current, key);
        return typeof value === "function" ? value.bind(current) : value;
      },
    }),
  };
});

import {
  db, pool, type PoolClient, companiesTable, companyModulesTable,
  accountingPeriodsTable, accountsTable, enoteTable, narocilaTable,
  racuniTable, postavkeTable, posBookingSettingsTable,
  posCategoryRevenueAccountsTable, journalEntriesTable,
  journalEntryLinesTable, invoicesTable, invoiceLinesTable,
  counterpartiesTable,
} from "@workspace/db";
import { syncPosBookingForDay, syncPosBookingForMonth } from "./posSyncBooking";

const DAY = "2026-07-15";
const MONTH = DAY.slice(0, 7);
const RATES = [
  { rate: "22.00", gross: "122.00", vat: "22.00" },
  { rate: "9.50", gross: "109.50", vat: "9.50" },
];
const CATEGORIES = [41401, 41402, 41403, null];
let client: PoolClient | undefined;
let finishTransaction: (() => void) | undefined;
let transactionDone: Promise<void> | undefined;
const companyIds: string[] = [];

beforeAll(async () => {
  client = await pool.connect();
  const rollback = new Error("category revenue test rollback");
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const finished = new Promise<void>(resolve => { finishTransaction = resolve; });
  transactionDone = drizzle(client).transaction(async tx => {
    state.db = tx;
    ready();
    await finished;
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
  await Promise.race([started, transactionDone]);
});

afterAll(async () => {
  try {
    finishTransaction?.();
    await transactionDone;
  } finally {
    state.db = null;
    client?.release();
  }
  try {
    for (const id of companyIds) {
      expect(await db.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.id, id))).toHaveLength(0);
    }
  } finally {
    await pool.end();
  }
});

async function fixture(frequency: "daily" | "monthly") {
  const [company] = await db.insert(companiesTable).values({
    naziv: "Kategorijski razrez — izoliran preizkus",
    podjetjeDavcna: `TEST-CAT-${crypto.randomUUID()}`,
  }).returning({ id: companiesTable.id });
  companyIds.push(company.id);
  await db.insert(companyModulesTable).values([
    { companyId: company.id, module: "pos", enabledBy: "test" },
    { companyId: company.id, module: "erp", enabledBy: "test" },
  ]);
  await db.insert(accountingPeriodsTable).values({
    companyId: company.id, name: "2026",
    startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  });
  async function account(code: string, type: "asset" | "revenue" | "liability" | "expense") {
    const [row] = await db.insert(accountsTable).values({
      companyId: company.id, code, name: code, type,
    }).returning({ id: accountsTable.id });
    return row.id;
  }
  const cash = await account("100", "asset");
  const ar = await account("120", "asset");
  const categoryA = await account("761", "revenue");
  const categoryB = await account("762", "revenue");
  const general = await account("760", "revenue");
  const legacy = await account("769", "revenue");
  const vat22 = await account("2600", "liability");
  const vat95 = await account("2601", "liability");
  const ownUse = await account("489", "expense");
  const representation = await account("417", "expense");
  await db.insert(posBookingSettingsTable).values({
    companyId: company.id, cashAccountId: cash, kirArAccountId: ar,
    revenueAccountId: general,
    revenueService22AccountId: legacy, revenueService95AccountId: legacy,
    vat22AccountId: vat22, vat95AccountId: vat95,
    lastnaPorabaAccountId: ownUse, reprezentancaAccountId: representation,
    salesBookingFrequency: frequency,
  });
  await db.insert(posCategoryRevenueAccountsTable).values([
    { companyId: company.id, categoryId: CATEGORIES[0]!, accountId: categoryA },
    { companyId: company.id, categoryId: CATEGORIES[1]!, accountId: categoryB },
  ]);
  const [unit] = await db.insert(enoteTable).values({
    companyId: company.id, ime: "Kategorije", zacetekDnevaUra: "04:00",
  }).returning({ id: enoteTable.id });
  return { companyId: company.id, unitId: unit.id, cash, ar, categoryA, categoryB,
    general, legacy, vat22, vat95, ownUse, representation };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function createReceipt(
  f: Fixture,
  payment: "gotovina" | "lastna_poraba" | "reprezentanca" | "negotovinsko",
  day = DAY,
) {
  const [order] = await db.insert(narocilaTable).values({
    enotaId: f.unitId, status: "zakljuceno", skupaj: "926.00",
  }).returning({ id: narocilaTable.id });
  let customerId: string | null = null;
  if (payment === "negotovinsko") {
    const [customer] = await db.insert(counterpartiesTable).values({
      companyId: f.companyId, type: "customer", name: "Kupec kategorij", taxId: "12345678",
    }).returning({ id: counterpartiesTable.id });
    customerId = customer.id;
  }
  const number = `CAT-${crypto.randomUUID()}`;
  const [receipt] = await db.insert(racuniTable).values({
    enotaId: f.unitId, narociloId: order.id, stevilkaRacuna: number,
    datumCas: new Date(`${day}T12:00:00+02:00`),
    skupaj: "926.00", osnova: "800.00", ddv: "126.00",
    placilnaNacin: payment, status: "poslan",
    znesekGotovina: payment === "gotovina" ? "926.00" : "0.00",
    znesekNegotovinsko: payment === "negotovinsko" ? "926.00" : "0.00",
    kupecCpId: customerId, kupecDavcnaStevilka: customerId ? "12345678" : null,
    kupecNaziv: customerId ? "Kupec kategorij" : null,
  }).returning({ id: racuniTable.id });
  await db.insert(postavkeTable).values(CATEGORIES.flatMap(kategorijaId =>
    RATES.map(({ rate, gross }) => ({
      narociloId: order.id, racunId: receipt.id, kategorijaId,
      ime: `Kategorija ${kategorijaId ?? "brez"} · ${rate}`,
      kolicina: 1, cenaKos: gross, skupaj: gross, davek: rate,
      vrstaArtikla: "storitev",
    })),
  ));
  return number;
}

async function expectJournal(f: Fixture, reference: string, debitAccount: string, count = 1) {
  const entries = await db.select().from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.companyId, f.companyId),
      eq(journalEntriesTable.reference, reference)));
  expect(entries).toHaveLength(1);
  const lines = await db.select().from(journalEntryLinesTable)
    .where(eq(journalEntryLinesTable.entryId, entries[0]!.id));
  for (const [accountId, net] of [
    [f.categoryA, 200], [f.categoryB, 200], [f.general, 400],
  ] as const) {
    const revenueLines = lines.filter(line => line.accountId === accountId);
    expect(revenueLines.length).toBeGreaterThan(0);
    expect(revenueLines.every(line => line.side === "credit")).toBe(true);
    expect(revenueLines.reduce((sum, line) => sum + Number(line.amount), 0)).toBe(net * count);
  }
  // Both an unmapped category and a missing category must choose the general
  // revenue account, not the (different) legacy service × VAT account.
  expect(lines.some(line => line.accountId === f.legacy)).toBe(false);
  const vatLines = lines.filter(line => line.description?.startsWith("Izhodni DDV"));
  expect(vatLines).toHaveLength(2);
  expect(vatLines).toEqual(expect.arrayContaining([
    expect.objectContaining({ accountId: f.vat22, side: "credit", amount: (88 * count).toFixed(2) }),
    expect.objectContaining({ accountId: f.vat95, side: "credit", amount: (38 * count).toFixed(2) }),
  ]));
  expect(lines.filter(line => line.side === "debit")).toEqual([
    expect.objectContaining({ accountId: debitAccount, amount: (926 * count).toFixed(2) }),
  ]);
  expect(lines.filter(line => line.side === "credit")
    .reduce((sum, line) => sum + Number(line.amount), 0)).toBe(926 * count);
  return entries[0]!;
}

async function expectKir(f: Fixture, invoiceNumber: string) {
  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.companyId, f.companyId),
      eq(invoicesTable.invoiceNumber, invoiceNumber)));
  expect(invoices).toHaveLength(1);
  const lines = await db.select().from(invoiceLinesTable)
    .where(eq(invoiceLinesTable.invoiceId, invoices[0]!.id));
  expect(lines).toHaveLength(8);
  for (const { rate, vat } of RATES) {
    for (const [index, category] of CATEGORIES.entries()) {
      const accountId = index === 0 ? f.categoryA : index === 1 ? f.categoryB : f.general;
      const rateLine = lines.find(row => row.vatRate === rate
        && row.description?.startsWith(`POS kategorija ${category ?? "brez kategorije"} ·`));
      expect(rateLine).toMatchObject({
        accountId, vatRate: rate, vatBase: "100.00", vatAmount: vat,
      });
    }
    const rateLines = lines.filter(line => line.vatRate === rate);
    expect(rateLines.reduce((sum, line) => sum + Number(line.vatBase), 0)).toBe(400);
    expect(rateLines.reduce((sum, line) => sum + Number(line.vatAmount), 0)).toBe(Number(vat) * 4);
  }
  expect(lines.some(line => line.accountId === f.legacy)).toBe(false);
  return invoices[0]!;
}

describe("POS kategorijski konti v mesečnih, T4 in KIR dokumentih", () => {
  it("mesečna prodaja združi več dni, razdeli prihodke in ohrani eno vrstico DDV na stopnjo", async () => {
    const f = await fixture("monthly");
    await createReceipt(f, "gotovina");
    await createReceipt(f, "gotovina", "2026-07-25");
    const reference = `POS:PRODAJA:${MONTH}:E${f.unitId}`;
    const result = await syncPosBookingForMonth(f.companyId, MONTH);
    expect(result.created).toContain(reference);
    await expectJournal(f, reference, f.cash, 2);
  });

  it.each([
    ["daily", "lastna_poraba"], ["daily", "reprezentanca"],
    ["monthly", "lastna_poraba"], ["monthly", "reprezentanca"],
  ] as const)("T4 %s / %s uporabi kategorijska konta, splošni fallback in združen DDV", async (frequency, payment) => {
    const f = await fixture(frequency);
    await createReceipt(f, payment);
    const reference = `POS:LASTREPR:${frequency === "monthly" ? MONTH : DAY}:E${f.unitId}`;
    const result = frequency === "monthly"
      ? await syncPosBookingForMonth(f.companyId, MONTH)
      : await syncPosBookingForDay(f.companyId, DAY);
    expect(result.created).toContain(reference);
    await expectJournal(f, reference, payment === "lastna_poraba" ? f.ownUse : f.representation);
    if (frequency === "daily") await expectKir(f, `POS-LASTREPR-${DAY}`);
  });

  it("A-račun in povezani KIR ohranita ista kategorijska konta in splošni fallback", async () => {
    const f = await fixture("daily");
    const number = await createReceipt(f, "negotovinsko");
    await syncPosBookingForDay(f.companyId, DAY);
    const entry = await expectJournal(f, `POS:AR:${number}`, f.ar);
    const invoice = await expectKir(f, `POS-${number}`);
    expect(entry.status).toBe("posted");
    expect(invoice.linkedEntryId).toBe(entry.id);
    expect(invoice.status).toBe("posted");
    expect(await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.companyId, f.companyId),
        eq(journalEntriesTable.reference, `POS:PRODAJA:${DAY}:E${f.unitId}`))))
      .toHaveLength(0);
  });
});
