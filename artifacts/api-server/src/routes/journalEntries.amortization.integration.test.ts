import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

const isolation = vi.hoisted(() => ({ root: null as any, tx: null as any }));
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");
  isolation.root = actual.db;
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(_target, key) {
        const executor = isolation.tx ?? actual.db;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "TEST-amortization-draft";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import {
  db, pool, companiesTable, companyModulesTable, accountingRolesTable,
  accountingPeriodsTable, accountsTable, osRolesTable, osAmortizacijaNastavitveTable,
  osAmortizacijskeSkupineTable, osnovnaSredstvaTable, osDoknjizbeTable,
  journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import journalsRouter from "./journalEntries";
import amortizationRouter from "./osAmortizacijaKnjizenje";

const app = express();
app.use(express.json(), journalsRouter, amortizationRouter);
app.use((err: any, _req: any, res: any, _next: any) => {
  res.status(500).json({ error: err.message });
});

let companyId: string, periodId: string, expenseId: string, adjustmentId: string;
let finish: (() => void) | undefined;
let transactionFinished: Promise<void>;
const rollback = new Error("Rollback amortization test fixtures");

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  transactionFinished = isolation.root.transaction(async (tx: any) => {
    isolation.tx = tx;
    ready();
    await new Promise<void>(resolve => { finish = resolve; });
    throw rollback;
  }).catch((error: unknown) => { if (error !== rollback) throw error; });
  await started;
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TEST_AMORT_DRAFT_${Date.now()}`, naziv: "TEST amortization draft",
  }).returning();
  companyId = company.id;
  await db.insert(companyModulesTable).values(
    (["erp", "osnovna_sredstva"] as const).map(module => ({
      companyId, module, enabledBy: "TEST-amortization-draft",
    })),
  );
  await db.insert(osRolesTable).values({
    companyId, clerkUserId: "TEST-amortization-draft", role: "os_admin",
  });
  await db.insert(accountingRolesTable).values({
    companyId, clerkUserId: "TEST-amortization-draft", role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "TEST 2024", startDate: "2024-01-01", endDate: "2024-12-31", status: "open",
  }).returning();
  periodId = period.id;
  const [expense, adjustment] = await db.insert(accountsTable).values([
    { companyId, code: "4300000", name: "Amortizacija", type: "expense" },
    { companyId, code: "0500000", name: "Popravek vrednosti", type: "asset" },
  ]).returning();
  expenseId = expense.id;
  adjustmentId = adjustment.id;
  await db.insert(osAmortizacijaNastavitveTable).values({
    companyId, kontoStroskaId: expenseId, kontoPopravkaId: adjustmentId,
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
});

afterAll(async () => {
  finish?.();
  try { await transactionFinished; } finally { isolation.tx = null; }
  if (companyId) {
    const remaining = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    expect(remaining).toHaveLength(0);
  }
  await pool.end();
});

async function createAmortization(mesec: number) {
  const response = await request(app).post(`/os/${companyId}/amortizacija/knjizenje`)
    .send({ leto: 2024, mesec, dryRun: false });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect(response.body.status).toBe("draft");
  const [entry] = await db.select().from(journalEntriesTable)
    .where(eq(journalEntriesTable.id, response.body.entryId));
  expect(entry).toMatchObject({
    status: "draft", sourceType: "amortizacija", postedAt: null, approvedBy: null,
  });
  return entry;
}

describe("amortization drafts cannot be posted through general journals", () => {
  it("rejects autoPost amortization creation through the general API without inserting an entry", async () => {
    const before = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    const response = await request(app).post(`/companies/${companyId}/entries`).send({
      periodId, documentDate: "2024-01-31", entryDate: "2024-01-31",
      description: "TEST amortization autoPost bypass", sourceType: "amortizacija", autoPost: true,
      lines: [
        { accountId: expenseId, side: "debit", amount: 100 },
        { accountId: adjustmentId, side: "credit", amount: 100 },
      ],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body).toMatchObject({ code: "ACCESS_DENIED", message: expect.stringContaining("osnutek") });
    const after = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    expect(after).toEqual(before);
  });

  it("creates a real draft and rejects direct posting for an accounting owner", async () => {
    const entry = await createAmortization(1);
    const response = await request(app).post(`/companies/${companyId}/entries/${entry.id}/post`).send({});
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "ACCESS_DENIED", message: expect.stringContaining("osnutek") });
    const [unchanged] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entry.id));
    expect(unchanged).toEqual(entry);
  });

  it("posts ordinary drafts in a series but leaves amortization untouched for an accountant", async () => {
    await db.update(accountingRolesTable).set({ role: "accountant" })
      .where(eq(accountingRolesTable.companyId, companyId));
    const amortization = await createAmortization(2);
    const [ordinary] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2024-02-29", entryDate: "2024-02-29",
      description: "TEST ordinary draft", sourceType: "manual", status: "draft",
      createdBy: "TEST-amortization-draft",
    }).returning();
    await db.insert(journalEntryLinesTable).values([
      { entryId: ordinary.id, accountId: expenseId, side: "debit", amount: "100.00", sequence: 1 },
      { entryId: ordinary.id, accountId: adjustmentId, side: "credit", amount: "100.00", sequence: 2 },
    ]);
    // No bulk endpoint exists: exercise the real per-entry API used by a series.
    for (const entry of [amortization, ordinary]) {
      const response = await request(app).post(`/companies/${companyId}/entries/${entry.id}/post`).send({});
      expect(response.status, JSON.stringify(response.body)).toBe(entry.id === amortization.id ? 409 : 200);
    }
    const [preserved] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, amortization.id));
    expect(preserved).toEqual(amortization);
    const [posted] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, ordinary.id));
    expect(posted.status).toBe("posted");
  });

  it("does not allow PATCH status=posted to bypass posting policy", async () => {
    const entry = await createAmortization(3);
    const response = await request(app).patch(`/companies/${companyId}/entries/${entry.id}`)
      .send({ status: "posted", sourceType: "manual" });
    expect(response.status).toBe(404);
    const [preserved] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entry.id));
    expect(preserved).toEqual(entry);
  });
});
