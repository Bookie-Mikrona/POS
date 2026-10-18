import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

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
    req.clerkUserId = req.get("X-Test-User") ?? "TEST-amortization-draft";
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
let foreignCompanyId: string;
const ownerUser = "TEST-amortization-owner";
const accountantUser = "TEST-amortization-accountant";
const viewerUser = "TEST-amortization-viewer";
const foreignOwnerUser = "TEST-amortization-foreign-owner";
const noAccessUser = "TEST-amortization-no-access";
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
  const primary = await createCompanyFixture("primary", "TEST-amortization-draft");
  ({ companyId, periodId, expenseId, adjustmentId } = primary);
  const foreign = await createCompanyFixture("foreign", foreignOwnerUser);
  foreignCompanyId = foreign.companyId;
  await db.insert(accountingRolesTable).values([
    { companyId, clerkUserId: ownerUser, role: "owner" },
    { companyId, clerkUserId: accountantUser, role: "accountant" },
    { companyId, clerkUserId: viewerUser, role: "viewer" },
  ]);
});

async function createCompanyFixture(label: string, clerkUserId: string) {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TEST_AMORT_DRAFT_${label}_${Date.now()}`, naziv: `TEST amortization draft ${label}`,
  }).returning();
  const companyId = company.id;
  await db.insert(companyModulesTable).values(
    (["erp", "osnovna_sredstva"] as const).map(module => ({
      companyId, module, enabledBy: clerkUserId,
    })),
  );
  await db.insert(osRolesTable).values({
    companyId, clerkUserId, role: "os_admin",
  });
  await db.insert(accountingRolesTable).values({
    companyId, clerkUserId, role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "TEST 2024", startDate: "2024-01-01", endDate: "2024-12-31", status: "open",
  }).returning();
  const periodId = period.id;
  const [expense, adjustment] = await db.insert(accountsTable).values([
    { companyId, code: "4300000", name: "Amortizacija", type: "expense" },
    { companyId, code: "0500000", name: "Popravek vrednosti", type: "asset" },
  ]).returning();
  const expenseId = expense.id;
  const adjustmentId = adjustment.id;
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
  return { companyId, periodId, expenseId, adjustmentId };
}

afterAll(async () => {
  finish?.();
  try { await transactionFinished; } finally { isolation.tx = null; }
  try {
    const fixtureIds = [companyId, foreignCompanyId].filter(Boolean);
    const remainingCompanies = await db.select().from(companiesTable)
      .where(inArray(companiesTable.id, fixtureIds));
    expect(remainingCompanies).toHaveLength(0);
  } finally {
    await pool.end();
  }
});

async function createAmortization(
  mesec: number, targetCompanyId = companyId, clerkUserId = "TEST-amortization-draft",
) {
  const response = await request(app).post(`/os/${targetCompanyId}/amortizacija/knjizenje`)
    .set("X-Test-User", clerkUserId)
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

describe("amortization posting does not disclose another company's journal", () => {
  let ownEntry: typeof journalEntriesTable.$inferSelect;
  let foreignEntry: typeof journalEntriesTable.$inferSelect;

  beforeAll(async () => {
    ownEntry = await createAmortization(4);
    foreignEntry = await createAmortization(4, foreignCompanyId, foreignOwnerUser);
    expect(ownEntry.companyId).toBe(companyId);
    expect(foreignEntry.companyId).toBe(foreignCompanyId);
  });

  async function snapshotEntries() {
    const ids = [ownEntry.id, foreignEntry.id];
    return {
      entries: await db.select().from(journalEntriesTable)
        .where(inArray(journalEntriesTable.id, ids)).orderBy(journalEntriesTable.id),
      lines: await db.select().from(journalEntryLinesTable)
        .where(inArray(journalEntryLinesTable.entryId, ids)).orderBy(journalEntryLinesTable.id),
    };
  }

  it.each([
    { role: "owner", user: ownerUser, target: "own", entry: "foreign", status: 404 },
    { role: "accountant", user: accountantUser, target: "own", entry: "foreign", status: 404 },
    { role: "viewer", user: viewerUser, target: "own", entry: "foreign", status: 403 },
    { role: "viewer", user: viewerUser, target: "own", entry: "own", status: 403 },
    { role: "no access", user: noAccessUser, target: "own", entry: "own", status: 403 },
    { role: "no access", user: noAccessUser, target: "own", entry: "foreign", status: 403 },
    { role: "owner", user: ownerUser, target: "foreign", entry: "foreign", status: 403 },
    { role: "accountant", user: accountantUser, target: "foreign", entry: "foreign", status: 403 },
    { role: "viewer", user: viewerUser, target: "foreign", entry: "foreign", status: 403 },
    { role: "no access", user: noAccessUser, target: "foreign", entry: "foreign", status: 403 },
  ])("returns $status for $role posting $entry entry via $target company", async ({ user, target, entry, status }) => {
    const targetCompanyId = target === "own" ? companyId : foreignCompanyId;
    const entryId = entry === "own" ? ownEntry.id : foreignEntry.id;
    const before = await snapshotEntries();
    expect(before.entries).toHaveLength(2);
    for (const journal of before.entries) {
      expect(journal).toMatchObject({ status: "draft", sourceType: "amortizacija", postedAt: null });
      expect(before.lines.filter(line => line.entryId === journal.id).length).toBeGreaterThanOrEqual(2);
    }

    const response = await request(app)
      .post(`/companies/${targetCompanyId}/entries/${entryId}/post`)
      .set("X-Test-User", user).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(response.body).toEqual(status === 404
      ? { code: "ACCOUNT_NOT_FOUND", message: "Temeljnica ni najdena" }
      : { error: user === viewerUser && target === "own"
        ? "Za knjiženje potrebujete vlogo računovodja ali lastnik"
        : "Dostop do tega podjetja ni dovoljen" });
    expect(JSON.stringify(response.body)).not.toMatch(/amortiza|osnutek|sourceType/i);
    expect(JSON.stringify(response.body)).not.toContain(entryId);
    expect(await snapshotEntries()).toEqual(before);
  });
});

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
      .where(eq(accountingRolesTable.clerkUserId, "TEST-amortization-draft"));
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
