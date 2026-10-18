import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";

// Keep the actual SQL and access checks, but route all queries through one
// real Drizzle transaction (including any nested savepoints).
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
    req.clerkUserId = "TEST-journal-list-dimensions";
    next();
  },
}));

import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, costCentersTable, projectsTable, departmentsTable,
  journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import router from "./journalEntries";

const app = express();
app.use(router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

const dimensionKeys = ["costCenterId", "projectId", "departmentId"] as const;
type DimensionKey = typeof dimensionKeys[number];
type Dimensions = Record<DimensionKey, string>;
type ListedEntry = {
  id: string;
  companyId: string;
  costCenterNames: string[];
  projectNames: string[];
  departmentNames: string[];
};
type Fixture = {
  companyId: string;
  entryIds: string[];
  dimensions: Dimensions[];
  expected: Pick<ListedEntry, "costCenterNames" | "projectNames" | "departmentNames">;
};
let own: Fixture;
let foreign: Fixture;
const companyIds: string[] = [];
const entryIds: string[] = [];
let finish: (() => void) | undefined;
let transactionFinished: Promise<void> | undefined;
const rollback = new Error("Rollback journal list dimension fixtures");

async function seedCompany(label: string): Promise<Fixture> {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TEST-LIST-DIM-${label}-${randomUUID()}`,
    naziv: `TEST journal list dimensions ${label}`,
  }).returning();
  const companyId = company!.id;
  companyIds.push(companyId);
  // The same authenticated user can access both companies: isolation must
  // come from the requested company, not from an incidental access denial.
  await db.insert(accountingRolesTable).values({
    companyId, clerkUserId: "TEST-journal-list-dimensions", role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "TEST 2026", startDate: "2026-01-01",
    endDate: "2026-12-31", status: "open",
  }).returning();
  const [account] = await db.insert(accountsTable).values({
    companyId, code: "1100000", name: "TEST konto", type: "asset",
  }).returning();
  // Distinct IDs with equal names prove deduplication by name, not by ID.
  // Empty names and missing FKs must never turn into blank/null array items.
  const names = [`${label} First`, `${label} Second`, `${label} First`, ""];
  const values = names.map((name, i) => ({ companyId, code: `TEST-${i}`, name }));
  const centers = await db.insert(costCentersTable).values(values).returning();
  const projects = await db.insert(projectsTable).values(values).returning();
  const departments = await db.insert(departmentsTable).values(values).returning();
  const dimensions = names.map((_, i) => ({
    costCenterId: centers[i]!.id,
    projectId: projects[i]!.id,
    departmentId: departments[i]!.id,
  }));
  const entries = await db.insert(journalEntriesTable).values(
    ["mixed", "null-dimensions", "empty-names", "no-lines"].map(description => ({
      companyId, periodId: period!.id, entryDate: "2026-05-01",
      description: `TEST ${label} ${description}`,
      createdBy: "TEST-journal-list-dimensions",
    })),
  ).returning();
  const ids = entries.map(entry => entry.id);
  entryIds.push(...ids);
  type LineDimensions = Partial<Record<DimensionKey, string | null>>;
  async function addLines(entryId: string, rows: LineDimensions[]) {
    await db.insert(journalEntryLinesTable).values(rows.map((dimensions, i) => ({
      entryId, accountId: account!.id, sequence: i,
      side: i % 2 === 0 ? "debit" as const : "credit" as const,
      amount: "10.00", ...dimensions,
    })));
  }
  // Each filter matches only the first row, but must preserve the names
  // contributed by the other rows (including other values of the filter itself).
  await addLines(ids[0]!, [
    dimensions[0]!, dimensions[1]!, dimensions[0]!, dimensions[2]!,
    dimensions[3]!, { costCenterId: null, projectId: null, departmentId: null },
  ]);
  await addLines(ids[1]!, [{}, {}]);
  await addLines(ids[2]!, [dimensions[3]!, dimensions[3]!]);
  return {
    companyId, entryIds: ids, dimensions,
    expected: {
      costCenterNames: names.slice(0, 2),
      projectNames: names.slice(0, 2),
      departmentNames: names.slice(0, 2),
    },
  };
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
  own = await seedCompany("A");
  foreign = await seedCompany("B");
});

afterAll(async () => {
  finish?.();
  try {
    await transactionFinished;
  } finally {
    isolation.tx = null;
    try {
      // Verify cleanup from outside the transaction, also after assertion/setup
      // failures. Do not delete financial records or disable integrity triggers.
      if (companyIds.length) {
        expect(await db.select({ id: companiesTable.id }).from(companiesTable)
          .where(inArray(companiesTable.id, companyIds))).toEqual([]);
      }
      if (entryIds.length) {
        expect(await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
          .where(inArray(journalEntriesTable.id, entryIds))).toEqual([]);
        expect(await db.select({ id: journalEntryLinesTable.id }).from(journalEntryLinesTable)
          .where(inArray(journalEntryLinesTable.entryId, entryIds))).toEqual([]);
      }
    } finally {
      await pool.end();
    }
  }
});

async function list(companyId: string, query: Partial<Dimensions> = {}): Promise<ListedEntry[]> {
  const response = await request(app).get(`/companies/${companyId}/entries`).query(query);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.entries).toBeInstanceOf(Array);
  return response.body.entries;
}

function expectDimensions(entry: ListedEntry | undefined, expected: Fixture["expected"]) {
  expect(entry).toBeDefined();
  for (const key of ["costCenterNames", "projectNames", "departmentNames"] as const) {
    expect(entry![key]).toBeInstanceOf(Array);
    // Do not impose an ordering that the SQL endpoint does not guarantee.
    expect([...entry![key]].sort()).toEqual([...expected[key]].sort());
  }
}

describe("GET journal entries aggregates all line dimensions independently of filters", () => {
  it("aggregates all three dimensions across lines and deduplicates equal names", async () => {
    const entries = await list(own.companyId);
    expect(entries.map(entry => entry.id).sort()).toEqual([...own.entryIds].sort());
    expect(entries.every(entry => entry.companyId === own.companyId)).toBe(true);
    expectDimensions(entries.find(entry => entry.id === own.entryIds[0]), own.expected);
  });

  it.each([
    [1, "only null dimension FKs"],
    [2, "empty dimension names"],
    [3, "no lines"],
  ] as const)("returns empty arrays for entry %i with %s", async (index, _description) => {
    const entries = await list(own.companyId);
    expectDimensions(entries.find(entry => entry.id === own.entryIds[index]), {
      costCenterNames: [], projectNames: [], departmentNames: [],
    });
  });

  it.each(dimensionKeys)("filtering by %s keeps every dimension from nonmatching lines", async key => {
    const entries = await list(own.companyId, { [key]: own.dimensions[0]![key] });
    expect(entries.map(entry => entry.id)).toEqual([own.entryIds[0]]);
    expectDimensions(entries[0], own.expected);
  });

  it.each(dimensionKeys)("returns no entries for an unknown %s", async key => {
    expect(await list(own.companyId, { [key]: randomUUID() })).toEqual([]);
  });

  it("keeps the other company's entries and dimension names separate", async () => {
    const entries = await list(foreign.companyId);
    expect(entries.map(entry => entry.id).sort()).toEqual([...foreign.entryIds].sort());
    expect(entries.every(entry => entry.companyId === foreign.companyId)).toBe(true);
    expectDimensions(entries.find(entry => entry.id === foreign.entryIds[0]), foreign.expected);
  });

  it.each(dimensionKeys)("does not find another company's entries through its %s", async key => {
    expect(await list(own.companyId, { [key]: foreign.dimensions[0]![key] })).toEqual([]);
    expect(await list(foreign.companyId, { [key]: own.dimensions[0]![key] })).toEqual([]);
    const entries = await list(foreign.companyId, { [key]: foreign.dimensions[0]![key] });
    expect(entries.map(entry => entry.id)).toEqual([foreign.entryIds[0]]);
    expectDimensions(entries[0], foreign.expected);
  });
});
