import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import type { db as database } from "@workspace/db";

type Database = typeof database;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const isolation = vi.hoisted(() => ({
  root: null as Database | null,
  tx: null as Transaction | null,
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  isolation.root = actual.db;
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(_target, key) {
        const executor = isolation.tx ?? actual.db;
        const value = Reflect.get(executor, key);
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: { clerkUserId?: string }, _res: unknown, next: () => void) => {
    req.clerkUserId = "TEST-os-account-patch";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import {
  db, pool, companiesTable, companyModulesTable, osRolesTable,
  accountsTable, osnovnaSredstvaTable,
} from "@workspace/db";
import router from "./osnovnaSredstva";

const app = express();
app.use(express.json(), router);

const accountFields = ["kontoStroskaId", "kontoPopravkaId"] as const;
type AccountField = typeof accountFields[number];
let companyId: string;
let foreignCompanyId: string;
let originalAccounts: Record<AccountField, string>;
let replacementAccounts: Record<AccountField, string>;
let foreignAccounts: Record<AccountField, string>;
let asset: typeof osnovnaSredstvaTable.$inferSelect;
let finish: (() => void) | undefined;
let transactionFinished: Promise<void> | undefined;
const rollback = new Error("Rollback asset account PATCH fixtures");

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  transactionFinished = isolation.root!.transaction(async (tx) => {
    isolation.tx = tx;
    ready();
    await new Promise<void>((resolve) => { finish = resolve; });
    throw rollback;
  }).catch((error: unknown) => {
    if (error !== rollback) throw error;
  });
  await Promise.race([started, transactionFinished]);

  const marker = randomUUID();
  const [company, foreignCompany] = await db.insert(companiesTable).values([
    { podjetjeDavcna: `TEST_OS_PATCH_${marker}`, naziv: "TEST asset accounts" },
    { podjetjeDavcna: `TEST_OS_FOREIGN_${marker}`, naziv: "TEST foreign accounts" },
  ]).returning();
  companyId = company.id;
  foreignCompanyId = foreignCompany.id;
  await db.insert(companyModulesTable).values({
    companyId, module: "osnovna_sredstva", enabledBy: "TEST-os-account-patch",
  });
  await db.insert(osRolesTable).values({
    companyId, clerkUserId: "TEST-os-account-patch", role: "os_user",
  });
  async function createAccounts(owner: string, suffix: string): Promise<Record<AccountField, string>> {
    const [expense, adjustment] = await db.insert(accountsTable).values([
      { companyId: owner, code: `430${suffix}`, name: "TEST strošek", type: "expense" },
      { companyId: owner, code: `050${suffix}`, name: "TEST popravek", type: "asset" },
    ]).returning();
    return { kontoStroskaId: expense.id, kontoPopravkaId: adjustment.id };
  }
  originalAccounts = await createAccounts(companyId, "0000");
  replacementAccounts = await createAccounts(companyId, "0001");
  // Deliberately use the same codes in both companies: ownership depends on ID.
  foreignAccounts = await createAccounts(foreignCompanyId, "0001");
});

beforeEach(async () => {
  [asset] = await db.insert(osnovnaSredstvaTable).values({
    companyId, inventarnaSt: randomUUID(), naziv: "TEST prvotni naziv",
    opomba: "TEST prvotna opomba", ...originalAccounts,
  }).returning();
});

afterAll(async () => {
  finish?.();
  try {
    await transactionFinished;
  } finally {
    isolation.tx = null;
    try {
      const ids = [companyId, foreignCompanyId].filter(Boolean);
      if (ids.length) {
        expect(await db.select({ id: companiesTable.id }).from(companiesTable)
          .where(inArray(companiesTable.id, ids))).toEqual([]);
      }
    } finally {
      await pool.end();
    }
  }
});

function patch(body: Record<string, unknown>) {
  return request(app).patch(`/companies/${companyId}/osnovna-sredstva/${asset.id}`).send(body);
}

async function storedAsset() {
  const [stored] = await db.select().from(osnovnaSredstvaTable)
    .where(eq(osnovnaSredstvaTable.id, asset.id));
  return stored;
}

describe("PATCH sredstva — konti pripadajo podjetju", () => {
  it.each(accountFields)("zavrne tuj %s brez delnega zapisa", async (field) => {
    const other = accountFields.find((candidate) => candidate !== field)!;
    const response = await patch({
      naziv: "TEST spremenjen naziv",
      opomba: "TEST spremenjena opomba",
      [field]: foreignAccounts[field],
      [other]: replacementAccounts[other],
    });

    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body).toEqual({ error: "Konto ni najden ali ne pripada temu podjetju" });
    // Check the entire persisted row, including the valid account and other edits.
    expect(await storedAsset()).toEqual(asset);
  });

  it("sprejme oba konta istega podjetja in ju dejansko shrani", async () => {
    const response = await patch(replacementAccounts);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ id: asset.id, ...replacementAccounts });
    expect(await storedAsset()).toMatchObject({ ...replacementAccounts, naziv: asset.naziv });
  });

  it.each(accountFields)("ohrani izpuščeni %s ob spremembi drugega konta", async (field) => {
    const other = accountFields.find((candidate) => candidate !== field)!;
    const expected = {
      [field]: originalAccounts[field],
      [other]: replacementAccounts[other],
      naziv: "TEST nov naziv",
    };
    const response = await patch({ [other]: replacementAccounts[other], naziv: expected.naziv });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject(expected);
    expect(await storedAsset()).toMatchObject(expected);
  });

  it.each(accountFields)("odstrani %s z eksplicitnim null in ohrani drugi konto", async (field) => {
    const other = accountFields.find((candidate) => candidate !== field)!;
    const expected = { [field]: null, [other]: originalAccounts[other], naziv: asset.naziv };
    const response = await patch({ [field]: null });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject(expected);
    expect(await storedAsset()).toMatchObject(expected);
  });

  it("prazen PATCH ohrani oba konta in celoten zapis", async () => {
    const response = await patch({});

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ id: asset.id, ...originalAccounts });
    expect(await storedAsset()).toEqual(asset);
  });
});
