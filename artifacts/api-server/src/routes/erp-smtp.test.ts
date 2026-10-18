import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  role: "accountant" as string | null,
  row: undefined as Record<string, unknown> | undefined,
  written: undefined as Record<string, unknown> | undefined,
  sendMail: vi.fn(), close: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) { res.sendStatus(401); return; }
    req.clerkUserId = "accountant-a"; next();
  },
}));
vi.mock("@workspace/db", async original => {
  const actual = await original<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      select: () => {
        let table: unknown;
        const query: any = {
          from: (value: unknown) => { table = value; return query; },
          where: () => query, innerJoin: () => query, groupBy: () => query,
          limit: async () => {
            if (table === actual.accountingRolesTable) return mocks.role ? [{ role: mocks.role }] : [];
            if (table === actual.companiesTable) return [{ naziv: "Company A", email: "office@company.si" }];
            return mocks.row ? [mocks.row] : [];
          },
          then: (resolve: (rows: unknown[]) => void) => resolve([]),
        };
        return query;
      },
      insert: () => ({ values: (value: Record<string, unknown>) => {
        mocks.written = value;
        return { onConflictDoUpdate: () => ({ returning: async () => {
          mocks.row = value; return [value];
        } }) };
      } }),
      delete: (table: unknown) => ({ where: async (predicate: any) => {
        mocks.deleted(table, new PgDialect().sqlToQuery(predicate).params);
        mocks.row = undefined;
      } }),
    },
  };
});
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail, close: mocks.close }) },
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn(async () => ({ firstName: "Test", lastName: "Exporter", emailAddresses: [] })) } },
}));
vi.mock("../lib/report-pdf", () => ({
  generateBalanceSheetPdf: vi.fn(async () => Buffer.from("%PDF-test")),
  generateIncomeStatementPdf: vi.fn(async () => Buffer.from("%PDF-test")),
  generateTrialBalancePdf: vi.fn(async () => Buffer.from("%PDF-test")),
}));

