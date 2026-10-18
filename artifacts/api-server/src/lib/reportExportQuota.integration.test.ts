import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

vi.hoisted(() => {
  vi.stubEnv("REPORT_EXPORT_QUOTA_MB", "1");
  vi.stubEnv("REPORT_EXPORT_QUOTA_MB_BY_COMPANY", "{}");
});
import { db, pool, reportExportsTable } from "@workspace/db";
import { saveReportExport, reportExportCutoff, ReportExportTooLargeError } from "./reportExportRetention";

const tenant = randomUUID();
const otherTenant = randomUUID();
function copy(bytes: number, companyId = tenant, extra: Partial<typeof reportExportsTable.$inferInsert> = {}) {
  return {
    companyId, reportType: "trial-balance", params: {}, filename: "quota-test.pdf",
    exportedBy: "TEST-quota", pdfData: Buffer.alloc(bytes, 1), ...extra,
  };
}
async function rows(companyId = tenant) {
  return db.select({ id: reportExportsTable.id, filename: reportExportsTable.filename })
    .from(reportExportsTable).where(eq(reportExportsTable.companyId, companyId));
}
afterEach(async () => {
  // Only disposable copies in these randomly generated test tenants; no source data.
  await db.delete(reportExportsTable).where(inArray(reportExportsTable.companyId, [tenant, otherTenant]));
});
afterAll(async () => { vi.unstubAllEnvs(); await pool.end(); });

describe("report export quota against PostgreSQL", () => {
  it("evicts an oldest prefix, including timestamp ties, and isolates companies", async () => {
    const timestamp = new Date(Date.now() - 10000);
    const old = "00000000-0000-4000-8000-000000000001";
    const newer = "00000000-0000-4000-8000-000000000002";
    // Historical over-budget data is intentionally seeded, like pre-quota copies.
    await db.insert(reportExportsTable).values([
      copy(400000, tenant, { id: old, exportedAt: timestamp }),
      copy(400000, tenant, { id: newer, exportedAt: timestamp }),
      copy(400000, otherTenant),
    ]);
    await saveReportExport(copy(400000, tenant, { filename: "new.pdf" }));
    expect((await rows()).map(r => r.id)).toContain(newer);
    expect((await rows()).map(r => r.id)).not.toContain(old);
    expect(await rows()).toHaveLength(2);
    expect(await rows(otherTenant)).toHaveLength(1);
  });
  it("serializes simultaneous writes on separate pool connections", async () => {
    await Promise.all([1, 2, 3].map(i =>
      saveReportExport(copy(600000, tenant, { filename: `parallel-${i}.pdf` })),
    ));
    expect(await rows()).toHaveLength(1);
    const result = await pool.query(
      "SELECT SUM(octet_length(pdf_data)) AS bytes FROM report_exports WHERE company_id = $1", [tenant],
    );
    expect(Number(result.rows[0].bytes)).toBe(600000);
  });
  it("accepts exact quota, rejects one byte over it, and preserves all prior copies on rejection", async () => {
    await saveReportExport(copy(1000000));
    const before = await rows();
    await expect(saveReportExport(copy(1000001))).rejects.toThrow(ReportExportTooLargeError);
    expect(await rows()).toEqual(before);
    await saveReportExport(copy(1000000, tenant, { filename: "replacement.pdf" }));
    expect(await rows()).toEqual([expect.objectContaining({ filename: "replacement.pdf" })]);
  });
  it("rolls back evictions if saving the new copy fails", async () => {
    await saveReportExport(copy(900000));
    const before = await rows();
    await expect(saveReportExport(copy(600000, tenant, {
      reportType: null as unknown as string,
    }))).rejects.toThrow();
    expect(await rows()).toEqual(before);
  });
  it("removes expired copies first, preserving recent copies that fit the budget", async () => {
    await db.insert(reportExportsTable).values([
      copy(900000, tenant, { exportedAt: new Date(reportExportCutoff().getTime() - 10000) }),
      copy(200000, tenant, { filename: "recent.pdf" }),
    ]);
    await saveReportExport(copy(700000, tenant, { filename: "new.pdf" }));
    expect((await rows()).map(r => r.filename).sort()).toEqual(["new.pdf", "recent.pdf"]);
    // All writes are scoped to report_exports, never accounting tables.
    expect(await db.select().from(reportExportsTable).where(and(
      eq(reportExportsTable.companyId, tenant), eq(reportExportsTable.filename, "recent.pdf"),
    ))).toHaveLength(1);
  });
});
