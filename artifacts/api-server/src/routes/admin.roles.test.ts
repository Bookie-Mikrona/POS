import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notificationMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/stripeSyncFailureMonitor", () => ({
  sendStripeSyncOperationalNotification: notificationMock,
}));

const { dbState, diagnosticsMock, detailMock, movementDetailMock } = vi.hoisted(() => ({
  dbState: {
    rows: [] as unknown[],
    selectCalls: 0,
  },
  diagnosticsMock: vi.fn(),
  detailMock: vi.fn(),
  movementDetailMock: vi.fn(),
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request & { clerkUserId?: string }, res: express.Response, next: express.NextFunction) => {
    const user = req.header("x-test-user");
    if (!user) {
      res.status(401).json({ error: "Neprijavljeni dostop ni dovoljen" });
      return;
    }
    req.clerkUserId = user;
    next();
  },
}));

vi.mock("../middlewares/requireSuperAdmin", () => ({
  requireSuperAdmin: (req: express.Request & { clerkUserId?: string }, res: express.Response, next: express.NextFunction) => {
    if (req.clerkUserId !== "superadmin") {
      res.status(403).json({ error: "Dostop samo za administratorje sistema" });
      return;
    }
    next();
  },
}));

vi.mock("@workspace/api-zod", () => ({
  CreateCompanyBody: { safeParse: vi.fn() },
  AssignRoleBody: { safeParse: vi.fn() },
  GetAdminEventTransferDiagnosticsParams: {
    safeParse: vi.fn((value: { id: string }) => ({ success: true, data: value })),
  },
  GetAdminEventTransferDiagnosticsQueryParams: {
    safeParse: vi.fn((value: { unitId?: string }) => ({
      success: true,
      data: { unitId: value.unitId ? Number(value.unitId) : undefined },
    })),
  },
  GetAdminEventTransferDiagnosticsResponse: {
    parse: vi.fn((value: unknown) => value),
  },
  GetAdminEventTransferDetailParams: {
    safeParse: vi.fn((value: { id: string; eventId: string }) => ({
      success: true,
      data: { id: value.id, eventId: Number(value.eventId) },
    })),
  },
  GetAdminEventTransferDetailResponse: {
    parse: vi.fn((value: unknown) => value),
  },
  GetAdminEventTransferMovementDetailParams: {
    safeParse: vi.fn((value: { id: string; movementId: string }) => ({
      success: true,
      data: { id: value.id, movementId: Number(value.movementId) },
    })),
  },
  GetAdminEventTransferMovementDetailResponse: {
    parse: vi.fn((value: unknown) => value),
  },
}));

vi.mock("../lib/loadEventTransferDiagnostics", () => ({
  loadEventTransferDiagnostics: diagnosticsMock,
}));
vi.mock("../lib/loadEventTransferDetail", () => ({
  loadEventTransferDetail: detailMock,
  loadEventTransferMovementDetail: movementDetailMock,
}));

vi.mock("@workspace/db", () => {
  function makeSelectChain() {
    const result = Promise.resolve(dbState.rows);
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => result,
      innerJoin: () => chain,
      limit: () => result,
      then: result.then.bind(result),
      catch: result.catch.bind(result),
    };
    return chain;
  }

  return {
    db: {
      select: () => {
        dbState.selectCalls += 1;
        return makeSelectChain();
      },
    },
    accountsTable: {},
    companiesTable: { id: "id", createdAt: "created_at" },
    accountingRolesTable: {
      id: "id",
      clerkUserId: "clerk_user_id",
      companyId: "company_id",
      role: "role",
      createdAt: "created_at",
    },
    companyModulesTable: { companyId: "company_id", module: "module", enabledAt: "enabled_at" },
    systemSettingsTable: { key: "key", value: "value" },
    posUporabnikiTable: {},
    enoteTable: {},
    blagajneTable: {},
    poslovniProstoriTable: {},
    osRolesTable: {},
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  desc: vi.fn((column: unknown) => column),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ column, values })),
  sql: vi.fn(),
}));

vi.mock("../lib/seedDefaultChartOfAccounts", () => ({
  seedDefaultChartOfAccounts: vi.fn(),
}));

vi.mock("../lib/seedDefaultAccountSettings", () => ({
  seedDefaultAccountSettings: vi.fn(),
}));

import adminRouter from "./admin";

