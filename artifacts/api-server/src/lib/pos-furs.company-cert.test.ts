import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { companiesTable, db, pool } from "@workspace/db";
import { sifrirajBizboxGeslo } from "./kripto-bizbox";
import { podpisiXML, pridobiCompanyCert } from "./pos-furs";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const TEST_ENC_KEY = "furs-company-cert-test-encryption-key-32!";

interface PemPair {
  certPem: string;
  certKljuc: string;
  pemPot: string;
}

let tempDir: string;
let companyAId: string;
let companyBId: string;
let companyBrezCertaId: string;
let certA: PemPair;
let certB: PemPair;
let legacyCert: PemPair;

function ustvariCertifikat(ime: string): PemPair {
  const keyPot = path.join(tempDir, `${ime}-key.pem`);
  const certPot = path.join(tempDir, `${ime}-cert.pem`);
  const result = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPot, "-out", certPot, "-days", "2",
    "-subj", `/CN=FURS ${ime} ${RUN_ID}`,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`openssl test fixture ni uspel: ${result.stderr}`);
  }
  const certPem = readFileSync(certPot, "utf8");
  const certKljuc = readFileSync(keyPot, "utf8");
  const pemPot = path.join(tempDir, `${ime}-combined.pem`);
  writeFileSync(pemPot, `${certKljuc}\n${certPem}`);
  return { certPem, certKljuc, pemPot };
}

beforeAll(async () => {
  process.env.BIZBOX_ENC_KEY = TEST_ENC_KEY;
  tempDir = mkdtempSync(path.join(tmpdir(), "furs-company-cert-"));
  certA = ustvariCertifikat("company-a");
  certB = ustvariCertifikat("company-b");
  legacyCert = ustvariCertifikat("legacy");

  const [a] = await db.insert(companiesTable).values({
    podjetjeDavcna: `FURS_COMPANY_A_${RUN_ID}`,
    naziv: `FURS company A ${RUN_ID}`,
    fursCertifikatPem: certA.certPem,
    fursKljucEnc: sifrirajBizboxGeslo(certA.certKljuc),
  }).returning({ id: companiesTable.id });
  companyAId = a!.id;

  const [b] = await db.insert(companiesTable).values({
    podjetjeDavcna: `FURS_COMPANY_B_${RUN_ID}`,
    naziv: `FURS company B ${RUN_ID}`,
    fursCertifikatPem: certB.certPem,
    fursKljucEnc: sifrirajBizboxGeslo(certB.certKljuc),
  }).returning({ id: companiesTable.id });
  companyBId = b!.id;

  const [brez] = await db.insert(companiesTable).values({
    podjetjeDavcna: `FURS_COMPANY_NONE_${RUN_ID}`,
    naziv: `FURS company brez certifikata ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyBrezCertaId = brez!.id;
});

afterAll(async () => {
  await db.delete(companiesTable).where(eq(companiesTable.id, companyAId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, companyBId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, companyBrezCertaId)).catch(() => {});
  rmSync(tempDir, { recursive: true, force: true });
  await pool.end();
});

describe("company FURS certifikat resolver", () => {
  it("uporabi company certifikat pri XML podpisu", async () => {
    const companyCert = await pridobiCompanyCert(companyAId);

    expect(companyCert).toEqual({
      certPem: certA.certPem,
      certKljuc: certA.certKljuc,
    });

    const signed = podpisiXML(
      '<InvoiceRequest Id="test"><Amount>1.00</Amount></InvoiceRequest>',
      companyCert!.certPem,
      companyCert!.certKljuc,
    );
    expect(signed).toContain("<Signature");
  });

  it("brez company certifikata jasno zavrne podpis", async () => {
    expect(await pridobiCompanyCert(companyBrezCertaId)).toBeNull();

    expect(() => podpisiXML(
      '<InvoiceRequest Id="test"><Amount>1.00</Amount></InvoiceRequest>',
    )).toThrow("FURS certifikat ni naložen za to podjetje");
  });

  it("nikoli ne vrne certifikata drugega podjetja", async () => {
    const [companyA, companyB] = await Promise.all([
      pridobiCompanyCert(companyAId),
      pridobiCompanyCert(companyBId),
    ]);

    expect(companyA).toEqual({ certPem: certA.certPem, certKljuc: certA.certKljuc });
    expect(companyB).toEqual({ certPem: certB.certPem, certKljuc: certB.certKljuc });
    expect(companyA?.certPem).not.toBe(companyB?.certPem);
    expect(companyA?.certKljuc).not.toBe(companyB?.certKljuc);
  });

  it("dešifriranega ključa ne logira in ne izpostavi v napaki", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sentinel = "PRIVATE_KEY_NE_SME_BITI_V_NAPAKI";

    await db.update(companiesTable)
      .set({
        fursCertifikatPem: certA.certPem,
        fursKljucEnc: "pokvarjen-sifropis",
      })
      .where(eq(companiesTable.id, companyBrezCertaId));

    try {
      await expect(pridobiCompanyCert(companyBrezCertaId))
        .rejects.toThrow("FURS certifikata podjetja ni mogoče dešifrirati.");
      await expect(pridobiCompanyCert(companyBrezCertaId))
        .rejects.not.toThrow(sentinel);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});