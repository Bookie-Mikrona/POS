import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const POS_PIN_MAX_FAILURES = 5;
export const POS_PIN_LOCK_MS = 5 * 60_000;

export function hashPosPin(pin: string, salt = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function verifyPosPin(pin: string, stored: string): boolean {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const actual = scryptSync(pin, salt, 32).toString("hex");
  return actual.length === digest.length
    && timingSafeEqual(Buffer.from(actual), Buffer.from(digest));
}