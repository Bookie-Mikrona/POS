/**
 * Integracijski testi: razveljavitev plačila (void) in vpliv na dashboard
 *
 * Pokrivajo:
 * 1. GET /open-items pokaže povečan preostali znesek po void plačila
 * 2. GET /aged-analysis vrne pravilne buckete po void
 * 3. Robni primer: delno poravnan račun → void → preverba preostalega zneska
 *
 * Auth: requireAuth middleware je zamenjana z testno verzijo, ki injicira
 * testni userId brez Clerk seje.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock requireAuth PRED uvozom paymentsRouter ───────────────────────────────
const TEST_CLERK_USER_ID = "test-user-void-integ";

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
  invoicesTable,
  invoiceLinesTable,
  paymentsTable,
  paymentAllocationsTable,
  journalEntriesTable,
  journalEntryLinesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import paymentsRouter from "./payments";

// ── Minimalna express aplikacija za teste ──────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  // Osnoven error handler: vrne JSON za Express 5 async napake
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status ?? err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

// ── Pomožne funkcije ──────────────────────────────────────────────────────────

// Naključna davcna za vsak testni zagon (prepreči unique conflict med zagonom)
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

async function createTestCompany(label: string) {
  const [c] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_TST_VOID_${RUN_ID}_${label}`,
      naziv: `Test ${label}`,
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

async function createPeriod(companyId: string) {
  const [p] = await db
    .insert(accountingPeriodsTable)
    .values({
      companyId,
      name: "Test 2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "open",
    })
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

/** Ustvari takoj knjižen račun (status=posted) z eno vrstico pri 0% DDV */
async function createPostedInvoice(opts: {
  companyId: string;
  counterpartyId: string;
  periodId: string;
  arApAccountId: string;
  revenueAccountId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  grossAmount: number;
}) {
  const [inv] = await db
    .insert(invoicesTable)
    .values({
      companyId: opts.companyId,
      type: "issued",
      counterpartyId: opts.counterpartyId,
      periodId: opts.periodId,
      invoiceNumber: opts.invoiceNumber,
      invoiceDate: opts.invoiceDate,
      dueDate: opts.dueDate,
      status: "posted",
      arApAccountId: opts.arApAccountId,
      createdBy: TEST_CLERK_USER_ID,
    })
    .returning({ id: invoicesTable.id });

  // 0% DDV → bruto = quantity × unitPrice
  await db.insert(invoiceLinesTable).values({
    invoiceId: inv.id,
    description: "Testna storitev",
    quantity: "1.000",
    unitPrice: opts.grossAmount.toFixed(4),
    vatRate: "0.00",
    accountId: opts.revenueAccountId,
  });

  return inv.id;
}

/** Ustvari plačilo z že nastavljenim statusom 'posted' (brez temeljnice) */
async function createPostedPayment(opts: {
  companyId: string;
  counterpartyId: string;
  periodId: string;
  bankAccountId: string;
  arApAccountId: string;
  amount: number;
  paymentDate: string;
  allocations?: Array<{ invoiceId: string; allocatedAmount: number }>;
}) {
  const [pay] = await db
    .insert(paymentsTable)
    .values({
      companyId: opts.companyId,
      counterpartyId: opts.counterpartyId,
      periodId: opts.periodId,
      direction: "inbound",
      paymentDate: opts.paymentDate,
      amount: opts.amount.toFixed(2),
      bankAccountId: opts.bankAccountId,
      arApAccountId: opts.arApAccountId,
      status: "posted",
      createdBy: TEST_CLERK_USER_ID,
    })
    .returning({ id: paymentsTable.id });

  if (opts.allocations && opts.allocations.length > 0) {
    await db.insert(paymentAllocationsTable).values(
      opts.allocations.map((a) => ({
        paymentId: pay.id,
        invoiceId: a.invoiceId,
        allocatedAmount: a.allocatedAmount.toFixed(2),
      })),
    );
  }

  return pay.id;
}

