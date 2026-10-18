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
    req.clerkUserId = "TEST-dimension-untagged";
    next();
  },
}));

import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, journalEntriesTable, journalEntryLinesTable,
  costCentersTable, projectsTable, departmentsTable,
} from "@workspace/db";
import router from "./reports";

const app = express();
app.use(router);
afterAll(() => pool.end());

describe("dimension report untagged line evidence", () => {
  it("pages matching lines with full reconciled totals, scoped by tenant, status, date, account and dimension", async () => {
    const rollback = new Error("rollback dimension report fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company, foreign] = await db.insert(companiesTable).values([
          { podjetjeDavcna: `TEST_DIM_${randomUUID()}`, naziv: "TEST dimension report" },
          { podjetjeDavcna: `TEST_DIM_${randomUUID()}`, naziv: "TEST foreign dimension report" },
        ]).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: "TEST-dimension-untagged", role: "accountant",
        });
        const [period, foreignPeriod] = await db.insert(accountingPeriodsTable).values(
          [company, foreign].map(c => ({
            companyId: c.id, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open" as const,
          })),
        ).returning();
        const [account, otherAccount, foreignAccount] = await db.insert(accountsTable).values([
          { companyId, code: "4000000", name: "Stroški", type: "expense" as const },
          { companyId, code: "2200000", name: "Obveznosti", type: "liability" as const },
          { companyId: foreign.id, code: "4000000", name: "Tuji stroški", type: "expense" as const },
        ]).returning();
        const [cc] = await db.insert(costCentersTable).values({ companyId, code: "SM", name: "SM" }).returning();
        const [project] = await db.insert(projectsTable).values({ companyId, code: "PR", name: "Projekt" }).returning();
        const [department] = await db.insert(departmentsTable).values({ companyId, code: "OD", name: "Oddelek" }).returning();
        const entryBase = {
          companyId, periodId: period.id, description: "TEST knjižba", createdBy: "TEST-dimension-untagged",
        };
        const [posted, reversed, draft, before, after, foreignEntry] = await db.insert(journalEntriesTable).values([
          { ...entryBase, entryDate: "2026-06-01", status: "posted", reference: "TEST-TEM" },
          { ...entryBase, entryDate: "2026-06-30", status: "reversed" },
          { ...entryBase, entryDate: "2026-06-15", status: "draft" },
          { ...entryBase, entryDate: "2026-05-31", status: "posted" },
          { ...entryBase, entryDate: "2026-07-01", status: "posted" },
          { ...entryBase, companyId: foreign.id, periodId: foreignPeriod.id, entryDate: "2026-06-15", status: "posted" },
        ]).returning();
        const lines = await db.insert(journalEntryLinesTable).values([
          ...Array.from({ length: 24 }, (_, sequence) => ({
            entryId: posted.id, accountId: account.id, sequence,
            side: sequence % 2 === 0 ? "debit" as const : "credit" as const,
            amount: "10.00", description: `Vrstica ${sequence}`,
          })),
          { entryId: posted.id, accountId: account.id, sequence: 24, side: "credit", amount: "7.00", costCenterId: cc.id },
          { entryId: posted.id, accountId: account.id, sequence: 25, side: "debit", amount: "7.00", projectId: project.id },
          { entryId: posted.id, accountId: otherAccount.id, sequence: 26, side: "debit", amount: "3.00", departmentId: department.id },
          { entryId: posted.id, accountId: otherAccount.id, sequence: 27, side: "credit", amount: "3.00", costCenterId: cc.id, projectId: project.id, departmentId: department.id },
          { entryId: reversed.id, accountId: account.id, sequence: 0, side: "debit", amount: "2.00" },
          { entryId: reversed.id, accountId: account.id, sequence: 1, side: "credit", amount: "2.00" },
          ...[draft, before, after, foreignEntry].flatMap(entry => [
            { entryId: entry.id, accountId: entry.id === foreignEntry.id ? foreignAccount.id : account.id, sequence: 0, side: "debit" as const, amount: "99.00" },
            { entryId: entry.id, accountId: entry.id === foreignEntry.id ? foreignAccount.id : account.id, sequence: 1, side: "credit" as const, amount: "99.00" },
          ]),
        ]).returning();

        for (const [dimensionType, dimensionColumn] of [
          ["costCenter", "costCenterId"], ["project", "projectId"], ["department", "departmentId"],
        ] as const) {
          for (const accountId of [undefined, account.id]) {
            const query = {
              dimensionType, dateFrom: "2026-06-01", dateTo: "2026-06-30",
              ...(accountId ? { accountId, groupBy: "account" } : {}),
            };
            const response = await request(app).get(`/companies/${companyId}/reports/dimensions`).query(query);
            expect(response.status).toBe(200);
            const expected = lines.filter(line =>
              [posted.id, reversed.id].includes(line.entryId)
              && line[dimensionColumn] === null
              && (!accountId || line.accountId === accountId),
            );
            expect(response.body.untaggedLines.map((line: any) => line.lineId)).toEqual(expected.slice(0, 20).map(line => line.id));
            expect(response.body).toMatchObject({ untaggedCount: expected.length, untaggedPage: 1, untaggedPageSize: 20 });
            const second = await request(app).get(`/companies/${companyId}/reports/dimensions`)
              .query({ ...query, untaggedPage: 2 });
            expect(second.status).toBe(200);
            expect(second.body.untaggedLines.map((line: any) => line.lineId)).toEqual(expected.slice(20).map(line => line.id));
            for (const key of ["rows", "untaggedDebit", "untaggedCredit", "untaggedBalance", "untaggedCount",
              "grandTotalDebit", "grandTotalCredit", "grandTotalBalance"]) {
              expect(second.body[key]).toEqual(response.body[key]);
            }
            const repeat = await request(app).get(`/companies/${companyId}/reports/dimensions`).query(query);
            expect(repeat.body.untaggedLines).toEqual(response.body.untaggedLines);
            expect(response.body.untaggedLines[0]).toMatchObject({
              entryId: posted.id, entryDate: "2026-06-01", reference: "TEST-TEM",
              entryDescription: "TEST knjižba", description: "Vrstica 0",
              accountCode: "4000000", accountName: "Stroški", side: "debit", amount: "10.00",
            });
            const debit = expected.filter(line => line.side === "debit").reduce((sum, line) => sum + Number(line.amount), 0);
            const credit = expected.filter(line => line.side === "credit").reduce((sum, line) => sum + Number(line.amount), 0);
            expect(response.body).toMatchObject({
              untaggedDebit: debit.toFixed(2), untaggedCredit: credit.toFixed(2),
              untaggedBalance: (debit - credit).toFixed(2),
            });
          }
        }
        // Thousands of additional lines must not enlarge the default response.
        await db.insert(journalEntryLinesTable).values(Array.from({ length: 2000 }, (_, index) => ({
          entryId: posted.id, accountId: account.id, sequence: index + 100,
          side: index % 2 === 0 ? "debit" as const : "credit" as const, amount: "1.00",
        })));
        const largeQuery = { dimensionType: "costCenter", dateFrom: "2026-06-01", dateTo: "2026-06-30" };
        const large = await request(app).get(`/companies/${companyId}/reports/dimensions`).query(largeQuery);
        expect(large.status).toBe(200);
        expect(large.body.untaggedLines).toHaveLength(20);
        expect(large.body.untaggedCount).toBeGreaterThan(2000);
        const allIds = new Set<string>();
        for (let page = 1; page <= Math.ceil(large.body.untaggedCount / 100); page++) {
          const result = await request(app).get(`/companies/${companyId}/reports/dimensions`)
            .query({ ...largeQuery, untaggedPage: page, untaggedPageSize: 100 });
          expect(result.status).toBe(200);
          expect(result.body.untaggedLines.length).toBeLessThanOrEqual(100);
          expect(result.body.untaggedDebit).toBe(large.body.untaggedDebit);
          expect(result.body.untaggedCredit).toBe(large.body.untaggedCredit);
          for (const line of result.body.untaggedLines) {
            expect(allIds.has(line.lineId)).toBe(false);
            allIds.add(line.lineId);
          }
        }
        expect(allIds.size).toBe(large.body.untaggedCount);
        const beyond = await request(app).get(`/companies/${companyId}/reports/dimensions`)
          .query({ ...largeQuery, untaggedPage: 10000 });
        expect(beyond.body.untaggedLines).toEqual([]);
        expect(beyond.body.untaggedCount).toBe(large.body.untaggedCount);
        for (const invalid of [
          { untaggedPage: "0" }, { untaggedPage: "-1" }, { untaggedPage: "1.5" },
          { untaggedPage: "abc" }, { untaggedPage: "9007199254740992" },
          { untaggedPageSize: "101" }, { untaggedPageSize: "0" },
        ]) {
          expect((await request(app).get(`/companies/${companyId}/reports/dimensions`).query(invalid)).status).toBe(400);
        }
        const empty = await request(app).get(`/companies/${companyId}/reports/dimensions`)
          .query({ dateFrom: "2026-08-01", dateTo: "2026-08-31" });
        expect(empty.status).toBe(200);
        expect(empty.body).toMatchObject({ untaggedLines: [], untaggedCount: 0, untaggedDebit: "0.00", untaggedCredit: "0.00" });
        expect((await request(app).get(`/companies/${foreign.id}/reports/dimensions`)).status).toBe(403);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    // No test tenant or financial history may survive this read-only route test.
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toEqual([]);
  });
});
