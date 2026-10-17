import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it, vi } from "vitest";

// Roll back all fixtures and export audit records, including the route's writes.
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
    req.clerkUserId = "TEST-trial-export";
    next();
  },
}));

import express from "express";
import request from "supertest";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import router from "./reports";

const app = express();
app.use(express.json());
app.use(router);
afterAll(() => pool.end());

describe("trial balance filtered PDF export", () => {
  it("exports only visible accounts, matching all six table totals and identifying the class", async () => {
    const rollback = new Error("rollback trial export fixtures");
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_TRIAL_EXPORT_${Date.now()}`, naziv: "TEST filtered export",
        }).returning();
        await db.insert(accountingRolesTable).values({
          companyId: company.id, clerkUserId: "TEST-trial-export", role: "viewer",
        });
        const [period] = await db.insert(accountingPeriodsTable).values({
          companyId: company.id, name: "TEST export 2026",
          startDate: "2026-01-01", endDate: "2026-12-31",
        }).returning();
        const accounts = await db.insert(accountsTable).values([
          { companyId: company.id, code: "0400000", name: "Oprema", type: "asset" },
          { companyId: company.id, code: "4100000", name: "Storitve", type: "expense" },
          { companyId: company.id, code: "4200000", name: "Najemnine", type: "expense" },
          { companyId: company.id, code: "2200000", name: "Dobavitelji", type: "liability" },
        ]).returning();
        for (const entryDate of ["2026-01-15", "2026-06-15"]) {
          const [entry] = await db.insert(journalEntriesTable).values({
            companyId: company.id, periodId: period.id, entryDate, status: "posted",
            description: "TEST filtered export", createdBy: "TEST-trial-export",
          }).returning();
          await db.insert(journalEntryLinesTable).values(accounts.map((account, sequence) => ({
            entryId: entry.id, accountId: account.id, sequence,
            side: sequence === 3 ? "credit" as const : "debit" as const,
            amount: ["10.10", "20.20", "30.30", "60.60"][sequence],
          })));
        }

        const base = `/companies/${company.id}/reports`;
        const dates = { dateFrom: "2026-06-01", dateTo: "2026-06-30" };
        const table = (await request(app).get(`${base}/trial-balance`).query(dates).expect(200)).body;
        for (const filters of [
          {}, { accountClass: "4" }, { accountClass: "0" }, { accountClass: "9" },
          { accountClass: "4", searchTerm: "  STORITVE  " },
        ]) {
          const response = await request(app).post(`${base}/export`)
            .send({ reportType: "trial-balance", ...dates, ...filters }).expect(200);
          expect(response.headers["content-type"]).toContain("application/pdf");
          const extracted = spawnSync("pdftotext", ["-layout", "-", "-"], {
            input: response.body, encoding: "utf8",
          });
          expect(extracted.status, extracted.stderr).toBe(0);
          const text = extracted.stdout;
          const visible = table.rows.filter((row: any) =>
            (!filters.accountClass || row.accountCode.startsWith(filters.accountClass)) &&
            (!filters.searchTerm || row.accountName.toLowerCase().includes(filters.searchTerm.trim().toLowerCase())));
          for (const row of table.rows) {
            expect(text.includes(row.accountCode)).toBe(visible.includes(row));
          }
          if (filters.accountClass) expect(text).toContain(`Razred ${filters.accountClass}`);
          else expect(text).not.toContain("Razred");
          const totalsLine = text.split("\n").find(line => line.includes("SKUPAJ"))!;
          expect(totalsLine).toBeTruthy();
          const expected = [
            "openingBalanceDebit", "openingBalanceCredit", "turnoverDebit",
            "turnoverCredit", "balanceDebit", "balanceCredit",
          ].map(field => visible.reduce((sum: number, row: any) => sum + Number(row[field]), 0).toFixed(2));
          const amounts = totalsLine.match(/\d+,\d{2}/g) ?? [];
          expect(amounts.slice(0, 6)).toEqual(expected.map(value => value.replace(".", ",")));
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
  });
});
