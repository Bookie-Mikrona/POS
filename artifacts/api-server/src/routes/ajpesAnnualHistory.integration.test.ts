import express from "express";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ actor: "ajpes-history-test-owner" }));
const objects = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = auth.actor; req.log = { error: vi.fn(), warn: vi.fn() }; next();
  },
}));
vi.mock("../lib/ajpes/load-annual-report", async importOriginal => {
  const original = await importOriginal<any>();
  return { ...original, loadAjpesAnnualReport: async () => ({ sourceFingerprint: "current-fingerprint" }) };
});
vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class {
    normalizeObjectEntityPath(url: string) { return url.replace("https://storage.test", ""); }
    async getObjectEntityUploadURL(dir: string) { return `https://storage.test/objects/${dir}/${crypto.randomUUID()}`; }
    async getObjectEntityFile(path: string) {
      if (!objects.has(path)) throw new Error("Missing test object");
      return path;
    }
    async downloadObject(path: string) { return new Response(new Uint8Array(objects.get(path)!)); }
    async saveObjectEntityToNewPath(dir: string, bytes: Buffer) {
      const path = `/objects/${dir}/${crypto.randomUUID()}`; objects.set(path, Buffer.from(bytes)); return path;
    }
    async deleteObjectEntity(path: string) { objects.delete(path); }
  },
}));
import { db, companiesTable, accountingRolesTable, annualReportExportsTable as exportsTable,
  annualReportSubmissionsTable as submissionsTable, auditLogTable } from "@workspace/db";
import router from "./ajpesAnnualHistory";
import { sha256, archiveAnnualExport } from "../lib/ajpes/annual-history-storage";
import type { AjpesAnnualReport } from "../lib/ajpes/annual-model";

const app = express().use(express.json()).use("/api", router);
const request = supertest(app);
const prefix = (company: string, year = 2025) => `/api/companies/${company}/reports/ajpes/${year}/history`;
const companyId = randomUUID(), foreignId = randomUUID();
const bytes = Buffer.from("%PDF-1.7\nFictitious evidence\n");
const objectPath = `/objects/ajpes-exports/${companyId}/2025/test`;
let exportId: string, reviewId: string, foreignExportId: string, receiptId: string;

async function reserve(id = exportId, content = bytes) {
  const r = await request.post(`${prefix(companyId)}/uploads`).send({
    exportId: id, filename: "test-evidence.pdf", mime: "application/pdf", byteSize: content.length,
  });
  expect(r.status).toBe(200);
  objects.set(r.body.uploadURL.replace("https://storage.test", ""), content);
  return r.body.id as string;
}
const receiptBody = (uploadId: string, extra = {}) => ({
  uploadId, outcome: "accepted", submittedOn: "2026-03-31",
  reference: "FICTITIOUS RECEIPT - NOT A REAL FILING", note: "", attested: true, supersedesId: null, ...extra,
});
beforeAll(async () => {
  await db.insert(companiesTable).values([
    { id: companyId, podjetjeDavcna: `AJH-${companyId}`, naziv: `Fictitious AJPES history ${companyId}` },
    { id: foreignId, podjetjeDavcna: `AJH-${foreignId}`, naziv: `Fictitious foreign history ${foreignId}` },
  ]);
  await db.insert(accountingRolesTable).values([
    { companyId, clerkUserId: auth.actor, role: "owner" },
    { companyId, clerkUserId: "ajpes-history-test-viewer", role: "viewer" },
    { companyId, clerkUserId: "ajpes-history-test-accountant", role: "accountant" },
  ]);
  const row = {
    year: 2025, format: "publication-pdf", purpose: "publication", revision: 3,
    fingerprint: "old-fingerprint", rulesVersion: "test", publicationReviewed: true,
    snapshot: { year: 2025 }, objectPath, sha256: sha256(bytes), byteSize: bytes.length,
    filename: "test-annual.pdf", mime: "application/pdf", createdBy: auth.actor,
  };
  const records = await db.insert(exportsTable).values([
    { ...row, companyId }, { ...row, companyId, purpose: "review", format: "pdf" },
    { ...row, companyId: foreignId },
  ]).returning();
  [exportId, reviewId, foreignExportId] = records.map(r => r.id);
  objects.set(objectPath, bytes);
});
afterAll(async () => {
  // Corrections reference history: remove these exact synthetic links before fixture teardown.
  await db.update(submissionsTable).set({ supersedesId: null }).where(inArray(submissionsTable.companyId, [companyId, foreignId]));
  await db.delete(submissionsTable).where(inArray(submissionsTable.companyId, [companyId, foreignId]));
  await db.delete(exportsTable).where(inArray(exportsTable.companyId, [companyId, foreignId]));
  await db.delete(auditLogTable).where(inArray(auditLogTable.companyId, [companyId, foreignId]));
  await db.delete(accountingRolesTable).where(inArray(accountingRolesTable.companyId, [companyId, foreignId]));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, foreignId]));
  objects.clear();
});

