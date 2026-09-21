import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exactDecimalCents, parsePaytenBridgePublicKey, verifyPaytenBridgeEnvelope } from "./payten-bridge";

describe("Payten Bridge signed envelope", () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = keys.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const keyId = createHash("sha256").update(spki).digest("base64url");
  const payload = {
    version: 1, keyId, attemptId: "attempt-1", requestId: "a".repeat(32), receivedAt: Date.now(),
    resultCode: "Approved", amount: "12.34", currency: "EUR", providerReference: "provider-1",
    invoice: {}, ecr: "00000001", responseHash: "b".repeat(32),
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const envelope = {
    keyId, payloadBase64Url: bytes.toString("base64url"),
    signatureBase64Url: sign("sha256", bytes, { key: keys.privateKey, dsaEncoding: "der" }).toString("base64url"),
  };

  it("accepts canonical P-256 pairing and a real DER signature", () => {
    expect(parsePaytenBridgePublicKey(keyId, spki.toString("base64url"))?.keyId).toBe(keyId);
    expect(verifyPaytenBridgeEnvelope(envelope, spki.toString("base64url")).ok).toBe(true);
  });
  it("rejects tampered signatures and raw response payload keys", () => {
    expect(verifyPaytenBridgeEnvelope({ ...envelope, signatureBase64Url: "x".repeat(80) }, spki.toString("base64url")).ok).toBe(false);
    const unsafe = Buffer.from(JSON.stringify({ ...payload, paytenResponse: {}, responseHash: undefined }));
    expect(verifyPaytenBridgeEnvelope({ ...envelope, payloadBase64Url: unsafe.toString("base64url") }, spki.toString("base64url")).ok).toBe(false);
  });
  it("parses provider amounts only as exact positive cents", () => {
    expect(exactDecimalCents("12.34")).toBe(1234);
    expect(exactDecimalCents("12.345")).toBeNull();
    expect(exactDecimalCents("0")).toBeNull();
  });
});