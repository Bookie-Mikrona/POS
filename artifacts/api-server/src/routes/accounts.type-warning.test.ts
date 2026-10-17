import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  values: vi.fn(),
  set: vi.fn(),
  role: "accountant",
  seed: vi.fn(async () => 1),
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/resolveSifrantAccess", () => ({
  resolveSifrantAccess: async () => ({ role: state.role }),
}));
vi.mock("../lib/accounts-pdf", () => ({ generateAccountsPdf: vi.fn() }));
vi.mock("../lib/companyChartOfAccounts", () => ({
  COMPANY_CHART_OF_ACCOUNTS: [{ code: "400", name: "Stroški", type: "asset" }],
}));
vi.mock("../lib/seedDefaultChartOfAccounts", () => ({ seedDefaultChartOfAccounts: state.seed }));
vi.mock("@workspace/db", () => {
  const query = () => {
    const chain: any = {};
    for (const method of ["from", "where", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(state.rows).then(resolve);
    return chain;
  };
  return {
    accountsTable: { id: "id", companyId: "companyId", code: "code" },
    db: {
      select: query,
      insert: () => ({ values: state.values }),
      update: () => ({ set: state.set }),
    },
  };
});
import router from "./accounts";
const app = express();
app.use(express.json(), router);
const url = "/companies/company/accounts";
const input = { code: "400", name: "Stroški", type: "asset" };

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "accountant";
  state.rows = [];
  state.values.mockReturnValue({ returning: async () => [{ id: "new", ...input }] });
  state.set.mockReturnValue({ where: () => ({ returning: async () => [{ id: "existing" }] }) });
});

describe("SRS account exception acknowledgement", () => {
  it("does not insert before confirmation and preserves the chosen type on confirmation", async () => {
    const warning = await request(app).post(url).send(input);
    expect(warning.status).toBe(422);
    expect(warning.body.warnings[0]).toMatchObject({ code: "400", storedType: "asset", expectedType: "expense" });
    expect(state.values).not.toHaveBeenCalled();
    expect((await request(app).post(url).send({ ...input, confirmTypeException: true })).status).toBe(201);
    expect(state.values.mock.calls[0][0]).toMatchObject(input);
    expect(state.values.mock.calls[0][0]).not.toHaveProperty("confirmTypeException");
  });
  it("saves a matching type without confirmation", async () => {
    expect((await request(app).post(url).send({ ...input, type: "expense" })).status).toBe(201);
  });
  it("checks the stored code on partial edits and permits correcting a wrong type", async () => {
    state.rows = [{ id: "existing", ...input }];
    expect((await request(app).patch(`${url}/existing`).send({ name: "Popravek" })).status).toBe(422);
    expect(state.set).not.toHaveBeenCalled();
    expect((await request(app).patch(`${url}/existing`).send({ type: "expense" })).status).toBe(200);
    expect(state.set).toHaveBeenCalledWith({ type: "expense" });
  });
  it("permits an explicitly confirmed edit but warns again on the next edit", async () => {
    state.rows = [{ id: "existing", ...input }];
    expect((await request(app).patch(`${url}/existing`).send({ name: "Izjema", confirmTypeException: true })).status).toBe(200);
    expect((await request(app).patch(`${url}/existing`).send({ isActive: false })).status).toBe(422);
  });
  it("validates the entire import before writing and permits confirmed import", async () => {
    const warning = await request(app).post(`${url}/seed`).send({});
    expect(warning.status).toBe(422);
    expect(warning.body.warnings).toHaveLength(1);
    expect(state.seed).not.toHaveBeenCalled();
    expect((await request(app).post(`${url}/seed`).send({ confirmTypeException: true })).status).toBe(201);
    expect(state.seed).toHaveBeenCalledTimes(1);
  });
  it("does not let confirmation bypass permissions or validation", async () => {
    state.role = "viewer";
    expect((await request(app).post(url).send({ ...input, confirmTypeException: true })).status).toBe(403);
    state.role = "accountant";
    expect((await request(app).post(url).send({ ...input, type: "wrong", confirmTypeException: true })).status).toBe(400);
    expect(state.values).not.toHaveBeenCalled();
  });
});
