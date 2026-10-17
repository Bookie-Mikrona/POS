import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPORT_EXPORT_RETENTION_DAYS } from "../lib/reportExportRetention";

const state = vi.hoisted(() => ({
  getUserList: vi.fn(),
  select: vi.fn(),
  authorized: true,
  rows: [] as { id: string; exportedBy: string }[],
}));

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUserList: state.getUserList } } }));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request & { clerkUserId?: string }, res: express.Response, next: express.NextFunction) => {
    if (!req.header("x-test-user")) {
      res.sendStatus(401);
      return;
    }
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: { select: state.select },
}));

import router from "./reports";

const app = express();
app.use(router);
const path = "/companies/company-a/reports/export/history";

beforeEach(() => {
  vi.clearAllMocks();
  state.authorized = true;
  state.rows = [];
  state.getUserList.mockResolvedValue({ data: [] });
  state.select.mockImplementation(() => {
    let history = false;
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => { history = true; return chain; },
      limit: () => Promise.resolve(history ? state.rows : state.authorized ? [{ role: "accountant" }] : []),
    };
    return chain;
  });
});

describe("report export history identities", () => {
  it("resolves each unique exporter, prefers full name then primary email, and retains audit IDs", async () => {
    state.rows = ["named", "email", "deleted", "named", "blank", "partial", "secondary"]
      .map((exportedBy, index) => ({ id: String(index), exportedBy }));
    state.getUserList.mockResolvedValue({ data: [
      { id: "named", firstName: " Ana ", lastName: " Novak ", emailAddresses: [] },
      { id: "email", firstName: null, lastName: " ", primaryEmailAddressId: "primary",
        emailAddresses: [{ id: "other", emailAddress: "other@example.test" }, { id: "primary", emailAddress: "primary@example.test" }] },
      { id: "blank", emailAddresses: [] },
      { id: "partial", firstName: "Ana", emailAddresses: [] },
      { id: "secondary", emailAddresses: [{ id: "other", emailAddress: "fallback@example.test" }] },
    ] });
    const res = await request(app).get(path).set("x-test-user", "viewer");
    expect(res.status).toBe(200);
    expect(res.body.exports.map((row: { exportedByName: string }) => row.exportedByName))
      .toEqual(["Ana Novak", "primary@example.test", "Neznan uporabnik", "Ana Novak",
        "Neznan uporabnik", "Ana", "fallback@example.test"]);
    expect(res.body.exports[0].exportedBy).toBe("named");
    expect(state.getUserList).toHaveBeenCalledExactlyOnceWith({
      userId: ["named", "email", "deleted", "blank", "partial", "secondary"], limit: 100,
    });
  });

  it("does not query Clerk for an empty history", async () => {
    expect((await request(app).get(path).set("x-test-user", "viewer")).body)
      .toEqual({ exports: [], retentionDays: REPORT_EXPORT_RETENTION_DAYS });
    expect(state.getUserList).not.toHaveBeenCalled();
  });

  it("batches histories with more than 100 distinct exporters", async () => {
    state.rows = Array.from({ length: 200 }, (_, i) => ({ id: String(i), exportedBy: `user-${i}` }));
    state.getUserList.mockImplementation(async ({ userId }: { userId: string[] }) => ({
      data: userId.map((id) => ({ id, firstName: id, emailAddresses: [] })),
    }));
    const res = await request(app).get(path).set("x-test-user", "viewer");
    expect(state.getUserList).toHaveBeenCalledTimes(2);
    expect(res.body.exports[199].exportedByName).toBe("user-199");
  });

  it("reports a directory failure instead of mislabeling users as deleted", async () => {
    state.rows = [{ id: "1", exportedBy: "user" }];
    state.getUserList.mockRejectedValue(new Error("unavailable"));
    expect((await request(app).get(path).set("x-test-user", "viewer")).status).toBe(502);
  });

  it("checks authentication and company access before looking up identities", async () => {
    expect((await request(app).get(path)).status).toBe(401);
    state.authorized = false;
    expect((await request(app).get(path).set("x-test-user", "viewer")).status).toBe(403);
    expect(state.getUserList).not.toHaveBeenCalled();
  });
});
