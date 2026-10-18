import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), execute: vi.fn(), insert: vi.fn(), values: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { transaction: mocks.transaction }, pool: {}, reportExportsTable: {},
}));
import {
  parseReportExportQuotaMb, parseReportExportCompanyQuotas, reportExportQuotaBytes,
  assertReportExportFitsQuota, saveReportExport, ReportExportTooLargeError,
} from "./reportExportRetention";

const companyId = "00000000-0000-4000-8000-000000000001";
const record = {
  companyId, reportType: "trial-balance", params: {}, filename: "test.pdf",
  exportedBy: "test", pdfData: Buffer.from("%PDF"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ rows: [] });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async work => work({
    execute: mocks.execute, insert: mocks.insert,
  }));
});

describe("report export space quota", () => {
  it("defaults to 500 decimal MB and supports explicit limits", () => {
    expect(parseReportExportQuotaMb(undefined)).toBe(500);
    expect(parseReportExportQuotaMb("1")).toBe(1);
    expect(parseReportExportQuotaMb("1000000")).toBe(1000000);
  });
  it.each(["", "0", "-1", "1.5", " 5", "1e3", "Infinity", "1000001"])(
    "rejects invalid quota %j", raw => {
      expect(() => parseReportExportQuotaMb(raw)).toThrow("REPORT_EXPORT_QUOTA_MB");
    },
  );
  it("validates per-company overrides and converts MB to bytes", () => {
    expect(parseReportExportCompanyQuotas(JSON.stringify({ [companyId]: 25 })).get(companyId))
      .toBe(25000000);
    expect(parseReportExportCompanyQuotas(undefined).size).toBe(0);
    for (const raw of ["null", "[]", "{", '{"other":5}', JSON.stringify({ [companyId]: "5" }),
      JSON.stringify({ [companyId]: 0 })]) {
      expect(() => parseReportExportCompanyQuotas(raw)).toThrow();
    }
  });
  it("allows exact fit but rejects oversized PDFs without starting a transaction", async () => {
    const quota = reportExportQuotaBytes(companyId);
    expect(() => assertReportExportFitsQuota(companyId, quota)).not.toThrow();
    expect(() => assertReportExportFitsQuota(companyId, quota + 1)).toThrow(ReportExportTooLargeError);
    await expect(saveReportExport({ ...record, pdfData: { length: quota + 1 } as Buffer }))
      .rejects.toThrow(ReportExportTooLargeError);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("locks the tenant before measuring bytes, pruning and inserting in one transaction", async () => {
    await saveReportExport(record);
    const queries = mocks.execute.mock.calls.map(([q]) => new PgDialect().sqlToQuery(q));
    expect(queries[0].sql).toContain("pg_advisory_xact_lock(724112");
    expect(queries[0].params).toEqual([companyId]);
    expect(queries[1].sql).toContain("exported_at <");
    expect(queries[2].sql).toContain("octet_length(pdf_data)");
    expect(queries[2].sql).toContain("ORDER BY exported_at DESC, id DESC");
    expect(queries[2].params).toEqual([companyId, companyId, reportExportQuotaBytes(companyId) - 4]);
    expect(mocks.values).toHaveBeenCalledWith(record);
    expect(mocks.execute.mock.invocationCallOrder.at(-1))
      .toBeLessThan(mocks.values.mock.invocationCallOrder[0]);
  });
  it("does not insert when pruning fails and propagates insert failure to roll back", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("lock failed"));
    await expect(saveReportExport(record)).rejects.toThrow("lock failed");
    expect(mocks.values).not.toHaveBeenCalled();
    mocks.values.mockRejectedValueOnce(new Error("insert failed"));
    await expect(saveReportExport(record)).rejects.toThrow("insert failed");
  });
});
