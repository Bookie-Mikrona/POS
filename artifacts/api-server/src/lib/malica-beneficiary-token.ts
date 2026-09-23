import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const value = process.env.BIZBOX_ENC_KEY;
  if (!value) throw new Error("BIZBOX_ENC_KEY is required for Malica beneficiary operations.");
  return value;
}
export function beneficiaryHash(enotaId: number, partnerId: string, type: string, value: string): string {
  return createHmac("sha256", secret()).update(`malica-beneficiary:v2:${enotaId}:${partnerId}:${type}:${value.trim()}`).digest("hex");
}
export function beneficiaryToken(enotaId: number, partnerId: string, beneficiaryId: number, expiresAt: number): string {
  const payload = `${enotaId}.${partnerId}.${beneficiaryId}.${expiresAt}`;
  return `${Buffer.from(payload).toString("base64url")}.${createHmac("sha256", secret()).update(`malica-token:${payload}`).digest("base64url")}`;
}
export function verifyBeneficiaryToken(token: string, enotaId: number, partnerId: string): number | null {
  try {
    const [encoded, signature] = token.split(".");
    const payload = Buffer.from(encoded, "base64url").toString();
    const expected = createHmac("sha256", secret()).update(`malica-token:${payload}`).digest("base64url");
    if (!signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const [unit, partner, id, expiry] = payload.split(".");
    if (Number(unit) !== enotaId || partner !== partnerId || Number(expiry) < Math.floor(Date.now() / 1000)) return null;
    return Number(id);
  } catch { return null; }
}