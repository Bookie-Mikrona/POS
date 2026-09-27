import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { dbState, whereArgs } = vi.hoisted(() => ({
  dbState: { queues: [] as unknown[][], index: 0 },
  whereArgs: [] as unknown[],
}));

vi.mock("@workspace/db", () => {
  const nextRows = () => dbState.queues[dbState.index++] ?? [];
  return {
    db: {
      select: () => {
        const rows = nextRows();
        const promise = Promise.resolve(rows);
        const chain: Record<string, unknown> = {
          from: () => chain,
          where: (condition: unknown) => {
            whereArgs.push(condition);
            return chain;
          },
          orderBy: () => promise,
          limit: () => promise,
          then: promise.then.bind(promise),
        };
        return chain;
      },
    },
    accountsTable: { companyId: "accounts.company_id", code: "accounts.code" },
    accountingRolesTable: { clerkUserId: "roles.clerk_user_id", companyId: "roles.company_id", role: "roles.role" },
    osRolesTable: { clerkUserId: "os_roles.clerk_user_id", companyId: "os_roles.company_id", role: "os_roles.role" },
    posUporabnikiTable: {
      clerkUserId: "pos.clerk_user_id",
      companyId: "pos.company_id",
      vloga: "pos.vloga",
      aktiven: "pos.aktiven",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...args: unknown[]) => ({ and: args }),
  asc: (column: unknown) => column,
}));

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => ({
    userId: req.headers.authorization?.replace("Bearer ", "") ?? null,
  }),
}));

async function makeApp() {
  const { default: accountsRouter } = await import("../accounts");
  const app = express();
  app.use("/", accountsRouter);
  return app;
}

describe("GET /companies/:companyId/accounts/export/pdf", () => {
  beforeEach(() => {
    dbState.queues = [[{ role: "viewer" }], [
      { code: "100", name: "Denarna sredstva", type: "asset", isActive: true },
      { code: "110", name: "Neaktivni konto", type: "asset", isActive: false },
    ]];
    dbState.index = 0;
    whereArgs.length = 0;
  });

  it("requires authentication", async () => {
    const app = await makeApp();
    const response = await request(app).get("/companies/company-1/accounts/export/pdf");
    expect(response.status).toBe(401);
  });

  it("allows a reader and returns all company accounts as a PDF", async () => {
    const app = await makeApp();
    const response = await request(app)
      .get("/companies/company-1/accounts/export/pdf")
      .set("Authorization", "Bearer reader");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(whereArgs[1]).toEqual({ column: "accounts.company_id", value: "company-1" });
  });
});