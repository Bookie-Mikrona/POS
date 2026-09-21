/**
 * Integracijski test: receipt_date (D4-2) v vat_ledger
 *
 * Pokriva:
 * 1. Prejeti račun z ločenim receiptDate (P4) in documentDate (P5):
 *    → vat_ledger.receipt_date = receiptDate (NE documentDate)
 * 2. Fallback: prejeti račun brez receiptDate:
 *    → vat_ledger.receipt_date = documentDate
 * 3. Izhodni DDV (KIR, direction=OUT): receipt_date ostane NULL
 *
 * §67 ZDDV-1 — D4-2: datum fizičnega prejema računa je P4 v KPR evidenci;
 * datum listine (datum na računu) je P5 — dve ločeni vrednosti.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock requireAuth PRED uvozom routerjev ─────────────────────────────────────
const TEST_CLERK_USER_ID = "test-user-vat-receipt-date";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_CLERK_USER_ID;
    next();
  },
}));

// ── Uvoz po mocku ──────────────────────────────────────────────────────────────
import express from "express";
import supertest from "supertest";
import { sql, eq, inArray } from "drizzle-orm";

import {
  db,
  pool,
  companiesTable,
  accountingRolesTable,
  accountingPeriodsTable,
  accountsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  vatLedgerTable,
} from "@workspace/db";
import journalEntriesRouter from "./journalEntries";

// ── Minimalna express aplikacija ───────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(journalEntriesRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status ?? err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

const app = buildApp();

// ── Pomožne funkcije ──────────────────────────────────────────────────────────
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
let runSeq = 0;

async function createCompany(label: string) {
  runSeq++;
  const [c] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_TST_RD_${RUN_ID}_${label}_${runSeq}`,
      naziv: `Test ReceiptDate ${label}`,
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

/** Vrne pravi vat_code_id za P22 (IN, 22%) iz DB (da ne hardkodiramo UUID). */
async function fetchInVatCodeId(): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM vat_code WHERE code = 'P22' AND direction = 'IN' LIMIT 1`
  );
  return rows.rows[0]?.id ?? "";
}

/** Vrne pravi vat_code_id za S22 (OUT, 22%) iz DB (da ne hardkodiramo UUID). */
async function fetchOutVatCodeId(): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM vat_code WHERE code = 'S22' AND direction = 'OUT' LIMIT 1`
  );
  return rows.rows[0]?.id ?? "";
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
let companyIds: string[] = [];

afterAll(async () => {
  if (companyIds.length === 0) { await pool.end(); return; }

  // Počisti po testih — vrstni red: vatLedger → entryLines → entries → periods → accounts → roles → companies
  const entryIds = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(inArray(journalEntriesTable.companyId, companyIds));
  const eIds = entryIds.map(e => e.id);

  if (eIds.length > 0) {
    await db.delete(vatLedgerTable).where(inArray(vatLedgerTable.journalEntryId, eIds));
    await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, eIds));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, eIds));
  }
  await db.delete(accountingPeriodsTable).where(inArray(accountingPeriodsTable.companyId, companyIds));
  await db.delete(accountsTable).where(inArray(accountsTable.companyId, companyIds));
  await db.delete(accountingRolesTable).where(inArray(accountingRolesTable.companyId, companyIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  await pool.end();
});

// ── Testi ────────────────────────────────────────────────────────────────────

