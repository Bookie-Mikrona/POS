import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  companiesTable,
  db,
  enoteTable,
  pool,
} from "@workspace/db";
import { desifrirajBizboxGeslo } from "../../lib/kripto-bizbox";
import { pridobiCompanyCert } from "../../lib/pos-furs";
import certifikatRouter from "./certifikat";

vi.mock("../../middlewares/pos", () => ({
  requireEnota: (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePosAdminRole: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const P12_GESLO = "FursP12SamoZaTest_123!";
let companyId: string;
let enotaId: number;
let p12Pot: string;
let tempDir: string;

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).companyId = companyId;
    (req as any).enotaId = enotaId;
    (req as any).vloga = "admin";
    (req as any).log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
    next();
  });
  app.use(certifikatRouter);
  return app;
}

function izvediOpenSsl(args: string[]) {
  const result = spawnSync("openssl", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`openssl test fixture ni uspel: ${result.stderr}`);
  }
}

beforeAll(async () => {
  process.env.BIZBOX_ENC_KEY = "test-bizbox-enc-key-za-teste-32-znakov!!";
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `FURS_TST_${RUN_ID}`,
    naziv: `FURS certifikat test ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `FURS enota ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;

  tempDir = mkdtempSync(path.join(tmpdir(), "furs-cert-test-"));
  const keyPot = path.join(tempDir, "test-key.pem");
  const certPot = path.join(tempDir, "test-cert.pem");
  p12Pot = path.join(tempDir, "test-cert.p12");
  izvediOpenSsl([
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPot, "-out", certPot, "-days", "30",
    "-subj", `/CN=FURS Test ${RUN_ID}`,
  ]);
  izvediOpenSsl([
    "pkcs12", "-export", "-out", p12Pot,
    "-inkey", keyPot, "-in", certPot,
    "-passout", `pass:${P12_GESLO}`,
  ]);
});

afterAll(async () => {
  rmSync(tempDir, { recursive: true, force: true });
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => {});
  await pool.end();
});

describe("FURS certifikat na nivoju podjetja", () => {
  it("GET brez certifikata vrne izključno varen status", async () => {
    const response = await supertest(buildApp()).get("/certifikat/info");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toEqual({ nastavljen: false, subject: null, veljaDo: null });
  });

  it("upload .p12 shrani šifriran ključ in ne shrani gesla", async () => {
    const response = await supertest(buildApp())
      .post("/certifikat/nalozi")
      .field("geslo", P12_GESLO)
      .attach("datoteka", p12Pot);

    expect(response.status).toBe(200);
    expect(response.body.uspeh).toBe(true);
    expect(response.body.nastavljen).toBe(true);
    expect(response.body.subject).toContain(`FURS Test ${RUN_ID}`);
    expect(response.body.veljaDo).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty("geslo");
    expect(response.body).not.toHaveProperty("fursKljucEnc");

    const [company] = await db.select({
      pem: companiesTable.fursCertifikatPem,
      kljucEnc: companiesTable.fursKljucEnc,
      subject: companiesTable.fursCertSubject,
      veljaDo: companiesTable.fursCertVeljaDo,
    }).from(companiesTable).where(eq(companiesTable.id, companyId));

    expect(company?.pem).toContain("BEGIN CERTIFICATE");
    expect(company?.kljucEnc).toBeTruthy();
    expect(company?.kljucEnc).not.toContain(P12_GESLO);
    expect(company?.kljucEnc?.split(":")).toHaveLength(3);
    expect(desifrirajBizboxGeslo(company!.kljucEnc!)).toContain("PRIVATE KEY");
    expect(company?.subject).toContain(`FURS Test ${RUN_ID}`);
    expect(company?.veljaDo).toBeInstanceOf(Date);
    expect(JSON.stringify(company)).not.toContain(P12_GESLO);
  });

  it("GET po uploadu nikoli ne vrne gesla ali ključa", async () => {
    const response = await supertest(buildApp()).get("/certifikat/info");
    const notranjiCert = await pridobiCompanyCert(companyId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      nastavljen: true,
      subject: expect.stringContaining(`FURS Test ${RUN_ID}`),
      veljaDo: expect.any(String),
    });
    expect(Object.keys(response.body).sort()).toEqual(["nastavljen", "subject", "veljaDo"]);
    expect(JSON.stringify(response.body)).not.toContain(P12_GESLO);
    expect(JSON.stringify(response.body)).not.toContain(notranjiCert!.certKljuc);
    expect(response.body).not.toHaveProperty("fursCertifikatPem");
    expect(response.body).not.toHaveProperty("fursKljucEnc");
  });
});