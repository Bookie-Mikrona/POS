import { afterAll, describe, expect, it, vi } from "vitest";

const isolation = vi.hoisted(() => ({ tx: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, key) {
        const executor = isolation.tx ?? target;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "TEST-historical-trial";
    next();
  },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import router from "./reports";

const app = express();
app.use(express.json());
app.use(router);
afterAll(() => pool.end());

describe("historical trial balance year boundaries", () => {
  it.each([
    ["Bookie Old", "posted"],
    ["annual opening", "reversed"],
  ] as const)("rejects unbounded %s balances without changing journal entries (%s)", async (kind, status) => {
    const rollback = new Error("rollback historical trial fixtures");
    let companyId: string | undefined;
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_HIST_TRIAL_${crypto.randomUUID()}`,
          naziv: "TEST historical trial",
        }).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: "TEST-historical-trial", role: "viewer",
        });
        const [bank, capital] = await db.insert(accountsTable).values([
          { companyId, code: "1100000", name: "Banka", type: "asset" },
          { companyId, code: "9000000", name: "Kapital", type: "equity" },
        ]).returning();
        for (const year of [2024, 2025]) {
          const [period] = await db.insert(accountingPeriodsTable).values({
            companyId, name: `TEST ${year}`,
            startDate: `${year}-01-01`, endDate: `${year}-12-31`,
          }).returning();
          for (const [suffix, amount] of [["01-01", year === 2024 ? "100.00" : "110.00"], ["06-01", "10.00"]]) {
            const [entry] = await db.insert(journalEntriesTable).values({
              companyId, periodId: period.id, entryDate: `${year}-${suffix}`,
              reference: suffix === "01-01"
                ? kind === "Bookie Old" ? `BOOKIE-OLD/K2/${year}/00/1` : `OTV-${year}-01`
                : `TEST-movement-${year}`,
              status: suffix === "01-01" ? status : "posted",
              description: "TEST historical trial", createdBy: "TEST-historical-trial",
            }).returning();
            await db.insert(journalEntryLinesTable).values([
              { entryId: entry.id, accountId: bank.id, sequence: 0, side: "debit", amount },
              { entryId: entry.id, accountId: capital.id, sequence: 1, side: "credit", amount },
            ]);
          }
        }
        const beforeEntries = await db.select().from(journalEntriesTable)
          .where(eq(journalEntriesTable.companyId, companyId));
        const beforeLines = await db.select().from(journalEntryLinesTable)
          .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
          .where(eq(journalEntriesTable.companyId, companyId));
        const base = `/companies/${companyId}/reports`;
        const error = "Za uvožena zgodovinska leta izberite datuma znotraj istega koledarskega leta.";
        for (const dates of [
          {}, { dateFrom: "", dateTo: "" },
          { dateFrom: "2025-01-01" }, { dateTo: "2025-12-31" },
          { dateFrom: "2024-01-01", dateTo: "2025-12-31" },
        ]) {
          const response = await request(app).get(`${base}/trial-balance`).query(dates);
          expect(response.status, JSON.stringify(response.body)).toBe(409);
          expect(response.body).toEqual({ error });
        }
        // The PDF path shares the loader and must not generate an inflated report.
        const pdf = await request(app).post(`${base}/export`).send({ reportType: "trial-balance" });
        expect(pdf.status).toBe(500);
        expect(pdf.body.error).toContain(error);

        for (const [dateFrom, opening, turnover] of [
          ["2025-01-01", "110.00", "10.00"],
          ["2025-07-01", "120.00", "0.00"],
        ]) {
          const response = await request(app).get(`${base}/trial-balance`)
            .query({ dateFrom, dateTo: "2025-12-31" });
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          expect(response.body).toMatchObject({
            totalOpeningBalanceDebit: opening, totalOpeningBalanceCredit: opening,
            totalTurnoverDebit: turnover, totalTurnoverCredit: turnover,
            totalBalanceDebit: "120.00", totalBalanceCredit: "120.00",
          });
        }
        expect(await db.select().from(journalEntriesTable)
          .where(eq(journalEntriesTable.companyId, companyId))).toEqual(beforeEntries);
        expect(await db.select().from(journalEntryLinesTable)
          .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
          .where(eq(journalEntriesTable.companyId, companyId))).toEqual(beforeLines);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    expect(companyId).toBeDefined();
    expect(await db.select({ id: companiesTable.id }).from(companiesTable)
      .where(eq(companiesTable.id, companyId!))).toEqual([]);
  });
});
