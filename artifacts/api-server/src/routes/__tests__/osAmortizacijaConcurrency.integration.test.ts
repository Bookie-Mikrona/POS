import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";

// Identity only: authorization, calculations, SQL, locks and commits stay real.
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { clerkUserId: string }).clerkUserId = "TEST-amort-concurrency";
    next();
  },
}));
vi.mock("../../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import {
  db, pool, companiesTable, companyModulesTable, osRolesTable,
  accountingPeriodsTable, accountsTable, osAmortizacijaNastavitveTable,
  osAmortizacijskeSkupineTable, osnovnaSredstvaTable, osDoknjizbeTable,
  journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import router from "../osAmortizacijaKnjizenje";

const app = express();
app.use(express.json(), router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

beforeAll(async () => {
  const name = process.env.AMORTIZATION_TEST_DATABASE_NAME;
  if (!name || !/^bookie_[a-f0-9]{32}_amort_test$/.test(name)) {
    throw new Error("Run via run-isolated-amortization-tests.ts, never against business data.");
  }
  const result = await pool.query("SELECT current_database() AS name");
  expect(result.rows[0].name).toBe(name);
  expect((await db.select().from(companiesTable))).toEqual([]);
});
afterAll(() => pool.end());

async function fixture() {
  const [company] = await db.insert(companiesTable).values({
    naziv: "TEST concurrent amortization", podjetjeDavcna: `TEST-amort-${randomUUID()}`,
  }).returning();
  const companyId = company.id;
  await db.insert(companyModulesTable).values(
    (["erp", "osnovna_sredstva"] as const).map(module => ({
      companyId, module, enabledBy: "TEST-amort-concurrency",
    })),
  );
  await db.insert(osRolesTable).values({
    companyId, clerkUserId: "TEST-amort-concurrency", role: "os_admin",
  });
  await db.insert(accountingPeriodsTable).values({
    companyId, name: "TEST 2024", startDate: "2024-01-01", endDate: "2024-12-31", status: "open",
  });
  const [expense, adjustment] = await db.insert(accountsTable).values([
    { companyId, code: "4300000", name: "Amortizacija", type: "expense" },
    { companyId, code: "0500000", name: "Popravek vrednosti", type: "asset" },
  ]).returning();
  await db.insert(osAmortizacijaNastavitveTable).values({
    companyId, kontoStroskaId: expense.id, kontoPopravkaId: adjustment.id,
  });
  const [group] = await db.insert(osAmortizacijskeSkupineTable).values({
    companyId, koda: "TEST", naziv: "TEST oprema", racunovodskaStonja: "20", davcnaStonja: "20",
  }).returning();
  const [asset] = await db.insert(osnovnaSredstvaTable).values({
    companyId, inventarnaSt: "TEST-1", naziv: "TEST stroj", skupinaId: group.id, status: "active",
  }).returning();
  await db.insert(osDoknjizbeTable).values({
    sredstvoId: asset.id, seq: 0, nabavnaVrednost: "12000.00",
    datumNabave: "2023-01-01", datumAktivacije: "2023-01-01", status: "active",
  });
  return { companyId, expenseId: expense.id, adjustmentId: adjustment.id };
}

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for concurrent request/lock")), 8_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const cases = [
  { label: "annual / annual", firstMonth: undefined, secondMonth: undefined, code: "DUPLICATE_PERIOD" },
  { label: "monthly / same month", firstMonth: 6, secondMonth: 6, code: "DUPLICATE_PERIOD" },
  { label: "annual wins over monthly", firstMonth: undefined, secondMonth: 6, code: "ANNUAL_EXISTS_FOR_YEAR" },
  { label: "monthly wins over annual", firstMonth: 6, secondMonth: undefined, code: "MONTHLY_EXISTS_FOR_YEAR" },
];

describe("concurrent amortization posting — real HTTP and PostgreSQL", () => {
  it.each(cases)("$label: one draft, a waiting request gets 409 and no extra lines", async ({
    firstMonth, secondMonth, code,
  }) => {
    const { companyId, expenseId, adjustmentId } = await fixture();
    const lineCountBefore = (await db.select({ id: journalEntryLinesTable.id })
      .from(journalEntryLinesTable)).length;
    const acquired = signal<number>();
    const secondStarted = signal<number>();
    const release = signal<void>();
    const original = db.transaction.bind(db);
    let transactionNumber = 0;

    // Test scheduling only: pause AFTER PostgreSQL grants the first real lock.
    // Each HTTP request still gets its own real transaction and pool connection.
    const spy = vi.spyOn(db, "transaction").mockImplementation((callback, config) => {
      const ordinal = ++transactionNumber;
      return original(async tx => {
        await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
        const backend = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        const pid = backend.rows[0].pid;
        if (ordinal === 2) secondStarted.resolve(pid);
        const executor = new Proxy(tx, {
          get(target, key) {
            if (key === "execute" && ordinal === 1) {
              return async (...args: Parameters<typeof tx.execute>) => {
                const result = await target.execute(...args);
                acquired.resolve(pid);
                await release.promise;
                return result;
              };
            }
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return callback(executor);
      }, config);
    });
    const post = (mesec: number | undefined) =>
      request(app).post(`/os/${companyId}/amortizacija/knjizenje`)
        .send({ leto: 2024, ...(mesec === undefined ? {} : { mesec }), dryRun: false })
        .then(response => response);
    const first = post(firstMonth);
    let second: ReturnType<typeof post> | undefined;
    try {
      const firstPid = await bounded(acquired.promise);
      second = post(secondMonth);
      const secondPid = await bounded(secondStarted.promise);
      expect(secondPid).not.toBe(firstPid);
      // Assert actual PostgreSQL blocking, not merely two promises started.
      {
        const deadline = Date.now() + 8_000;
        let blocked = false;
        while (Date.now() < deadline) {
          const result = await pool.query(`
            SELECT wait_event FROM pg_stat_activity
            WHERE pid = $1 AND $2 = ANY(pg_blocking_pids(pid))
              AND wait_event_type = 'Lock' AND wait_event = 'advisory'
          `, [secondPid, firstPid]);
          if (result.rows.length === 1) {
            blocked = true;
            break;
          }
          await delay(10);
        }
        expect(blocked, "second request must wait on the first request's PostgreSQL advisory lock").toBe(true);
      }
      expect(await db.select().from(journalEntriesTable)
        .where(eq(journalEntriesTable.companyId, companyId))).toEqual([]);
      release.resolve();
      const [winner, loser] = await bounded(Promise.all([first, second]));
      expect(winner.status, JSON.stringify(winner.body)).toBe(201);
      expect(winner.body.status).toBe("draft");
      expect(loser.status, JSON.stringify(loser.body)).toBe(409);
      expect(loser.body.code).toBe(code);
      expect(loser.body.existingEntries).toEqual([{ entryId: winner.body.entryId, status: "draft" }]);
      if (code === "DUPLICATE_PERIOD") {
        expect(loser.body.existingEntryId).toBe(winner.body.entryId);
        expect(loser.body.existingStatus).toBe("draft");
      }
      const entries = await db.select().from(journalEntriesTable)
        .where(eq(journalEntriesTable.companyId, companyId));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: winner.body.entryId, status: "draft", sourceType: "amortizacija",
        reference: firstMonth === undefined ? "AMORT:2024" : "AMORT:2024-06",
        postedAt: null, approvedBy: null,
      });
      const lines = await db.select().from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, entries[0].id));
      expect(lines).toHaveLength(2);
      expect((await db.select({ id: journalEntryLinesTable.id })
        .from(journalEntryLinesTable)).length).toBe(lineCountBefore + 2);
      const amount = firstMonth === undefined ? "2400.00" : "200.00";
      expect(lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: expenseId, side: "debit", amount }),
        expect.objectContaining({ accountId: adjustmentId, side: "credit", amount }),
      ]));
      // A fresh read confirms the conflict did not alter the winning draft.
      const replay = await post(secondMonth);
      expect(replay.status).toBe(409);
      expect(replay.body.existingEntries).toEqual(loser.body.existingEntries);
      expect(await db.select().from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, entries[0].id))).toEqual(lines);
      // All fixtures live only in the disposable database, removed by the launcher.
    } finally {
      release.resolve();
      await Promise.allSettled([first, ...(second ? [second] : [])]);
      spy.mockRestore();
    }
  });
});
