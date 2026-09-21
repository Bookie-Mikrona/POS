import { createHash, createPublicKey, createSign, randomUUID } from "node:crypto";
import { db, offlineProvisioningBundlesTable } from "@workspace/db";
import { canonicalAuthorityJson } from "./offline-authority";

export function deviceRegistrationProofInput(challengeId: string, challenge: string, publicKeyFingerprint: string): string {
  return `bookie-device-registration-v1\n${challengeId}\n${challenge}\n${publicKeyFingerprint}`;
}

/** Canonical SPKI representation: fingerprint DER bytes, persist PEM with exactly one terminal LF. */
export function normalizeDevicePublicKey(publicKeyInput: string): {
  publicKeyPem: string;
  fingerprintSha256: string;
} {
  if (/PRIVATE KEY/i.test(publicKeyInput)) throw new Error("Only an SPKI public key is accepted.");
  const key = createPublicKey(publicKeyInput);
  const publicKeyPem = key.export({ type: "spki", format: "pem" }).toString().replace(/\r\n/g, "\n");
  const der = key.export({ type: "spki", format: "der" });
  return { publicKeyPem, fingerprintSha256: createHash("sha256").update(der).digest("hex") };
}

function requiredHttpsBase(name: string): string {
  const raw = process.env[name];
  if (!raw) throw Object.assign(new Error(`${name} ni konfiguriran.`), { status: 503 });
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw Object.assign(new Error(`${name} mora biti zaupan HTTPS base URL.`), { status: 503 });
  }
  return url.toString().replace(/\/$/, "");
}

export async function createProvisioningBundle(input: {
  deviceId: string; companyId: string; enotaId: number; poslovniProstorId: number;
  poslovniProstorOznaka: string; bIdentifier: string; expectedFursCertFingerprint: string;
  devicePublicKeyFingerprintSha256: string;
  authorityVersion: number; goldenAttestationSha256: string;
  bundleVersion?: number;
}, executor: any = db) {
  const privateKey = process.env.OFFLINE_AUTHORITY_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");
  const publicKey = process.env.OFFLINE_AUTHORITY_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
  const keyId = process.env.OFFLINE_AUTHORITY_KEY_ID;
  if (!privateKey || !publicKey || !keyId) throw Object.assign(new Error("Authority signing key ni konfiguriran."), { status: 503 });
  const allowedOrigins = (process.env.OFFLINE_ALLOWED_POS_HTTPS_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean);
  if (!allowedOrigins.length || new Set(allowedOrigins).size !== allowedOrigins.length || allowedOrigins.some(value => {
    try {
      const url = new URL(value);
      return url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
        url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.origin !== value;
    } catch { return true; }
  })) throw Object.assign(new Error("OFFLINE_ALLOWED_POS_HTTPS_ORIGINS mora vsebovati samo enolične HTTPS origins."), { status: 503 });
  const syncBaseUrl = requiredHttpsBase("OFFLINE_SYNC_HTTPS_BASE_URL");
  const now = new Date(), validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const payload = {
    schema: "bookie-offline-provisioning-v1", bundleId: randomUUID(), version: input.bundleVersion ?? input.authorityVersion,
    device: { id: input.deviceId, companyId: input.companyId, enotaId: input.enotaId,
      poslovniProstorId: input.poslovniProstorId, poslovniProstorOznaka: input.poslovniProstorOznaka,
      bIdentifier: input.bIdentifier, publicKeyFingerprintSha256: input.devicePublicKeyFingerprintSha256 },
    authority: { keyId, publicKeyPem: publicKey, version: input.authorityVersion, algorithm: "RSA-SHA256" },
    furs: { expectedCertificateFingerprint: input.expectedFursCertFingerprint },
    pos: { allowedHttpsOrigins: allowedOrigins },
    sync: { httpsBaseUrl: syncBaseUrl, ingestPath: "/api/offline-fiscal/sync/receipts/ingest",
      statusPathTemplate: "/api/offline-fiscal/sync/receipts/status/{operationId}",
      gatewayIngestPath: "/api/offline-fiscal/sync/gateway-events/ingest",
      gatewayStatusPath: "/api/offline-fiscal/sync/gateway-events/status",
      configPath: "/api/offline-fiscal/sync/config", maxBodyBytes: 65536 },
    contract: { version: "furs-v2", goldenAttestationSha256: input.goldenAttestationSha256 },
    authentication: { timestampToleranceSeconds: 300, nonceMinBits: 128, nonceRetentionSeconds: 600,
      signatureInput: "METHOD\\nPATH_WITH_QUERY\\nTIMESTAMP\\nNONCE\\nLOWERCASE_HEX_SHA256_RAW_BODY" },
    revocation: { deviceVersion: input.authorityVersion, minimumAcceptedVersion: input.authorityVersion },
    validity: { validFrom: now.toISOString(), validUntil: validUntil.toISOString() },
  };
  const canonical = canonicalAuthorityJson(payload);
  const payloadSha256 = createHash("sha256").update(canonical).digest("hex");
  const signer = createSign("RSA-SHA256"); signer.update(canonical); signer.end();
  const signatureBase64 = signer.sign(privateKey).toString("base64");
  await executor.insert(offlineProvisioningBundlesTable).values({
    id: payload.bundleId, deviceId: input.deviceId, version: payload.version, payload,
    payloadSha256, signatureBase64, validFrom: now, validUntil,
  });
  return { ...payload, payloadSha256, signatureBase64 };
}