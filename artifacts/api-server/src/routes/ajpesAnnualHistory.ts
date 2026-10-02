import { Router, type Request, type Response } from "express";
import { and, eq, desc, inArray } from "drizzle-orm";
import {
  db, accountingRolesTable, annualReportExportsTable as exportsTable,
  annualReportSubmissionsTable as evidenceTable, auditLogTable,
  type AnnualReportExportRecord, type AnnualReportSubmissionRecord,
} from "@workspace/db";
import {
  GetAjpesAnnualReportParams, GetAjpesAnnualHistoryQueryParams, GetAjpesAnnualHistoryResponse,
  RequestAjpesEvidenceUploadBody, RequestAjpesEvidenceUploadResponse,
  RecordAjpesSubmissionBody, RecordAjpesSubmissionResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { AjpesReportError, loadAjpesAnnualReport } from "../lib/ajpes/load-annual-report";
import {
  annualHistoryStorage, readAnnualObject, sha256, MAX_EVIDENCE_BYTES,
  validateEvidenceBytes, validateSubmissionDate,
} from "../lib/ajpes/annual-history-storage";

const router = Router();
const base = "/companies/:companyId/reports/ajpes/:year/history";
const uuid = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);

async function access(req: Request, write = false) {
  const params = GetAjpesAnnualReportParams.safeParse(req.params);
  if (!params.success || !uuid(params.data.companyId) || !Number.isInteger(params.data.year))
    throw new AjpesReportError(400, "Neveljavno podjetje ali leto.");
  const actor = (req as AuthenticatedRequest).clerkUserId;
  const [role] = await db.select().from(accountingRolesTable).where(and(
    eq(accountingRolesTable.companyId, params.data.companyId), eq(accountingRolesTable.clerkUserId, actor),
  )).limit(1);
  if (!role || (write && role.role === "viewer"))
    throw new AjpesReportError(403, "Za ta postopek nimate dovoljenja v izbranem podjetju.");
  return { ...params.data, actor };
}
function fail(req: Request, res: Response, err: unknown) {
  if (err instanceof AjpesReportError) { res.status(err.status).json({ error: err.message }); return; }
  let cause: unknown = err;
  for (let i = 0; i < 6 && cause && typeof cause === "object"; i++) {
    if ("code" in cause && ["23505", "40001", "40P01"].includes(String(cause.code))) {
      res.status(409).json({ error: "Vpis je bil medtem spremenjen. Osvežite evidenco." }); return;
    }
    cause = "cause" in cause ? cause.cause : null;
  }
  req.log.error({ err }, "AJPES evidenca izvozov in dokazil");
  res.status(500).json({ error: "Evidence oziroma datoteke ni bilo mogoče shraniti ali prebrati." });
}
const exportView = (r: AnnualReportExportRecord) => ({
  id: r.id, format: r.format, purpose: r.purpose, revision: r.revision, fingerprint: r.fingerprint,
  rulesVersion: r.rulesVersion, publicationReviewed: r.publicationReviewed, sha256: r.sha256,
  byteSize: r.byteSize, filename: r.filename, mime: r.mime, createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});
