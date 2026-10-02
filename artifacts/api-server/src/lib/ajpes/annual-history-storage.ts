import { createHash } from "node:crypto";
import { db, annualReportExportsTable, auditLogTable } from "@workspace/db";
import type { AjpesAnnualReport } from "./annual-model";
import { AjpesReportError } from "./load-annual-report";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { AJPES_GD_AOP_CATALOG_2025 } from "./aopCatalog2025";
import { AJPES_PROFILE_RULES_VERSION } from "./annual-profile";

export const annualHistoryStorage = new ObjectStorageService();
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function exportPurpose(report: AjpesAnnualReport, format: string) {
  if (format === "publication-pdf") return "publication";
  if (format !== "xml") return "review";
  return report.publicationAssessment.canExport && report.settings.profile?.simplifiedSubmission === "yes"
    ? "combined" : "statistics";
}

/** A completed export is archived before the HTTP response; failure is explicit. */
export async function archiveAnnualExport(input: {
  companyId: string; actor: string; report: AjpesAnnualReport;
  bytes: Buffer; format: string; mime: string; filename: string;
}) {
  const { companyId, actor, report, bytes, format, mime, filename } = input;
  const objectPath = await annualHistoryStorage.saveObjectEntityToNewPath(
    `ajpes-exports/${companyId}/${report.year}`, bytes, mime,
  );
  // Never delete an uncertain committed object on an ambiguous DB error.
  return db.transaction(async tx => {
    const [record] = await tx.insert(annualReportExportsTable).values({
      companyId, year: report.year, format, mime, filename, objectPath,
      purpose: exportPurpose(report, format), revision: report.revision,
      fingerprint: report.sourceFingerprint,
      rulesVersion: `GD2025:${sha256(Buffer.from(JSON.stringify(AJPES_GD_AOP_CATALOG_2025)))};${AJPES_PROFILE_RULES_VERSION};${report.publicationAssessment.rulesVersion}`,
      publicationReviewed: report.publicationAssessment.reviewed, snapshot: { ...report },
      sha256: sha256(bytes), byteSize: bytes.length, createdBy: actor,
    }).returning();
    await tx.insert(auditLogTable).values({
      companyId, entityType: "annual_report_export", entityId: record!.id, action: "export",
      changedBy: actor,
      payload: { year: report.year, fingerprint: record!.fingerprint, sha256: record!.sha256,
        format, purpose: record!.purpose, revision: report.revision },
    });
    return record!;
  });
}

/** Bounded reads also verify historical bytes have not changed in storage. */
export async function readAnnualObject(path: string, limit: number): Promise<Buffer> {
  const object = await annualHistoryStorage.getObjectEntityFile(path).catch(err => {
    if (err instanceof ObjectNotFoundError) throw new AjpesReportError(422, "Datoteka še ni naložena ali ni več dosegljiva.");
    throw err;
  });
  const response = await annualHistoryStorage.downloadObject(object);
  if (!response.ok || !response.body) throw new AjpesReportError(422, "Datoteka ni dosegljiva v zasebnem arhivu.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) throw new AjpesReportError(422, "Datoteka presega dovoljeno velikost.");
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function validateEvidenceBytes(bytes: Buffer, mime: string, expectedSize: number) {
  if (bytes.length !== expectedSize || !bytes.length || bytes.length > MAX_EVIDENCE_BYTES)
    throw new AjpesReportError(422, "Velikost prenesenega dokazila se ne ujema z rezervacijo.");
  const valid = mime === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : false;
  if (!valid) throw new AjpesReportError(422, "Vsebina dokazila ni dovoljen PDF, PNG ali JPEG.");
}

export function validateSubmissionDate(value: string, periodEnd: string,
  today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" })) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value || value <= periodEnd || value > today)
    throw new AjpesReportError(422, "Datum predložitve mora biti veljaven, po obdobju poročila in ne v prihodnosti.");
}