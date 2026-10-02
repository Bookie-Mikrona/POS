import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "ledger-recent-test-user";
    next();
  },
}));
import ledgerRouter from "./ledger";

const app = express().use(ledgerRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: err.message }));
const companies: string[] = [];
let companyId: string, foreignCompanyId: string;
let accountId: string, otherAccountId: string, foreignAccountId: string;
let periodId: string, oldPeriodId: string;

async function seedCompany(label: string) {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TEST_RECENT_${crypto.randomUUID()}`, naziv: `Recent ledger ${label}`,
  }).returning();
  companies.push(company.id);
  await db.insert(accountingRolesTable).values({
    companyId: company.id, clerkUserId: "ledger-recent-test-user", role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId: company.id, name: "2025", startDate: "2025-01-01", endDate: "2025-12-31", status: "open",
  }).returning();
  const accounts = await db.insert(accountsTable).values([
    { companyId: company.id, code: "1100", name: "TRR", type: "asset" as const },
    { companyId: company.id, code: "1101", name: "Other TRR", type: "asset" as const },
    { companyId: company.id, code: "4900", name: "Contra", type: "expense" as const },
  ]).returning();
  return { companyId: company.id, periodId: period.id, accounts };
}

async function seedEntry(company: string, period: string, bank: string, contra: string,
  date: string, amount: string, side: "debit" | "credit" = "debit",
  status: "posted" | "reversed" | "draft" = "posted", extraBankLine = false) {
  const [entry] = await db.insert(journalEntriesTable).values({
    companyId: company, periodId: period, entryDate: date, description: `Entry ${date} ${amount}`,
    status, createdBy: "ledger-recent-test-user", createdAt: new Date("2025-01-01T12:00:00Z"),
  }).returning();
  await db.insert(journalEntryLinesTable).values([
    { entryId: entry.id, accountId: bank, sequence: 1, side, amount },
    { entryId: entry.id, accountId: contra, sequence: 2,
      side: side === "debit" ? "credit" : "debit", amount: extraBankLine ? "9.50" : amount },
    ...(extraBankLine ? [{ entryId: entry.id, accountId: bank, sequence: 3,
      side: "debit" as const, amount: "7.15" }] : []),
  ]);
}

beforeAll(async () => {
  const main = await seedCompany("main");
  companyId = main.companyId; periodId = main.periodId;
  accountId = main.accounts[0].id; otherAccountId = main.accounts[1].id;
  const contraId = main.accounts[2].id;
  const [oldPeriod] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "2024", startDate: "2024-01-01", endDate: "2024-12-31", status: "open",
  }).returning();
  oldPeriodId = oldPeriod.id;
  await seedEntry(companyId, oldPeriodId, accountId, contraId, "2024-12-31", "100.00");
  for (let i = 1; i <= 12; i++) {
    // Same date/creation timestamp on the last three entries exercises stable ties.
    const day = String(Math.min(i, 10)).padStart(2, "0");
    await seedEntry(companyId, periodId, accountId, contraId, `2025-01-${day}`,
      i === 1 ? "0.10" : i === 2 ? "0.20" : `${i}.35`, i % 3 ? "debit" : "credit");
  }
  await seedEntry(companyId, periodId, accountId, contraId, "2025-01-18", "2.35", "debit", "posted", true);
  await seedEntry(companyId, periodId, accountId, contraId, "2025-01-20", "1.25", "credit", "reversed");
  await seedEntry(companyId, periodId, accountId, contraId, "2025-12-31", "999.00", "debit", "draft");
  await seedEntry(companyId, periodId, otherAccountId, contraId, "2025-12-31", "888.00");
  const foreign = await seedCompany("foreign");
  foreignCompanyId = foreign.companyId; foreignAccountId = foreign.accounts[0].id;
  await seedEntry(foreignCompanyId, foreign.periodId, foreignAccountId, foreign.accounts[2].id, "2025-12-31", "777.00");
}, 30_000);

afterAll(async () => {
  for (const id of companies) {
    const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, id));
    if (entries.length) await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, entries.map(e => e.id)));
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, id));
    await db.delete(accountsTable).where(eq(accountsTable.companyId, id));
    await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, id));
    await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, id));
    await db.delete(companiesTable).where(eq(companiesTable.id, id));
  }
});

function getLedger(filters: Record<string, string | number> = {}, company = companyId) {
  return supertest(app).get(`/companies/${company}/ledger`).query({ accountId, ...filters });
}

describe("bounded recent ledger (real database)", () => {
  it("keeps the full default ledger and returns only its last seven lines with identical balances and totals", async () => {
    const full = await getLedger().expect(200);
    expect(full.body.lines).toHaveLength(16);
    const recent = await getLedger({ recentLimit: 7 }).expect(200);
    expect(recent.body).toEqual({ ...full.body, lines: full.body.lines.slice(-7) });
    expect(recent.body.lines[0].runningBalance).not.toBe(recent.body.lines[0].debit);
    expect(recent.body.lines.at(-1).credit).toBe("1.25"); // reversed stays included
    expect(recent.body.lines.some((line: any) => line.debit === "999.00")).toBe(false);
    expect((await getLedger({ recentLimit: 7 }).expect(200)).body).toEqual(recent.body);
  });

  it.each([
    { periodId: () => periodId },
    { dateFrom: () => "2025-01-06", dateTo: () => "2025-01-18" },
    { periodId: () => oldPeriodId },
  ])("preserves period/date filters and their full-history running balances: %j", async (getFilters) => {
    const filters = Object.fromEntries(Object.entries(getFilters).map(([key, value]) => [key, value()]));
    const full = await getLedger(filters).expect(200);
    const recent = await getLedger({ ...filters, recentLimit: 3 }).expect(200);
    expect(recent.body).toEqual({ ...full.body, lines: full.body.lines.slice(-3) });
  });

  it("keeps accounts and companies separate, including empty results", async () => {
    const other = await getLedger({ accountId: otherAccountId, recentLimit: 7 }).expect(200);
    expect(other.body.lines).toHaveLength(1);
    expect(other.body.totalDebit).toBe("888.00");
    expect((await getLedger({ accountId: foreignAccountId, recentLimit: 7 }).expect(200)).body)
      .toEqual({ lines: [], totalDebit: "0.00", totalCredit: "0.00" });
    const foreign = await getLedger({ accountId: foreignAccountId, recentLimit: 7 }, foreignCompanyId).expect(200);
    expect(foreign.body.totalDebit).toBe("777.00");
    expect((await getLedger({ dateFrom: "2026-01-01", recentLimit: 7 }).expect(200)).body.lines).toEqual([]);
  });

  it("applies a line limit even without an account filter and accepts the upper bound", async () => {
    const full = await getLedger({ accountId: "" }).expect(200);
    expect((await getLedger({ accountId: "", recentLimit: 7 }).expect(200)).body)
      .toEqual({ ...full.body, lines: full.body.lines.slice(-7) });
    expect((await getLedger({ recentLimit: 100 }).expect(200)).body)
      .toEqual((await getLedger().expect(200)).body);
  });

  it.each(["0", "-1", "1.5", "101", "1e2", "NaN", "", "7foo"])("rejects invalid limits (%j)", async recentLimit => {
    await getLedger({ recentLimit }).expect(400);
  });

  it("rejects repeated query parameters and still enforces access control", async () => {
    await supertest(app).get(`/companies/${companyId}/ledger?recentLimit=7&recentLimit=8`).expect(400);
    await supertest(app).get(`/companies/${crypto.randomUUID()}/ledger?recentLimit=7`).expect(403);
  });
});