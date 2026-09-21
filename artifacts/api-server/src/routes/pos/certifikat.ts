import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { companiesTable, db } from "@workspace/db";
import { requireEnota, requirePosAdminRole, type PosRequest } from "../../middlewares/pos";
import { spawnSync } from "child_process";
import crypto from "crypto";
import os from "os";
import fs from "fs";
import path from "path";
import multer from "multer";
import { sifrirajBizboxGeslo } from "../../lib/kripto-bizbox";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

interface FursCertifikatStatus {
  nastavljen: boolean;
  subject: string | null;
  veljaDo: string | null;
}

function statusIzCompany(company: {
  fursCertifikatPem: string | null;
  fursKljucEnc: string | null;
  fursCertSubject: string | null;
  fursCertVeljaDo: Date | null;
} | undefined): FursCertifikatStatus {
  const nastavljen = Boolean(company?.fursCertifikatPem && company?.fursKljucEnc);
  return {
    nastavljen,
    subject: nastavljen ? company?.fursCertSubject ?? null : null,
    veljaDo: nastavljen && company?.fursCertVeljaDo
      ? company.fursCertVeljaDo.toISOString()
      : null,
  };
}

function pridobiCertifikatnePodatke(certPem: string): { subject: string; veljaDo: Date } {
  const cert = new crypto.X509Certificate(certPem);
  const veljaDo = new Date(cert.validTo);
  if (Number.isNaN(veljaDo.getTime())) {
    throw new Error("Certifikat nima veljavnega datuma poteka.");
  }
  return { subject: cert.subject.split("\n").join(", "), veljaDo };
}

router.get("/certifikat/info", requireEnota, requirePosAdminRole, async (req, res) => {
  const companyId = (req as PosRequest).companyId;
  const [company] = await db.select({
    fursCertifikatPem: companiesTable.fursCertifikatPem,
    fursKljucEnc: companiesTable.fursKljucEnc,
    fursCertSubject: companiesTable.fursCertSubject,
    fursCertVeljaDo: companiesTable.fursCertVeljaDo,
  }).from(companiesTable).where(eq(companiesTable.id, companyId));
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(statusIzCompany(company));
});

router.post("/certifikat/nalozi", requireEnota, requirePosAdminRole, upload.single("datoteka"), async (req, res) => {
  const companyId = (req as PosRequest).companyId;
  const file = req.file;
  if (!file) {
    res.status(400).json({ uspeh: false, napaka: "Datoteka .p12 ni bila priložena" });
    return;
  }
  if (!/\.(p12|pfx)$/i.test(file.originalname)) {
    res.status(400).json({ uspeh: false, napaka: "Podprte so samo datoteke .p12 ali .pfx" });
    return;
  }

  const body = req.body as { geslo?: string };
  const geslo = body.geslo ?? "";
  const tmpP12 = path.join(os.tmpdir(), `furs-${Date.now()}.p12`);

  try {
    fs.writeFileSync(tmpP12, file.buffer);

    const openssl = (args: string[]) =>
      spawnSync("openssl", args, { encoding: "buffer", timeout: 15000 });

    const extractCert = (legacy: boolean) =>
      openssl([
        "pkcs12", "-in", tmpP12, "-clcerts", "-nokeys",
        "-passin", `pass:${geslo}`,
        ...(legacy ? ["-legacy"] : []),
      ]);

    const extractKey = (legacy: boolean) =>
      openssl([
        "pkcs12", "-in", tmpP12, "-nocerts", "-nodes",
        "-passin", `pass:${geslo}`,
        ...(legacy ? ["-legacy"] : []),
      ]);

    let certResult = extractCert(false);
    if (certResult.status !== 0) certResult = extractCert(true);

    let keyResult = extractKey(false);
    if (keyResult.status !== 0) keyResult = extractKey(true);

    try { fs.unlinkSync(tmpP12); } catch { /* nop */ }

    if (certResult.status !== 0 || keyResult.status !== 0) {
      const err = (certResult.stderr ?? keyResult.stderr ?? Buffer.from("")).toString().slice(0, 300);
      res.status(400).json({ uspeh: false, napaka: `Pretvorba ni uspela. Preverite geslo in format datoteke. (${err})` });
      return;
    }

    const certPemStr = certResult.stdout.toString("utf8");
    const keyPemStr  = keyResult.stdout.toString("utf8");

    const certBlock = certPemStr.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0] ?? "";
    let   keyBlock  = keyPemStr.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/)?.[0] ?? "";

    if (!certBlock || !keyBlock) {
      res.status(400).json({ uspeh: false, napaka: "Certifikat ali zasebni ključ ni bil najden. Preverite geslo." });
      return;
    }

    if (!keyBlock.includes("BEGIN RSA PRIVATE KEY")) {
      const rsaRes = spawnSync("openssl", ["rsa", "-in", "/dev/stdin"], { input: keyBlock, encoding: "utf8" });
      if (rsaRes.stdout?.includes("BEGIN RSA PRIVATE KEY")) keyBlock = rsaRes.stdout;
    }

    const { subject, veljaDo } = pridobiCertifikatnePodatke(certBlock);
    const fursKljucEnc = sifrirajBizboxGeslo(keyBlock);

    await db.update(companiesTable).set({
      fursCertifikatPem: certBlock,
      fursKljucEnc,
      fursCertSubject: subject,
      fursCertVeljaDo: veljaDo,
    }).where(eq(companiesTable.id, companyId));

    req.log.info({ subject, companyId }, "FURS certifikat varno naložen na podjetje");
    res.json({
      uspeh: true,
      ...statusIzCompany({
        fursCertifikatPem: certBlock,
        fursKljucEnc,
        fursCertSubject: subject,
        fursCertVeljaDo: veljaDo,
      }),
    });
  } catch (e) {
    try { fs.unlinkSync(tmpP12); } catch { /* nop */ }
    req.log.error({ err: e }, "Napaka pri nalaganju certifikata");
    res.status(500).json({ uspeh: false, napaka: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/certifikat", requireEnota, requirePosAdminRole, async (req, res) => {
  const companyId = (req as PosRequest).companyId;
  await db.update(companiesTable).set({
    fursCertifikatPem: null,
    fursKljucEnc: null,
    fursCertSubject: null,
    fursCertVeljaDo: null,
  }).where(eq(companiesTable.id, companyId));
  req.log.info({ companyId }, "FURS certifikat izbrisan iz podjetja");
  res.json({ uspeh: true });
});

export default router;
