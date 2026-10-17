import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    req.clerkUserId = "TEST-journal-dimension-scope";
    next();
  },
}));

import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, costCentersTable, projectsTable,
  departmentsTable, vatCodesTable, vatCodeTable, journalEntriesTable,
  journalEntryLinesTable,
} from "@workspace/db";
import router from "./journalEntries";

const app = express();
app.use(express.json(), router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

const keys = ["partnerId", "costCenterId", "projectId", "departmentId"] as const;
type DimensionKey = typeof keys[number];
type Dimensions = Record<DimensionKey, string>;
const errors: Record<DimensionKey, string> = {
  partnerId: "Vsaj en partner",
  costCenterId: "Vsaj eno stroškovno mesto",
  projectId: "Vsaj en projekt",
  departmentId: "Vsaj en oddelek",
};
let companyId: string;
let periodId: string;
let accountId: string;
let own: Dimensions;
let foreign: Dimensions;
let companyVatIds: string[];
let foreignVatId: string;
let fursId: string;
let finish: (() => void) | undefined;
let transactionFinished: Promise<void> | undefined;
const rollback = new Error("Rollback journal dimension fixtures");

async function seedDimensions(id: string): Promise<Dimensions> {
  const [partner] = await db.insert(counterpartiesTable).values({
    companyId: id, name: "TEST partner", type: "supplier",
  }).returning();
  const [costCenter] = await db.insert(costCentersTable).values({
    companyId: id, code: "TEST", name: "TEST stroškovno mesto",
  }).returning();
  const [project] = await db.insert(projectsTable).values({
    companyId: id, code: "TEST", name: "TEST projekt",
  }).returning();
  const [department] = await db.insert(departmentsTable).values({
    companyId: id, code: "TEST", name: "TEST oddelek",
  }).returning();
  return { partnerId: partner!.id, costCenterId: costCenter!.id, projectId: project!.id, departmentId: department!.id };
}

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  transactionFinished = isolation.root.transaction(async (tx: any) => {
    isolation.tx = tx;
    ready();
    await new Promise<void>(resolve => { finish = resolve; });
    throw rollback;
  }).catch((error: unknown) => { if (error !== rollback) throw error; });
  await Promise.race([started, transactionFinished]);
  const run = randomUUID();
  const companies = await db.insert(companiesTable).values([
    { podjetjeDavcna: `TEST-DIM-A-${run}`, naziv: "TEST journal dimensions A" },
    { podjetjeDavcna: `TEST-DIM-B-${run}`, naziv: "TEST journal dimensions B" },
  ]).returning();
  companyId = companies[0]!.id;
  const foreignCompanyId = companies[1]!.id;
  await db.insert(accountingRolesTable).values({
    companyId, clerkUserId: "TEST-journal-dimension-scope", role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "TEST 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  }).returning();
  periodId = period!.id;
  const [account] = await db.insert(accountsTable).values({
    companyId, code: "1100000", name: "TEST konto", type: "asset",
  }).returning();
  accountId = account!.id;
  own = await seedDimensions(companyId);
  foreign = await seedDimensions(foreignCompanyId);
  const [furs] = await db.insert(vatCodeTable).values({
    code: `TEST-${run.slice(0, 8)}`, description: "TEST FURS", direction: "IN",
    rate: "22", validFrom: "2026-01-01",
  }).returning();
  fursId = furs!.id;
  const vat = await db.insert(vatCodesTable).values([
    { companyId, code: "TEST-A", name: "TEST A", rate: "22", fursCodeId: fursId },
    { companyId, code: "TEST-B", name: "TEST B", rate: "22", fursCodeId: fursId },
    { companyId: foreignCompanyId, code: "TEST-C", name: "TEST C", rate: "22", fursCodeId: fursId },
  ]).returning();
  companyVatIds = [vat[0]!.id, vat[1]!.id];
  foreignVatId = vat[2]!.id;
});

afterAll(async () => {
  finish?.();
  try {
    await transactionFinished;
  } finally {
    isolation.tx = null;
  }
  if (companyId) {
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toEqual([]);
  }
  await pool.end();
});

function payload(dimensions: Partial<Dimensions>, vatIds: string[] = []) {
  return {
    periodId, documentDate: "2026-05-01", entryDate: "2026-05-01",
    description: "TEST dimension ownership", autoPost: false,
    lines: (["debit", "credit"] as const).map((side, i) => ({
      accountId, side, amount: 100, ...dimensions,
      ...(vatIds.length ? { companyVatCodeId: vatIds[i % vatIds.length] } : {}),
    })),
  };
}

describe("journal creation validates each dimension in the entry company", () => {
  it.each(keys)("saves a valid %s without any company VAT code", async key => {
    const response = await request(app).post(`/companies/${companyId}/entries`)
      .send(payload({ [key]: own[key] }));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, response.body.id));
    expect(lines).toHaveLength(2);
    expect(lines.every(line => line[key] === own[key])).toBe(true);
  });

  it("accepts repeated own dimensions with two VAT codes and only one department", async () => {
    const response = await request(app).post(`/companies/${companyId}/entries`).send(payload(own, companyVatIds));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, response.body.id));
    expect(lines).toHaveLength(2);
    for (const [i, line] of lines.entries()) {
      expect(line).toMatchObject({ ...own, companyVatCodeId: companyVatIds[i], vatCodeId: fursId });
    }
  });

  it("accepts a company VAT code without dimensions", async () => {
    const response = await request(app).post(`/companies/${companyId}/entries`).send(payload({}, [companyVatIds[0]!]));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  });

  for (const withVat of [false, true]) {
    it.each(keys)(`rejects another company's %s (VAT code: ${withVat}) without inserting an entry`, async key => {
      const before = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
      const response = await request(app).post(`/companies/${companyId}/entries`)
        .send(payload({ ...own, [key]: foreign[key] }, withVat ? [companyVatIds[0]!] : []));
      expect(response.status, JSON.stringify(response.body)).toBe(400);
      expect(response.body.error).toContain(errors[key]);
      expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).toEqual(before);
    });
  }

  it.each(keys)("rejects a nonexistent %s", async key => {
    const response = await request(app).post(`/companies/${companyId}/entries`).send(payload({ [key]: randomUUID() }));
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.error).toContain(errors[key]);
  });

  it.each(["foreign", "missing"])("rejects a %s company VAT code independently of department count", async kind => {
    const before = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    const response = await request(app).post(`/companies/${companyId}/entries`)
      .send(payload(own, [kind === "foreign" ? foreignVatId : randomUUID()]));
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.error).toContain("DDV koda ne obstaja ali ne pripada");
    expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).toEqual(before);
  });
});
