import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  balancePdf: vi.fn(),
  incomePdf: vi.fn(),
  trialPdf: vi.fn(),
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn(async () => ({
    firstName: "Test", lastName: "Exporter", emailAddresses: [],
  })) } },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return { ...original, db: { select: mocks.select, insert: mocks.insert } };
});
vi.mock("../lib/report-pdf", () => ({
  generateBalanceSheetPdf: mocks.balancePdf,
  generateIncomeStatementPdf: mocks.incomePdf,
  generateTrialBalancePdf: mocks.trialPdf,
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { clerkUserId: "user-retention" });
    next();
  },
}));

import router from "./reports";
import { REPORT_EXPORT_RETENTION_DAYS } from "../lib/reportExportRetention";

const app = express().use(express.json()).use(router);
const path = "/companies/00000000-0000-4000-8000-000000000001/reports/export/history";
const dialect = new PgDialect();

function queueQuery(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  mocks.select.mockReturnValueOnce(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockReset();
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockResolvedValue(undefined);
  mocks.balancePdf.mockResolvedValue(Buffer.from("%PDF-balance"));
  mocks.incomePdf.mockResolvedValue(Buffer.from("%PDF-income"));
  mocks.trialPdf.mockResolvedValue(Buffer.from("%PDF-trial"));
});

describe("report export retention API", () => {
  it("returns the effective policy and filters history by tenant and retention cutoff", async () => {
    queueQuery([{ role: "admin" }]);
    const history = queueQuery([]);
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ exports: [], retentionDays: REPORT_EXPORT_RETENTION_DAYS });
    const query = dialect.sqlToQuery(history.where.mock.calls[0][0]);
    expect(query.sql).toContain('"report_exports"."company_id" =');
    expect(query.sql).toContain('"report_exports"."exported_at" >=');
    expect(query.params[0]).toBe("00000000-0000-4000-8000-000000000001");
    expect(new Date(query.params[1] as string).getTime())
      .toBeCloseTo(Date.now() - REPORT_EXPORT_RETENTION_DAYS * 86400000, -3);
  });

  it("applies the same expiration check to direct re-downloads", async () => {
    queueQuery([{ role: "admin" }]);
    const download = queueQuery([]);
    const res = await request(app).get(`${path}/00000000-0000-4000-8000-000000000002/download`);
    expect(res.status).toBe(404);
    expect(dialect.sqlToQuery(download.where.mock.calls[0][0]).sql)
      .toContain('"report_exports"."exported_at" >=');
  });

  it("does not expose the policy or history without company access", async () => {
    queueQuery([]);
    const res = await request(app).get(path);
    expect(res.status).toBe(403);
    expect(res.body.retentionDays).toBeUndefined();
    expect(mocks.select).toHaveBeenCalledOnce();
  });

  it("still prevents downloading another company's current export", async () => {
    queueQuery([{ role: "admin" }]);
    queueQuery([{ companyId: "other-company", filename: "private.pdf", pdfData: Buffer.from("private") }]);
    const res = await request(app).get(`${path}/00000000-0000-4000-8000-000000000002/download`);
    expect(res.status).toBe(403);
  });

  it.each(["balance-sheet", "income-statement"])(
    "keeps the %s GET route independent of export history", async (type) => {
      queueQuery([{ role: "admin" }]);
      const journal = queueQuery([]);
      const res = await request(app).get(path.replace("/export/history", `/${type}`));
      expect(res.status).toBe(200);
      expect(res.body.compare).toBeNull();
      expect(res.body.current).toHaveProperty(type === "balance-sheet" ? "aktiva" : "revenue");
      expect(journal.innerJoin).toHaveBeenCalled();
      expect(journal.groupBy).toHaveBeenCalled();
    },
  );

  it("loads a balance sheet, not an income statement, for balance-sheet PDF exports", async () => {
    queueQuery([{ role: "admin" }]);
    queueQuery([{ naziv: "Test" }]);
    queueQuery([]); // Current-year opening.
    queueQuery([]); // Earlier opening.
    queueQuery([]);
    const res = await request(app).post(path.replace("/export/history", "/export"))
      .send({ reportType: "balance-sheet", asOf: "2026-10-17" });
    expect(res.status).toBe(200);
    expect(mocks.balancePdf).toHaveBeenCalledWith(expect.objectContaining({
      current: expect.objectContaining({ aktiva: expect.any(Object), pasiva: expect.any(Object) }),
    }));
    expect(mocks.incomePdf).not.toHaveBeenCalled();
  });

  it("filters actual account rows, not export-history records, for trial-balance PDFs", async () => {
    queueQuery([{ role: "admin" }]);
    queueQuery([{ naziv: "Test" }]);
    queueQuery([]); // Current-year opening.
    queueQuery([]); // Earlier opening.
    queueQuery([]); // Opening balance before selected period.
    const rows = [
      { accountId: "a", accountCode: "400", accountName: "Material", accountType: "expense", side: "debit", total: "12.34" },
      { accountId: "b", accountCode: "110", accountName: "Banka", accountType: "asset", side: "credit", total: "12.34" },
    ];
    queueQuery(rows); // Turnover.
    queueQuery(rows); // Closing balance.
    const res = await request(app).post(path.replace("/export/history", "/export"))
      .send({ reportType: "trial-balance", accountClass: "4", dateFrom: "2026-10-01", dateTo: "2026-10-17" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mocks.trialPdf).toHaveBeenCalledWith(expect.objectContaining({
      rows: [expect.objectContaining({ accountCode: "400", turnoverDebit: "12.34" })],
      totalTurnoverDebit: "12.34",
      totalTurnoverCredit: "0.00",
    }));
  });
});
