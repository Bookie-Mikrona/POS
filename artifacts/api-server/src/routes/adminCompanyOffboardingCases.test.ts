import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticated: true,
  superAdmin: true,
  ownerCompanyId: null as string | null,
  companyExists: true,
  archive: null as { archive_sha256: string | null; archive_verified_at: string | null } | null,
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: mocks.poolQuery,
    connect: async () => ({ query: mocks.clientQuery, release: mocks.release }),
  },
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!mocks.authenticated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as express.Request & { clerkUserId: string }).clerkUserId = "auth|superadmin";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({
  requireSuperAdmin: (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!mocks.superAdmin) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
}));

import casesRouter from "./adminCompanyOffboardingCases";

const companyId = "99c2f5a7-2c7e-4091-86de-0ad29a7045fa";
const caseId = "385c08e8-06c9-4d6b-a6c8-f7bc20b93417";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/companies/:id/offboarding", casesRouter);
  return app;
}

beforeEach(() => {
  mocks.authenticated = true;
  mocks.superAdmin = true;
  mocks.ownerCompanyId = null;
  mocks.companyExists = true;
  mocks.archive = null;
  mocks.poolQuery.mockReset();
  mocks.clientQuery.mockReset();
  mocks.release.mockReset();
  mocks.clientQuery.mockImplementation(async (query: string) => {
    if (query.includes("FROM system_settings")) {
      return { rows: mocks.ownerCompanyId ? [{ value: mocks.ownerCompanyId }] : [] };
    }
    if (query.includes("FROM companies")) {
      return {
        rows: mocks.companyExists
          ? [{ id: companyId, naziv: "Example Company" }]
          : [],
      };
    }
    if (query.includes("INSERT INTO company_offboarding_cases")) {
      return {
        rows: [{
          id: caseId,
          target_company_id: companyId,
          company_name_snapshot: "Example Company",
          shared_backup_retain_until: "2099-12-31",
          status: "pending_export",
          created_by_actor_id: "auth|superadmin",
        }],
      };
    }
    return { rows: [] };
  });
  mocks.poolQuery.mockImplementation(async (query: string) => {
    if (query.includes("FROM company_offboarding_cases") && query.includes("archive_sha256")) {
      return { rows: [mocks.archive ?? { archive_sha256: null, archive_verified_at: null }] };
    }
    return { rows: [] };
  });
});

describe("company offboarding case state", () => {
  it("requires authentication and superadmin authorization", async () => {
    mocks.authenticated = false;
    const unauthenticated = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases`)
      .send({ sharedBackupRetainUntil: "2099-12-31" });
    expect(unauthenticated.status).toBe(401);

    mocks.authenticated = true;
    mocks.superAdmin = false;
    const forbidden = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/cases`);
    expect(forbidden.status).toBe(403);
    expect(mocks.clientQuery).not.toHaveBeenCalled();
  });

  it("creates a pending-export case and audit event in one transaction", async () => {
    const response = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases`)
      .send({ sharedBackupRetainUntil: "2099-12-31" });

    expect(response.status).toBe(201);
    expect(response.body.case.status).toBe("pending_export");
    expect(mocks.clientQuery.mock.calls.map(([query]) => query)).toEqual(expect.arrayContaining([
      "BEGIN",
      expect.stringContaining("INSERT INTO company_offboarding_cases"),
      expect.stringContaining("INSERT INTO company_offboarding_case_audit_events"),
      "COMMIT",
    ]));
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO company_offboarding_cases"),
      [companyId, "Example Company", "2099-12-31", "auth|superadmin"],
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rejects the ERP owner and unknown companies without creating a case", async () => {
    mocks.ownerCompanyId = companyId;
    const ownerResponse = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases`)
      .send({ sharedBackupRetainUntil: "2099-12-31" });
    expect(ownerResponse.status).toBe(409);
    expect(ownerResponse.body.code).toBe("PROTECTED_ERP_OWNER");

    mocks.ownerCompanyId = null;
    mocks.companyExists = false;
    const missingResponse = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases`)
      .send({ sharedBackupRetainUntil: "2099-12-31" });
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.code).toBe("COMPANY_NOT_FOUND");
    expect(mocks.clientQuery.mock.calls.some(([query]) => String(query).includes("INSERT INTO"))).toBe(false);
  });

  it("rejects malformed and past retention dates", async () => {
    const malformed = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases`)
      .send({ sharedBackupRetainUntil: "2099-02-30" });
    expect(malformed.status).toBe(400);
    expect(mocks.clientQuery).not.toHaveBeenCalled();

    mocks.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes("FROM companies")) {
        return { rows: [{ id: companyId, naziv: "Example Company" }] };
      }
      return { rows: [] };
    });
    const expired = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases`)
      .send({ sharedBackupRetainUntil: "2000-01-01" });
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe("RETENTION_DEADLINE_PAST");
  });

  it("scopes list and case detail reads to the parent company", async () => {
    mocks.poolQuery.mockImplementation(async (query: string) => {
      if (query.includes("WHERE target_company_id = $1 AND id = $2")) {
        return { rows: [{ id: caseId, target_company_id: companyId, status: "pending_export" }] };
      }
      if (query.includes("FROM company_offboarding_case_audit_events")) return { rows: [] };
      return { rows: [{ id: caseId, target_company_id: companyId, status: "pending_export" }] };
    });

    const listResponse = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/cases`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.cases).toHaveLength(1);
    expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE target_company_id = $1"), [companyId]);

    const detailResponse = await request(makeApp()).get(`/api/admin/companies/${companyId}/offboarding/cases/${caseId}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.case.id).toBe(caseId);
    expect(detailResponse.body.auditEvents).toEqual([]);
    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE target_company_id = $1 AND id = $2"),
      [companyId, caseId],
    );
  });

  it("fails closed for acknowledgements without a verified archive", async () => {
    const response = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases/${caseId}/acknowledge`)
      .send({
        archiveSha256: "a".repeat(64),
        confirmed: true,
        acknowledgementText: "I received the archive.",
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("VERIFIED_ARCHIVE_REQUIRED");
    expect(mocks.poolQuery).toHaveBeenCalledWith(expect.stringContaining("FROM company_offboarding_cases"), [companyId, caseId]);
  });

  it("does not accept acknowledgement even if metadata is populated without export integration", async () => {
    mocks.archive = { archive_sha256: "a".repeat(64), archive_verified_at: "2099-01-01T00:00:00Z" };
    const response = await request(makeApp())
      .post(`/api/admin/companies/${companyId}/offboarding/cases/${caseId}/acknowledge`)
      .send({
        archiveSha256: "a".repeat(64),
        confirmed: true,
        acknowledgementText: "I received the archive.",
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("EXPORT_INTEGRATION_UNAVAILABLE");
    expect(mocks.poolQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO"), expect.anything());
  });
});