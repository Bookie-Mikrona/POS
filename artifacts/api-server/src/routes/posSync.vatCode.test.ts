/**
 * Integracijski test #138: POS→ERP temeljnica dobí vatCodeId → vat_ledger (KIR)
 *
 * Pokriva:
 * 1. POS:PRODAJA z nastavljenim vatCodeId za 22 % → journal_entry_lines.vat_code_id nastavljen,
 *    ob potrditvi (POST .../post) → vat_ledger dobi direction=OUT vrstico
 * 2. POS:PRODAJA brez nastavitve vatCodeId (NULL) → temeljnica nastane, vat_ledger ostane prazen
 *    za to stopnjo (fallback — nič se ne poruši, samo manjka KIR zapis)
 * 3. Uravnoteženost temeljnic NI prizadeta v nobeni varianti
 *
 * §135 — KIR: izhodni DDV iz POS prodaje mora priti v vat_ledger.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_CLERK_USER_ID = "test-user-pos-vat-sync";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_CLERK_USER_ID;
    next();
  },
}));

import express from "express";
import supertest from "supertest";
import { sql, eq, and, inArray } from "drizzle-orm";

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
  posBookingSettingsTable,
} from "@workspace/db";
import journalEntriesRouter from "./journalEntries";

// ── App ───────────────────────────────────────────────────────────────────────
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

// ── Globalni šifrant ──────────────────────────────────────────────────────────
// S22 (OUT, 22 %) — iz 002-vat-code-seed.sql; preverimo iz DB
let VAT_CODE_S22_ID = "";

// ── Pomožne funkcije ──────────────────────────────────────────────────────────
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
let seq = 0;

async function mkCompany() {
  const [c] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_PS_${RUN_ID}_${++seq}`,
    naziv: `Test POS sync ${seq}`,
  }).returning({ id: companiesTable.id });
  return c.id;
}

async function mkRole(companyId: string) {
  await db.insert(accountingRolesTable).values({ clerkUserId: TEST_CLERK_USER_ID, companyId, role: "owner" });
}

async function mkPeriod(companyId: string) {
  const [p] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "Test 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  return p.id;
}

async function mkAccount(companyId: string, code: string, type: "asset" | "liability" | "equity" | "revenue" | "expense") {
  const [a] = await db.insert(accountsTable).values({
    companyId, code, name: `Konto ${code}`, type,
  }).returning({ id: accountsTable.id });
  return a.id;
}

/** Ustvari in potrdi temeljnico prek HTTP; vrne { entryId, status }. */
async function createAndPostEntry(companyId: string, periodId: string, lines: object[]) {
  const res = await supertest(app)
    .post(`/companies/${companyId}/entries`)
    .send({
      periodId,
      entryDate: "2026-07-01",
      documentDate: "2026-07-01",
      description: "POS test knjižba",
      autoPost: true,
      lines,
    });
  return res;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
let companyIds: string[] = [];

afterAll(async () => {
  if (companyIds.length > 0) {
    const entries = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(inArray(journalEntriesTable.companyId, companyIds));
    const eIds = entries.map(e => e.id);
    if (eIds.length > 0) {
      await db.delete(vatLedgerTable).where(inArray(vatLedgerTable.journalEntryId, eIds));
      await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, eIds));
      await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, eIds));
    }
    await db.delete(accountingPeriodsTable).where(inArray(accountingPeriodsTable.companyId, companyIds));
    await db.delete(accountsTable).where(inArray(accountsTable.companyId, companyIds));
    await db.delete(accountingRolesTable).where(inArray(accountingRolesTable.companyId, companyIds));
    await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  }
  await pool.end();
});

