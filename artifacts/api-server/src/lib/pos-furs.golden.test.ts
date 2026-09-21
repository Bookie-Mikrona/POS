import { createHash, createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-ignore The checked-in generator intentionally lives under scripts and is executed with tsx.
import { generateFursV1Golden, canonicalJson } from "../../scripts/generate-furs-v1-golden";
import { validateFinalizationPlan } from "../services/pos/finalization-plan";

const workspace = path.resolve(import.meta.dirname, "../../../..");
const contractPath = path.join(workspace, "fiscal-service/contract/bookie-fiscal-service-v1.json");
const goldenPath = path.join(workspace, "fiscal-service/contract/golden-vectors-furs-v1.json");
const hash = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");

function resolveRef(root: any, schema: any): any {
  if (!schema?.$ref) return schema;
  return schema.$ref.slice(2).split("/").reduce((value: any, key: string) => value[key], root);
}

/** Contract-shape verifier for required fields, closed objects, arrays and constants. */
function verifyContractShape(root: any, input: any, unresolved: any, location = "$"): void {
  const schema = resolveRef(root, unresolved);
  if (schema.const !== undefined) expect(input, `${location} const`).toEqual(schema.const);
  if (schema.type === "object" || schema.properties) {
    expect(input && typeof input === "object" && !Array.isArray(input), `${location} object`).toBe(true);
    for (const key of schema.required ?? []) expect(Object.hasOwn(input, key), `${location}.${key} required`).toBe(true);
    if (schema.additionalProperties === false) {
      expect(Object.keys(input).filter(key => !Object.hasOwn(schema.properties ?? {}, key)), `${location} closed`).toEqual([]);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(input, key)) verifyContractShape(root, input[key], child, `${location}.${key}`);
    }
  }
  if (schema.type === "array" || schema.items) {
    expect(Array.isArray(input), `${location} array`).toBe(true);
    input.forEach((child: unknown, index: number) => verifyContractShape(root, child, schema.items, `${location}[${index}]`));
  }
}

// v1 is retained solely as parser/quarantine evidence; it is not normative
// transport evidence and must never be regenerated/retransmitted.
describe.skip("legacy furs-v1 quarantine artifact", () => {
  it("rebuilds byte-for-byte through the production canonical signer", () => {
    const checkedIn = JSON.parse(readFileSync(goldenPath, "utf8"));
    expect(generateFursV1Golden()).toEqual(checkedIn);
  });

  it("validates contract shapes, plan, signatures, byte hashes and attestation aggregation", () => {
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    expect(contract["x-furs-v1-golden"].goldenAttestationSha256)
      .toBe(golden.goldenAttestation.goldenAttestationSha256);

    verifyContractShape(contract, golden.authorityBundle, contract.$defs.OfflineAuthorityBundle);
    verifyContractShape(contract, golden.cashIssueRequest, contract.$defs.CashIssueRequest);
    verifyContractShape(contract, golden.finalizationPlan, contract.$defs.FinalizationPlan);
    verifyContractShape(contract, golden.canonicalPayload, contract.$defs.FursV1CanonicalPayload);
    verifyContractShape(contract, golden.sealedEnvelope, contract.$defs.SealedEnvelope);
    verifyContractShape(contract, golden.provisioning.challenge, contract.$defs.ProvisioningChallenge);
    verifyContractShape(contract, golden.provisioning.serverRegistrationRequest, contract.$defs.DeviceRegistrationProof);
    verifyContractShape(contract, golden.provisioning.signedBundle, contract.$defs.ProvisioningBundle);
    expect(validateFinalizationPlan(golden.finalizationPlan)).toEqual([]);

    const xmlBytes = Buffer.from(golden.fursArtifact.signedXmlBase64, "base64");
    expect(`sha256:${hash(xmlBytes)}`).toBe(golden.fursArtifact.signedXmlSha256);
    expect(Buffer.from(golden.fursArtifact.unsignedInvoiceXmlUtf8).toString("base64"))
      .toBe(golden.fursArtifact.unsignedInvoiceXmlBase64);
    expect(hash(golden.finalizationPlanCanonicalUtf8)).toBe(golden.finalizationPlanSha256);
    expect(hash(golden.canonicalPayloadUtf8)).toBe(golden.payloadSha256);
    expect(canonicalJson(golden.canonicalPayload)).toBe(golden.canonicalPayloadUtf8);
    const cert = new X509Certificate(golden.testAuthority.certificatePem);
    const issuedAt = new Date(golden.routingFields.issuedAt);
    expect(issuedAt >= new Date(cert.validFrom) && issuedAt <= new Date(cert.validTo)).toBe(true);

    const zoiVerifier = createVerify("RSA-SHA256");
    zoiVerifier.update(golden.fursArtifact.zoiInputUtf8);
    zoiVerifier.end();
    const zoiSignature = Buffer.from(golden.fursArtifact.zoiSignatureBase64, "base64");
    expect(zoiVerifier.verify(golden.testAuthority.publicKeyPem, zoiSignature)).toBe(true);
    expect(createHash("md5").update(zoiSignature).digest("hex")).toBe(golden.fursArtifact.zoi);

    const authorityVerifier = createVerify("RSA-SHA256");
    authorityVerifier.update(golden.authorityCanonicalUtf8);
    authorityVerifier.end();
    expect(authorityVerifier.verify(
      golden.testAuthority.publicKeyPem,
      Buffer.from(golden.authorityBundle.signatureBase64, "base64"),
    )).toBe(true);

    const deviceVerifier = createVerify("RSA-SHA256");
    deviceVerifier.update(golden.deviceSignatureMessageUtf8);
    deviceVerifier.end();
    expect(deviceVerifier.verify(
      golden.testAuthority.publicKeyPem,
      Buffer.from(golden.sealedEnvelope.deviceSignature, "base64"),
    )).toBe(true);

    const proofVerifier = createVerify("RSA-SHA256");
    proofVerifier.update(golden.provisioning.proofSignatureInputUtf8);
    proofVerifier.end();
    expect(proofVerifier.verify(golden.provisioning.devicePublicKeyPem,
      Buffer.from(golden.provisioning.proofSignatureBase64, "base64"))).toBe(true);
    expect(hash(createPublicKey(golden.provisioning.devicePublicKeyPem).export({ type: "spki", format: "der" })))
      .toBe(golden.provisioning.devicePublicKeyFingerprintSha256);

    const bundleVerifier = createVerify("RSA-SHA256");
    bundleVerifier.update(golden.provisioning.bundleCanonicalUtf8);
    bundleVerifier.end();
    expect(hash(golden.provisioning.bundleCanonicalUtf8)).toBe(golden.provisioning.signedBundle.payloadSha256);
    expect(bundleVerifier.verify(golden.testAuthority.publicKeyPem,
      Buffer.from(golden.provisioning.signedBundle.signatureBase64, "base64"))).toBe(true);
    expect(golden.provisioning.attestationChecks).toEqual({
      registrationMatchesGoldenAttestation: true, bundleMatchesGoldenAttestation: true,
    });

    const aggregation = golden.goldenAttestation.aggregationOrder
      .map((name: string) => `${name}=${golden.intermediateHashes[name]}`).join("\n");
    expect(aggregation).toBe(golden.goldenAttestation.aggregationInputUtf8);
    expect(hash(aggregation)).toBe(golden.goldenAttestation.goldenAttestationSha256);
  });
});