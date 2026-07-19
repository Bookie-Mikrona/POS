import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, nastavitveTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { spawnSync } from "child_process";
import crypto from "crypto";
import os from "os";
import fs from "fs";
import path from "path";
import multer from "multer";

const requireAdmin = requireEnota;

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

interface CertInfo {
  najden: boolean;
  subjekt?: string;
  izdajatelj?: string;
  veljavnoOd?: string;
  veljavnoDo?: string;
  dniDoIzteka?: number;
  opozorilo?: boolean;
  napaka?: string;
}

async function getCertPemFromDB(enotaId: number): Promise<string | null> {
  const rows = await db.select().from(nastavitveTable).where(
    and(eq(nastavitveTable.enotaId, enotaId),
      eq(nastavitveTable.kljuc, "certifikatPem")
    )
  );
  return rows[0]?.vrednost || null;
}

async function saveKljucVrednost(enotaId: number, kljuc: string, vrednost: string): Promise<void> {
  const existing = await db.select().from(nastavitveTable).where(
    and(eq(nastavitveTable.enotaId, enotaId),
      eq(nastavitveTable.kljuc, kljuc)
    )
  );
  if (existing.length > 0) {
    await db.update(nastavitveTable).set({ vrednost }).where(
      and(eq(nastavitveTable.enotaId, enotaId),
        eq(nastavitveTable.kljuc, kljuc)
      )
    );
  } else {
    await db.insert(nastavitveTable).values({ enotaId, kljuc, vrednost });
  }
}

function parseCertInfo(certPemStr: string): CertInfo {
  try {
    const certMatch = certPemStr.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    if (!certMatch) return { najden: false, napaka: "V podatkih ni certifikata (PEM bloka)" };

    const cert = new (require('node:crypto').X509Certificate)(certMatch[0]);
    const validTo = new Date(cert.validTo);
    const now = new Date();
    const dniDoIzteka = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
      najden: true,
      subjekt: cert.subject.split("\n").join(", "),
      izdajatelj: cert.issuer.split("\n").join(", "),
      veljavnoOd: cert.validFrom,
      veljavnoDo: cert.validTo,
      dniDoIzteka,
      opozorilo: dniDoIzteka <= 30};
  } catch (e) {
    return { najden: false, napaka: `Napaka pri branju: ${e instanceof Error ? e.message : String(e)}` };
  }
}

router.get("/certifikat/info", requireAdmin, async (req, res) => {
  const tenotaId = (req as any).enotaId ?? 1;
  const certPem = await getCertPemFromDB(tenotaId);
  if (!certPem) {
    res.json({ najden: false, napaka: "Certifikat ni naložen v bazo" });
    return;
  }
  res.json(parseCertInfo(certPem));
});

router.post("/certifikat/nalozi", requireAdmin, upload.single("datoteka"), async (req, res) => {
  const tenotaId = (req as any).enotaId ?? 1;
  const file = req.file;
  if (!file) {
    res.status(400).json({ uspeh: false, napaka: "Datoteka .p12 ni bila priložena" });
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

    await saveKljucVrednost(tenotaId, "certifikatPem", certBlock);
    await saveKljucVrednost(tenotaId, "certifikatKljuc", keyBlock);
    await saveKljucVrednost(tenotaId, "certifikatPot", "");
    await saveKljucVrednost(tenotaId, "certifikatGeslo", "");

    const info = parseCertInfo(certBlock);
    req.log.info({ subjekt: info.subjekt }, "Certifikat FURS naložen v bazo");
    res.json({ uspeh: true, ...info });
  } catch (e) {
    try { fs.unlinkSync(tmpP12); } catch { /* nop */ }
    req.log.error({ err: e }, "Napaka pri nalaganju certifikata");
    res.status(500).json({ uspeh: false, napaka: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/certifikat", requireAdmin, async (req, res) => {
  const tenotaId = (req as any).enotaId ?? 1;
  await saveKljucVrednost(tenotaId, "certifikatPem", "");
  await saveKljucVrednost(tenotaId, "certifikatKljuc", "");
  req.log.info("Certifikat FURS izbrisan iz baze");
  res.json({ uspeh: true });
});

export default router;