// ── Pridobi S22 id iz DB ──────────────────────────────────────────────────────
beforeAll(async () => {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM vat_code WHERE code = 'S22' AND direction = 'OUT' LIMIT 1`
  );
  VAT_CODE_S22_ID = rows.rows[0]?.id ?? "";
});

// ── Testi ─────────────────────────────────────────────────────────────────────

describe("#138: POS DDV vrstica z vatCodeId → vat_ledger KIR vpis", () => {
  let companyId: string;
  let periodId: string;
  let revenueAccId: string;
  let vatAccId: string;
  let cashAccId: string;

  beforeAll(async () => {
    companyId = await mkCompany();
    companyIds.push(companyId);
    await mkRole(companyId);
    periodId = await mkPeriod(companyId);
    revenueAccId = await mkAccount(companyId, "7600", "revenue");
    vatAccId    = await mkAccount(companyId, "2600", "liability");
    cashAccId   = await mkAccount(companyId, "1000", "asset");
  });

  it("DDV vrstica z vatCodeId → ob potrditvi nastane vat_ledger OUT vrstica", async () => {
    if (!VAT_CODE_S22_ID) { console.warn("S22 ni najden, test preskočen"); return; }

    // Simuliramo POS:PRODAJA strukturo: gotovina debet, prihodki + DDV kredit
    // Skupaj bruto 1220 = 1000 neto + 220 DDV 22%
    const res = await createAndPostEntry(companyId, periodId, [
      // Debet: gotovina
      { accountId: cashAccId, side: "debit", amount: 1220 },
      // Kredit: prihodki (neto)
      { accountId: revenueAccId, side: "credit", amount: 1000 },
      // Kredit: DDV 22% — vatCodeId nastavi KIR vrstico
      {
        accountId: vatAccId,
        side: "credit",
        amount: 220,
        vatCodeId: VAT_CODE_S22_ID,
        vatAmount: 220,
        vatDeductionPercent: 100,
      },
    ]);

    expect(res.status, `POST failed: ${JSON.stringify(res.body)}`).toBe(201);
    const entryId = res.body.id as string;

    // Potrdi: journal_entry_lines DDV vrstica ima vatCodeId
    const lines = await db.select({
      vatCodeId: journalEntryLinesTable.vatCodeId,
      vatAmount: journalEntryLinesTable.vatAmount,
      amount: journalEntryLinesTable.amount,
      side: journalEntryLinesTable.side,
    }).from(journalEntryLinesTable)
      .where(and(
        eq(journalEntryLinesTable.entryId, entryId),
        eq(journalEntryLinesTable.accountId, vatAccId),
      ));

    expect(lines).toHaveLength(1);
    expect(lines[0].vatCodeId).toBe(VAT_CODE_S22_ID);
    expect(parseFloat(lines[0].vatAmount ?? "0")).toBeCloseTo(220, 1);

    // Potrdi: vat_ledger ima OUT vrstico z vatCodeId = S22
    const vlRows = await db.select({
      direction: vatLedgerTable.direction,
      vatAmount: vatLedgerTable.vatAmount,
      baseAmount: vatLedgerTable.baseAmount,
    }).from(vatLedgerTable)
      .where(eq(vatLedgerTable.journalEntryId, entryId));

    expect(vlRows.length, "vat_ledger mora imeti vsaj 1 vrstico").toBeGreaterThan(0);
    const outRow = vlRows.find(r => r.direction === "OUT");
    expect(outRow, "mora obstajati OUT (KIR) vrstica").toBeDefined();
    expect(parseFloat(outRow!.vatAmount)).toBeCloseTo(220, 1);
    expect(parseFloat(outRow!.baseAmount)).toBeCloseTo(220, 1); // baseAmount = amount DDV vrstice
  });

  it("Uravnoteženost temeljnice NI prizadeta — debet = kredit", async () => {
    if (!VAT_CODE_S22_ID) return;

    const res = await createAndPostEntry(companyId, periodId, [
      { accountId: cashAccId, side: "debit", amount: 1220 },
      { accountId: revenueAccId, side: "credit", amount: 1000 },
      { accountId: vatAccId, side: "credit", amount: 220,
        vatCodeId: VAT_CODE_S22_ID, vatAmount: 220, vatDeductionPercent: 100 },
    ]);

    expect(res.status).toBe(201);
    const entryId = res.body.id as string;

    const lines = await db.select({ side: journalEntryLinesTable.side, amount: journalEntryLinesTable.amount })
      .from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entryId));

    const debit  = lines.filter(l => l.side === "debit").reduce((s, l) => s + parseFloat(l.amount), 0);
    const credit = lines.filter(l => l.side === "credit").reduce((s, l) => s + parseFloat(l.amount), 0);
    expect(Math.abs(debit - credit)).toBeLessThan(0.01);
  });
});

describe("#138: Brez vatCodeId (fallback) — temeljnica nastane, vat_ledger prazen", () => {
  let companyId: string;
  let periodId: string;
  let revenueAccId: string;
  let vatAccId: string;
  let cashAccId: string;

  beforeAll(async () => {
    companyId = await mkCompany();
    companyIds.push(companyId);
    await mkRole(companyId);
    periodId = await mkPeriod(companyId);
    revenueAccId = await mkAccount(companyId, "7600", "revenue");
    vatAccId    = await mkAccount(companyId, "2600", "liability");
    cashAccId   = await mkAccount(companyId, "1000", "asset");
  });

  it("brez vatCodeId: temeljnica se ustvari, vat_ledger NE dobi KIR vrstice", async () => {
    const res = await createAndPostEntry(companyId, periodId, [
      { accountId: cashAccId, side: "debit", amount: 1220 },
      { accountId: revenueAccId, side: "credit", amount: 1000 },
      // vatCodeId NI nastavljen — simulira manjkajočo preslikavo v pos_booking_settings
      { accountId: vatAccId, side: "credit", amount: 220 },
    ]);

    expect(res.status, `Temeljnica mora nastati tudi brez vatCodeId: ${JSON.stringify(res.body)}`).toBe(201);
    const entryId = res.body.id as string;

    // vat_ledger mora biti prazen — ni vatCodeId, ni KIR vpisa
    const vlRows = await db.select({ id: vatLedgerTable.id })
      .from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, entryId));
    expect(vlRows).toHaveLength(0);
  });
});