/**
 * Počisti vse testne podatke za podano podjetje.
 * Vrstni red brisanja upošteva FK omejitve.
 */
async function cleanupCompany(companyId: string) {
  if (!companyId) return;

  // 1. Pridobi ID-je računov in temeljnic tega podjetja
  const invoices = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.companyId, companyId));
  const invoiceIds = invoices.map((i) => i.id);

  const payments = await db
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(eq(paymentsTable.companyId, companyId));
  const paymentIds = payments.map((p) => p.id);

  const entries = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  const entryIds = entries.map((e) => e.id);

  // 2. Brišemo otroke pred starši
  if (paymentIds.length > 0) {
    await db
      .delete(paymentAllocationsTable)
      .where(inArray(paymentAllocationsTable.paymentId, paymentIds));
  }
  if (invoiceIds.length > 0) {
    await db
      .delete(invoiceLinesTable)
      .where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
  }
  if (entryIds.length > 0) {
    await db
      .delete(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, entryIds));
  }

  // 3. Brišemo starše
  await db.delete(paymentsTable).where(eq(paymentsTable.companyId, companyId));
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  await db
    .delete(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));

  // 4. Brišemo kontni plan, partnerje, obdobja, vloge — vsi imajo company_id
  await db
    .delete(accountsTable)
    .where(eq(accountsTable.companyId, companyId));
  await db
    .delete(counterpartiesTable)
    .where(eq(counterpartiesTable.companyId, companyId));
  await db
    .delete(accountingPeriodsTable)
    .where(eq(accountingPeriodsTable.companyId, companyId));
  await db
    .delete(accountingRolesTable)
    .where(eq(accountingRolesTable.companyId, companyId));

  // 5. Podjetje samo
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
}

// ── Skupna testna infrastruktura ──────────────────────────────────────────────

let app: ReturnType<typeof buildApp>;
let companyId: string;
let periodId: string;
let bankAccountId: string;
let arAccountId: string;
let revenueAccountId: string;

beforeAll(async () => {
  app = buildApp();
  companyId = await createTestCompany("MAIN");
  await createRole(companyId);
  periodId = await createPeriod(companyId);
  bankAccountId = await createAccount(companyId, "1100", "asset");
  arAccountId = await createAccount(companyId, "1200", "asset");
  revenueAccountId = await createAccount(companyId, "7600", "revenue");
});

