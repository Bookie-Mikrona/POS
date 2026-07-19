/**
 * Integracijski testi: razveljavitev plačila (void) in vpliv na ledger/poročila
 *
 * Pokrivajo:
 * 1. Po void plačila ima ledger poizvedba za bančni konto neto saldo 0
 *    (original debit + storno kredit se izničita)
 * 2. Bruto bilanca (trial balance) pravilno prikaže oba vpisa (original + storno)
 * 3. Robni primer: void v drugem obdobju kot originalno plačilo — poizvedba
 *    po obdobju vrne pravilne vnose
 *
 * Zakaj so "reversed" vnosi vključeni:
 *   Ko void handler izvede storno, označi originalni vnos kot "reversed" in
 *   ustvari nov vnos s status "posted" (nasprotne strani). Ledger in poročila
 *   morajo vključiti oba — sicer neto saldo ni 0 ampak negativen.
 *
 * Izolacija: vsak describe blok ustvari lastno podjetje, da se vnosi
 * različnih testnih zagonov ne mešajo.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock requireAuth PRED uvozom routerjev ─────────────────────────────────────
const TEST_CLERK_USER_ID = "test-user-void-ledger-integ";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_CLERK_USER_ID;
    next();
  },
}));

// ── Uvoz po mocku ──────────────────────────────────────────────────────────────
import express from "express";
import supertest from "supertest";

import {
  db,
  pool,
  companiesTable,
  accountingRolesTable,
  accountingPeriodsTable,
  accountsTable,
  counterpartiesTable,
  paymentsTable,
  journalEntriesTable,
  journalEntryLinesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import paymentsRouter from "./payments";
import ledgerRouter from "./ledger";
import reportsRouter from "./reports";

// ── Minimalna express aplikacija ───────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  app.use(ledgerRouter);
  app.use(reportsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status ?? err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

const app = buildApp();

// ── Pomožne funkcije ──────────────────────────────────────────────────────────
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
let runSeq = 0;

async function createTestCompany(label: string) {
  runSeq++;
  const [c] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_TST_VL_${RUN_ID}_${label}_${runSeq}`,
      naziv: `Test Ledger ${label}`,
    })
    .returning({ id: companiesTable.id });
  return c.id;
}

async function createRole(companyId: string) {
  await db.insert(accountingRolesTable).values({
    clerkUserId: TEST_CLERK_USER_ID,
    companyId,
    role: "owner",
  });
}

async function createPeriod(
  companyId: string,
  label: string = "Test 2026",
  startDate: string = "2026-01-01",
  endDate: string = "2026-12-31",
) {
  const [p] = await db
    .insert(accountingPeriodsTable)
    .values({ companyId, name: label, startDate, endDate, status: "open" })
    .returning({ id: accountingPeriodsTable.id });
  return p.id;
}

async function createAccount(
  companyId: string,
  code: string,
  type: "asset" | "liability" | "equity" | "revenue" | "expense",
) {
  const [a] = await db
    .insert(accountsTable)
    .values({ companyId, code, name: `Konto ${code}`, type })
    .returning({ id: accountsTable.id });
  return a.id;
}

async function createCounterparty(companyId: string, name: string) {
  const [cp] = await db
    .insert(counterpartiesTable)
    .values({ companyId, type: "customer", name })
    .returning({ id: counterpartiesTable.id });
  return cp.id;
}

async function cleanupCompany(companyId: string) {
  if (!companyId) return;

  const entries = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  const entryIds = entries.map((e) => e.id);

  if (entryIds.length > 0) {
    await db
      .delete(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, entryIds));
  }
  await db.delete(paymentsTable).where(eq(paymentsTable.companyId, companyId));
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 1: Ledger neto saldo = 0 po void
// ─────────────────────────────────────────────────────────────────────────────

describe("ledger: neto saldo bančnega konta = 0 po void plačila", () => {
  let companyId: string;
  let periodId: string;
  let bankAccountId: string;
  let arAccountId: string;
  let paymentId: string;
  const AMOUNT = 750;

  beforeAll(async () => {
    companyId = await createTestCompany("LED1");
    await createRole(companyId);
    periodId = await createPeriod(companyId);
    bankAccountId = await createAccount(companyId, "1100", "asset");
    arAccountId = await createAccount(companyId, "1200", "asset");
    const cpId = await createCounterparty(companyId, "Testni partner LED1");

    // Ustvari in potrdi plačilo
    const createRes = await supertest(app)
      .post(`/companies/${companyId}/payments`)
      .send({
        counterpartyId: cpId,
        periodId,
        direction: "inbound",
        amount: AMOUNT,
        paymentDate: "2026-03-10",
        bankAccountId,
        arApAccountId: arAccountId,
        reference: "LEDGER-TEST-001",
      })
      .expect(201);
    paymentId = createRes.body.id;

    await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/post`)
      .expect(200);
  });

  afterAll(async () => {
    await cleanupCompany(companyId);
  });

  it("po knjiženju: ledger prikaže debit na bančnem kontu (neto = AMOUNT)", async () => {
    const res = await supertest(app)
      .get(`/companies/${companyId}/ledger?accountId=${bankAccountId}`)
      .expect(200);

    expect(res.body.lines.length).toBeGreaterThanOrEqual(1);
    const totalDebit = parseFloat(res.body.totalDebit);
    const totalCredit = parseFloat(res.body.totalCredit);
    expect(totalDebit - totalCredit).toBeCloseTo(AMOUNT, 1);
  });

  it("po void: ledger prikaže oba vnosa (original + storno), neto saldo = 0", async () => {
    await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/void`)
      .send({ reason: "Test void ledger" })
      .expect(200);

    const res = await supertest(app)
      .get(`/companies/${companyId}/ledger?accountId=${bankAccountId}`)
      .expect(200);

    // Pričakujemo vsaj 2 vrstici: original + storno
    expect(res.body.lines.length).toBeGreaterThanOrEqual(2);

    const totalDebit = parseFloat(res.body.totalDebit);
    const totalCredit = parseFloat(res.body.totalCredit);

    // Neto saldo mora biti 0: original debit (750) + storno kredit (750)
    expect(totalDebit).toBeCloseTo(AMOUNT, 1);
    expect(totalCredit).toBeCloseTo(AMOUNT, 1);
    expect(totalDebit - totalCredit).toBeCloseTo(0, 1);
  });

  it("po void: zadnje tekoče stanje (runningBalance) je 0", async () => {
    const res = await supertest(app)
      .get(`/companies/${companyId}/ledger?accountId=${bankAccountId}`)
      .expect(200);

    const lines: any[] = res.body.lines;
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const lastBalance = parseFloat(lines[lines.length - 1].runningBalance);
    expect(lastBalance).toBeCloseTo(0, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 2: Bruto bilanca (trial balance) po void
// ─────────────────────────────────────────────────────────────────────────────

describe("trial balance: bančni konto neto = 0 po void plačila", () => {
  let companyId: string;
  let periodId: string;
  let bankAccountId: string;
  let arAccountId: string;
  let paymentId: string;
  const AMOUNT = 500;

  beforeAll(async () => {
    companyId = await createTestCompany("LED2");
    await createRole(companyId);
    periodId = await createPeriod(companyId);
    bankAccountId = await createAccount(companyId, "1100", "asset");
    arAccountId = await createAccount(companyId, "1200", "asset");
    const cpId = await createCounterparty(companyId, "Testni partner LED2");

    const createRes = await supertest(app)
      .post(`/companies/${companyId}/payments`)
      .send({
        counterpartyId: cpId,
        periodId,
        direction: "inbound",
        amount: AMOUNT,
        paymentDate: "2026-04-01",
        bankAccountId,
        arApAccountId: arAccountId,
        reference: "TB-TEST-001",
      })
      .expect(201);
    paymentId = createRes.body.id;

    await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/post`)
      .expect(200);
  });

  afterAll(async () => {
    await cleanupCompany(companyId);
  });

  it("po knjiženju: balance-sheet prikaže bančni konto z pozitivnim saldom", async () => {
    const res = await supertest(app)
      .get(`/companies/${companyId}/reports/balance-sheet`)
      .expect(200);

    const aktivaSections: any[] = res.body.current.aktiva.sections ?? [];
    let found = false;
    for (const sec of aktivaSections) {
      for (const item of sec.items) {
        if (item.accountId === bankAccountId) {
          expect(parseFloat(item.balance)).toBeGreaterThan(0);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("po void: balance-sheet prikaže neto saldo 0 za bančni konto", async () => {
    await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/void`)
      .send({ reason: "Test void trial balance" })
      .expect(200);

    const res = await supertest(app)
      .get(`/companies/${companyId}/reports/balance-sheet`)
      .expect(200);

    // Po void: neto saldo = 0 → konto bodisi ni v poročilu ali kaže 0.00
    const aktivaSections: any[] = res.body.current.aktiva.sections ?? [];
    let bankBalance = 0;
    for (const sec of aktivaSections) {
      for (const item of sec.items) {
        if (item.accountId === bankAccountId) {
          bankBalance += parseFloat(item.balance);
        }
      }
    }
    expect(bankBalance).toBeCloseTo(0, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 3: Robni primer — void v drugem obdobju kot originalno plačilo
// ─────────────────────────────────────────────────────────────────────────────

describe("robni primer: void v drugem obdobju kot originalno plačilo", () => {
  let companyId: string;
  let period1Id: string;
  let period2Id: string;
  let bankAccountId: string;
  let arAccountId: string;
  let paymentId: string;
  let linkedEntryId: string;
  const AMOUNT = 300;

  beforeAll(async () => {
    companyId = await createTestCompany("LED3");
    await createRole(companyId);
    period1Id = await createPeriod(companyId, "Test 2026", "2026-01-01", "2026-12-31");
    period2Id = await createPeriod(companyId, "Test 2027", "2027-01-01", "2027-12-31");
    bankAccountId = await createAccount(companyId, "1100", "asset");
    arAccountId = await createAccount(companyId, "1200", "asset");
    const cpId = await createCounterparty(companyId, "Testni partner LED3");

    // Ustvari in potrdi plačilo v 1. obdobju (2026)
    const createRes = await supertest(app)
      .post(`/companies/${companyId}/payments`)
      .send({
        counterpartyId: cpId,
        periodId: period1Id,
        direction: "inbound",
        amount: AMOUNT,
        paymentDate: "2026-06-15",
        bankAccountId,
        arApAccountId: arAccountId,
        reference: "XPERIOD-TEST-001",
      })
      .expect(201);
    paymentId = createRes.body.id;

    const postRes = await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/post`)
      .expect(200);
    linkedEntryId = postRes.body.linkedEntryId;
  });

  afterAll(async () => {
    await cleanupCompany(companyId);
  });

  it("po knjiženju v 2026: ledger za 1. obdobje prikaže debit na banki", async () => {
    const res = await supertest(app)
      .get(
        `/companies/${companyId}/ledger?accountId=${bankAccountId}&periodId=${period1Id}`,
      )
      .expect(200);

    const totalDebit = parseFloat(res.body.totalDebit);
    const totalCredit = parseFloat(res.body.totalCredit);
    expect(totalDebit - totalCredit).toBeCloseTo(AMOUNT, 1);
  });

  it("void v 2027: storno temeljnica je v 2. obdobju, original ostane v 1.", async () => {
    const voidRes = await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/void`)
      .send({ reason: "Storno v novem letu", periodId: period2Id })
      .expect(200);
    expect(voidRes.body.status).toBe("void");

    // Preverimo, da originalna temeljnica je zdaj "reversed" in v 1. obdobju
    const [origEntry] = await db
      .select({
        id: journalEntriesTable.id,
        periodId: journalEntriesTable.periodId,
        status: journalEntriesTable.status,
      })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, linkedEntryId))
      .limit(1);

    expect(origEntry).toBeDefined();
    expect(origEntry!.status).toBe("reversed");
    expect(origEntry!.periodId).toBe(period1Id);

    // Storno temeljnica: reversalOf = linkedEntryId, status = posted, periodId = period2Id
    const allEntries = await db
      .select({
        id: journalEntriesTable.id,
        periodId: journalEntriesTable.periodId,
        status: journalEntriesTable.status,
        reversalOf: journalEntriesTable.reversalOf,
      })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));

    const reversalEntry = allEntries.find((e) => e.reversalOf === linkedEntryId);
    expect(reversalEntry).toBeDefined();
    expect(reversalEntry!.status).toBe("posted");
    expect(reversalEntry!.periodId).toBe(period2Id);
  });

  it("ledger za 1. obdobje: prikaže samo original debit (reversed vnos)", async () => {
    const res = await supertest(app)
      .get(
        `/companies/${companyId}/ledger?accountId=${bankAccountId}&periodId=${period1Id}`,
      )
      .expect(200);

    const totalDebit = parseFloat(res.body.totalDebit);
    const totalCredit = parseFloat(res.body.totalCredit);
    // V 1. obdobju je samo original entry (DEBIT AMOUNT, status reversed)
    expect(totalDebit).toBeCloseTo(AMOUNT, 1);
    expect(totalCredit).toBeCloseTo(0, 1);
  });

  it("ledger za 2. obdobje: prikaže samo storno kredit (posted vnos)", async () => {
    const res = await supertest(app)
      .get(
        `/companies/${companyId}/ledger?accountId=${bankAccountId}&periodId=${period2Id}`,
      )
      .expect(200);

    const totalDebit = parseFloat(res.body.totalDebit);
    const totalCredit = parseFloat(res.body.totalCredit);
    // V 2. obdobju je samo storno entry (CREDIT AMOUNT, status posted)
    expect(totalDebit).toBeCloseTo(0, 1);
    expect(totalCredit).toBeCloseTo(AMOUNT, 1);
  });

  it("ledger brez filtra po obdobju: neto saldo = 0 (original + storno skupaj)", async () => {
    const res = await supertest(app)
      .get(`/companies/${companyId}/ledger?accountId=${bankAccountId}`)
      .expect(200);

    const totalDebit = parseFloat(res.body.totalDebit);
    const totalCredit = parseFloat(res.body.totalCredit);
    expect(totalDebit - totalCredit).toBeCloseTo(0, 1);
  });
});

afterAll(async () => {
  await pool.end();
});
