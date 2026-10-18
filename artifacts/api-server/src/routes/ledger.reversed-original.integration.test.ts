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
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = "TEST-ledger-reversed"; next(); },
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import ledgerRouter from "./ledger";

const app = express().use(ledgerRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ error: err.message }));
afterAll(() => pool.end());

describe("reversed originals in ledger", () => {
  it("finds same-company reversals outside filters without multiplying lines or changing balances", async () => {
    const rollback = new Error("rollback ledger fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company, foreign] = await db.insert(companiesTable).values([
          { podjetjeDavcna: `TEST_LEDGER_${crypto.randomUUID()}`, naziv: "TEST ledger" },
          { podjetjeDavcna: `TEST_LEDGER_${crypto.randomUUID()}`, naziv: "TEST foreign ledger" },
        ]).returning();
        companyId = company.id;
        await db.insert(accountingRolesTable).values({
          companyId, clerkUserId: "TEST-ledger-reversed", role: "viewer",
        });
        const [oldPeriod, newPeriod] = await db.insert(accountingPeriodsTable).values([
          { companyId, name: "2025", startDate: "2025-01-01", endDate: "2025-12-31", status: "open" },
          { companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open" },
        ]).returning();
        const [bank, contra] = await db.insert(accountsTable).values([
          { companyId, code: "1100", name: "Bank", type: "asset" },
          { companyId, code: "4900", name: "Contra", type: "expense" },
        ]).returning();
        const entryValues = {
          companyId, periodId: oldPeriod.id, entryDate: "2025-12-31",
          description: "TEST ledger", createdBy: "TEST-ledger-reversed",
        };
        const [normal, original, orphan] = await db.insert(journalEntriesTable).values([
          { ...entryValues, status: "posted" },
          { ...entryValues, status: "reversed" },
          { ...entryValues, status: "reversed" },
        ]).returning();
        const [reversal] = await db.insert(journalEntriesTable).values({
          ...entryValues, periodId: newPeriod.id, entryDate: "2026-01-05",
          status: "posted", reversalOf: original.id,
        }).returning();
        // Malformed cross-company evidence must never escape through the lookup.
        await db.insert(journalEntriesTable).values({
          ...entryValues, companyId: foreign.id, status: "posted", reversalOf: orphan.id,
        });
        for (const entry of [normal, original, orphan, reversal]) {
          const side = entry.id === reversal.id ? "credit" : "debit";
          await db.insert(journalEntryLinesTable).values([
            { entryId: entry.id, accountId: bank.id, side, amount: "20.00", sequence: 1 },
            { entryId: entry.id, accountId: contra.id, side: side === "debit" ? "credit" : "debit", amount: "20.00", sequence: 2 },
          ]);
        }
        const url = `/companies/${companyId}/ledger`;
        for (const recentLimit of [undefined, 100]) {
          const full = await request(app).get(url).query({ accountId: bank.id, recentLimit }).expect(200);
          expect(full.body.lines).toHaveLength(4);
          expect(full.body).toMatchObject({ totalDebit: "60.00", totalCredit: "20.00" });
          expect(full.body.lines.at(-1).runningBalance).toBe("40.00");
          expect(full.body.lines.find((l: any) => l.entryId === normal.id))
            .toMatchObject({ isReversal: false, isReversed: false, reversedBy: null });
          expect(full.body.lines.find((l: any) => l.entryId === reversal.id))
            .toMatchObject({ isReversal: true, reversalOf: original.id, isReversed: false, reversedBy: null });
          expect(full.body.lines.find((l: any) => l.entryId === orphan.id))
            .toMatchObject({ isReversed: true, reversedBy: null });
          const filtered = await request(app).get(url).query({
            accountId: bank.id, periodId: oldPeriod.id, dateTo: "2025-12-31", recentLimit,
          }).expect(200);
          expect(filtered.body.lines).toHaveLength(3);
          expect(filtered.body.lines.find((l: any) => l.entryId === original.id))
            .toMatchObject({ isReversal: false, isReversed: true, reversedBy: reversal.id, debit: "20.00" });
          const pair = full.body.lines.filter((l: any) => [original.id, reversal.id].includes(l.entryId));
          expect(pair.reduce((sum: number, l: any) => sum + Number(l.debit) - Number(l.credit), 0)).toBe(0);
        }
        await request(app).get(`/companies/${foreign.id}/ledger`).expect(403);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toEqual([]);
  });
});