describe("vat_ledger.receipt_date — D4-2 ločen od datuma dokumenta", () => {
  let companyId: string;
  let periodId: string;
  let expenseAccId: string;
  let payableAccId: string;
  let inVatCodeId: string;

  beforeAll(async () => {
    companyId = await createCompany("KPR");
    companyIds.push(companyId);
    await createRole(companyId);
    periodId = await createPeriod(companyId);
    expenseAccId = await createAccount(companyId, "4000", "expense");
    payableAccId = await createAccount(companyId, "2200", "liability");
    inVatCodeId = await fetchInVatCodeId();
    if (!inVatCodeId) {
      throw new Error("P22 vat_code (IN, 22 %) ni najden v testni bazi");
    }
  });

  it("P4 (receipt_date) se nastavi na receiptDate, NE na documentDate (P5)", async () => {
    const P4 = "2026-07-15"; // datum fizičnega prejema (kasnejši)
    const P5 = "2026-06-30"; // datum na računu (starejši)

    const res = await supertest(app)
      .post(`/companies/${companyId}/entries`)
      .send({
        periodId,
        entryDate: P4,
        documentDate: P5,
        receiptDate: P4,
        description: "Test KPR P4≠P5",
        autoPost: true,
        lines: [
          {
            accountId: expenseAccId,
            side: "debit",
            amount: 1000,
            vatCodeId: inVatCodeId,
            vatAmount: 220,
            vatDeductionPercent: 100,
          },
          {
            accountId: payableAccId,
            side: "credit",
            amount: 1000,
          },
        ],
      });

    expect(res.status, `POST /entries failed: ${JSON.stringify(res.body)}`).toBe(201);

    const entryId = res.body.id as string;

    const [vlRow] = await db
      .select({
        receiptDate: vatLedgerTable.receiptDate,
        invoiceDate: vatLedgerTable.invoiceDate,
        direction: vatLedgerTable.direction,
      })
      .from(vatLedgerTable)
      .where(eq(vatLedgerTable.journalEntryId, entryId));

    expect(vlRow, "vat_ledger vrstica mora obstajati").toBeDefined();
    expect(vlRow.direction).toBe("IN");
    // P4 = datum fizičnega prejema → mora biti P4, NE P5
    expect(vlRow.receiptDate).toBe(P4);
    // P5 = datum listine → invoice_date
    expect(vlRow.invoiceDate).toBe(P5);
    // P4 ≠ P5 — ključna asercija
    expect(vlRow.receiptDate).not.toBe(vlRow.invoiceDate);
  });

  it("fallback: brez receiptDate → receipt_date = documentDate (obstoječi zapisi)", async () => {
    const P5 = "2026-06-28"; // datum dokumenta

    const res = await supertest(app)
      .post(`/companies/${companyId}/entries`)
      .send({
        periodId,
        entryDate: P5,
        documentDate: P5,
        // receiptDate NI podan → fallback
        description: "Test KPR fallback brez receiptDate",
        autoPost: true,
        lines: [
          {
            accountId: expenseAccId,
            side: "debit",
            amount: 500,
            vatCodeId: inVatCodeId,
            vatAmount: 110,
            vatDeductionPercent: 100,
          },
          {
            accountId: payableAccId,
            side: "credit",
            amount: 500,
          },
        ],
      });

    expect(res.status, `POST /entries failed: ${JSON.stringify(res.body)}`).toBe(201);

    const entryId = res.body.id as string;

    const [vlRow] = await db
      .select({
        receiptDate: vatLedgerTable.receiptDate,
        invoiceDate: vatLedgerTable.invoiceDate,
      })
      .from(vatLedgerTable)
      .where(eq(vatLedgerTable.journalEntryId, entryId));

    expect(vlRow, "vat_ledger vrstica mora obstajati").toBeDefined();
    // Fallback: receiptDate ni podan → receipt_date = documentDate
    expect(vlRow.receiptDate).toBe(P5);
    expect(vlRow.invoiceDate).toBe(P5);
  });
});

describe("vat_ledger.receipt_date — izhodni DDV (KIR) ostane NULL", () => {
  let companyId: string;
  let periodId: string;
  let revenueAccId: string;
  let receivableAccId: string;
  let outVatCodeId: string;

  beforeAll(async () => {
    companyId = await createCompany("KIR");
    companyIds.push(companyId);
    await createRole(companyId);
    periodId = await createPeriod(companyId);
    revenueAccId = await createAccount(companyId, "7600", "revenue");
    receivableAccId = await createAccount(companyId, "1200", "asset");
    // Poišči S22 iz DB (direction=OUT)
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM vat_code WHERE code = 'S22' AND direction = 'OUT' LIMIT 1`
    );
    outVatCodeId = rows.rows[0]?.id ?? "";
  });

  it("KIR (direction=OUT): receipt_date mora biti NULL", async () => {
    if (!outVatCodeId) {
      console.warn("S22 vat_code ni najden — test preskočen");
      return;
    }

    const invoiceDate = "2026-07-10";

    const res = await supertest(app)
      .post(`/companies/${companyId}/entries`)
      .send({
        periodId,
        entryDate: invoiceDate,
        documentDate: invoiceDate,
        receiptDate: invoiceDate, // vnesel uporabnik, a za OUT mora biti NULL
        description: "Test KIR receipt_date=NULL",
        autoPost: true,
        lines: [
          {
            accountId: receivableAccId,
            side: "debit",
            amount: 1000,
          },
          {
            accountId: revenueAccId,
            side: "credit",
            amount: 1000,
            vatCodeId: outVatCodeId,
            vatAmount: 220,
            vatDeductionPercent: 100,
          },
        ],
      });

    expect(res.status, `POST /entries failed: ${JSON.stringify(res.body)}`).toBe(201);

    const entryId = res.body.id as string;

    const [vlRow] = await db
      .select({
        receiptDate: vatLedgerTable.receiptDate,
        direction: vatLedgerTable.direction,
      })
      .from(vatLedgerTable)
      .where(eq(vatLedgerTable.journalEntryId, entryId));

    expect(vlRow, "vat_ledger vrstica mora obstajati").toBeDefined();
    expect(vlRow.direction).toBe("OUT");
    // Za izhodni DDV (KIR) receipt_date mora biti NULL — §67 ZDDV-1 velja samo za KPR
    expect(vlRow.receiptDate).toBeNull();
  });
});
