import { describe, it, expect, vi, afterAll } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

const state = vi.hoisted(() => ({ tx: null as any, user: "vat-submission-test" }));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<typeof import("@workspace/db")>();
  return { ...actual, db: new Proxy(actual.db, {
    get(target, key) {
      const executor = state.tx ?? target;
      const value = executor[key];
      return typeof value === "function" ? value.bind(executor) : value;
    },
  }) };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth(req: any, _res: any, next: any) { req.clerkUserId = state.user; next(); },
}));

import {
  accountingPeriodsTable, accountingRolesTable, companiesTable,
  journalEntriesTable, vatLedgerTable, vatSubmissionsTable,
} from "@workspace/db";
import router from "./vatSubmissions";
import { generateKirKprXml } from "../lib/vatXmlGenerator";
import { archivedSubmissionHeader, markVatSubmission, VatSubmissionConflict } from "../lib/markVatSubmission";

const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
const app = express();
app.use(express.json(), router);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(500).json({ error: err.message });
});

afterAll(() => actual.pool.end());

async function isolated(run: (tx: any) => Promise<void>) {
  const rollback = new Error("test rollback");
  try {
    await actual.db.transaction(async tx => {
      state.tx = tx;
      try { await run(tx); } finally { state.tx = null; }
      throw rollback;
    });
  } catch (err) { if (err !== rollback) throw err; }
}

async function fixture(tx: any, mode: "mesecno" | "trimesecno" = "mesecno") {
  const [company] = await tx.insert(companiesTable).values({
    naziv: "KIR KPR rollback test", podjetjeDavcna: `TEST_${crypto.randomUUID()}`,
  }).returning();
  await tx.insert(accountingRolesTable).values({
    companyId: company.id, clerkUserId: state.user, role: "accountant",
  });
  const [period] = await tx.insert(accountingPeriodsTable).values({
    companyId: company.id, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31",
  }).returning();
  const [entry] = await tx.insert(journalEntriesTable).values({
    companyId: company.id, periodId: period.id, entryDate: "2026-03-12",
    description: "Test", createdBy: state.user,
  }).returning();
  const codes = await tx.execute(sql`SELECT id, code FROM vat_code WHERE code IN ('S22', 'P22') AND valid_to IS NULL`);
  const code = (name: string) => {
    const found = codes.rows.find((row: any) => row.code === name);
    if (!found) throw new Error(`Missing seeded VAT code ${name}`);
    return found.id;
  };
  const rows = await tx.insert(vatLedgerTable).values([
    { direction: "OUT", vatCodeId: code("S22"), documentNo: "KIR-TEST" },
    { direction: "IN", vatCodeId: code("P22"), documentNo: "KPR-TEST", receiptDate: "2026-03-12" },
    { direction: "OUT", vatCodeId: code("S22"), documentNo: "JAN-TEST", taxPointDate: "2026-01-10" },
  ].map(row => ({
    journalEntryId: entry.id, invoiceDate: "2026-03-12", serviceDate: "2026-03-12",
    postingDate: "2026-03-12", taxPointDate: "2026-03-12", vatPeriod: "0703", vatPeriodYear: 2026,
    baseAmount: "100.00", vatAmount: "22.00", createdBy: state.user, ...row,
  }))).returning();
  const from = mode === "mesecno" ? "2026-03-01" : "2026-01-01";
  const generated = await generateKirKprXml(company.id, company.podjetjeDavcna, 2026, "0703", from, "2026-03-31", {}, tx);
  const [submission] = await tx.insert(vatSubmissionsTable).values({
    companyId: company.id, periodYear: 2026, period: "0703", kind: "BOTH",
    xmlInline: generated.xml, kirCount: generated.kirCount, kprCount: generated.kprCount,
    createdBy: state.user,
  }).returning();
  const path = `/companies/${company.id}/vat-submissions/${submission.id}/mark-submitted`;
  return { company, submission, rows, path };
}

