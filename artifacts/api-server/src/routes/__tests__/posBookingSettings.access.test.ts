import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { state, seedSmallEquipmentMock } = vi.hoisted(() => ({
  state: {
    queues: [] as unknown[][],
    index: 0,
    inserted: null as Record<string, unknown> | null,
  },
  seedSmallEquipmentMock: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const nextRows = () => state.queues[state.index++] ?? [];
  const selectChain = () => {
    const rows = nextRows();
    const promise = Promise.resolve(rows);
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => promise,
      limit: () => promise,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    };
    return chain;
  };
  const insertChain = {
    values: (values: Record<string, unknown>) => {
      state.inserted = values;
      return {
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([{ id: "settings-1", ...values }]),
        }),
      };
    },
  };

  return {
    db: {
      select: () => selectChain(),
      insert: () => insertChain,
      delete: () => ({ where: () => Promise.resolve() }),
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => selectChain(),
        insert: () => insertChain,
        delete: () => ({ where: () => Promise.resolve() }),
      }),
    },
    posBookingSettingsTable: { companyId: "company_id" },
    posCategoryRevenueAccountsTable: {
      companyId: "company_id",
      categoryId: "category_id",
      accountId: "account_id",
    },
    accountingRolesTable: { clerkUserId: "clerk_user_id", companyId: "company_id", role: "role" },
    posUporabnikiTable: { clerkUserId: "clerk_user_id", companyId: "company_id", vloga: "vloga", aktiven: "aktiven" },
    accountsTable: {
      id: "id",
      companyId: "company_id",
      code: "code",
      isActive: "is_active",
      allowsPosting: "allows_posting",
      type: "type",
    },
    enoteTable: { id: "id", ime: "ime", companyId: "company_id" },
    kategorijeTable: { id: "id", ime: "ime", enotaId: "enota_id", vrstniRed: "vrstni_red" },
    vatCodeTable: {
      id: "id",
      code: "code",
      description: "description",
      direction: "direction",
      rate: "rate",
      validTo: "valid_to",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: "and", args })),
  asc: vi.fn((column: unknown) => ({ _tag: "asc", column })),
  eq: vi.fn((column: unknown, value: unknown) => ({ _tag: "eq", column, value })),
  gte: vi.fn((column: unknown, value: unknown) => ({ _tag: "gte", column, value })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ _tag: "inArray", column, values })),
  isNull: vi.fn((column: unknown) => ({ _tag: "isNull", column })),
  lte: vi.fn((column: unknown, value: unknown) => ({ _tag: "lte", column, value })),
  or: vi.fn((...args: unknown[]) => ({ _tag: "or", args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _tag: "sql", strings, values })),
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

const syncMock = vi.hoisted(() => vi.fn().mockResolvedValue({ created: 0, updated: 0 }));
vi.mock("../../lib/posSyncBooking", () => ({ syncPosBookingForDay: syncMock }));
vi.mock("../../lib/seedSmallEquipmentExpenseAccount", () => ({
  seedSmallEquipmentExpenseAccount: seedSmallEquipmentMock,
  SmallEquipmentExpenseAccountUnavailableError: class extends Error {},
}));

async function buildApp() {
  const { default: router } = await import("../posBookingSettings");
  const app = express();
  app.use(express.json());
  app.use("/", router);
  return app;
}

function reset(...queues: unknown[][]) {
  state.queues = queues;
  state.index = 0;
  state.inserted = null;
  syncMock.mockClear();
  seedSmallEquipmentMock.mockReset().mockResolvedValue({
    accountId: "small-equipment-account",
    created: true,
    filled: true,
  });
}

