import { beforeEach, describe, expect, it, vi } from "vitest";
import contract from "../../../../fiscal-service/contract/bookie-fiscal-service-v1.json";
import vectors from "../../../../fiscal-service/contract/golden-vectors-v1.json";
import fursV2 from "../../../../fiscal-service/contract/golden-vectors-furs-v2.json";
import {
  authenticatedFiscalHeaders,
  canonicalFiscalJson,
  canonicalSha256,
  FISCAL_SERVICE_BASE_URL,
  isFiscalServicePaired,
  legalLjubljanaTimestamp,
  normalizeServerFursState,
  pairFiscalService,
  getFiscalServiceBaseUrl,
  normalizeFiscalServiceBaseUrl,
  validateOfflineAuthorityBundle,
  validateBoundaryEnvelope,
  validateLocalReceiptProjection,
  type SealedEnvelope,
  type OfflineAuthorityBundle,
} from "./offlineFiscal";

describe("Bookie Fiscal Service v1 contract", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses the checked-in sole loopback base and golden canonical/hash vector", async () => {
    expect(FISCAL_SERVICE_BASE_URL).toBe("http://127.0.0.1:17831/v1");
    expect(contract.servers).toEqual([{ url: FISCAL_SERVICE_BASE_URL }]);
    const vector = vectors.vectors[0];
    expect(canonicalFiscalJson(vector.canonicalPayload)).toBe(vector.canonicalUtf8);
    expect(await canonicalSha256(vector.canonicalPayload)).toBe(vector.payloadSha256);
  });

  it("accepts the cross-language Windows boundary fixture only with signed-core hash and signature mirrors", async () => {
    const core = fursV2.legalCore;
    const plan = core.finalizationPlan;
    const envelope = {
      operationId: core.operationId, deviceId: core.authorityBundle.scope.deviceId,
      poslovniProstorId: core.authorityBundle.scope.premiseId,
      poslovniProstorOznaka: plan.receipt.pp, bIdentifier: plan.receipt.b,
      sequence: plan.receipt.ppBSequence, issuedAt: plan.receipt.issuedAt,
      interruptionStartedAt: plan.receipt.issuedAt, orderId: plan.receipt.orderId,
      operatorReference: plan.operator.taxNumber, paymentReference: null, paymentMethod: "cash",
      canonicalPayload: core, payloadSha256: await canonicalSha256(core),
      deviceSignature: core.deviceSignatureBase64,
      signingPublicKeyFingerprintSha256: core.deviceKeyFingerprintSha256,
    } as SealedEnvelope;
    await expect(validateBoundaryEnvelope(envelope)).resolves.toBeUndefined();
    await expect(validateBoundaryEnvelope({ ...envelope, payloadSha256: "0".repeat(64) })).rejects.toThrow();
    const unsigned = { ...core } as Partial<typeof core>;
    delete unsigned.deviceSignatureBase64;
    expect(envelope.payloadSha256).not.toBe(await canonicalSha256(unsigned));
  });

  it("accepts Windows queue projections using the Android delivery vocabulary and full defaults", async () => {
    const core = fursV2.legalCore;
    const plan = core.finalizationPlan;
    const envelope = {
      operationId: core.operationId, deviceId: core.authorityBundle.scope.deviceId,
      poslovniProstorId: core.authorityBundle.scope.premiseId,
      poslovniProstorOznaka: plan.receipt.pp, bIdentifier: plan.receipt.b,
      sequence: plan.receipt.ppBSequence, issuedAt: plan.receipt.issuedAt,
      interruptionStartedAt: plan.receipt.issuedAt, orderId: plan.receipt.orderId,
      operatorReference: plan.operator.taxNumber, paymentReference: null, paymentMethod: "cash",
      canonicalPayload: core, payloadSha256: await canonicalSha256(core),
      deviceSignature: core.deviceSignatureBase64,
      signingPublicKeyFingerprintSha256: core.deviceKeyFingerprintSha256,
    } as SealedEnvelope;
    for (const bookieDeliveryState of ["pending", "confirmed"] as const) {
      expect(() => validateLocalReceiptProjection({
        envelope, printState: "printed", bookieDeliveryState,
        serverFursProjection: {
          fursState: null, eor: null, attemptCount: 0, lastError: null,
        },
        submissionDeadlineAt: "2025-01-07T10:15:30+01:00",
      })).not.toThrow();
    }
    expect(() => validateLocalReceiptProjection({
      envelope, printState: "printed", bookieDeliveryState: "confirmed",
      serverFursProjection: { fursState: null, eor: null } as never,
      submissionDeadlineAt: "2025-01-07T10:15:30+01:00",
    })).toThrow();
    const lateEorProjection = {
      envelope, printState: "printed" as const, bookieDeliveryState: "confirmed" as const,
      serverFursProjection: {
        fursState: "needs_review" as const, eor: "late-differing-eor",
        attemptCount: 2, lastError: "EOR differs from a late FURS response",
      },
      submissionDeadlineAt: "2025-01-07T10:15:30+01:00",
    };
    expect(() => validateLocalReceiptProjection(lateEorProjection)).not.toThrow();
    expect(normalizeServerFursState(lateEorProjection.serverFursProjection.fursState)).toBe("needs_review");
  });

  it("pairs once through the contract endpoint and stores no pairing code", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      pairingSecret: "AQIDBA==",
      contract: "v1",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await pairFiscalService("123456", "Register 1");
    expect(fetchMock).toHaveBeenCalledWith(`${FISCAL_SERVICE_BASE_URL}/pair`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ code: "123456", clientName: "Register 1" }),
    }));
    expect(isFiscalServicePaired()).toBe(true);
    expect(localStorage.getItem("bookie.fiscal.v1.pairing")).not.toContain("123456");
  });

  it("stores and reuses a nonstandard loopback base URL", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      pairingSecret: "AQIDBA==",
      contract: "v1",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await pairFiscalService("123456", "Register 1", "http://127.0.0.1:18431/v1/");
    expect(getFiscalServiceBaseUrl()).toBe("http://127.0.0.1:18431/v1");
  });

  it("requires HTTPS outside loopback and accepts a LAN HTTPS base", () => {
    expect(normalizeFiscalServiceBaseUrl("https://192.168.1.20:18432/v1")).toBe("https://192.168.1.20:18432/v1");
    expect(() => normalizeFiscalServiceBaseUrl("http://192.168.1.20:18432/v1")).toThrow(/HTTPS/);
  });
  it("signs method, v1 path, timestamp, nonce and raw-body hash exactly", async () => {
    localStorage.setItem("bookie.fiscal.v1.pairing", JSON.stringify({ secret: "AQIDBA==", protocolVersion: "1.0" }));
    const body = '{"operationId":"x"}';
    const headers = await authenticatedFiscalHeaders("POST", "/v1/receipts/cash", body);
    expect(headers["X-Bookie-Nonce"]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(headers["X-Bookie-Timestamp"]).toMatch(/^\d{10}$/);

    const bodyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hex = [...new Uint8Array(bodyHash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const input = `POST\n/v1/receipts/cash\n${headers["X-Bookie-Timestamp"]}\n${headers["X-Bookie-Nonce"]}\n${hex}`;
    const key = await crypto.subtle.importKey("raw", new Uint8Array([1, 2, 3, 4]), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
    expect(headers["X-Bookie-Signature"]).toBe([...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join(""));

    const second = await authenticatedFiscalHeaders("POST", "/v1/receipts/cash", body);
    expect(second["X-Bookie-Nonce"]).not.toBe(headers["X-Bookie-Nonce"]);
  });

  it("emits a Europe/Ljubljana legal offset rather than Z", () => {
    expect(legalLjubljanaTimestamp(new Date("2025-01-03T09:16:00Z"))).toBe("2025-01-03T10:16:00+01:00");
    expect(legalLjubljanaTimestamp(new Date("2025-07-03T08:16:00Z"))).toBe("2025-07-03T10:16:00+02:00");
  });

  it("verifies authority hash, RSA signature, scope and validity", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true, ["sign", "verify"],
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const pemBody = btoa(String.fromCharCode(...spki)).match(/.{1,64}/g)!.join("\n");
    const unsigned = {
      schema: "bookie-offline-authority-v1" as const,
      bundleId: "11111111-1111-4111-8111-111111111111",
      server: { companyId: "22222222-2222-4222-8222-222222222222", enotaId: 3 },
      scope: { deviceId: "33333333-3333-4333-8333-333333333333", premiseId: 19, bIdentifier: "B01" },
      contract: { version: "furs-v2" as const, goldenAttestationSha256: "a".repeat(64), authorityVersion: 1 },
      validity: { validFrom: "2025-01-01T00:00:00Z", validUntil: "2025-02-01T00:00:00Z", outageSubmissionBusinessDays: 2 as const },
      operator: { waiterId: 7, name: "Test", taxNumber: "12345678", shiftId: 9 },
      catalog: [], modifiers: [],
      policies: { paymentMethods: ["cash"], maxReceiptGross: "100.00", maxLines: 10 },
      authority: { keyId: "test", algorithm: "RSA-SHA256" as const, publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----\n` },
    };
    const bundleSha256 = await canonicalSha256(unsigned);
    const signature = new Uint8Array(await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(canonicalFiscalJson(unsigned)),
    ));
    const bundle = {
      ...unsigned, bundleSha256, signatureBase64: btoa(String.fromCharCode(...signature)),
    } satisfies OfflineAuthorityBundle;
    const identity = { deviceId: bundle.scope.deviceId, unitId: 3, premiseId: 19, premiseLabel: "PP01", bIdentifier: "B01" };
    await expect(validateOfflineAuthorityBundle(bundle, identity, new Date("2025-01-15T00:00:00Z"))).resolves.toBeUndefined();
    await expect(validateOfflineAuthorityBundle({ ...bundle, bundleSha256: "0".repeat(64) }, identity, new Date("2025-01-15T00:00:00Z")))
      .rejects.toThrow("SHA-256");
  });
});