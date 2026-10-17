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
    req.clerkUserId = "TEST-account-report";
    next();
  },
}));
import express from "express";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import accountsRouter from "./accounts";
import reportsRouter from "./reports";
import { accountTypeWarning } from "../lib/accountTypeWarning";
import { resolveEffectiveType } from "./reports";
import { COMPANY_CHART_OF_ACCOUNTS } from "../lib/companyChartOfAccounts";

const app = express();
app.use(express.json(), accountsRouter, reportsRouter);
afterAll(() => pool.end());

describe("account save through real posted report totals", () => {
  it("uses one classification for every standard imported account", () => {
    for (const account of COMPANY_CHART_OF_ACCOUNTS) {
      expect(accountTypeWarning(account)).toBeNull();
      expect(resolveEffectiveType(account)).toBe(account.type);
    }
  });
  it("keeps class 5 liabilities in the balance sheet, including confirmed exceptions and class 9 subclasses", async () => {
    const rollback = new Error("rollback account/report fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_ACCOUNT_REPORT_${Date.now()}`, naziv: "TEST account/report",
        }).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: "TEST-account-report", role: "accountant",
        });
        const [period] = await db.insert(accountingPeriodsTable).values({
          companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
        }).returning();
        const url = `/companies/${companyId}/accounts`;
        const bank = (await request(app).post(url).send({
          code: "1100000", name: "Bank", type: "asset",
        }).expect(201)).body;
        for (const [code, expectedType, wrongType] of [
          ["5000000", "liability", "expense"],
          ["9600000", "liability", "revenue"],
          ["9900000", "asset", "expense"],
          ["9990000", "liability", "expense"],
        ]) {
          const saved = (await request(app).post(url).send({
            code, name: code, type: expectedType,
          }).expect(201)).body;
          const [entry] = await db.insert(journalEntriesTable).values({
            companyId, periodId: period.id, entryDate: "2026-06-15",
            description: "TEST account classification", createdBy: "TEST-account-report", status: "posted",
          }).returning();
          const side = expectedType === "asset" ? "debit" : "credit";
          await db.insert(journalEntryLinesTable).values([
            { entryId: entry.id, accountId: saved.id, side, amount: "123.45", sequence: 1 },
            { entryId: entry.id, accountId: bank.id, side: side === "debit" ? "credit" : "debit", amount: "123.45", sequence: 2 },
          ]);
          const balance = async () => (await request(app).get(`/companies/${companyId}/reports/balance-sheet`).expect(200)).body.current;
          const income = async () => (await request(app).get(`/companies/${companyId}/reports/income-statement`).expect(200)).body.current;
          const items = (report: any) => [...report.aktiva.sections, ...report.pasiva.sections].flatMap((section: any) => section.items);
          let report = await balance();
          expect(items(report)).toContainEqual(expect.objectContaining({ accountCode: code, balance: "123.45" }));
          expect(report.typeWarnings).toEqual([]);
          expect((await income()).expenses.total).toBe("0.00");

          // An unconfirmed mismatch cannot change either storage or reports.
          await request(app).patch(`${url}/${saved.id}`).send({ type: wrongType }).expect(422);
          const [unchanged] = await db.select().from(accountsTable).where(eq(accountsTable.id, saved.id));
          expect(unchanged.type).toBe(expectedType);
          // A deliberate exception remains visible in the authoritative report, with a warning.
          await request(app).patch(`${url}/${saved.id}`).send({ type: wrongType, confirmTypeException: true }).expect(200);
          report = await balance();
          expect(items(report)).toContainEqual(expect.objectContaining({ accountCode: code, balance: "123.45" }));
          expect(report.typeWarnings).toContainEqual(expect.objectContaining({ code, storedType: wrongType, effectiveType: expectedType }));
          const pnl = await income();
          expect(pnl.expenses.total).toBe("0.00");
          expect(pnl.revenue.total).toBe("0.00");
          // Restore the matching type so the next scenario starts warning-free.
          await request(app).patch(`${url}/${saved.id}`).send({ type: expectedType }).expect(200);
        }
        const exportPdf = async (body: Record<string, string>) => {
          const response = await request(app)
            .post(`/companies/${companyId}/reports/export`).send(body).expect(200)
            .expect("Content-Type", /application\/pdf/);
          const text = spawnSync("pdftotext", ["-layout", "-", "-"], {
            input: response.body, encoding: "utf8",
          });
          expect(text.status, text.stderr).toBe(0);
          return text.stdout;
        };
        const balancePdf = await exportPdf({
          reportType: "balance-sheet", asOf: "2026-06-30",
        });
        expect(balancePdf).toContain("5000000");
        expect(balancePdf).toContain("9600000");
        const trialPdf = await exportPdf({
          reportType: "trial-balance", dateFrom: "2026-01-01", dateTo: "2026-06-30", accountClass: "5",
        });
        expect(trialPdf).toContain("5000000");
        expect(trialPdf).not.toContain("1100000");
        expect(trialPdf).not.toContain("9600000");
        expect(await exportPdf({
          reportType: "income-statement", dateFrom: "2026-01-01", dateTo: "2026-06-30",
        })).toContain("IZKAZ POSLOVNEGA IZIDA");
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toHaveLength(0);
  }, 30000);
});
