import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceRegistrationProofInput, normalizeDevicePublicKey } from "./offline-provisioning";
import { deviceSyncSignatureInput } from "../../routes/pos/offline-fiscal-sync";

describe("offline provisioning and sync signatures", () => {
  it("proves possession without transporting a private key and detects tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const fingerprint = normalizeDevicePublicKey(pem).fingerprintSha256;
    const input = deviceRegistrationProofInput("11111111-1111-4111-8111-111111111111", "challenge", fingerprint);
    const signer = createSign("RSA-SHA256"); signer.update(input); signer.end();
    const signature = signer.sign(privateKey);
    const verifier = createVerify("RSA-SHA256"); verifier.update(input); verifier.end();
    expect(verifier.verify(publicKey, signature)).toBe(true);
    const tampered = createVerify("RSA-SHA256"); tampered.update(`${input}x`); tampered.end();
    expect(tampered.verify(publicKey, signature)).toBe(false);
  });

  it("normalizes Android-style SPKI PEM whitespace to one DER fingerprint and proof", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const canonicalInput = publicKey.export({ type: "spki", format: "pem" }).toString();
    const androidWithoutTerminalLf = canonicalInput.replace(/\n$/, "").replace(/\n/g, "\r\n");
    const androidWithWhitespace = ` \r\n${androidWithoutTerminalLf}\r\n\r\n\t`;
    const first = normalizeDevicePublicKey(androidWithoutTerminalLf);
    const second = normalizeDevicePublicKey(androidWithWhitespace);
    expect(first).toEqual(second);
    expect(first.publicKeyPem.endsWith("\n")).toBe(true);
    expect(first.publicKeyPem.endsWith("\n\n")).toBe(false);

    const input = deviceRegistrationProofInput(
      "11111111-1111-4111-8111-111111111111", "android-challenge", first.fingerprintSha256,
    );
    const signer = createSign("RSA-SHA256"); signer.update(input); signer.end();
    const proof = signer.sign(privateKey);
    for (const variant of [androidWithoutTerminalLf, androidWithWhitespace]) {
      const normalized = normalizeDevicePublicKey(variant);
      const verifier = createVerify("RSA-SHA256");
      verifier.update(deviceRegistrationProofInput(
        "11111111-1111-4111-8111-111111111111", "android-challenge", normalized.fingerprintSha256,
      ));
      verifier.end();
      expect(verifier.verify(normalized.publicKeyPem, proof)).toBe(true);
    }
  });

  it("binds method, exact path, timestamp, nonce and raw body hash", () => {
    const input = deviceSyncSignatureInput("post", "/api/offline-fiscal/sync/receipts/ingest",
      "2026-09-06T10:17:00.000Z", "unique_nonce_128_bits_x", "A".repeat(64));
    expect(input).toBe([
      "POST", "/api/offline-fiscal/sync/receipts/ingest", "2026-09-06T10:17:00.000Z",
      "unique_nonce_128_bits_x", "a".repeat(64),
    ].join("\n"));
  });
});