describe("Stripe operational test endpoint", () => {
  it.each([
    [undefined, 401],
    ["ordinary-user", 403],
  ])("blocks unauthorized user %s before sending", async (user, status) => {
    notificationMock.mockClear();
    const app = express().use("/admin", adminRouter);
    const req = request(app).post("/admin/stripe-sync/test-notification");
    if (user) req.set("x-test-user", user);
    expect((await req).status).toBe(status);
    expect(notificationMock).not.toHaveBeenCalled();
  });

  it.each([
    { success: true, code: "sent" },
    { success: false, code: "recipient_missing" },
    { success: false, code: "delivery_failed" },
  ])("returns the safe transport result %j for super admin", async (result) => {
    notificationMock.mockClear().mockResolvedValue(result);
    const app = express().use("/admin", adminRouter);
    const res = await request(app).post("/admin/stripe-sync/test-notification")
      .set("x-test-user", "superadmin").send({ recipient: "ignored@example.test" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(notificationMock).toHaveBeenCalledExactlyOnceWith({ type: "test" });
  });
});

function makeApp() {
  const app = express();
  app.use("/api/admin", adminRouter);
  return app;
}

describe("GET /api/admin/companies/:id/roles", () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.selectCalls = 0;
  });

  it("superadminu vrne obstoječe ERP vloge podjetja", async () => {
    dbState.rows = [{
      id: "role-1",
      clerkUserId: "user-mojca",
      role: "accountant",
      createdAt: "2026-08-22T13:07:57.414Z",
    }];

    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/roles")
      .set("x-test-user", "superadmin");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      users: [{
        id: "role-1",
        clerkUserId: "user-mojca",
        role: "accountant",
        createdAt: "2026-08-22T13:07:57.414Z",
      }],
    });
    expect(dbState.selectCalls).toBe(1);
  });

  it("navadnemu uporabniku vrne 403 in ne bere vlog", async () => {
    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/roles")
      .set("x-test-user", "racunovodja");

    expect(response.status).toBe(403);
    expect(dbState.selectCalls).toBe(0);
  });
});

describe("GET /api/admin/companies/:id/event-transfer-diagnostics", () => {
  beforeEach(() => {
    diagnosticsMock.mockReset();
    diagnosticsMock.mockResolvedValue({
      generatedAt: "2026-09-04T00:00:00.000Z",
      scope: { companyId: "company-mojca", unitId: 7 },
      readOnly: true,
      checked: { transfers: 2, lines: 3, movements: 4 },
      violationCount: 1,
      summary: { missing_movement: 1 },
      violations: [{
        kind: "missing_movement",
        transferId: 11,
        eventId: 12,
        direction: "outbound",
        status: "completed",
        sourceUnitId: 6,
        targetUnitId: 7,
        detail: "Manjka pričakovani gib.",
      }],
    });
  });

  it("superadminu vrne read-only poročilo za izbrano podjetje in enoto", async () => {
    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics?unitId=7")
      .set("x-test-user", "superadmin");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      readOnly: true,
      scope: { companyId: "company-mojca", unitId: 7 },
      violationCount: 1,
    });
    expect(diagnosticsMock).toHaveBeenCalledWith("company-mojca", 7);
  });

  it("navadnemu uporabniku zavrne dostop brez zagona diagnostike", async () => {
    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics")
      .set("x-test-user", "racunovodja");

    expect(response.status).toBe(403);
    expect(diagnosticsMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/companies/:id/event-transfer-diagnostics/events/:eventId", () => {
  beforeEach(() => {
    detailMock.mockReset();
  });

  it("superadminu vrne company-scoped read-only podrobnosti", async () => {
    detailMock.mockResolvedValue({
      readOnly: true,
      event: { id: 12, name: "Festival" },
      transfers: [],
    });

    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics/events/12")
      .set("x-test-user", "superadmin");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ readOnly: true, event: { id: 12 } });
    expect(detailMock).toHaveBeenCalledWith("company-mojca", 12);
  });

  it("vrne 404, ko dogodek v izbranem podjetju ne obstaja", async () => {
    detailMock.mockResolvedValue(null);

    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics/events/99")
      .set("x-test-user", "superadmin");

    expect(response.status).toBe(404);
    expect(detailMock).toHaveBeenCalledWith("company-mojca", 99);
  });

  it("navadnemu uporabniku zavrne dostop brez branja podrobnosti", async () => {
    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics/events/12")
      .set("x-test-user", "racunovodja");

    expect(response.status).toBe(403);
    expect(detailMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/companies/:id/event-transfer-diagnostics/movements/:movementId", () => {
  beforeEach(() => {
    movementDetailMock.mockReset();
  });

  it("superadminu vrne company-scoped read-only sled premika", async () => {
    movementDetailMock.mockResolvedValue({
      readOnly: true,
      id: 501,
      articleName: "Sok",
      createdAt: "2026-09-04T09:00:00.000Z",
    });

    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics/movements/501")
      .set("x-test-user", "superadmin");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({ readOnly: true, id: 501 });
    expect(movementDetailMock).toHaveBeenCalledWith("company-mojca", 501);
  });

  it("vrne 404 za neobstoječ ali tuj premik", async () => {
    movementDetailMock.mockResolvedValue(null);

    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics/movements/999")
      .set("x-test-user", "superadmin");

    expect(response.status).toBe(404);
    expect(movementDetailMock).toHaveBeenCalledWith("company-mojca", 999);
  });

  it("navadnemu uporabniku zavrne dostop brez branja premika", async () => {
    const response = await request(makeApp())
      .get("/api/admin/companies/company-mojca/event-transfer-diagnostics/movements/501")
      .set("x-test-user", "racunovodja");

    expect(response.status).toBe(403);
    expect(movementDetailMock).not.toHaveBeenCalled();
  });
});