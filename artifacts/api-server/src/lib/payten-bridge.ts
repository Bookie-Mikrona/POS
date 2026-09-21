import { createHash, createPublicKey, verify } from "node:crypto";

export type PaytenBridgePayload = {
  version: 1;
  keyId: string;
  attemptId: string;
  requestId: string;
  receivedAt: string;
  resultCode: string;
  amount: string | number;
  currency: "EUR";
  providerReference: string;
  invoice: unknown;
  ecr: unknown;
  responseHash: string;
};

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const KEY_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function decodeBase64Url(value: unknown, maxBytes: number): Buffer | null {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maxBytes * 4 / 3) + 4 || !BASE64URL.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length > 0 && decoded.length <= maxBytes ? decoded : null;
  } catch {
    return null;
  }
}

/** Ensures enrollment input is an SPKI encoded NIST P-256 public key. */
export function parsePaytenBridgePublicKey(keyId: unknown, publicKeyBase64Url: unknown) {
  if (typeof keyId !== "string" || !KEY_ID.test(keyId)) return null;
  const der = decodeBase64Url(publicKeyBase64Url, 1024);
  if (!der) return null;
  try {
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    const details = key.asymmetricKeyDetails;
    if (key.asymmetricKeyType !== "ec" || details?.namedCurve !== "prime256v1") return null;
    // Exporting canonical SPKI prevents alternate encodings from bypassing pairing comparison.
    const spki = key.export({ format: "der", type: "spki" }) as Buffer;
    const digest = createHash("sha256").update(spki).digest();
    const canonicalKeyId = digest.toString("base64url");
    if (keyId !== canonicalKeyId) return null;
    return { keyId: canonicalKeyId, spkiBase64Url: spki.toString("base64url"), fingerprint: digest.toString("hex") };
  } catch {
    return null;
  }
}

function isPayload(value: unknown): value is PaytenBridgePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const expected = ["version", "keyId", "attemptId", "requestId", "receivedAt", "resultCode", "amount", "currency", "providerReference", "invoice", "ecr", "responseHash"];
  if (Object.keys(v).length !== expected.length || !expected.every(key => Object.hasOwn(v, key))) return false;
  return v.version === 1 && typeof v.keyId === "string" && KEY_ID.test(v.keyId)
    && typeof v.attemptId === "string" && v.attemptId.length <= 128
    && typeof v.requestId === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(v.requestId)
    && typeof v.receivedAt === "number" && Number.isSafeInteger(v.receivedAt) && v.receivedAt > 0
    && typeof v.resultCode === "string" && v.resultCode.length <= 64
    && (typeof v.amount === "string" || typeof v.amount === "number")
    && v.currency === "EUR" && typeof v.providerReference === "string" && v.providerReference.trim().length > 0 && v.providerReference.length <= 256
    && typeof v.responseHash === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(v.responseHash);
}

export function exactDecimalCents(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function verifyPaytenBridgeEnvelope(envelope: unknown, publicKeyBase64Url: string) {
  if (!envelope || typeof envelope !== "object") return { ok: false as const, error: "Neveljavna podpisana ovojnica." };
  const input = envelope as Record<string, unknown>;
  const bytes = decodeBase64Url(input.payloadBase64Url, 16 * 1024);
  const signature = decodeBase64Url(input.signatureBase64Url, 512);
  if (!bytes || !signature || typeof input.keyId !== "string" || !KEY_ID.test(input.keyId)) return { ok: false as const, error: "Neveljavna podpisana ovojnica." };
  let payload: unknown;
  try { payload = JSON.parse(bytes.toString("utf8")); } catch { return { ok: false as const, error: "Neveljaven podpisan Payten rezultat." }; }
  if (!isPayload(payload)) return { ok: false as const, error: "Podpisan Payten rezultat nima veljavne oblike." };
  const key = parsePaytenBridgePublicKey(input.keyId, publicKeyBase64Url);
  if (!key || !verify("sha256", bytes, { key: createPublicKey({ key: Buffer.from(key.spkiBase64Url, "base64url"), format: "der", type: "spki" }), dsaEncoding: "der" }, signature)) {
    return { ok: false as const, error: "Podpis Payten Bridge ni veljaven." };
  }
  return { ok: true as const, payload, payloadBytes: bytes };
}