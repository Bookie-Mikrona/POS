import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowed: true,
  superAdminAllowed: true,
  ownerId: null as string | null,
  companyExists: true,
  dbSelect: vi.fn(),
  query: vi.fn(),
  companiesTable: { id: {} },
  systemSettingsTable: { key: {}, value: {} },
}));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.dbSelect },
  pool: { query: mocks.query },
  companiesTable: mocks.companiesTable,
  systemSettingsTable: mocks.systemSettingsTable,
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
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
  mocks.dbSelect.mockReset();
  mocks.query.mockReset();
  mocks.dbSelect.mockImplementation(() => {
    let selectedTable: unknown;
    const chain = {
      from(table: unknown) {
        selectedTable = table;
        return chain;
      },
      where() {
        return chain;
      },
      limit() {
        if (selectedTable === mocks.systemSettingsTable) {
          return Promise.resolve(mocks.ownerId ? [{ value: mocks.ownerId }] : []);
        }
        return Promise.resolve(mocks.companyExists ? [{ id: companyId }] : []);
      },
    };
    return chain;
  });
  mocks.query.mockImplementation(async (query: string) => {
    if (query.includes("information_schema.tables")) {
      return {
        rows: [
          { table_name: "companies", column_name: "id" },
          { table_name: "companies", column_name: "company_id" },
          { table_name: "invoice_lines", column_name: "id" },
          { table_name: "invoice_lines", column_name: "invoice_id" },
        ],
      };
    }
    if (query.includes("pg_constraint")) {
      return {
        rows: [{
          table_name: "invoice_lines",
          column_name: "invoice_id",
          referenced_table: "invoices",
          referenced_column: "id",
        }],
      };
    }
    return { rows: [{ count: "3" }] };
  });
});

describe("GET /api/admin/companies/:id/offboarding/preflight", () => {
  it("rejects callers who are not authenticated", async () => {
    mocks.allowed = false;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(401);
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-superadmins", async () => {
    mocks.superAdminAllowed = false;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(403);
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it("fails closed for tables without directly proven tenant scope", async () => {
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(200);
    expect(response.body.eligible).toBe(false);
    expect(response.body.readyForDeletion).toBe(false);
    expect(response.body.schemaOnly).toBe(true);
    expect(response.body.blockers).toContainEqual(expect.objectContaining({
      code: "TENANT_SCOPE_UNPROVEN",
      table: "invoice_lines",
    }));
    expect(response.body.inventory.directlyCompanyScopedTables).toEqual([
      { table: "companies", rowCount: 3 },
    ]);
    expect(response.body.foreignKeys).toHaveLength(1);
  });

  it("never signals deletion eligibility even when every inspected table is directly scoped", async () => {
    mocks.query.mockImplementation(async (query: string) => {
      if (query.includes("information_schema.tables")) {
        return {
          rows: [
            { table_name: "companies", column_name: "id" },
            { table_name: "companies", column_name: "company_id" },
          ],
        };
      }
      if (query.includes("pg_constraint")) return { rows: [] };
      return { rows: [{ count: "3" }] };
    });

    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(200);
    expect(response.body.blockers).toEqual([]);
    expect(response.body.eligible).toBe(false);
    expect(response.body.readyForDeletion).toBe(false);
    expect(response.body.schemaOnly).toBe(true);
  });

  it("rejects the configured ERP owner company", async () => {
    mocks.ownerId = companyId;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PROTECTED_ERP_OWNER");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown company", async () => {
    mocks.companyExists = false;
    const response = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/preflight`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("COMPANY_NOT_FOUND");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});