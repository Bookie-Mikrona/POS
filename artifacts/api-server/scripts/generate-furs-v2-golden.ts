import { createHash, createSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLegalCore, buildSignedTransportAttempt } from "../src/lib/pos-furs";
import { canonicalJson, generateFursV1Golden } from "./generate-furs-v1-golden";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../../..");
const fixtureDir = path.join(workspace, "fiscal-service/contract/test-fixtures");
const outputPath = path.join(workspace, "fiscal-service/contract/golden-vectors-furs-v2.json");
const sha256 = (input: string | Buffer) => createHash("sha256").update(input).digest("hex");

/** Deterministic v2 vectors: one immutable core and two deliberately fresh attempts. */
export function generateFursV2Golden() {
  // Reuse only stable invoice/finalization fixture inputs, never its v1 SOAP evidence.
  const v1 = generateFursV1Golden();
  const certPem = readFileSync(path.join(fixtureDir, "FURS-V1-GOLDEN-TEST-ONLY-certificate.pem"), "utf8");
  const privateKeyPem = readFileSync(path.join(fixtureDir, "FURS-V1-GOLDEN-TEST-ONLY-private-key.pem"), "utf8");
  const operationId = v1.routingFields.operationId;
  const unsignedAuthorityBundle = {
    ...v1.authorityBundle,
    contract: { ...v1.authorityBundle.contract, version: "furs-v2" },
  };
  delete (unsignedAuthorityBundle as any).bundleSha256;
  delete (unsignedAuthorityBundle as any).signatureBase64;
  const authorityCanonicalUtf8 = canonicalJson(unsignedAuthorityBundle);
  const authoritySigner = createSign("RSA-SHA256");
  authoritySigner.update(authorityCanonicalUtf8, "utf8"); authoritySigner.end();
  const authorityBundle = {
    ...unsignedAuthorityBundle, bundleSha256: sha256(authorityCanonicalUtf8),
    signatureBase64: authoritySigner.sign(privateKeyPem).toString("base64"),
  };
  const data = {
    stevilkaRacuna: v1.finalizationPlan.receipt.legalNumber,
    datumCas: new Date(v1.routingFields.issuedAt),
    skupaj: v1.finalizationPlan.totals.gross,
    ddv: v1.finalizationPlan.totals.vat,
    placilnaNacin: "gotovina" as const,
    postavke: v1.finalizationPlan.soldLines.map((line: any) => ({
      ime: line.name, kolicina: line.quantity, cenaKos: line.unitGross, skupaj: line.gross, davek: line.vatRate,
    })),
    davcnaStevilka: "12345678", poslovnaProstor: v1.finalizationPlan.receipt.pp,
    blagajnaId: v1.finalizationPlan.receipt.b, operatorDavcna: v1.finalizationPlan.operator.taxNumber!,
    certPem, certKljuc: privateKeyPem,
  };
  const legalCore = buildLegalCore({
    operationId, localReceiptId: v1.finalizationPlan.receipt.localReceiptId,
    authorityBundle, finalizationPlan: v1.finalizationPlan,
    finalizationPlanSha256: v1.finalizationPlanSha256, data,
    deviceKeyFingerprintSha256: v1.testAuthority.publicKeyFingerprintSha256, devicePrivateKey: privateKeyPem,
  });
  const attempt1 = buildSignedTransportAttempt(legalCore, data, 1, "2026-09-06T10:17:00.000Z");
  const attempt2 = buildSignedTransportAttempt(legalCore, data, 2, "2026-09-06T10:18:00.000Z");
  const contract = JSON.parse(readFileSync(path.join(workspace, "fiscal-service/contract/bookie-fiscal-service-v1.json"), "utf8"));
  const intermediateHashes = {
    legalCoreSha256: sha256(canonicalJson(legalCore)),
    attempt1XmlSha256: attempt1.signedXmlSha256.slice(7),
    attempt2XmlSha256: attempt2.signedXmlSha256.slice(7),
  };
  const aggregationInputUtf8 = Object.entries(intermediateHashes).map(([k, v]) => `${k}=${v}`).join("\n");
  return {
    schema: "bookie-furs-v2-golden-v1",
    warning: "TEST ONLY. The checked-in private key and certificate are public test material and MUST NEVER be used in production.",
    canonicalization: "bookie-canonical-json-v1",
    contractSchemaProjectionSha256: sha256(canonicalJson({
      legalCore: contract.$defs.LegalInvoiceCore, transportAttempt: contract.$defs.FursTransportAttempt,
      derivation: contract["x-furs-v2-derivation"],
    })),
    testAuthority: v1.testAuthority,
    legalCore,
    transportAttempts: [attempt1, attempt2].map(({ signedXml, signedXmlBytes, ...attempt }) => ({
      ...attempt, signedXmlBase64: signedXmlBytes.toString("base64"),
    })),
    goldenAttestation: {
      algorithm: "SHA-256", aggregationInputUtf8, goldenAttestationSha256: sha256(aggregationInputUtf8),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = `${JSON.stringify(generateFursV2Golden(), null, 2)}\n`;
  if (process.argv.includes("--write")) writeFileSync(outputPath, generated);
  else process.stdout.write(generated);
}