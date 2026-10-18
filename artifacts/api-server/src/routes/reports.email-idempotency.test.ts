import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";

const state = vi.hoisted(() => ({
  send: vi.fn(), history: vi.fn(), allowed: true, pdf: vi.fn(),
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: async () => ({ firstName: "Test", lastName: "Exporter", emailAddresses: [] }) } },
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request & { clerkUserId?: string }, _res: express.Response, next: express.NextFunction) => {
    req.clerkUserId = req.header("x-user") ?? "user-a";
    next();
  },
}));
vi.mock("../lib/erp-email", () => ({ posljiPorociloPdf: state.send }));
vi.mock("../lib/report-pdf", () => ({
  generateBalanceSheetPdf: state.pdf, generateIncomeStatementPdf: state.pdf, generateTrialBalancePdf: state.pdf,
}));
vi.mock("@workspace/db", async (original) => ({
  ...await original<typeof import("@workspace/db")>(),
  db: {
    select: (fields: Record<string, unknown> = {}) => {
      const rows = "role" in fields ? (state.allowed ? [{ role: "accountant" }] : [])
        : "naziv" in fields ? [{ naziv: "Test", email: null }] : [];
      const chain: unknown = new Proxy({}, {
        get: (_target, property) => property === "then" ? Promise.resolve(rows).then.bind(Promise.resolve(rows)) : () => chain,
      });
      return chain;
    },
    insert: () => ({ values: state.history }),
    transaction: async (work: (tx: unknown) => unknown) =>
      work({ execute: async () => ({ rows: [], rowCount: 0 }), insert: () => ({ values: state.history }) }),
  },
}));
import router from "./reports";
import { reportEmailRequest } from "../lib/reportEmailRequest";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.header("x-drop-response")) {
    res.json = () => { res.socket?.destroy(); return res; };
  }
  next();
});
app.use(router);
const companyA = randomUUID(), companyB = randomUUID();
const body = { reportType: "income-statement", email: "recipient@example.test" };
function send(key: string = randomUUID(), company = companyA) {
  return request(app).post(`/companies/${company}/reports/export`).set("Idempotency-Key", key);
}

beforeEach(() => {
  vi.resetAllMocks();
  state.allowed = true;
  state.pdf.mockResolvedValue(Buffer.from("%PDF-test"));
  state.send.mockResolvedValue({ uspeh: true });
  state.history.mockResolvedValue(undefined);
});
afterEach(async () => {
  await pool.query("DELETE FROM report_email_requests WHERE company_id IN ($1, $2)", [companyA, companyB]);
});
afterAll(async () => { await pool.end(); });

describe("report SMTP durable idempotency", () => {
  it("replays success after the HTTP connection is lost without regenerating PDF or repeating SMTP/history", async () => {
    const key = randomUUID();
    await expect(send(key).set("x-drop-response", "1").send(body)).rejects.toThrow();
    const response = await send(key).send(body);
    expect(response.status).toBe(200);
    expect(response.body.uspeh).toBe(true);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.pdf).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveBeenCalledTimes(1);
    const persisted = await pool.query("SELECT status FROM report_email_requests WHERE company_id = $1 AND request_key = $2", [companyA, key]);
    expect(persisted.rows).toEqual([{ status: "succeeded" }]);
  });

  it("atomically excludes a concurrent retry while SMTP is in flight", async () => {
    const key = randomUUID();
    let finish!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    state.send.mockImplementation(() => {
      started();
      return new Promise((resolve) => { finish = () => resolve({ uspeh: true }); });
    });
    const first = send(key).send(body).then((response) => response);
    await entered;
    const second = await send(key).send(body);
    expect(second.status).toBe(409);
    expect(state.send).toHaveBeenCalledTimes(1);
    finish();
    expect((await first).status).toBe(200);
    expect((await send(key).send(body)).status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.history).toHaveBeenCalledTimes(1);
  });

  it("isolates the same key between companies and allows an explicit new export", async () => {
    const key = randomUUID();
    expect((await send(key).send(body)).status).toBe(200);
    expect((await send(key, companyB).send(body)).status).toBe(200);
    expect((await send(randomUUID()).send(body)).status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(3);
  });

  it("allows exactly one owner when different database connections race to claim a new key", async () => {
    const key = randomUUID();
    const outcomes = await Promise.all(Array.from({ length: 8 }, () =>
      reportEmailRequest(companyA, key, "user-a", "same-payload", true)));
    expect(outcomes.filter((outcome) => outcome === "claimed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "pending")).toHaveLength(7);
  });

  it("rejects changed payloads and other users, and checks company access before replay", async () => {
    const key = randomUUID();
    await send(key).send(body);
    expect((await send(key).send({ ...body, email: "other@example.test" })).status).toBe(409);
    expect((await send(key).set("x-user", "user-b").send(body)).status).toBe(409);
    state.allowed = false;
    expect((await send(key).send(body)).status).toBe(403);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("does not repeat SMTP when saving history fails after SMTP success", async () => {
    const key = randomUUID();
    state.history.mockRejectedValueOnce(new Error("history unavailable"));
    expect((await send(key).send(body)).status).toBe(500);
    expect((await send(key).send(body)).status).toBe(200);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("never reclaims an uncertain SMTP outcome", async () => {
    const key = randomUUID();
    state.send.mockRejectedValueOnce(new Error("SMTP connection lost"));
    expect((await send(key).send(body)).status).toBe(502);
    expect((await send(key).send(body)).status).toBe(409);
    expect(state.send).toHaveBeenCalledTimes(1);
  });

  it("requires a valid email request key, but ordinary PDF downloads remain compatible", async () => {
    expect((await send("invalid").send(body)).status).toBe(400);
    expect((await request(app).post(`/companies/${companyA}/reports/export`).send(body)).status).toBe(400);
    expect(state.send).not.toHaveBeenCalled();
    const response = await request(app).post(`/companies/${companyA}/reports/export`).send({ reportType: "income-statement" });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
  });
});
