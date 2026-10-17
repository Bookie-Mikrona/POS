import { describe, it, expect } from "vitest";
import { REFUND_EVIDENCE_MAX_BYTES, validateRefundEvidence, refundEvidenceHash } from "./refundEvidence";

describe("refund evidence boundary", () => {
  it.each([
    ["application/pdf", Buffer.from("%PDF-1.7\n")],
    ["image/png", Buffer.from("89504e470d0a1a0a", "hex")],
    ["image/jpeg", Buffer.from("ffd8ffe0", "hex")],
    ["image/webp", Buffer.from("RIFF1234WEBP")],
  ])("accepts signature matching %s but not a forged MIME", (mime, bytes) => {
    expect(validateRefundEvidence(bytes, mime)).toBe(true);
    expect(validateRefundEvidence(Buffer.from("<script>alert(1)</script>"), mime)).toBe(false);
  });
  it("rejects empty, SVG and oversized evidence", () => {
    expect(validateRefundEvidence(Buffer.alloc(0), "application/pdf")).toBe(false);
    expect(validateRefundEvidence(Buffer.from("<svg/>"), "image/svg+xml")).toBe(false);
    const huge = Buffer.alloc(REFUND_EVIDENCE_MAX_BYTES + 1);
    huge.write("%PDF-");
    expect(validateRefundEvidence(huge, "application/pdf")).toBe(false);
  });
  it("hashes actual bytes deterministically with SHA-256", () => {
    expect(refundEvidenceHash(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(refundEvidenceHash(Buffer.from("abd"))).not.toBe(refundEvidenceHash(Buffer.from("abc")));
  });
});
