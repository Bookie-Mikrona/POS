import { createHash } from "node:crypto";

export const REFUND_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const REFUND_EVIDENCE_MIMES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

export function validateRefundEvidence(bytes: Buffer, mime: string): boolean {
  if (!bytes.length || bytes.length > REFUND_EVIDENCE_MAX_BYTES) return false;
  switch (mime) {
    case "application/pdf": return bytes.subarray(0, 5).toString() === "%PDF-";
    case "image/png": return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "image/jpeg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp": return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    default: return false;
  }
}

export function refundEvidenceHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
