import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SignedXml } from "xml-crypto";

import {
  posljiPodpisanFursRacun,
  type FursRacunData,
  zgradiInPodpisiFursRacun,
} from "./pos-furs";

let fixtureDir: string;
let certPem: string;
let certKljuc: string;

const invoice: Omit<FursRacunData, "certPem" | "certKljuc"> = {
  stevilkaRacuna: "LJ01-POS2-000042",
  datumCas: new Date("2026-01-15T23:30:45.000Z"),
  skupaj: 115,
  ddv: 15,
  placilnaNacin: "kartica",
  davcnaStevilka: "87654321",
  poslovnaProstor: "LJ01",
  blagajnaId: "POS2",
  operatorDavcna: "11223344",
  kupecDavcnaStevilka: "55667788",
  postavke: [
    { ime: "Višja stopnja", kolicina: 1, cenaKos: 61, skupaj: 61, davek: 22 },
    { ime: "Nižja stopnja", kolicina: 1, cenaKos: 54, skupaj: 54, davek: 8 },
  ],
};

beforeAll(() => {
  // Ephemeral test-only key: no private key fixture is checked into the repository.
  fixtureDir = mkdtempSync(path.join(tmpdir(), "furs-canonical-"));
  const keyPath = path.join(fixtureDir, "key.pem");
  const certPath = path.join(fixtureDir, "cert.pem");
  const generated = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "1",
    "-subj", "/CN=Offline FURS canonical test",
  ], { encoding: "utf8" });
  if (generated.status !== 0) throw new Error(generated.stderr);
  certPem = readFileSync(certPath, "utf8");
  certKljuc = readFileSync(keyPath, "utf8");
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

describe("canonical signed FURS invoice", () => {
  it("freezes canonical fields, uses Ljubljana time and creates a verifiable exact payload", () => {
    const request = zgradiInPodpisiFursRacun(
      { ...invoice, certPem, certKljuc },
      22,
      "00000000-0000-4000-8000-000000000042",
    );
    const repeated = zgradiInPodpisiFursRacun(
      { ...invoice, certPem, certKljuc },
      22,
      "00000000-0000-4000-8000-000000000042",
    );

    expect(request.canonicalFields).toEqual(expect.objectContaining({
      messageId: "00000000-0000-4000-8000-000000000042",
      issueDateTime: "2026-01-16T00:30:45",
      invoiceNumber: 42,
      invoiceAmount: "115.00",
      paymentAmount: "115.00",
    }));
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.canonicalFields)).toBe(true);
    expect(request.invoiceXml).toMatch(
      /<fu:TaxNumber>87654321<\/fu:TaxNumber>.*<fu:IssueDateTime>2026-01-16T00:30:45<\/fu:IssueDateTime>.*<fu:NumberingStructure>B<\/fu:NumberingStructure>.*<fu:InvoiceIdentifier>.*<fu:CustomerTaxNumber>55667788<\/fu:CustomerTaxNumber>.*<fu:InvoiceAmount>115.00<\/fu:InvoiceAmount>.*<fu:PaymentAmount>115.00<\/fu:PaymentAmount>.*<fu:TaxesPerSeller>.*<fu:OperatorTaxNumber>11223344<\/fu:OperatorTaxNumber>.*<fu:ProtectedID>/,
    );
    expect(request.signedXml).toBe(repeated.signedXml);
    expect(request.payloadHash).toBe(
      `sha256:${crypto.createHash("sha256").update(request.signedXmlBytes).digest("hex")}`,
    );

    const signatureXml = request.signedXml.match(/<Signature[\s\S]*?<\/Signature>/)?.[0];
    expect(signatureXml).toBeTruthy();
    const verifier = new SignedXml({ publicCert: certPem });
    verifier.loadSignature(signatureXml!);
    expect(verifier.checkSignature(request.signedXml)).toBe(true);
  });

  it("sends byte-identical signed XML on every retry and classifies response loss unknown", async () => {
    const request = zgradiInPodpisiFursRacun(
      { ...invoice, certPem, certKljuc },
      22,
      "00000000-0000-4000-8000-000000000043",
    );
    const sent: Buffer[] = [];
    const transport = vi.fn(async (body: string | Buffer) => {
      sent.push(Buffer.from(body));
      throw new Error("socket closed after write");
    });
    const options = { fursNacin: "testno" as const, certPem, certKljuc };

    const first = await posljiPodpisanFursRacun(request, options, transport);
    const retry = await posljiPodpisanFursRacun(request, options, transport);

    expect(first.outcome).toBe("unknown");
    expect(first.deliveryUnknown).toBe(true);
    expect(retry.outcome).toBe("unknown");
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(request.signedXmlBytes);
    expect(sent[1]).toEqual(sent[0]);
  });
});