afterAll(async () => {
  await cleanupCompany(companyId);
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// DEBUG: preveri kaj vrne endpoint
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 1: polna poravnava → void → open-items
// ─────────────────────────────────────────────────────────────────────────────

describe("open-items po void plačila", () => {
  let invoiceId: string;
  let paymentId: string;
  const INVOICE_AMOUNT = 1000;

  beforeAll(async () => {
    const cpId = await createCounterparty(companyId, "Kupec A – open-items");

    invoiceId = await createPostedInvoice({
      companyId,
      counterpartyId: cpId,
      periodId,
      arApAccountId: arAccountId,
      revenueAccountId,
      invoiceNumber: "2026-OI-001",
      invoiceDate: "2026-01-15",
      dueDate: "2026-02-15",
      grossAmount: INVOICE_AMOUNT,
    });

    paymentId = await createPostedPayment({
      companyId,
      counterpartyId: cpId,
      periodId,
      bankAccountId,
      arApAccountId: arAccountId,
      amount: INVOICE_AMOUNT,
      paymentDate: "2026-01-20",
      allocations: [{ invoiceId, allocatedAmount: INVOICE_AMOUNT }],
    });

    // Označi račun kot plačan (kot bi to naredil POST /post handler)
    await db
      .update(invoicesTable)
      .set({ status: "paid" })
      .where(eq(invoicesTable.id, invoiceId));
  });

  it("pred void: račun je plačan, ne pojavi se v open-items", async () => {
    const res = await supertest(app)
      .get(`/companies/${companyId}/open-items`)
      .expect(200);

    const item = res.body.items?.find((i: any) => i.invoiceId === invoiceId);
    // Popolnoma poravnan račun ne sme biti v open-items
    expect(item).toBeUndefined();
  });

  it("po void: open-items prikaže račun s polnim preostalim zneskom", async () => {
    const voidRes = await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/void`)
      .send({ reason: "Napaka pri plačilu" })
      .expect(200);

    expect(voidRes.body.status).toBe("void");

    const res = await supertest(app)
      .get(`/companies/${companyId}/open-items`)
      .expect(200);

    const item = res.body.items?.find((i: any) => i.invoiceId === invoiceId);
    expect(item).toBeDefined();
    expect(parseFloat(item.remainingAmount)).toBeCloseTo(INVOICE_AMOUNT, 1);
    expect(parseFloat(item.allocatedAmount)).toBeCloseTo(0, 1);
    // totalRemaining vsaj vsebuje ta račun
    expect(parseFloat(res.body.totalRemaining)).toBeGreaterThanOrEqual(
      INVOICE_AMOUNT - 0.01,
    );
  });

  it("po void: plačilo ima status void", async () => {
    const [pay] = await db
      .select({ status: paymentsTable.status })
      .from(paymentsTable)
      .where(eq(paymentsTable.id, paymentId))
      .limit(1);
    expect(pay.status).toBe("void");
  });

  it("po void: račun se je vrnil na status posted", async () => {
    const [inv] = await db
      .select({ status: invoicesTable.status })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .limit(1);
    expect(inv.status).toBe("posted");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 2: void → aged-analysis pravilni bucketi
// ─────────────────────────────────────────────────────────────────────────────

describe("aged-analysis po void plačila", () => {
  let invoiceId: string;
  let paymentId: string;
  const INVOICE_AMOUNT = 500;
  // Zapadlost: 2026-01-10, referenčni datum: 2026-02-25
  // 2026-01-10 → 2026-02-25 = 46 dni → bucket31to60
  const INVOICE_DUE_DATE = "2026-01-10";
  const AS_OF_DATE = "2026-02-25";

  beforeAll(async () => {
    const cpId = await createCounterparty(companyId, "Kupec B – aged");

    invoiceId = await createPostedInvoice({
      companyId,
      counterpartyId: cpId,
      periodId,
      arApAccountId: arAccountId,
      revenueAccountId,
      invoiceNumber: "2026-AG-001",
      invoiceDate: "2025-12-20",
      dueDate: INVOICE_DUE_DATE,
      grossAmount: INVOICE_AMOUNT,
    });

    paymentId = await createPostedPayment({
      companyId,
      counterpartyId: cpId,
      periodId,
      bankAccountId,
      arApAccountId: arAccountId,
      amount: INVOICE_AMOUNT,
      paymentDate: "2026-01-15",
      allocations: [{ invoiceId, allocatedAmount: INVOICE_AMOUNT }],
    });

    await db
      .update(invoicesTable)
      .set({ status: "paid" })
      .where(eq(invoicesTable.id, invoiceId));
  });

  it("pred void: aged-analysis ne vsebuje neporavnanega zneska za tega partnerja", async () => {
    const res = await supertest(app)
      .get(`/companies/${companyId}/aged-analysis?type=issued&asOfDate=${AS_OF_DATE}`)
      .expect(200);

    const cpRow = res.body.rows?.find(
      (r: any) => r.counterpartyName === "Kupec B – aged",
    );
    if (cpRow) {
      expect(parseFloat(cpRow.total)).toBeCloseTo(0, 1);
    }
  });

  it("po void: aged-analysis pokaže znesek v bucketu 31–60 dni", async () => {
    await supertest(app)
      .post(`/companies/${companyId}/payments/${paymentId}/void`)
      .send({ reason: "Storno – test aged" })
      .expect(200);

    const res = await supertest(app)
      .get(`/companies/${companyId}/aged-analysis?type=issued&asOfDate=${AS_OF_DATE}`)
      .expect(200);

    const cpRow = res.body.rows?.find(
      (r: any) => r.counterpartyName === "Kupec B – aged",
    );

    expect(cpRow).toBeDefined();
    // 46 dni zamude → bucket31to60
    expect(parseFloat(cpRow.bucket31to60)).toBeCloseTo(INVOICE_AMOUNT, 1);
    // Ostali bucketi so 0
    expect(parseFloat(cpRow.current)).toBeCloseTo(0, 1);
    expect(parseFloat(cpRow.bucket1to30)).toBeCloseTo(0, 1);
    expect(parseFloat(cpRow.total)).toBeCloseTo(INVOICE_AMOUNT, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 3: delna poravnava → void → preostali odprti znesek
// ─────────────────────────────────────────────────────────────────────────────

describe("robni primer: delno poravnan račun → void → preostali znesek", () => {
  let invoiceId: string;
  let partialPaymentId: string;
  const INVOICE_AMOUNT = 1200;
  const PARTIAL_PAYMENT = 400; // 400 od 1200

  beforeAll(async () => {
    const cpId = await createCounterparty(companyId, "Kupec C – delna poravnava");

    invoiceId = await createPostedInvoice({
      companyId,
      counterpartyId: cpId,
      periodId,
      arApAccountId: arAccountId,
      revenueAccountId,
      invoiceNumber: "2026-DP-001",
      invoiceDate: "2026-02-01",
      dueDate: "2026-03-01",
      grossAmount: INVOICE_AMOUNT,
    });

    // Delno plačilo: 400 od 1200
    partialPaymentId = await createPostedPayment({
      companyId,
      counterpartyId: cpId,
      periodId,
      bankAccountId,
      arApAccountId: arAccountId,
      amount: PARTIAL_PAYMENT,
      paymentDate: "2026-02-10",
      allocations: [{ invoiceId, allocatedAmount: PARTIAL_PAYMENT }],
    });
    // Račun ostane "posted" (ni popolnoma poravnan)
  });

  it("pred void: open-items prikaže preostali znesek 800 (1200 − 400)", async () => {
    const res = await supertest(app)
      .get(`/companies/${companyId}/open-items`)
      .expect(200);

    const item = res.body.items?.find((i: any) => i.invoiceId === invoiceId);
    expect(item).toBeDefined();
    expect(parseFloat(item.remainingAmount)).toBeCloseTo(
      INVOICE_AMOUNT - PARTIAL_PAYMENT,
      1,
    );
    expect(parseFloat(item.allocatedAmount)).toBeCloseTo(PARTIAL_PAYMENT, 1);
  });

  it("po void delnega plačila: open-items prikaže polni znesek računa (1200)", async () => {
    await supertest(app)
      .post(`/companies/${companyId}/payments/${partialPaymentId}/void`)
      .send({ reason: "Napaka pri delnem plačilu" })
      .expect(200);

    const res = await supertest(app)
      .get(`/companies/${companyId}/open-items`)
      .expect(200);

    const item = res.body.items?.find((i: any) => i.invoiceId === invoiceId);
    expect(item).toBeDefined();
    expect(parseFloat(item.remainingAmount)).toBeCloseTo(INVOICE_AMOUNT, 1);
    expect(parseFloat(item.allocatedAmount)).toBeCloseTo(0, 1);
  });

  it("po void: račun ostane 'posted' (ni bil nikoli označen kot paid)", async () => {
    const [inv] = await db
      .select({ status: invoicesTable.status })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .limit(1);
    expect(inv.status).toBe("posted");
  });

  it("poravnave ostanejo v bazi po void (soft-delete: le status plačila se spremeni)", async () => {
    const allocs = await db
      .select({ id: paymentAllocationsTable.id })
      .from(paymentAllocationsTable)
      .where(eq(paymentAllocationsTable.paymentId, partialPaymentId));
    // Poravnave fizično ostanejo; odprti-postavke jih filtrirajo prek status='posted'
    expect(allocs.length).toBeGreaterThan(0);
  });
});
