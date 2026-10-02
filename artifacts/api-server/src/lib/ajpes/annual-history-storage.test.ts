import { describe, expect, it } from "vitest";
import { exportPurpose, validateEvidenceBytes, validateSubmissionDate, MAX_EVIDENCE_BYTES } from "./annual-history-storage";
import type { AjpesAnnualReport } from "./annual-model";

describe("AJPES manual filing evidence policies", () => {
  it.each(["2026-02-30", "2025-12-30", "2025-12-31", "2026-10-03", "2026-1-1"])("rejects invalid receipt date %s", value => {
    expect(() => validateSubmissionDate(value, "2025-12-31", "2026-10-02")).toThrow();
  });
  it("preserves the calendar day and permits recording historical filing receipts", () => {
    expect(() => validateSubmissionDate("2026-03-31", "2025-12-31", "2026-10-02")).not.toThrow();
  });
  it.each([
    ["application/pdf", Buffer.from("%PDF-1.7\n")],
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ["image/jpeg", Buffer.from([255, 216, 255, 224])],
  ])("requires actual %s bytes and exact declared size", (mime, bytes) => {
    expect(() => validateEvidenceBytes(bytes, mime, bytes.length)).not.toThrow();
    expect(() => validateEvidenceBytes(bytes, mime, bytes.length + 1)).toThrow();
    expect(() => validateEvidenceBytes(Buffer.from("<html>evil</html>"), mime, 17)).toThrow();
  });
  it("rejects oversized and empty evidence", () => {
    expect(() => validateEvidenceBytes(Buffer.alloc(0), "application/pdf", 0)).toThrow();
    expect(() => validateEvidenceBytes(Buffer.alloc(MAX_EVIDENCE_BYTES + 1), "application/pdf", MAX_EVIDENCE_BYTES + 1)).toThrow();
  });
  it("does not call an XML combined filing without the exact approved publication content", () => {
    const report = { publicationAssessment: { canExport: false },
      settings: { profile: { simplifiedSubmission: "yes" } } } as AjpesAnnualReport;
    expect(exportPurpose(report, "xlsx")).toBe("review");
    expect(exportPurpose(report, "pdf")).toBe("review");
    expect(exportPurpose(report, "publication-pdf")).toBe("publication");
    expect(exportPurpose(report, "xml")).toBe("statistics");
    report.publicationAssessment.canExport = true;
    expect(exportPurpose(report, "xml")).toBe("combined");
    report.settings.profile!.simplifiedSubmission = "no";
    expect(exportPurpose(report, "xml")).toBe("statistics");
  });
});