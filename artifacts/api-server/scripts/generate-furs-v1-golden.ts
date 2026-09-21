import {
  createHash, createPrivateKey, createPublicKey, createSign, X509Certificate,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignedXml } from "xml-crypto";

import { buildAndSignCanonicalFursInvoice } from "../src/lib/pos-furs";
import {
  canonicalFinalizationJson, createFinalizationPlan, deterministicFinalizationUuid,
  deterministicFursMessageId, deterministicInvoiceRequestId,
  finalizationPlanHash, validateFinalizationPlan, type FinalizationPlan,
} from "../src/services/pos/finalization-plan";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../../..");
const contractDir = path.join(workspace, "fiscal-service/contract");
const fixtureDir = path.join(contractDir, "test-fixtures");
const outputPath = path.join(contractDir, "golden-vectors-furs-v1.json");
const contractPath = path.join(contractDir, "bookie-fiscal-service-v1.json");

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");
const sign = (input: string, privateKey: string) => {
  const signer = createSign("RSA-SHA256");
  signer.update(input, "utf8");
  signer.end();
  return signer.sign(privateKey).toString("base64");
};

export function generateFursV1Golden() {
  const certPem = readFileSync(path.join(fixtureDir, "FURS-V1-GOLDEN-TEST-ONLY-certificate.pem"), "utf8");
  const privateKeyPem = readFileSync(path.join(fixtureDir, "FURS-V1-GOLDEN-TEST-ONLY-private-key.pem"), "utf8");
  const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: "spki", format: "pem" }).toString();
  const certificateFingerprint = `sha256:${new X509Certificate(certPem).fingerprint256.replace(/:/g, "").toLowerCase()}`;
  const publicKeyDer = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  const signingPublicKeyFingerprintSha256 = sha256(publicKeyDer);
  const provisioningChallenge = {
    challengeId: "44444444-4444-4444-8444-444444444444",
    challenge: "RlVSUy1WMS1HT0xERU4tUFJPVklTSU9OSU5HLUNIQUxMRU5HRQ",
    expiresAt: "2026-09-06T10:20:00.000Z",
  };
  const provisioningProofInputUtf8 = [
    "bookie-device-registration-v1", provisioningChallenge.challengeId,
    provisioningChallenge.challenge, signingPublicKeyFingerprintSha256,
  ].join("\n");
  const provisioningProofSignatureBase64 = sign(provisioningProofInputUtf8, privateKeyPem);

  const operationId = "018f47d2-44d2-7a6b-8d7c-8fd8ec6a02cc";
  const deviceId = "11111111-1111-4111-8111-111111111111";
  const companyId = "22222222-2222-4222-8222-222222222222";
  const bundleId = "33333333-3333-4333-8333-333333333333";
  const messageId = deterministicFursMessageId(operationId);
  const localReceiptId = deterministicFinalizationUuid(operationId, "receipt");
  const invoiceRequestId = deterministicInvoiceRequestId(localReceiptId, operationId);
  const issuedAt = "2026-09-06T10:16:00+02:00";
  const interruptionStartedAt = "2026-09-06T10:15:30+02:00";
  const pp = "PP01";
  const b = "B01";
  const sequence = 1;
  const legalNumber = `${pp}-${b}-${sequence}`;

  const signed = buildAndSignCanonicalFursInvoice({
    stevilkaRacuna: legalNumber,
    datumCas: new Date(issuedAt),
    skupaj: 12.5,
    ddv: 2.25,
    placilnaNacin: "gotovina",
    postavke: [{ ime: "Kava", kolicina: 1, cenaKos: 12.5, skupaj: 12.5, davek: 22 }],
    davcnaStevilka: "12345678",
    poslovnaProstor: pp,
    blagajnaId: b,
    operatorDavcna: "87654321",
    certPem,
    certKljuc: privateKeyPem,
  }, messageId, 22, invoiceRequestId);

  const finalizationPlan = createFinalizationPlan({
    version: 2,
    source: "offline",
    sourceOperationId: operationId,
    receipt: {
      localReceiptId,
      companyId, enotaId: 3, orderId: 4242, legalNumber, pp, b, ppBSequence: sequence,
      issuedAt, isPartial: false,
    },
    soldLines: [{
      id: 7001, articleId: 101, modifierId: null, name: "Kava", quantity: 1,
      unitGross: 12.5, gross: 12.5, vatRate: 22, normativeFactor: 1, articleKind: "sale",
    }],
    normativeSnapshot: [{ articleId: 501, quantity: -0.008 }],
    totals: { gross: 12.5, net: 10.25, vat: 2.25, vatGroups: [{ rate: 22, gross: 12.5, vat: 2.25 }] },
    payment: {
      method: "gotovina", cash: 12.5, card: 0, voucher: 0, pizzaVoucher: 0, nonCash: 0,
      terminalReferenceReservationId: null, cardPaymentAttemptId: null, giftVoucherRedemption: 0,
    },
    operator: { waiterId: 17, name: "Testni Operater", taxNumber: "87654321", shiftId: 23, actor: "offline-device:golden" },
    closure: { allLinesCovered: true, closeOrder: true, orderId: 4242, tableId: 9, clearTipAmount: true },
    tip: { amount: 0, mode: null, policyId: null, feeAmount: 0, netAmount: 0, distributionProfile: null },
    stockMovements: [{
      articleId: 501, quantity: -0.008, unitWac: 18.75, value: -0.15,
      note: "Golden Kava", effectiveAt: issuedAt,
    }],
    kds: { effects: [{ kind: "complete", lineId: 7001 }] },
    accounting: { companyId, businessDate: "2026-09-06", syncAfterCommit: true },
    print: {
      receiptNumber: legalNumber, issuedAt, customerName: null,
      customerAddress: null, customerTaxNumber: null,
    },
    reservations: { issueReservationId: deterministicFinalizationUuid(operationId, "issue-reservation") },
    furs: {
      snapshotId: deterministicFinalizationUuid(operationId, "furs-snapshot"),
      requestHash: signed.payloadHash, canonicalArtifactLink: `offline:${operationId}`,
    },
  } satisfies FinalizationPlan);
  const finalizationPlanSha256 = finalizationPlanHash(finalizationPlan);
  const zoiSignatureBase64 = sign(signed.canonicalFields.zoiInput, privateKeyPem);
  const zoiSignatureBytes = Buffer.from(zoiSignatureBase64, "base64");
  if (createHash("md5").update(zoiSignatureBytes).digest("hex") !== signed.zoi) {
    throw new Error("ZOI does not match the deterministic RSA signature bytes.");
  }

  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  const contractSchemaProjection = {
    canonicalization: contract["x-canonicalization"],
    derivation: contract["x-furs-v1-derivation"],
    dynamicFursIdentifiers: contract["x-dynamic-furs-identifiers"],
    serverSyncAuthentication: contract["x-server-sync-authentication"],
    deviceRegistrationProof: contract["x-device-registration-proof"],
    provisioningInstall: contract["x-provisioning-install"],
    loopbackAdminCertificate: contract["x-loopback-admin-certificate"],
    schemas: {
      OfflineAuthorityBundle: contract.$defs.OfflineAuthorityBundle,
      CashIssueRequest: contract.$defs.CashIssueRequest,
      FinalizationPlan: contract.$defs.FinalizationPlan,
      FursV1CanonicalPayload: contract.$defs.FursV1CanonicalPayload,
      LocalProvisioningProofRequest: contract.$defs.LocalProvisioningProofRequest,
      LocalProvisioningProofResponse: contract.$defs.LocalProvisioningProofResponse,
      ProvisioningChallenge: contract.$defs.ProvisioningChallenge,
      DeviceRegistrationProof: contract.$defs.DeviceRegistrationProof,
      ProvisioningBundle: contract.$defs.ProvisioningBundle,
      ProvisioningInstallResponse: contract.$defs.ProvisioningInstallResponse,
      LocalCertificateImport: contract.$defs.LocalCertificateImport,
      LocalCertificateStatus: contract.$defs.LocalCertificateStatus,
      DeviceSyncStatus: contract.$defs.DeviceSyncStatus,
      SealedEnvelope: contract.$defs.SealedEnvelope,
    },
  };
  const intermediateHashes = {
    contractSchemaProjectionSha256: sha256(canonicalJson(contractSchemaProjection)),
    unsignedInvoiceXmlSha256: sha256(Buffer.from(signed.invoiceXml, "utf8")),
    signedSoapXmlSha256: signed.payloadHash.slice("sha256:".length),
    zoiInputSha256: sha256(signed.canonicalFields.zoiInput),
    zoiSignatureSha256: sha256(zoiSignatureBytes),
    finalizationPlanSha256,
    certificateDerSha256: certificateFingerprint.slice("sha256:".length),
    devicePublicKeySpkiDerSha256: signingPublicKeyFingerprintSha256,
    provisioningProofInputSha256: sha256(provisioningProofInputUtf8),
  };
  const aggregationOrder = Object.keys(intermediateHashes);
  const aggregationInputUtf8 = aggregationOrder
    .map((name) => `${name}=${intermediateHashes[name as keyof typeof intermediateHashes]}`)
    .join("\n");
  const goldenAttestationSha256 = sha256(aggregationInputUtf8);
  const deviceRegistrationRequest = {
    challengeId: provisioningChallenge.challengeId,
    publicKeyPem,
    proofSignatureBase64: provisioningProofSignatureBase64,
    platform: "android",
    bIdentifier: b,
    expectedFursCertFingerprint: certificateFingerprint,
    goldenAttestationSha256,
  };
  const unsignedProvisioningBundle = {
    schema: "bookie-offline-provisioning-v1",
    bundleId: "55555555-5555-4555-8555-555555555555",
    version: 1,
    device: {
      id: deviceId, companyId, enotaId: 3, poslovniProstorId: 19,
      poslovniProstorOznaka: pp, bIdentifier: b,
      publicKeyFingerprintSha256: signingPublicKeyFingerprintSha256,
    },
    authority: { keyId: "FURS-V1-GOLDEN-TEST-ONLY", publicKeyPem, version: 1, algorithm: "RSA-SHA256" },
    furs: { expectedCertificateFingerprint: certificateFingerprint },
    pos: { allowedHttpsOrigins: ["https://pos.example.test"] },
    sync: {
      httpsBaseUrl: "https://api.example.test",
      ingestPath: "/api/offline-fiscal/sync/receipts/ingest",
      statusPathTemplate: "/api/offline-fiscal/sync/receipts/status/{operationId}",
      configPath: "/api/offline-fiscal/sync/config", maxBodyBytes: 65536,
    },
    contract: { version: "furs-v1", goldenAttestationSha256 },
    authentication: {
      timestampToleranceSeconds: 300, nonceMinBits: 128, nonceRetentionSeconds: 600,
      signatureInput: "METHOD\\nPATH_WITH_QUERY\\nTIMESTAMP\\nNONCE\\nLOWERCASE_HEX_SHA256_RAW_BODY",
    },
    revocation: { deviceVersion: 1, minimumAcceptedVersion: 1 },
    validity: { validFrom: "2026-09-06T10:17:00.000Z", validUntil: "2026-10-06T10:17:00.000Z" },
  };
  const provisioningBundleCanonicalUtf8 = canonicalJson(unsignedProvisioningBundle);
  const provisioningBundle = {
    ...unsignedProvisioningBundle,
    payloadSha256: sha256(provisioningBundleCanonicalUtf8),
    signatureBase64: sign(provisioningBundleCanonicalUtf8, privateKeyPem),
  };

  const unsignedAuthorityBundle = {
    schema: "bookie-offline-authority-v1",
    bundleId,
    server: { companyId, enotaId: 3 },
    scope: { deviceId, premiseId: 19, bIdentifier: b },
    contract: { version: "furs-v1", goldenAttestationSha256, authorityVersion: 1 },
    validity: { validFrom: "2026-09-01T00:00:00+02:00", validUntil: "2026-09-08T00:00:00+02:00", outageSubmissionBusinessDays: 2 },
    operator: { waiterId: 17, name: "Testni Operater", taxNumber: "87654321", shiftId: 23 },
    catalog: [{
      articleId: 101, name: "Kava", unitGross: "12.50", vatRate: "22.00", articleKind: "sale",
      inputArticleId: 501, normativeQuantity: "0.008", unitWac: "18.750000",
    }],
    modifiers: [],
    policies: {
      paymentMethods: ["cash"], maxReceiptGross: "10000.00", maxLines: 250,
      stock: "signed-snapshot-exactly-once", kds: "signed-effects-exactly-once",
      accounting: "server-after-confirmation", staleOrder: "quarantine",
    },
    authority: { keyId: "FURS-V1-GOLDEN-TEST-ONLY", algorithm: "RSA-SHA256", publicKeyPem },
  };
  const authorityCanonicalUtf8 = canonicalJson(unsignedAuthorityBundle);
  const authorityBundle = {
    ...unsignedAuthorityBundle,
    bundleSha256: sha256(authorityCanonicalUtf8),
    signatureBase64: sign(authorityCanonicalUtf8, privateKeyPem),
  };

  const finalizationPlanTemplate = {
    ...finalizationPlan,
    receiptContext: {
      companyId, enotaId: 3, orderId: 4242, isPartial: false,
    },
  } as Record<string, unknown>;
  delete finalizationPlanTemplate.receipt;
  delete finalizationPlanTemplate.reservations;
  delete finalizationPlanTemplate.furs;
  const cashIssueRequest = {
    operationId, authorityBundle,
    orderEventSnapshot: { orderId: 4242, orderVersion: 7, eventId: 9001, capturedAt: issuedAt, lineIds: [7001] },
    finalizationPlanTemplate,
    legalTimestamp: issuedAt,
    interruptionStartedAt,
  };

  const fursArtifact = {
    unsignedInvoiceXmlUtf8: signed.invoiceXml,
    unsignedInvoiceXmlBase64: Buffer.from(signed.invoiceXml, "utf8").toString("base64"),
    signedXmlBase64: signed.signedXmlBytes.toString("base64"),
    signedXmlSha256: signed.payloadHash,
    canonicalPayloadHash: signed.payloadHash,
    zoi: signed.zoi,
    zoiInputUtf8: signed.canonicalFields.zoiInput,
    zoiSignatureBase64,
    certificateFingerprint: signed.certificateFingerprint,
    canonicalFields: signed.canonicalFields,
    xmlDsig: {
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
      transforms: [
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
      ],
      referenceUri: `#${invoiceRequestId}`,
    },
  };
  const canonicalPayload = {
    envelopeVersion: "furs-v1",
    authorityBundle,
    finalizationPlan,
    finalizationPlanSha256,
    fursArtifact: {
      signedXmlBase64: fursArtifact.signedXmlBase64,
      signedXmlSha256: fursArtifact.signedXmlSha256,
      zoi: fursArtifact.zoi,
      certificateFingerprint: fursArtifact.certificateFingerprint,
      canonicalFields: fursArtifact.canonicalFields,
    },
  };
  const canonicalPayloadUtf8 = canonicalJson(canonicalPayload);
  const payloadSha256 = sha256(canonicalPayloadUtf8);
  const routingFields = {
    operationId, deviceId, poslovniProstorId: 19, poslovniProstorOznaka: pp,
    bIdentifier: b, sequence, issuedAt, interruptionStartedAt, orderId: 4242,
    operatorReference: "17", paymentReference: null, paymentMethod: "cash" as const,
  };
  const deviceSignatureMessage = canonicalJson({ ...routingFields, payloadSha256 });
  const sealedEnvelope = {
    ...routingFields, canonicalPayload, payloadSha256,
    deviceSignature: sign(deviceSignatureMessage, privateKeyPem),
    signingPublicKeyFingerprintSha256,
  };
  const syncRequest = {
    method: "POST",
    path: "/api/offline-fiscal/sync/receipts/ingest",
    timestamp: "2026-09-06T10:17:00.000Z",
    nonce: "RklSUy1WMS1HT0xERU4tTk9OQ0U",
    bodySha256: sha256(canonicalJson(sealedEnvelope)),
  };
  const syncSignatureInputUtf8 = [
    syncRequest.method, syncRequest.path, syncRequest.timestamp, syncRequest.nonce, syncRequest.bodySha256,
  ].join("\n");
  const syncRequestVector = {
    ...syncRequest, deviceId,
    signatureInputUtf8: syncSignatureInputUtf8,
    signatureBase64: sign(syncSignatureInputUtf8, privateKeyPem),
  };

  const signatureXml = signed.signedXml.match(/<Signature[\s\S]*?<\/Signature>/)?.[0];
  if (!signatureXml) throw new Error("Generated XMLDSig is missing.");
  const verifier = new SignedXml({ publicCert: certPem });
  verifier.loadSignature(signatureXml);
  if (!verifier.checkSignature(signed.signedXml)) throw new Error("Generated XMLDSig is invalid.");
  if (validateFinalizationPlan(finalizationPlan).length) throw new Error("Generated FinalizationPlan is invalid.");
  if (canonicalFinalizationJson(finalizationPlan) !== canonicalJson(finalizationPlan)) throw new Error("Canonical JSON implementations diverged.");

  return {
    schema: "bookie-furs-v1-golden-v1",
    warning: "TEST ONLY. The checked-in private key and certificate are public test material and MUST NEVER be used in production.",
    canonicalization: "bookie-canonical-json-v1",
    goldenAttestation: {
      algorithm: "SHA-256",
      aggregationRule: "UTF-8 lines name=lowercase-hex-sha256 joined by LF, in aggregationOrder; no trailing LF.",
      aggregationOrder,
      aggregationInputUtf8,
      goldenAttestationSha256,
    },
    testAuthority: {
      certificatePem: certPem,
      certificateFingerprintSha256: certificateFingerprint,
      publicKeyPem,
      publicKeyFingerprintSha256: signingPublicKeyFingerprintSha256,
      fixturePrivateKeyPath: "test-fixtures/FURS-V1-GOLDEN-TEST-ONLY-private-key.pem",
      fixtureCertificatePath: "test-fixtures/FURS-V1-GOLDEN-TEST-ONLY-certificate.pem",
    },
    authorityBundle,
    provisioning: {
      challenge: provisioningChallenge,
      devicePublicKeyPem: publicKeyPem,
      devicePublicKeyFingerprintSha256: signingPublicKeyFingerprintSha256,
      proofSignatureInputUtf8: provisioningProofInputUtf8,
      proofSignatureBase64: provisioningProofSignatureBase64,
      serverRegistrationRequest: deviceRegistrationRequest,
      unsignedBundle: unsignedProvisioningBundle,
      bundleCanonicalUtf8: provisioningBundleCanonicalUtf8,
      signedBundle: provisioningBundle,
      attestationChecks: {
        registrationMatchesGoldenAttestation: deviceRegistrationRequest.goldenAttestationSha256 === goldenAttestationSha256,
        bundleMatchesGoldenAttestation: provisioningBundle.contract.goldenAttestationSha256 === goldenAttestationSha256,
      },
    },
    authorityCanonicalUtf8,
    cashIssueRequest,
    cashIssueRequestCanonicalSha256: sha256(canonicalJson(cashIssueRequest)),
    finalizationPlan,
    finalizationPlanCanonicalUtf8: canonicalJson(finalizationPlan),
    finalizationPlanSha256,
    fursArtifact,
    canonicalPayload,
    canonicalPayloadUtf8,
    payloadSha256,
    routingFields,
    deviceSignatureMessageUtf8: deviceSignatureMessage,
    deviceSignatureMessageSha256: sha256(deviceSignatureMessage),
    sealedEnvelope,
    dynamicFursIds: { messageId, invoiceRequestId },
    syncRequestVector,
    sealedEnvelopeCanonicalSha256: sha256(canonicalJson(sealedEnvelope)),
    intermediateHashes,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = `${JSON.stringify(generateFursV1Golden(), null, 2)}\n`;
  if (process.argv.includes("--write")) writeFileSync(outputPath, generated);
  else process.stdout.write(generated);
}