// Real independent connections need committed fixtures. Keep all such data in a
// disposable schema rather than leaving protected financial rows in public.
const connectionPids = new WeakMap<object, number>();
async function twoConnections(run: (writer: any, marker: any, writerDb: any, fixtureData: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
  const schema = `vat_submit_${crypto.randomUUID().replaceAll("-", "")}`;
  const writer = await actual.pool.connect();
  const marker = await actual.pool.connect();
  try {
    for (const client of [writer, marker]) {
      const { rows: [{ pid }] } = await client.query("SELECT pg_backend_pid() AS pid");
      connectionPids.set(client, pid);
    }
    await writer.query(`CREATE SCHEMA "${schema}"`);
    for (const table of [
      "companies", "accounting_roles", "accounting_periods", "journal_entries",
      "invoices", "documents", "vat_code", "vat_ledger", "vat_submissions",
    ]) {
      await writer.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await writer.query(`INSERT INTO "${schema}".vat_code SELECT * FROM public.vat_code`);
    await writer.query(`CREATE TRIGGER immutable_update BEFORE UPDATE ON "${schema}".vat_ledger
      FOR EACH ROW EXECUTE FUNCTION public.vat_ledger_immutability_check()`);
    await writer.query(`CREATE TRIGGER immutable_delete BEFORE DELETE ON "${schema}".vat_ledger
      FOR EACH ROW EXECUTE FUNCTION public.vat_ledger_immutability_check_delete()`);
    await writer.query(`SET search_path TO "${schema}", public`);
    await marker.query(`SET search_path TO "${schema}", public`);
    const writerDb = drizzle(writer);
    const f = await fixture(writerDb);
    state.tx = drizzle(marker);
    await run(writer, marker, writerDb, f);
  } finally {
    state.tx = null;
    await writer.query("ROLLBACK");
    await marker.query("ROLLBACK");
    await writer.query("RESET search_path");
    await marker.query("RESET search_path");
    await writer.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    writer.release();
    marker.release();
  }
}

async function expectLockWait(client: any) {
  const pid = connectionPids.get(client);
  await vi.waitFor(async () => {
    const result = await actual.pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid]);
    expect(result.rows[0]?.wait_event_type).toBe("Lock");
  }, { timeout: 5000, interval: 25 });
}

async function insertConcurrent(writerDb: any, f: Awaited<ReturnType<typeof fixture>>) {
  return writerDb.insert(vatLedgerTable).values({
    ...f.rows[0], id: crypto.randomUUID(), documentNo: "CONCURRENT-INSERT",
    createdAt: new Date(),
  }).returning();
}