describe("POS dostop do nastavitev knjiženja", () => {
  let app: express.Application;

  beforeEach(async () => {
    app = await buildApp();
    reset();
  });

  it("aktivni POS admin brez accounting_roles lahko bere in shrani nastavitve", async () => {
    reset(
      [],
      [{ vloga: "admin" }],
      [{ id: "settings-1", companyId: "cmp-1", cashAccountId: "account-1" }],
    );
    const read = await request(app)
      .get("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin");

    expect(read.status).toBe(200);
    expect(read.body.cashAccountId).toBe("account-1");

    reset([], [{ vloga: "admin" }]);
    const write = await request(app)
      .put("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin")
      .send({});

    expect(write.status).toBe(200);
    expect(state.inserted).toMatchObject({ companyId: "cmp-1" });
  });

  it("aktivni POS admin brez accounting_roles lahko ročno zažene sinhronizacijo", async () => {
    reset([], [{ vloga: "admin" }]);

    const response = await request(app)
      .post("/companies/cmp-1/pos-booking-settings/sync/2026-08-19")
      .set("Authorization", "Bearer pos-admin");

    expect(response.status).toBe(200);
    expect(syncMock).toHaveBeenCalledWith("cmp-1", "2026-08-19");
  });

  it("izrecno pripravi konto drobnega inventarja z enakimi pravicami kot shranjevanje", async () => {
    reset([], [{ vloga: "admin" }]);

    const response = await request(app)
      .post("/companies/cmp-1/pos-booking-settings/seed-small-equipment")
      .set("Authorization", "Bearer pos-admin");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      accountId: "small-equipment-account",
      created: true,
      filled: true,
    });
    expect(seedSmallEquipmentMock).toHaveBeenCalledWith("cmp-1");

    reset([{ role: "viewer" }], []);
    const denied = await request(app)
      .post("/companies/cmp-1/pos-booking-settings/seed-small-equipment")
      .set("Authorization", "Bearer viewer");
    expect(denied.status).toBe(403);
    expect(seedSmallEquipmentMock).not.toHaveBeenCalled();
  });

  it("ročno sinhronizira veljaven razpon po dnevih in vrne sprotni napredek", async () => {
    syncMock
      .mockResolvedValueOnce({ created: ["POS:PRODAJA:2026-08-19"], skipped: [] })
      .mockResolvedValueOnce({ created: [], skipped: [{ ref: "vse", reason: "Ni podatkov" }] });
    reset([], [{ vloga: "admin" }]);

    const response = await request(app)
      .post("/companies/cmp-1/pos-booking-settings/sync-range")
      .set("Authorization", "Bearer pos-admin")
      .send({ from: "2026-08-19", to: "2026-08-20" });

    expect(response.status).toBe(200);
    const events = response.text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events[0]).toMatchObject({ type: "progress", completed: 1, total: 2, datum: "2026-08-19" });
    expect(events[1]).toMatchObject({ type: "progress", completed: 2, total: 2, datum: "2026-08-20" });
    expect(events[2]).toMatchObject({
      type: "complete",
      total: 2,
      created: ["POS:PRODAJA:2026-08-19"],
      skipped: [{ ref: "vse", reason: "Ni podatkov" }],
    });
    expect(syncMock).toHaveBeenNthCalledWith(1, "cmp-1", "2026-08-19");
    expect(syncMock).toHaveBeenNthCalledWith(2, "cmp-1", "2026-08-20");
  });

  it.each([
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-01-01", to: "2027-01-02" },
    { from: "2026-03-02", to: "2026-03-01" },
  ])("zavrne neveljaven ali predolg razpon ($from–$to)", async ({ from, to }) => {
    reset([], [{ vloga: "admin" }]);

    const response = await request(app)
      .post("/companies/cmp-1/pos-booking-settings/sync-range")
      .set("Authorization", "Bearer pos-admin")
      .send({ from, to });

    expect(response.status).toBe(400);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("POS admin ob GLK viewer vlogi še vedno lahko bere in piše POS nastavitve", async () => {
    reset(
      [{ role: "viewer" }],
      [{ vloga: "admin" }],
      [{ id: "settings-1", companyId: "cmp-1" }],
    );
    const read = await request(app)
      .get("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin-viewer");
    expect(read.status).toBe(200);

    reset([{ role: "viewer" }], [{ vloga: "admin" }]);
    const write = await request(app)
      .put("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin-viewer")
      .send({});
    expect(write.status).toBe(200);
  });

  it.each([
    { id: "11111111-1111-1111-1111-111111111111", direction: "IN", rate: "22.00", validFrom: "2020-01-01", validTo: null },
    { id: "22222222-2222-2222-2222-222222222222", direction: "OUT", rate: "22.00", validFrom: "2020-01-01", validTo: "2020-12-31" },
    { id: "33333333-3333-3333-3333-333333333333", direction: "OUT", rate: "5.00", validFrom: "2020-01-01", validTo: null },
  ])("zavrne DDV kodo, ki ni veljavna izhodna koda pravilne stopnje", async (vatCode) => {
    reset([], [{ vloga: "admin" }], [vatCode]);

    const response = await request(app)
      .put("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin")
      .send({ vat22VatCodeId: vatCode.id });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("veljavne izhodne kode");
  });

  it("zavrne POS kategorijo drugega podjetja", async () => {
    reset([], [{ vloga: "admin" }], []);

    const response = await request(app)
      .put("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin")
      .send({
        categoryRevenueAccounts: [{
          categoryId: 42,
          accountId: "11111111-1111-1111-1111-111111111111",
        }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("POS kategorije");
  });

  it("zavrne prihodkovni konto drugega podjetja", async () => {
    reset([], [{ vloga: "admin" }], [{ id: 42 }], []);

    const response = await request(app)
      .put("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin")
      .send({
        categoryRevenueAccounts: [{
          categoryId: 42,
          accountId: "11111111-1111-1111-1111-111111111111",
        }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("tega podjetja");
  });

  it("zavrne neprihodkovni konto POS kategorije", async () => {
    const accountId = "11111111-1111-1111-1111-111111111111";
    reset([], [{ vloga: "admin" }], [{ id: 42 }], [{ id: accountId, type: "asset" }]);

    const response = await request(app)
      .put("/companies/cmp-1/pos-booking-settings")
      .set("Authorization", "Bearer pos-admin")
      .send({ categoryRevenueAccounts: [{ categoryId: 42, accountId }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("prihodkovnimi konti");
  });

  it.each(["admin_enote", "uporabnik"])(
    "POS vloga %s nima bralnega ali pisalnega dostopa",
    async (vloga) => {
      reset([], [{ vloga }]);
      const read = await request(app)
        .get("/companies/cmp-1/pos-booking-settings")
        .set("Authorization", `Bearer ${vloga}`);
      expect(read.status).toBe(403);

      reset([], [{ vloga }]);
      const write = await request(app)
        .put("/companies/cmp-1/pos-booking-settings")
        .set("Authorization", `Bearer ${vloga}`)
        .send({});
      expect(write.status).toBe(403);
    },
  );
});