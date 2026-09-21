import { createHash, createPublicKey, createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildSignedTransportAttempt, verifyZOI } from "./pos-furs";

const workspace = path.resolve(import.meta.dirname, "../../../..");
const golden = JSON.parse(readFileSync(path.join(workspace, "fiscal-service/contract/golden-vectors-furs-v2.json"), "utf8"));
const certificatePem = readFileSync(path.join(workspace, "fiscal-service/contract/test-fixtures/FURS-V1-GOLDEN-TEST-ONLY-certificate.pem"), "utf8");
const privateKeyPem = readFileSync(path.join(workspace, "fiscal-service/contract/test-fixtures/FURS-V1-GOLDEN-TEST-ONLY-private-key.pem"), "utf8");
const data = {
  stevilkaRacuna: golden.legalCore.finalizationPlan.receipt.legalNumber,
  datumCas: new Date(golden.legalCore.finalizationPlan.receipt.issuedAt),
  skupaj: golden.legalCore.finalizationPlan.totals.gross, ddv: golden.legalCore.finalizationPlan.totals.vat,
  placilnaNacin: "gotovina" as const,
  postavke: golden.legalCore.finalizationPlan.soldLines.map((line: any) => ({
    ime: line.name, kolicina: line.quantity, cenaKos: line.unitGross, skupaj: line.gross, davek: line.vatRate,
  })),
  davcnaStevilka: "12345678", poslovnaProstor: "PP01", blagajnaId: "B01", operatorDavcna: "87654321",
  certPem: certificatePem, certKljuc: privateKeyPem,
};

describe("FURS v2 legal core and append-only transport attempts", () => {
  it("rebuilds exact attempts with fresh identities and invariant legal invoice evidence", () => {
    const [first, second] = golden.transportAttempts;
    const rebuiltFirst = buildSignedTransportAttempt(golden.legalCore, data, 1, first.transmissionTime);
    const rebuiltSecond = buildSignedTransportAttempt(golden.legalCore, data, 2, second.transmissionTime);
    const { signedXml: _firstXml, signedXmlBytes: _firstBytes, ...firstWire } = rebuiltFirst;
    const { signedXml: _secondXml, signedXmlBytes: _secondBytes, ...secondWire } = rebuiltSecond;
    expect({ ...firstWire, signedXmlBase64: rebuiltFirst.signedXmlBytes.toString("base64") }).toEqual(first);
    expect({ ...secondWire, signedXmlBase64: rebuiltSecond.signedXmlBytes.toString("base64") }).toEqual(second);
    expect(first.messageId).not.toBe(second.messageId);
    expect(first.invoiceRequestId).not.toBe(second.invoiceRequestId);
    expect(first.transmissionTime).not.toBe(second.transmissionTime);
    expect(first.signedXmlSha256).not.toBe(second.signedXmlSha256);
    expect(golden.legalCore.legalInvoice.zoi).toBe(golden.legalCore.legalInvoice.zoi);
    expect(Buffer.from(first.signedXmlBase64, "base64").toString("utf8")).toContain(golden.legalCore.legalInvoice.zoi);
    expect(Buffer.from(second.signedXmlBase64, "base64").toString("utf8")).toContain(golden.legalCore.legalInvoice.zoi);
  });

  it("verifies ZOI and fails closed when its immutable evidence is tampered", () => {
    expect(verifyZOI(golden.legalCore, golden.testAuthority.publicKeyPem, golden.testAuthority.certificateFingerprintSha256)).toBe(true);
    expect(verifyZOI({ ...golden.legalCore, legalInvoice: { ...golden.legalCore.legalInvoice, zoi: "0".repeat(32) } },
      golden.testAuthority.publicKeyPem, golden.testAuthority.certificateFingerprintSha256)).toBe(false);
    expect(verifyZOI({ ...golden.legalCore, certificateFingerprint: "sha256:".concat("0".repeat(64)) },
      golden.testAuthority.publicKeyPem, golden.testAuthority.certificateFingerprintSha256)).toBe(false);
  });

  it("has cryptographically valid device and XMLDSig evidence", () => {
    const unsigned = { ...golden.legalCore }; delete (unsigned as any).deviceSignatureBase64;
    const verifyDevice = createVerify("RSA-SHA256");
    verifyDevice.update((awaitableCanonicalJson(unsigned)), "utf8"); verifyDevice.end();
    expect(verifyDevice.verify(golden.testAuthority.publicKeyPem, Buffer.from(golden.legalCore.deviceSignatureBase64, "base64"))).toBe(true);
    for (const attempt of golden.transportAttempts) {
      expect(`sha256:${createHash("sha256").update(Buffer.from(attempt.signedXmlBase64, "base64")).digest("hex")}`).toBe(attempt.signedXmlSha256);
    }
    expect(createHash("sha256").update(createPublicKey(golden.testAuthority.publicKeyPem).export({ type: "spki", format: "der" })).digest("hex"))
      .toBe(golden.legalCore.deviceKeyFingerprintSha256);
  });
});

function awaitableCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(awaitableCanonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${awaitableCanonicalJson(v)}`).join(",")}}`;
}