describe("manual KIR/KPR submission", () => {
  it.each(["mesecno", "trimesecno"] as const)("atomically marks the archived %s scope, preserves replay timestamps and activates immutability", async mode => {
    await isolated(async tx => {
      const f = await fixture(tx, mode);
      const list = await supertest(app).get(`/companies/${f.company.id}/vat-submissions`);
      expect(list.status).toBe(200);
      expect(list.body.submissions[0].periodFrom).toBe(mode === "mesecno" ? "2026-03-01" : "2026-01-01");
      expect(list.body.submissions[0].periodTo).toBe("2026-03-31");
      expect(list.body.submissions[0].xmlInline).toBeUndefined();
      const first = await supertest(app).post(f.path);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.status).toBe("submitted");
      const ledger = await tx.select().from(vatLedgerTable).where(inArray(vatLedgerTable.id, f.rows.map((r: any) => r.id)));
      expect(ledger.filter((r: any) => r.reportedAt)).toHaveLength(mode === "mesecno" ? 2 : 3);
      for (const row of ledger.filter((r: any) => r.reportedAt)) {
        expect(row.reportedPeriod).toBe("202603");
        expect(row.reportedAt.toISOString()).toBe(first.body.submittedAt);
      }
      const second = await supertest(app).post(f.path);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      const [saved] = await tx.select().from(vatSubmissionsTable).where(eq(vatSubmissionsTable.id, f.submission.id));
      expect(saved.submittedAt.toISOString()).toBe(first.body.submittedAt);
      const protectedId = f.rows[0].id;
      await expect(tx.transaction(async (sp: any) => {
        await sp.update(vatLedgerTable).set({ baseAmount: "999" }).where(eq(vatLedgerTable.id, protectedId));
      })).rejects.toThrow();
      await expect(tx.transaction(async (sp: any) => {
        await sp.delete(vatLedgerTable).where(eq(vatLedgerTable.id, protectedId));
      })).rejects.toThrow();
    });
  });

  it("denies viewers, foreign-company submissions and malformed IDs without marking anything", async () => {
    await isolated(async tx => {
      const f = await fixture(tx);
      await tx.update(accountingRolesTable).set({ role: "viewer" }).where(eq(accountingRolesTable.companyId, f.company.id));
      expect((await supertest(app).post(f.path)).status).toBe(403);
      await tx.update(accountingRolesTable).set({ role: "accountant" }).where(eq(accountingRolesTable.companyId, f.company.id));
      const foreign = await fixture(tx);
      expect((await supertest(app).post(`/companies/${f.company.id}/vat-submissions/${foreign.submission.id}/mark-submitted`)).status).toBe(404);
      expect((await supertest(app).post(f.path.replace(f.submission.id, "invalid"))).status).toBe(400);
      const unchanged = await tx.select().from(vatLedgerTable).where(inArray(vatLedgerTable.id, [...f.rows, ...foreign.rows].map((r: any) => r.id)));
      expect(unchanged.every((r: any) => r.reportedAt === null)).toBe(true);
    });
  });

  it("refuses a changed export and preflight errors without partially marking rows", async () => {
    await isolated(async tx => {
      const f = await fixture(tx);
      await tx.update(vatLedgerTable).set({ baseAmount: "200" }).where(eq(vatLedgerTable.id, f.rows[0].id));
      expect((await supertest(app).post(f.path)).status).toBe(409);
      await tx.update(vatLedgerTable).set({ baseAmount: "100" }).where(eq(vatLedgerTable.id, f.rows[0].id));
      await tx.update(vatLedgerTable).set({ receiptDate: null }).where(eq(vatLedgerTable.id, f.rows[1].id));
      const invalid = await supertest(app).post(f.path);
      expect(invalid.status).toBe(409);
      expect(invalid.body.error).toContain("napake");
      const [submission] = await tx.select().from(vatSubmissionsTable).where(eq(vatSubmissionsTable.id, f.submission.id));
      expect(submission.status).toBe("draft");
      expect(submission.submittedAt).toBeNull();
      const ledger = await tx.select().from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, f.rows[0].journalEntryId));
      expect(ledger.every((r: any) => r.reportedAt === null)).toBe(true);
    });
  });

  it("does not relabel previously reported rows or downgrade an accepted submission", async () => {
    await isolated(async tx => {
      const f = await fixture(tx);
      const oldDate = new Date("2026-04-01T10:00:00Z");
      await tx.update(vatLedgerTable).set({ reportedAt: oldDate, reportedPeriod: "202602" }).where(eq(vatLedgerTable.id, f.rows[0].id));
      expect((await supertest(app).post(f.path)).status).toBe(200);
      const [row] = await tx.select().from(vatLedgerTable).where(eq(vatLedgerTable.id, f.rows[0].id));
      expect(row.reportedPeriod).toBe("202602");
      expect(row.reportedAt).toEqual(oldDate);
      await tx.update(vatSubmissionsTable).set({ status: "accepted" }).where(eq(vatSubmissionsTable.id, f.submission.id));
      const replay = await supertest(app).post(f.path);
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe("accepted");
    });
  });

  it("rejects ambiguous or invalid archived periods", () => {
    expect(() => archivedSubmissionHeader("<invalid/>", 2026, "0703")).toThrow("obdobja");
  });

  it("waits for an in-flight insert and refuses the now-stale archive", async () => {
    await twoConnections(async (writer, marker, writerDb, f) => {
      await writer.query("BEGIN");
      await insertConcurrent(writerDb, f);
      const resultPromise = markVatSubmission(f.company.id, f.submission.id, async () => ({ rows: [] }))
        .then(result => ({ result, error: null }), error => ({ result: null, error }));
      try {
        await expectLockWait(marker);
      } finally {
        await writer.query("COMMIT");
      }
      const result = await resultPromise;
      expect(result.error).toBeInstanceOf(VatSubmissionConflict);
      const [saved] = await writerDb.select().from(vatSubmissionsTable).where(eq(vatSubmissionsTable.id, f.submission.id));
      expect(saved.status).toBe("draft");
      const ledger = await writerDb.select().from(vatLedgerTable);
      expect(ledger.every((row: any) => row.reportedAt === null)).toBe(true);
    });
  });

  it("blocks an insert during confirmation, then serializes it after submission without falsely reporting it", async () => {
    await twoConnections(async (writer, _marker, writerDb, f) => {
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const preflightEntered = new Promise<void>(resolve => { entered = resolve; });
      const marking = markVatSubmission(f.company.id, f.submission.id, async () => {
        entered();
        await blocked;
        return { rows: [] };
      });
      await preflightEntered;
      const inserting = insertConcurrent(writerDb, f);
      // Drizzle queries are lazy: attach a handler to start the actual insert.
      const inserted = inserting.then((rows: any) => rows);
      try {
        await expectLockWait(writer);
      } finally {
        release();
      }
      const submitted = await marking;
      const [lateRow] = await inserted;
      expect(submitted?.status).toBe("submitted");
      expect(lateRow.reportedAt).toBeNull();
      const replay = await markVatSubmission(f.company.id, f.submission.id, async () => {
        throw new Error("Replay must not revalidate or mark the later row");
      });
      expect(replay).toEqual(submitted);
      const ledger = await writerDb.select().from(vatLedgerTable);
      expect(ledger.filter((row: any) => row.reportedAt)).toHaveLength(2);
    });
  });
});
