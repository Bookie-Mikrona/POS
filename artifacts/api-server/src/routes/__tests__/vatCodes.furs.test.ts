import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { dbState } = vi.hoisted(() => ({
  dbState: {
    queues: [] as unknown[][],
    index: 0,
    inserted: null as Record<string, unknown> | null,
    updated: null as Record<string, unknown> | null,
  },
}));

vi.mock("@workspace/db", () => {
  function makeSelectChain() {
    const rows = dbState.queues[dbState.index++] ?? [];
    const promise = Promise.resolve(rows);
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      from: () => chain,
      where: () => chain,
      leftJoin: () => chain,
      orderBy: () => chain,
      limit: () => promise,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    });
    return chain;
  }

  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          dbState.inserted = values;
          return {
            returning: () => Promise.resolve([{ id: "company-vat-1" }]),
          };
        },
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          dbState.updated = values;
          return { where: () => Promise.resolve() };
        },
      }),
    },
    vatCodesTable: {
      id: "id", companyId: "company_id", code: "code", name: "name",
      rate: "rate", behavior: "behavior", accountOutputId: "account_output_id",
      accountInputId: "account_input_id", fursCodeId: "furs_code_id",
      validFrom: "valid_from", validTo: "valid_to", isActive: "is_active",
      notes: "notes", createdAt: "created_at", updatedAt: "updated_at",
    },
    vatCodeTable: {
      id: "id", code: "code", description: "description",
      direction: "direction", rate: "rate",
    },
    accountsTable: {
      id: "id", companyId: "company_id", code: "code", isActive: "is_active",
    },
    accountingRolesTable: {
      clerkUserId: "clerk_user_id", companyId: "company_id", role: "role",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  like: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { clerkUserId: string }).clerkUserId = "user-1";
    next();
  },
}));

async function buildApp() {
  const { default: router } = await import("../vatCodes");
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

function resetDb(...queues: unknown[][]) {
  dbState.queues = queues;
  dbState.index = 0;
  dbState.inserted = null;
  dbState.updated = null;
}

const owner = [{ role: "owner" }];
const fursCode = {
  id: "furs-1",
  code: "S22",
  description: "Domača prodaja 22 %",
  direction: "OUT",
};
const companyVatCode = {
  id: "company-vat-1",
  companyId: "company-1",
  code: "S22",
  name: "Splošna stopnja",
  rate: "22.00",
  behavior: "standard",
  accountOutputId: null,
  accountInputId: null,
  fursCodeId: "furs-1",
  validFrom: null,
  validTo: null,
  isActive: true,
  notes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("povezava podjetniške DDV kode s FURS šifrantom", () => {
  let app: express.Application;

  beforeEach(async () => {
    app = await buildApp();
  });

  it("shrani in vrne izbrano FURS kodo", async () => {
    resetDb(owner, [], [{ id: fursCode.id }], [companyVatCode], [fursCode]);

    const response = await request(app)
      .post("/companies/company-1/vat-codes")
      .send({
        code: "S22",
        name: "Splošna stopnja",
        rate: 22,
        fursCodeId: fursCode.id,
      });

    expect(response.status).toBe(201);
    expect(dbState.inserted?.fursCodeId).toBe(fursCode.id);
    expect(response.body).toMatchObject({
      fursCodeId: fursCode.id,
      fursCode: "S22",
      fursCodeDirection: "OUT",
    });
  });

  it("zavrne neobstoječo FURS kodo", async () => {
    resetDb(owner, [], []);

    const response = await request(app)
      .post("/companies/company-1/vat-codes")
      .send({
        code: "TEST",
        name: "Test",
        rate: 22,
        fursCodeId: "missing-furs-code",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/ne obstaja/);
    expect(dbState.inserted).toBeNull();
  });

  it("pri branju ohrani ID podjetniške kode in prikaže človeško FURS kodo", async () => {
    resetDb(owner, [companyVatCode], [fursCode]);

    const response = await request(app)
      .get("/companies/company-1/vat-codes?includeInactive=true");

    expect(response.status).toBe(200);
    expect(response.body.vatCodes[0]).toMatchObject({
      id: "company-vat-1",
      fursCodeId: "furs-1",
      fursCode: "S22",
      fursCodeDescription: "Domača prodaja 22 %",
    });
  });
});