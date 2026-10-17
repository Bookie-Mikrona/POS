import { afterAll, describe, expect, it, vi } from "vitest";

// Exercise the real SQL on one transaction, without leaving financial fixtures.
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
    req.clerkUserId = "TEST-dimension-report";
    next();
  },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, costCentersTable, projectsTable, departmentsTable,
  journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import router from "./reports";

const app = express();
app.use(router);
afterAll(() => pool.end());

interface Totals {
  totalDebit: string;
  totalCredit: string;
  balance: string;
}
interface DimensionRow extends Totals {
  id: string;
  accounts: (Totals & { accountId: string })[];
}
const cents = (amount: string) => Math.round(Number(amount) * 100);

function expectReconciled(report: {
  rows: DimensionRow[];
  grandTotalDebit: string;
  grandTotalCredit: string;
  grandTotalBalance: string;
}) {
  for (const row of report.rows) {
    for (const field of ["totalDebit", "totalCredit", "balance"] as const) {
      expect(cents(row[field])).toBe(row.accounts.reduce((sum, account) => sum + cents(account[field]), 0));
    }
    expect(cents(row.balance)).toBe(cents(row.totalDebit) - cents(row.totalCredit));
  }
  expect(cents(report.grandTotalDebit)).toBe(report.rows.reduce((sum, row) => sum + cents(row.totalDebit), 0));
  expect(cents(report.grandTotalCredit)).toBe(report.rows.reduce((sum, row) => sum + cents(row.totalCredit), 0));
  expect(cents(report.grandTotalBalance)).toBe(report.rows.reduce((sum, row) => sum + cents(row.balance), 0));
}

describe("dimension report line-level attribution", () => {
  it.each([
    ["costCenter", costCentersTable, "costCenterId"],
    ["project", projectsTable, "projectId"],
    ["department", departmentsTable, "departmentId"],
  ] as const)("reconciles %s totals with account subrows for a split journal", async (dimensionType, table, fk) => {
    const rollback = new Error("rollback dimension report fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company, otherCompany] = await db.insert(companiesTable).values([
          { podjetjeDavcna: `TEST_DIM_${dimensionType}_${Date.now()}`, naziv: "TEST dimensions" },
          { podjetjeDavcna: `TEST_DIM_OTHER_${dimensionType}_${Date.now()}`, naziv: "TEST other dimensions" },
        ]).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: "TEST-dimension-report", role: "viewer",
        });
        const [period] = await db.insert(accountingPeriodsTable).values({
          companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
        }).returning();
        const [expense, bank] = await db.insert(accountsTable).values([
          { companyId, code: "4000", name: "Expense", type: "expense" },
          { companyId, code: "1100", name: "Bank", type: "asset" },
        ]).returning();
        const [first, second] = await db.insert(table).values([
          { companyId, code: "A", name: "First dimension" },
          { companyId, code: "B", name: "Second dimension" },
        ]).returning();
        const entryValues = {
          companyId, periodId: period.id, entryDate: "2026-06-15",
          description: "TEST split dimensions", createdBy: "TEST-dimension-report",
        };
        const addJournal = async (
          overrides: Partial<typeof journalEntriesTable.$inferInsert>,
          lines: { accountId: string; side: "debit" | "credit"; amount: string; dimensionId: string | null }[],
        ) => {
          const [entry] = await db.insert(journalEntriesTable).values({
            ...entryValues, status: "posted", ...overrides,
          }).returning();
          await db.insert(journalEntryLinesTable).values(lines.map((line, sequence) => ({
            entryId: entry.id, accountId: line.accountId, side: line.side,
            amount: line.amount, sequence, [fk]: line.dimensionId,
          })));
        };
        const line = (accountId: string, side: "debit" | "credit", amount: string, dimensionId: string | null) =>
          ({ accountId, side, amount, dimensionId });

        // Same account in two dimensions; two accounts and both sides in each
        // dimension; repeated account/side rows must be summed, not overwritten.
        await addJournal({}, [
          line(expense.id, "debit", "10.10", first.id),
          line(expense.id, "debit", "0.20", first.id),
          line(bank.id, "credit", "3.05", first.id),
          line(expense.id, "debit", "20.20", second.id),
          line(expense.id, "credit", "0.30", second.id),
          line(bank.id, "credit", "27.15", second.id),
        ]);
        // The reversed original and its posted opposite must cancel.
        await addJournal({ status: "reversed" }, [
          line(expense.id, "debit", "4.44", first.id),
          line(bank.id, "credit", "4.44", first.id),
        ]);
        await addJournal({}, [
          line(expense.id, "credit", "4.44", first.id),
          line(bank.id, "debit", "4.44", first.id),
        ]);
        const excluded = [
          line(expense.id, "debit", "999.99", first.id),
          line(bank.id, "credit", "999.99", first.id),
        ];
        await addJournal({ status: "draft" }, excluded);
        await addJournal({ entryDate: "2026-05-31" }, excluded);
        await addJournal({ entryDate: "2026-07-01" }, excluded);
        await addJournal({ companyId: otherCompany.id }, excluded);
        await addJournal({}, [
          line(expense.id, "debit", "7.77", null),
          line(bank.id, "credit", "7.77", null),
        ]);

        const url = `/companies/${companyId}/reports/dimensions`;
        for (const accountId of [undefined, expense.id, bank.id]) {
          const query = {
            dimensionType, dateFrom: "2026-06-01", dateTo: "2026-06-30",
            ...(accountId ? { accountId } : {}),
          };
          const detailed = (await request(app).get(url).query({ ...query, groupBy: "account" }).expect(200)).body;
          const plain = (await request(app).get(url).query(query).expect(200)).body;
          expectReconciled(detailed);
          expect(detailed.rows.map(({ accounts: _accounts, ...row }: DimensionRow) => row)).toEqual(plain.rows);
          for (const field of ["grandTotalDebit", "grandTotalCredit", "grandTotalBalance"]) {
            expect(detailed[field]).toBe(plain[field]);
          }
          expect(detailed.rows.map((row: DimensionRow) => row.id)).toEqual([first.id, second.id]);
          if (accountId) {
            for (const row of detailed.rows) {
              expect(row.accounts.map((account: { accountId: string }) => account.accountId)).toEqual([accountId]);
            }
          } else {
            expect(detailed.rows).toMatchObject([
              {
                totalDebit: "19.18", totalCredit: "11.93", balance: "7.25",
                accounts: [
                  { accountId: bank.id, totalDebit: "4.44", totalCredit: "7.49", balance: "-3.05" },
                  { accountId: expense.id, totalDebit: "14.74", totalCredit: "4.44", balance: "10.30" },
                ],
              },
              {
                totalDebit: "20.20", totalCredit: "27.45", balance: "-7.25",
                accounts: [
                  { accountId: bank.id, totalDebit: "0.00", totalCredit: "27.15", balance: "-27.15" },
                  { accountId: expense.id, totalDebit: "20.20", totalCredit: "0.30", balance: "19.90" },
                ],
              },
            ]);
            expect(detailed).toMatchObject({
              grandTotalDebit: "39.38", grandTotalCredit: "39.38", grandTotalBalance: "0.00",
              untaggedDebit: "7.77", untaggedCredit: "7.77", untaggedBalance: "0.00",
            });
          }
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toHaveLength(0);
  });
});