import router from "./reports";
import { decryptSmtpPassword } from "../lib/erp-smtp-settings";
import { erpSmtpSettingsTable } from "@workspace/db";
const app = express().use(express.json()).use(router);
const companyId = "11111111-1111-4111-8111-111111111111";
const url = `/companies/${companyId}/erp-smtp`;
const config = { host: "mail.example.si", port: 587, user: "smtp-user", from: "relay@example.si", password: "dummy-test-password" };
const auth = { Authorization: "test-session" };
let testClock = 1_800_000_000_000;
beforeEach(() => {
  vi.clearAllMocks(); mocks.role = "accountant"; mocks.row = undefined; mocks.written = undefined;
  testClock += 60_000;
  vi.spyOn(Date, "now").mockReturnValue(testClock);
  mocks.sendMail.mockResolvedValue({ messageId: "test" });
  vi.stubEnv("SESSION_SECRET", "smtp-test-only-key-with-at-least-32-characters");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("company SMTP settings routes", () => {
  it("requires authentication and denies viewers or other company users on every endpoint", async () => {
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).delete(url)).status).toBe(401);
    for (const role of ["viewer", null]) {
      mocks.role = role;
      expect((await request(app).get(url).set(auth)).status).toBe(403);
      expect((await request(app).put(url).set(auth).send(config)).status).toBe(403);
      expect((await request(app).delete(url).set(auth)).status).toBe(403);
      expect((await request(app).post(`${url}/test`).set(auth).send({ recipient: "test@example.si" })).status).toBe(403);
    }
    expect(mocks.written).toBeUndefined(); expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.deleted).not.toHaveBeenCalled();
  });
  it.each(["owner", "accountant"])("lets %s remove only the selected company's credentials and requires a new password to re-enable", async role => {
    mocks.role = role;
    await request(app).put(url).set(auth).send(config);
    const result = await request(app).delete(url).set(auth);
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toEqual({ configured: false, passwordSet: false, host: "", port: 465, user: "", from: "" });
    expect(mocks.deleted).toHaveBeenCalledWith(erpSmtpSettingsTable, [companyId]);
    expect(mocks.row).toBeUndefined();
    expect((await request(app).get(url).set(auth)).body).toEqual(result.body);
    expect((await request(app).post(`${url}/test`).set(auth).send({ recipient: "test@example.si" })).status).toBe(409);
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect((await request(app).put(url).set(auth).send({ ...config, password: "" })).status).toBe(400);
    expect((await request(app).delete(url).set(auth)).status).toBe(200);
    expect((await request(app).put(url).set(auth).send(config)).status).toBe(200);
  });
  it("rejects an invalid company before deleting", async () => {
    expect((await request(app).delete("/companies/not-a-company/erp-smtp").set(auth)).status).toBe(400);
    expect(mocks.deleted).not.toHaveBeenCalled();
  });
  it("reports unconfigured status after removal, refuses report email without fallback, and still downloads PDF", async () => {
    const statusUrl = `/companies/${companyId}/reports/export/smtp-status`;
    const exportUrl = `/companies/${companyId}/reports/export`;
    const report = { reportType: "income-statement", dateFrom: "2026-01-01", dateTo: "2026-12-31" };
    await request(app).put(url).set(auth).send(config);
    expect((await request(app).get(statusUrl).set(auth)).body).toEqual({ konfigurirano: true });
    await request(app).delete(url).set(auth);
    const status = await request(app).get(statusUrl).set(auth);
    expect(status.body).toEqual({ konfigurirano: false });
    expect(status.headers["cache-control"]).toBe("no-store");
    const email = await request(app).post(exportUrl).set(auth).send({ ...report, email: "test@example.si" });
    expect(email.status).toBe(502);
    expect(email.body.error).toContain("SMTP nastavitve za ERP niso konfigurirane");
    expect(mocks.sendMail).not.toHaveBeenCalled();
    const download = await request(app).post(exportUrl).set(auth).send(report);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.body.toString()).toBe("%PDF-test");
  });
  it("returns empty state and requires an initial password", async () => {
    const response = await request(app).get(url).set(auth);
    expect(response.body).toMatchObject({ configured: false, passwordSet: false });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect((await request(app).put(url).set(auth).send({ ...config, password: "" })).status).toBe(400);
  });
  it("persists encrypted settings, returns no credentials, and retains an omitted password", async () => {
    const saved = await request(app).put(url).set(auth).send(config);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ configured: true, passwordSet: true, host: config.host });
    expect(JSON.stringify(saved.body)).not.toContain(config.password);
    expect(saved.body).not.toHaveProperty("passwordEncrypted");
    expect(mocks.written?.companyId).toBe(companyId);
    const encrypted = mocks.written!.passwordEncrypted as string;
    expect(decryptSmtpPassword(encrypted, companyId)).toBe(config.password);
    const read = await request(app).get(url).set(auth);
    expect(read.body).toEqual(saved.body);
    const { password, ...withoutPassword } = config;
    const updated = await request(app).put(url).set(auth).send({ ...withoutPassword, host: "other.example.si" });
    expect(updated.status).toBe(200);
    expect(mocks.written?.passwordEncrypted).toBe(encrypted);
    const changed = await request(app).put(url).set(auth).send({ ...config, password: "new-password" });
    expect(changed.status).toBe(200);
    expect(decryptSmtpPassword(mocks.written!.passwordEncrypted as string, companyId)).toBe("new-password");
  });
  it("allows the company owner to save but rejects malformed inputs", async () => {
    mocks.role = "owner";
    expect((await request(app).put(url).set(auth).send(config)).status).toBe(200);
    expect((await request(app).put(url).set(auth).send({ ...config, port: 25 })).status).toBe(400);
    expect((await request(app).post(`${url}/test`).set(auth).send({ recipient: "bad" })).status).toBe(400);
  });
  it("sends a test through saved company settings and throttles immediate repeats", async () => {
    await request(app).put(url).set(auth).send(config);
    const result = await request(app).post(`${url}/test`).set(auth).send({ recipient: "test@example.si" });
    expect(result.status).toBe(200);
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "test@example.si", from: { name: "Company A", address: config.from },
      replyTo: { name: "Company A", address: "office@company.si" },
    }));
    expect(mocks.close).toHaveBeenCalled();
    expect((await request(app).post(`${url}/test`).set(auth).send({ recipient: "test@example.si" })).status).toBe(429);
  });
  it("requires saved settings before testing", async () => {
    expect((await request(app).post(`${url}/test`).set(auth).send({ recipient: "test@example.si" })).status).toBe(409);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
  it("does not return credentials or raw server errors when a test fails", async () => {
    await request(app).put(url).set(auth).send(config);
    mocks.sendMail.mockRejectedValue(new Error(`Authentication failed: ${config.password}`));
    const result = await request(app).post(`${url}/test`).set(auth).send({ recipient: "test@example.si" });
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain(config.password);
    expect(mocks.close).toHaveBeenCalled();
  });
});