const evidenceView = (r: AnnualReportSubmissionRecord) => ({
  id: r.id, exportId: r.exportId, outcome: r.outcome, submittedOn: r.submittedOn,
  reference: r.reference, note: r.note ?? "", filename: r.filename, mime: r.mime,
  byteSize: r.byteSize, sha256: r.sha256, recordedBy: r.createdBy,
  recordedAt: r.recordedAt!.toISOString(), supersedesId: r.supersedesId,
});
async function getExport(companyId: string, year: number, id: unknown) {
  if (!uuid(id)) throw new AjpesReportError(400, "Neveljavna oznaka izvoza.");
  const [r] = await db.select().from(exportsTable).where(and(eq(exportsTable.id, id),
    eq(exportsTable.companyId, companyId), eq(exportsTable.year, year))).limit(1);
  if (!r) throw new AjpesReportError(404, "Izvoz ni v evidenci tega podjetja in leta.");
  return r;
}
function sendFile(res: Response, r: { filename: string; mime: string; sha256: string; byteSize: number }, bytes: Buffer) {
  if (bytes.length !== r.byteSize || sha256(bytes) !== r.sha256)
    throw new AjpesReportError(409, "Arhivska datoteka se ne ujema z evidentiranim odtisom.");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", r.mime);
  // Always attachment, including receipts; never run uploaded HTML or PDF scripts inline.
  res.setHeader("Content-Disposition", `attachment; filename="ajpes-file"; filename*=UTF-8''${encodeURIComponent(r.filename)}`);
  res.send(bytes);
}
router.get(base, requireAuth, async (req, res) => {
  try {
    const s = await access(req);
    const query = GetAjpesAnnualHistoryQueryParams.safeParse(req.query);
    if (!query.success) throw new AjpesReportError(400, "Neveljavna stran evidence.");
    const offset = query.data.offset ?? 0;
    const result = await db.transaction(async tx => {
      const report = await loadAjpesAnnualReport(tx, s.companyId, s.year);
      const records = await tx.select().from(exportsTable).where(and(
        eq(exportsTable.companyId, s.companyId), eq(exportsTable.year, s.year),
      )).orderBy(desc(exportsTable.createdAt), desc(exportsTable.id)).offset(offset).limit(51);
      const page = records.slice(0, 50);
      const evidence = page.length ? await tx.select().from(evidenceTable).where(and(
        eq(evidenceTable.companyId, s.companyId), eq(evidenceTable.year, s.year),
        eq(evidenceTable.state, "recorded"), inArray(evidenceTable.exportId, page.map(r => r.id)),
      )).orderBy(desc(evidenceTable.recordedAt), desc(evidenceTable.id)) : [];
      return { exports: page.map(exportView), submissions: evidence.map(evidenceView),
        currentFingerprint: report.sourceFingerprint, nextOffset: records.length > 50 ? offset + 50 : null };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    res.setHeader("Cache-Control", "no-store");
    res.json(GetAjpesAnnualHistoryResponse.parse(result));
  } catch (err) { fail(req, res, err); }
});
router.get(`${base}/exports/:exportId/download`, requireAuth, async (req, res) => {
  try {
    const s = await access(req);
    const r = await getExport(s.companyId, s.year, req.params.exportId);
    sendFile(res, r, await readAnnualObject(r.objectPath, r.byteSize));
  } catch (err) { fail(req, res, err); }
});
router.post(`${base}/uploads`, requireAuth, async (req, res) => {
  try {
    const s = await access(req, true);
    const parsed = RequestAjpesEvidenceUploadBody.safeParse(req.body);
    if (!parsed.success) throw new AjpesReportError(400, "Neveljavna datoteka dokazila (PDF, PNG, JPEG, največ 10 MB).");
    const body = parsed.data;
    if (!body.filename.trim() || /[\x00-\x1f\x7f/\\]/u.test(body.filename))
      throw new AjpesReportError(400, "Neveljavno ime datoteke.");
    const target = await getExport(s.companyId, s.year, body.exportId);
    if (target.purpose === "review") throw new AjpesReportError(422, "Številčni pregled ni datoteka za predložitev. Izberite uradni XML ali poročilo z besedili.");
    const uploadURL = await annualHistoryStorage.getObjectEntityUploadURL(`ajpes-staging/${s.companyId}/${s.year}`);
    const [upload] = await db.insert(evidenceTable).values({
      companyId: s.companyId, year: s.year, exportId: target.id,
      stagingPath: annualHistoryStorage.normalizeObjectEntityPath(uploadURL),
      filename: body.filename.trim(), mime: body.mime, byteSize: body.byteSize, createdBy: s.actor,
    }).returning();
    res.json(RequestAjpesEvidenceUploadResponse.parse({ id: upload!.id, uploadURL }));
  } catch (err) { fail(req, res, err); }
});
router.post(`${base}/submissions`, requireAuth, async (req, res) => {
  try {
    const s = await access(req, true);
    const parsed = RecordAjpesSubmissionBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.attested || !uuid(parsed.data.uploadId) ||
      (parsed.data.supersedesId && !uuid(parsed.data.supersedesId)) || !parsed.data.reference.trim())
      throw new AjpesReportError(400, "Potrdite povezavo dokazila z izvozom ter izpolnite datum, rezultat in referenco.");
    const b = parsed.data;
    const where = and(eq(evidenceTable.id, b.uploadId), eq(evidenceTable.companyId, s.companyId), eq(evidenceTable.year, s.year));
    const [upload] = await db.select().from(evidenceTable).where(where).limit(1);
    if (!upload) throw new AjpesReportError(404, "Rezervacija dokazila ne obstaja v tem podjetju in letu.");
    if (upload.createdBy !== s.actor) throw new AjpesReportError(403, "Dokazilo lahko zaključi le uporabnik, ki je rezerviral prenos.");
    // Exact retries are idempotent, changed input must create a new append-only record.
    if (upload.state === "recorded") {
      if (upload.outcome !== b.outcome || upload.submittedOn !== b.submittedOn ||
        upload.reference !== b.reference.trim() || upload.note !== b.note.trim() ||
        upload.supersedesId !== (b.supersedesId ?? null))
        throw new AjpesReportError(409, "Dokazilo je že shranjeno. Popravek vnesite kot nov zapis.");
      res.json(RecordAjpesSubmissionResponse.parse(evidenceView(upload))); return;
    }
    if (Date.now() - upload.createdAt.getTime() > 60 * 60 * 1000)
      throw new AjpesReportError(410, "Rezervacija je potekla. Ponovno izberite in prenesite datoteko.");
    const target = await getExport(s.companyId, s.year, upload.exportId);
    validateSubmissionDate(b.submittedOn, `${s.year}-12-31`);
    if (b.outcome === "rejected" && !b.note.trim()) throw new AjpesReportError(422, "Pri zavrnitvi navedite razlog.");
    const bytes = await readAnnualObject(upload.stagingPath, MAX_EVIDENCE_BYTES);
    validateEvidenceBytes(bytes, upload.mime, upload.byteSize);
    // The signed PUT may still be usable: freeze a separate private copy, never the staging object.
    const objectPath = await annualHistoryStorage.saveObjectEntityToNewPath(
      `ajpes-evidence/${s.companyId}/${s.year}`, bytes, upload.mime,
    );
    const record = await db.transaction(async tx => {
      const [locked] = await tx.select().from(evidenceTable).where(where).for("update");
      if (!locked || locked.state !== "pending") throw new AjpesReportError(409, "Prenos je že zaključen. Osvežite evidenco.");
      if (b.supersedesId) {
        const [previous] = await tx.select().from(evidenceTable).where(and(
          eq(evidenceTable.id, b.supersedesId), eq(evidenceTable.exportId, target.id),
          eq(evidenceTable.companyId, s.companyId), eq(evidenceTable.year, s.year),
          eq(evidenceTable.state, "recorded"),
        )).for("update");
        if (!previous) throw new AjpesReportError(422, "Nadomestiti je mogoče le dokazilo istega izvoza.");
        const [replacement] = await tx.select().from(evidenceTable).where(eq(evidenceTable.supersedesId, previous.id)).limit(1);
        if (replacement) throw new AjpesReportError(409, "Ta vpis je že nadomeščen. Izberite zadnji vpis.");
      }
      const [saved] = await tx.update(evidenceTable).set({
        state: "recorded", objectPath, sha256: sha256(bytes), recordedAt: new Date(),
        outcome: b.outcome, submittedOn: b.submittedOn, reference: b.reference.trim(), note: b.note.trim(),
        supersedesId: b.supersedesId ?? null,
      }).where(where).returning();
      await tx.insert(auditLogTable).values({
        companyId: s.companyId, entityType: "annual_report_submission", entityId: saved!.id,
        action: "manual_submission_evidence", changedBy: s.actor,
        payload: { exportId: target.id, fingerprint: target.fingerprint, sha256: saved!.sha256,
          outcome: b.outcome, submittedOn: b.submittedOn, reference: saved!.reference,
          supersedesId: saved!.supersedesId, manual: true },
      });
      return saved!;
    });
    // Staging cleanup failure must not undo a successfully committed, immutable receipt.
    await annualHistoryStorage.deleteObjectEntity(upload.stagingPath).catch(err => req.log.warn({ err }, "AJPES staging cleanup"));
    res.json(RecordAjpesSubmissionResponse.parse(evidenceView(record)));
  } catch (err) { fail(req, res, err); }
});
router.get(`${base}/submissions/:submissionId/download`, requireAuth, async (req, res) => {
  try {
    const s = await access(req);
    if (!uuid(req.params.submissionId)) throw new AjpesReportError(400, "Neveljavna oznaka dokazila.");
    const [r] = await db.select().from(evidenceTable).where(and(eq(evidenceTable.id, req.params.submissionId),
      eq(evidenceTable.companyId, s.companyId), eq(evidenceTable.year, s.year), eq(evidenceTable.state, "recorded"))).limit(1);
    if (!r || !r.objectPath || !r.sha256) throw new AjpesReportError(404, "Dokazilo ne obstaja.");
    sendFile(res, { ...r, sha256: r.sha256 }, await readAnnualObject(r.objectPath, MAX_EVIDENCE_BYTES));
  } catch (err) { fail(req, res, err); }
});
export default router;