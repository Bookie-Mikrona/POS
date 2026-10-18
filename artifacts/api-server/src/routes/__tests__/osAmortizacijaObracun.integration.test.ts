import { afterAll, describe, expect, it, vi } from "vitest";

type Transaction = Parameters<Parameters<typeof import("@workspace/db").db.transaction>[0]>[0];
const isolation = vi.hoisted(() => ({ tx: null as Transaction | null }));

// Keep real SQL, defaults and role checks; route calls share the outer transaction.
// Passing the Drizzle transaction (not a client inside manual BEGIN) also ensures
// any nested route transactions use savepoints instead of committing test data.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, key) {
        const executor = isolation.tx ?? target;
        const value = Reflect.get(executor, key, executor);
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, companiesTable, companyModulesTable, osRolesTable,
  accountsTable, accountingPeriodsTable, osAmortizacijaNastavitveTable,
  osAmortizacijskeSkupineTable, osnovnaSredstvaTable, osDoknjizbeTable,
  osAmortizacijaObracunTable, osAmortizacijaObracunSredstvoTable,
  journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import router from "../osAmortizacijaKnjizenje";

const app = express();
app.use(express.json(), router);
afterAll(() => pool.end());

describe("POST /os/:companyId/amortizacija/obracun — real database draft invariants", () => {
  it.each([
    { name: "direct multi-month calculation", months: [6, 12] },
    { name: "successive monthly recalculations", months: [1, 6, 9, 12] },
  ])("$name keeps every journal entry a draft, including the next year", async ({ months }) => {
    const companyId = randomUUID();
    const user = `TEST-amortization-${randomUUID()}`;
    const rollback = new Error("ROLLBACK amortization draft fixtures");
    const entryIds = new Map<number, string>();
    try {
      await db.transaction(async (tx) => {
        isolation.tx = tx;
        await db.insert(companiesTable).values({
          id: companyId, naziv: "TEST amortization drafts", podjetjeDavcna: `TEST-${companyId}`,
        });
        await db.insert(companyModulesTable).values(
          (["osnovna_sredstva", "erp"] as const).map((module) => ({
            companyId, module, enabledBy: user,
          })),
        );
        await db.insert(osRolesTable).values({ companyId, clerkUserId: user, role: "os_admin" });
        const [expense, correction] = await db.insert(accountsTable).values([
          { companyId, code: "4300", name: "TEST depreciation expense", type: "expense" },
          { companyId, code: "0190", name: "TEST accumulated depreciation", type: "asset" },
        ]).returning();
        await db.insert(accountingPeriodsTable).values([2024, 2025].map((year) => ({
          companyId, name: `TEST ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31`,
        })));
        await db.insert(osAmortizacijaNastavitveTable).values({
          companyId, kontoStroskaId: expense.id, kontoPopravkaId: correction.id, osLeto: 2024,
        });
        const [group] = await db.insert(osAmortizacijskeSkupineTable).values({
          companyId, koda: "TEST", naziv: "TEST equipment",
          racunovodskaStonja: "10", davcnaStonja: "10",
        }).returning();
        const [asset] = await db.insert(osnovnaSredstvaTable).values({
          companyId, inventarnaSt: "TEST-001", naziv: "TEST equipment",
          skupinaId: group.id, status: "v_uporabi",
        }).returning();
        await db.insert(osDoknjizbeTable).values({
          sredstvoId: asset.id, seq: 0, nabavnaVrednost: "12000",
          datumNabave: "2023-01-01", datumAktivacije: "2023-01-01", status: "v_uporabi",
        });

        for (const year of [2024, 2025]) {
          for (const month of months) {
            const previousId = entryIds.get(year);
            const response = await request(app)
              .post(`/os/${companyId}/amortizacija/obracun`)
              .set("x-test-user", user)
              .send({ leto: year, doMeseca: month });
            expect(response.status, JSON.stringify(response.body)).toBe(201);
            expect(response.body.status).toBe(month === 12 ? "zakljucen" : "odprt");
            expect(response.body.glkOsnutek).toMatchObject({
              ustvarjen: !previousId, posodobljen: !!previousId,
            });
            const entryId = response.body.glkOsnutek.temeljnicaId as string;
            expect(entryId).toEqual(expect.any(String));
            if (previousId) expect(entryId).toBe(previousId);
            entryIds.set(year, entryId);

            const [head] = await db.select().from(osAmortizacijaObracunTable)
              .where(eq(osAmortizacijaObracunTable.id, response.body.obracunId));
            expect(head).toMatchObject({
              companyId, leto: year, doMeseca: month, glkTemeljnicaId: entryId,
              status: month === 12 ? "zakljucen" : "odprt",
            });
            const savedAssets = await db.select().from(osAmortizacijaObracunSredstvoTable)
              .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, head.id));
            expect(savedAssets).toHaveLength(1);
            expect(Number(savedAssets[0].obracunano)).toBe(month * 100);

            // Check ALL entries after EVERY call, not just the current response.
            const entries = await db.select().from(journalEntriesTable)
              .where(eq(journalEntriesTable.companyId, companyId));
            expect(entries.map((entry) => entry.id).sort()).toEqual([...entryIds.values()].sort());
            for (const entry of entries) {
              expect(entry).toMatchObject({
                sourceType: "amortizacija", status: "draft", postedAt: null, approvedBy: null,
              });
            }
            const lines = await db.select().from(journalEntryLinesTable)
              .where(eq(journalEntryLinesTable.entryId, entryId));
            expect(lines).toHaveLength(2);
            expect(lines.map((line) => [line.side, line.accountId, Number(line.amount)]))
              .toEqual(expect.arrayContaining([
                ["debit", expense.id, month * 100],
                ["credit", correction.id, month * 100],
              ]));
          }
        }
        expect(new Set(entryIds.values()).size).toBe(2);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }

    // Verify rollback using the normal pool, with no cleanup DELETEs or disabled guards.
    expect(await db.select({ id: companiesTable.id }).from(companiesTable)
      .where(eq(companiesTable.id, companyId))).toEqual([]);
    expect(await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(inArray(journalEntriesTable.id, [...entryIds.values()]))).toEqual([]);
    expect(await db.select({ id: osAmortizacijaObracunTable.id }).from(osAmortizacijaObracunTable)
      .where(eq(osAmortizacijaObracunTable.companyId, companyId))).toEqual([]);
  });
});
