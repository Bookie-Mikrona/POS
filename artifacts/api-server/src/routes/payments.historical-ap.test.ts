import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const USER = "test-ap-evidence-user";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = USER; next(); },
}));
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, invoicesTable, journalEntriesTable,
  journalEntryLinesTable, bookieOldApSettlementsTable,
} from "@workspace/db";
import paymentsRouter from "./payments";
import partnerLedgerRouter from "./partnerLedger";

const app = express();
app.use(express.json(), paymentsRouter, partnerLedgerRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
let companyId: string;
let partnerId: string;
let accountId: string;
let expenseId: string;
let periodId: string;
let invoiceId: string;
let sourceLineId: string;
const entryIds: string[] = [];

async function invoice(number: string, source: string, amount: string, status: "posted" | "draft") {
  const date = status === "posted" ? "2025-01-03" : "2026-01-03";
  const [entry] = await db.insert(journalEntriesTable).values({
    companyId, periodId, reference: `BOOKIE-OLD/K2/${date.slice(0, 4)}/30/${number}`,
    description: "TEST AP evidence", entryDate: date, documentDate: date,
    status, sourceType: "manual", createdBy: USER,
  }).returning();
  entryIds.push(entry.id);
  const [credit] = await db.insert(journalEntryLinesTable).values({
    entryId: entry.id, accountId, partnerId, side: "credit", amount, sequence: 1,
    description: `TEST [Bookie Old GLAVNA #${source}, konto 2200000, partner 999 TEST]`,
  }).returning();
  await db.insert(journalEntryLinesTable).values({
    entryId: entry.id, accountId: expenseId, side: "debit", amount, sequence: 2,
  });
  const [inv] = await db.insert(invoicesTable).values({
    companyId, periodId, counterpartyId: partnerId, type: "received", invoiceNumber: number,
    invoiceDate: date, dueDate: date, status, sourceType: "bookie-old",
    linkedEntryId: entry.id, historicalReference: entry.reference,
    historicalGross: amount, arApAccountId: accountId, createdBy: USER,
  }).returning();
  return { invoiceId: inv.id, lineId: credit.id };
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TEST_AP_${Date.now()}`, naziv: "TEST historical AP evidence",
  }).returning();
  companyId = company.id;
  await db.insert(accountingRolesTable).values({ companyId, clerkUserId: USER, role: "owner" });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "TEST AP", startDate: "2025-01-01", endDate: "2026-12-31", status: "open",
  }).returning();
  periodId = period.id;
  const [ap, expense] = await db.insert(accountsTable).values([
    { companyId, code: "2200000", name: "TEST suppliers", type: "liability", isOpenItem: true },
    { companyId, code: "4000000", name: "TEST expense", type: "expense" },
  ]).returning();
  accountId = ap.id; expenseId = expense.id;
  const [partner] = await db.insert(counterpartiesTable).values({
    companyId, type: "supplier", name: "TEST supplier",
  }).returning();
  partnerId = partner.id;
  const partial = await invoice("000001", "1001", "100.00", "posted");
  invoiceId = partial.invoiceId; sourceLineId = partial.lineId;
  const full = await invoice("000002", "1002", "40.00", "posted");
  await invoice("000003", "1003", "60.00", "draft");
  await db.insert(bookieOldApSettlementsTable).values([
    {
      companyId, invoiceId, sourceLineId: "1001", originalAmount: "100.00",
      closedAmount: "70.00", remainingAmount: "30.00", sourceAsOf: "2026-09-29",
      sourceSha256: "a".repeat(64),
      evidence: [
        { closingId: "501", otherLineId: "2001", amount: "30.00", recordedDate: "2025-01-25" },
        { closingId: "502", otherLineId: "2002", amount: "40.00", recordedDate: "2/25/2025" },
      ],
    },
    {
      companyId, invoiceId: full.invoiceId, sourceLineId: "1002", originalAmount: "40.00",
      closedAmount: "40.00", remainingAmount: "0.00", sourceAsOf: "2026-09-29",
      sourceSha256: "b".repeat(64),
      evidence: [{ closingId: "503", otherLineId: "2003", amount: "40.00", recordedDate: "1/25/2025" }],
    },
  ]);
});

afterAll(async () => {
  if (companyId) {
    await db.delete(bookieOldApSettlementsTable).where(eq(bookieOldApSettlementsTable.companyId, companyId));
    await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
    for (const id of entryIds) await db.delete(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, id));
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
  await pool.end();
});

describe("historical supplier closing evidence", () => {
  it("subtracts all partial source links, omits fully paid invoices and excludes drafts", async () => {
    const response = await request(app).get(`/companies/${companyId}/open-items`)
      .query({ type: "received", asOfDate: "2026-10-02" }).expect(200);
    expect(response.body.totalRemaining).toBe("30.00");
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ invoiceId, allocatedAmount: "70.00", remainingAmount: "30.00" });
  });
  it("uses individual closing dates rather than the later snapshot date", async () => {
    const response = await request(app).get(`/companies/${companyId}/open-items`)
      .query({ type: "received", asOfDate: "2025-02-01" }).expect(200);
    expect(response.body.totalRemaining).toBe("70.00");
  });
  it("gives the same remainder in the dashboard aging and partner card", async () => {
    const aged = await request(app).get(`/companies/${companyId}/aged-analysis`)
      .query({ type: "received", asOfDate: "2026-10-02" }).expect(200);
    expect(aged.body.totals.total).toBe("30.00");
    const card = await request(app).get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId, accountId, dateTo: "2026-10-02" }).expect(200);
    const line = card.body.lines.find((row: any) => row.lineId === sourceLineId);
    expect(line.openCredit).toBe("30.00");
    expect(line.closings).toHaveLength(2);
    expect(line.closings.every((close: any) => close.source === "bookie_old_ap")).toBe(true);
  });
  it("retains tenant authorization", async () => {
    await request(app).get(`/companies/00000000-0000-4000-8000-000000000001/open-items`)
      .query({ type: "received" }).expect(403);
  });
  it("does not silently present gross as open when an imported supplier invoice has no verified snapshot", async () => {
    await invoice("000004", "1004", "25.00", "posted");
    const response = await request(app).get(`/companies/${companyId}/open-items`)
      .query({ type: "received", asOfDate: "2026-10-02" }).expect(409);
    expect(response.body.error).toContain("manjkajo preverjena dokazila zapiranj");
    expect(response.body.totalRemaining).toBeUndefined();
  });
});