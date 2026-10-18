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
  journalEntriesTable, journalEntryLinesTable, reportExportsTable,
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
  ] as const)("denies foreign-company %s reports in both views without leaking data", async (dimensionType, table, fk) => {
    const rollback = new Error("rollback unauthorized dimension report fixtures");
    const companyIds: string[] = [];
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [ownCompany, foreignCompany] = await db.insert(companiesTable).values([
          { podjetjeDavcna: `TEST_DIM_ACCESS_OWN_${dimensionType}_${Date.now()}`, naziv: "TEST own report company" },
          { podjetjeDavcna: `TEST_DIM_ACCESS_FOREIGN_${dimensionType}_${Date.now()}`, naziv: "TEST private report company" },
        ]).returning();
        companyIds.push(ownCompany.id, foreignCompany.id);
        await db.insert(accountingRolesTable).values([
          { companyId: ownCompany.id, clerkUserId: "TEST-dimension-report", role: "viewer" },
          { companyId: foreignCompany.id, clerkUserId: "TEST-foreign-dimension-owner", role: "viewer" },
        ]);
        const [period] = await db.insert(accountingPeriodsTable).values({
          companyId: foreignCompany.id, name: "2026",
          startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
        }).returning();
        const [expense, bank] = await db.insert(accountsTable).values([
          { companyId: foreignCompany.id, code: "4000", name: "TEST private expense", type: "expense" },
          { companyId: foreignCompany.id, code: "1100", name: "TEST private bank", type: "asset" },
        ]).returning();
        const [dimension] = await db.insert(table).values({
          companyId: foreignCompany.id, code: "PRIVATE", name: "TEST private dimension",
        }).returning();
        const [entry] = await db.insert(journalEntriesTable).values({
          companyId: foreignCompany.id, periodId: period.id, entryDate: "2026-06-15",
          description: "TEST private dimension journal", createdBy: "TEST-foreign-dimension-owner", status: "posted",
        }).returning();
        await db.insert(journalEntryLinesTable).values([
          { entryId: entry.id, accountId: expense.id, side: "debit", amount: "1234.56", sequence: 0, [fk]: dimension.id },
          { entryId: entry.id, accountId: bank.id, side: "credit", amount: "1234.56", sequence: 1, [fk]: dimension.id },
        ]);

        const url = `/companies/${foreignCompany.id}/reports/dimensions`;
        const queries = [
          { dimensionType, dateFrom: "2026-06-01", dateTo: "2026-06-30" },
          { dimensionType, dateFrom: "2026-06-01", dateTo: "2026-06-30", groupBy: "account" },
        ];
        for (const query of queries) {
          const response = await request(app).get(url).query(query).expect(403);
          // An error-only payload excludes rows, account details and totals.
          expect(response.body).toEqual({ error: "Dostop do tega podjetja ni dovoljen" });
          for (const privateValue of [
            foreignCompany.id, foreignCompany.naziv, dimension.id, dimension.code, dimension.name,
            expense.id, expense.name, bank.id, bank.name, entry.id, "1234.56",
          ]) {
            expect(response.text).not.toContain(privateValue);
          }
        }

        // Positive control: these same queries expose real data only after an
        // explicit role grant to the requesting user at the foreign company.
        await db.insert(accountingRolesTable).values({
          companyId: foreignCompany.id, clerkUserId: "TEST-dimension-report", role: "viewer",
        });
        // An existing export must never become an account-breakdown row.
        await db.insert(reportExportsTable).values({
          companyId: foreignCompany.id, reportType: "balance-sheet", params: {},
          filename: "not-an-account.pdf", exportedBy: "TEST-dimension-report",
          pdfData: Buffer.from("%PDF-test"), emailSentTo: "not-an-account@example.test",
        });
        for (const query of queries) {
          const response = await request(app).get(url).query(query).expect(200);
          expect(response.body.rows).toMatchObject([{ id: dimension.id, totalDebit: "1234.56", totalCredit: "1234.56" }]);
          if (query.groupBy === "account") {
            expect(response.body.rows[0].accounts.map((account: { accountId: string }) => account.accountId).sort())
              .toEqual([expense.id, bank.id].sort());
            for (const account of response.body.rows[0].accounts) {
              expect(Object.keys(account).sort()).toEqual([
                "accountId", "balance", "code", "name", "totalCredit", "totalDebit",
              ]);
            }
            expect(response.text).not.toContain("not-an-account");
          }
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    expect(companyIds).toHaveLength(2);
    for (const companyId of companyIds) {
      expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toHaveLength(0);
    }
  });

  it.each([
    ["costCenter", costCentersTable, "costCenterId"],
    ["project", projectsTable, "projectId"],
    ["department", departmentsTable, "departmentId"],
  ] as const)("preserves posted %s amounts in both views after deactivation", async (dimensionType, table, fk) => {
    const rollback = new Error("rollback inactive dimension report fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_DIM_INACTIVE_${dimensionType}_${Date.now()}`, naziv: "TEST inactive dimensions",
        }).returning();
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
        const [historical, active] = await db.insert(table).values([
          { companyId, code: "A", name: "Historical dimension", isActive: true },
          { companyId, code: "B", name: "Active dimension", isActive: true },
        ]).returning();
        const [entry] = await db.insert(journalEntriesTable).values({
          companyId, periodId: period.id, entryDate: "2026-06-15", status: "posted",
          description: "TEST historical dimension amounts", createdBy: "TEST-dimension-report",
        }).returning();
        await db.insert(journalEntryLinesTable).values([
          { entryId: entry.id, accountId: expense.id, side: "debit", amount: "12.34", sequence: 0, [fk]: historical.id },
          { entryId: entry.id, accountId: bank.id, side: "credit", amount: "2.10", sequence: 1, [fk]: historical.id },
          { entryId: entry.id, accountId: expense.id, side: "debit", amount: "3.21", sequence: 2, [fk]: active.id },
          { entryId: entry.id, accountId: bank.id, side: "credit", amount: "13.45", sequence: 3, [fk]: active.id },
        ]);

        const url = `/companies/${companyId}/reports/dimensions`;
        const query = { dimensionType, dateFrom: "2026-06-01", dateTo: "2026-06-30" };
        const plainBefore = (await request(app).get(url).query(query).expect(200)).body;
        const detailedBefore = (await request(app).get(url).query({ ...query, groupBy: "account" }).expect(200)).body;
        expect(plainBefore.rows).toEqual([
          { id: historical.id, code: "A", name: "Historical dimension", totalDebit: "12.34", totalCredit: "2.10", balance: "10.24" },
          { id: active.id, code: "B", name: "Active dimension", totalDebit: "3.21", totalCredit: "13.45", balance: "-10.24" },
        ]);
        expect(plainBefore).toMatchObject({
          grandTotalDebit: "15.55", grandTotalCredit: "15.55", grandTotalBalance: "0.00",
        });
        expect(detailedBefore.rows[0].accounts).toEqual([
          { accountId: bank.id, code: "1100", name: "Bank", totalDebit: "0.00", totalCredit: "2.10", balance: "-2.10" },
          { accountId: expense.id, code: "4000", name: "Expense", totalDebit: "12.34", totalCredit: "0.00", balance: "12.34" },
        ]);

        // Change the live dimension only after its historical amounts exist.
        const deactivated = await db.update(table).set({ isActive: false })
          .where(eq(table.id, historical.id)).returning({ id: table.id, isActive: table.isActive });
        expect(deactivated).toEqual([{ id: historical.id, isActive: false }]);

        const plainAfter = (await request(app).get(url).query(query).expect(200)).body;
        const detailedAfter = (await request(app).get(url).query({ ...query, groupBy: "account" }).expect(200)).body;
        expect(plainAfter).toEqual(plainBefore);
        expect(detailedAfter).toEqual(detailedBefore);
        expectReconciled(detailedAfter);
        expect(detailedAfter.rows.map(({ accounts: _accounts, ...row }: DimensionRow) => row)).toEqual(plainAfter.rows);
        for (const field of ["grandTotalDebit", "grandTotalCredit", "grandTotalBalance"]) {
          expect(detailedAfter[field]).toBe(plainAfter[field]);
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
