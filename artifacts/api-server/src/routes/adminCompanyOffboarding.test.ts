import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowed: true,
  superAdminAllowed: true,
  ownerId: null as string | null,
  companyExists: true,
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  inspectGraph: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: mocks.connect },
}));

vi.mock("../lib/companyOffboardingGraph", () => ({
  inspectCompanyOffboardingGraph: mocks.inspectGraph,
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!mocks.allowed) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({
  requireSuperAdmin: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!mocks.superAdminAllowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
}));

import offboardingRouter from "./adminCompanyOffboarding";

const companyId = "99c2f5a7-2c7e-4091-86de-0ad29a7045fa";

function makeApp() {
  const app = express();
  app.use("/api/admin/companies/:id/offboarding", offboardingRouter);
  return app;
}

beforeEach(() => {
  mocks.allowed = true;
  mocks.superAdminAllowed = true;
  mocks.ownerId = null;
  mocks.companyExists = true;
  mocks.connect.mockReset();
  mocks.clientQuery.mockReset();
  mocks.release.mockReset();
  mocks.inspectGraph.mockReset();
  mocks.connect.mockResolvedValue({
    query: mocks.clientQuery,
    release: mocks.release,
  });
  mocks.clientQuery.mockImplementation(async (query: string) => {
    if (query.includes("system_settings")) {
      return { rows: mocks.ownerId ? [{ value: mocks.ownerId }] : [] };
    }
    if (query.includes('"companies"')) {
      return { rows: mocks.companyExists ? [{ id: companyId }] : [] };
    }
    return { rows: [] };
  });
  mocks.inspectGraph.mockImplementation(async (_client: unknown, id: string) => ({
    companyId: id,
    readyForDeletion: false,
    inspectionComplete: true,
    tables: [
      { table: "companies", primaryKeyColumns: ["id"], primaryKeys: [[id]], rowCount: 1 },
      { table: "invoice_lines", primaryKeyColumns: ["id"], primaryKeys: [], rowCount: 0 },
    ],
    blockers: [{ code: "UNKNOWN_TENANT_OWNERSHIP", table: "invoice_lines", reason: "Ownership is unproven." }],
    metadata: {
      publicBaseTableCount: 2,
      foreignKeyCount: 1,
      selectedTableCount: 1,
      selectedRowCount: 1,
      readOnly: true,
      snapshotConsistent: true,
    },
  }));
});

describe("GET /api/admin/companies/:id/offboarding/preflight", () => {
  it("rejects callers who are not authenticated", async () => {
    mocks.allowed = false;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(401);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-superadmins", async () => {
    mocks.superAdminAllowed = false;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("inspects the graph on one repeatable-read read-only client and rolls back", async () => {
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(200);
    expect(response.body.readyForDeletion).toBe(false);
    expect(response.body.schemaOnly).toBe(true);
    expect(response.body.inspectionComplete).toBe(true);
    expect(response.body.tables).toHaveLength(2);
    expect(response.body.blockers).toContainEqual(expect.objectContaining({
      code: "UNKNOWN_TENANT_OWNERSHIP",
      table: "invoice_lines",
    }));
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.clientQuery.mock.calls[0][0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(mocks.clientQuery.mock.calls).toEqual(expect.arrayContaining([
      ["SET LOCAL statement_timeout = '5000ms'"],
      ["SET LOCAL lock_timeout = '1000ms'"],
      ["ROLLBACK"],
    ]));
    expect(mocks.inspectGraph).toHaveBeenCalledWith(expect.any(Object), companyId, {
      maxSelectedRows: 10_000,
      maxDurationMs: 25_000,
      snapshotConsistent: true,
    });
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("rejects the configured ERP owner company after rolling back", async () => {
    mocks.ownerId = companyId;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PROTECTED_ERP_OWNER");
    expect(mocks.inspectGraph).not.toHaveBeenCalled();
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("returns not found for an unknown company", async () => {
    mocks.companyExists = false;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("COMPANY_NOT_FOUND");
    expect(mocks.inspectGraph).not.toHaveBeenCalled();
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases the client when inspection fails", async () => {
    mocks.inspectGraph.mockRejectedValue(new Error("database timeout"));
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(503);
    expect(response.body.readyForDeletion).toBe(false);
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});