describe("tenant-scoped AJPES export and manual receipt archive", () => {
  it("lists current-vs-old content without disclosing storage paths or snapshots", async () => {
    const r = await request.get(prefix(companyId));
    expect(r.status).toBe(200);
    expect(r.body.exports).toHaveLength(2);
    expect(r.body.currentFingerprint).toBe("current-fingerprint");
    expect(r.body.submissions).toEqual([]);
    expect(r.body.exports[0].objectPath).toBeUndefined();
    expect(r.body.exports[0].snapshot).toBeUndefined();
    expect((await request.get(prefix(foreignId))).status).toBe(403);
    expect((await request.get(`${prefix(companyId)}/exports/${foreignExportId}/download`)).status).toBe(404);
    expect((await request.get(prefix(companyId, 2024))).body.exports).toEqual([]);
    expect((await request.get(`${prefix(companyId)}?offset=-1`)).status).toBe(400);
  });
  it("archives original bytes before response, with server-owned actor, fingerprint and audit", async () => {
    const report = { year: 2025, revision: 7, sourceFingerprint: "current-fingerprint",
      publicationAssessment: { rulesVersion: "test-rules", reviewed: false, canExport: false },
      settings: { profile: { simplifiedSubmission: "no" } } } as AjpesAnnualReport;
    const r = await archiveAnnualExport({ companyId, actor: auth.actor, report,
      bytes, format: "xml", mime: "application/xml", filename: "test.xml" });
    expect(r).toMatchObject({ purpose: "statistics", fingerprint: "current-fingerprint", createdBy: auth.actor,
      sha256: sha256(bytes), revision: 7 });
    expect(objects.get(r.objectPath)).toEqual(bytes);
    const audit = await db.select().from(auditLogTable).where(and(eq(auditLogTable.entityId, r.id), eq(auditLogTable.companyId, companyId)));
    expect(audit).toHaveLength(1);
  });
  it("allows read/download for viewers but rejects every write and review-only filing", async () => {
    auth.actor = "ajpes-history-test-viewer";
    expect((await request.get(prefix(companyId))).status).toBe(200);
    const r = await request.get(`${prefix(companyId)}/exports/${exportId}/download`);
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("private, no-store");
    expect(r.headers["content-disposition"]).toContain("attachment");
    expect((await request.post(`${prefix(companyId)}/uploads`).send({})).status).toBe(403);
    expect((await request.post(`${prefix(companyId)}/submissions`).send({})).status).toBe(403);
    auth.actor = "ajpes-history-test-owner";
    expect((await request.post(`${prefix(companyId)}/uploads`).send({
      exportId: reviewId, filename: "receipt.pdf", mime: "application/pdf", byteSize: bytes.length,
    })).status).toBe(422);
  });
  it("rejects path injection, foreign exports, oversized and unsupported declared uploads", async () => {
    for (const change of [
      { exportId: foreignExportId }, { filename: "../receipt.pdf" }, { mime: "text/html" },
      { byteSize: 10485761 }, { byteSize: 0 },
    ]) {
      const r = await request.post(`${prefix(companyId)}/uploads`).send({
        exportId, filename: "receipt.pdf", mime: "application/pdf", byteSize: bytes.length, ...change,
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
  });
  it("rejects fake content, partial uploads, future dates and absent attestations", async () => {
    const bad = await reserve(exportId, Buffer.from("<html>not a PDF</html>"));
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(bad))).status).toBe(422);
    const good = await reserve();
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(good, { attested: false }))).status).toBe(400);
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(good, { submittedOn: "2099-01-01" }))).status).toBe(422);
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(good, { outcome: "rejected", note: "" }))).status).toBe(422);
    const [row] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, good));
    objects.set(row!.stagingPath, Buffer.from("%PDF-"));
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(good))).status).toBe(422);
    auth.actor = "ajpes-history-test-accountant";
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(good))).status).toBe(403);
    auth.actor = "ajpes-history-test-owner";
  });
  it("freezes an independent private receipt and makes an unchanged retry idempotent", async () => {
    const id = await reserve();
    const [pending] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, id));
    const r = await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(id));
    expect(r.status).toBe(200);
    receiptId = r.body.id;
    expect(r.body.recordedBy).toBe(auth.actor);
    expect(r.body.sha256).toBe(sha256(bytes));
    const [saved] = await db.select().from(submissionsTable).where(eq(submissionsTable.id, id));
    expect(saved!.objectPath).not.toBe(pending!.stagingPath);
    // A reused still-valid PUT URL cannot change recorded evidence bytes.
    objects.set(pending!.stagingPath, Buffer.from("<html>changed staging</html>"));
    expect(objects.get(saved!.objectPath!)).toEqual(bytes);
    expect((await request.get(`${prefix(companyId)}/submissions/${id}/download`)).status).toBe(200);
    expect((await request.get(`${prefix(companyId, 2024)}/submissions/${id}/download`)).status).toBe(404);
    const retry = await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(id));
    expect(retry.status).toBe(200); expect(retry.body.id).toBe(id);
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(id, { reference: "CHANGED" }))).status).toBe(409);
    const audits = await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, id));
    expect(audits).toHaveLength(1);
  });
  it("keeps corrections append-only and prevents branching, foreign and self replacements", async () => {
    const id = await reserve();
    const r = await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(id, {
      outcome: "rejected", note: "Synthetic corrected result", supersedesId: receiptId,
    }));
    expect(r.status).toBe(200);
    expect(r.body.supersedesId).toBe(receiptId);
    const history = await request.get(prefix(companyId));
    expect(history.body.submissions.find((s: any) => s.id === receiptId).outcome).toBe("accepted");
    expect(history.body.submissions.find((s: any) => s.id === id).outcome).toBe("rejected");
    const branch = await reserve();
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(branch, { supersedesId: receiptId }))).status).toBe(409);
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(branch, { supersedesId: branch }))).status).toBe(422);
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(branch, { supersedesId: randomUUID() }))).status).toBe(422);
  });
  it("rejects expired reservations and refuses a corrupt archive rather than regenerating", async () => {
    const id = await reserve();
    await db.update(submissionsTable).set({ createdAt: new Date(Date.now() - 3600001) }).where(eq(submissionsTable.id, id));
    expect((await request.post(`${prefix(companyId)}/submissions`).send(receiptBody(id))).status).toBe(410);
    objects.set(objectPath, Buffer.from("%PDF- CORRUPTED"));
    expect((await request.get(`${prefix(companyId)}/exports/${exportId}/download`)).status).toBe(409);
  });
});