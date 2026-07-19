import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, nastavitveTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { fursEchoDiagnostika } from "../../lib/pos-furs";
import path from "path";

const router: IRouter = Router();

router.post("/furs/diagnostika", requireEnota, async (req, res) => {
  const tenotaId = (req as any).enotaId ?? 1;
  try {
    const rows = await db.select().from(nastavitveTable)
      .where(and(eq(nastavitveTable.enotaId, tenotaId)));
    const nastavitve: Record<string, string> = {};
    for (const r of rows) nastavitve[r.kljuc] = r.vrednost;

    const certPot = nastavitve.certifikatPot || path.join(process.cwd(), "certs", "test-furs.p12");
    const testniNacin = (nastavitve.testniNacin ?? "true") === "true";
    const geslo = nastavitve.certifikatGeslo || undefined;

    const r = await fursEchoDiagnostika(certPot, testniNacin, geslo);

    const fmt = (d: { statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }) => ({
      statusCode: d.statusCode,
      body: d.body,
      ct: d.headers["content-type"]});

    res.json({
      certPot,
      certNajden: r.certNajden,
      caCertPrenesen: r.caCertPrenesen,
      testniNacin,
      A_echoGet: fmt(r.echoGet),
      B_echoPost: fmt(r.echoPost),
      C_echoPostPayload: fmt(r.echoPostPayload),
      D_jwtWrapped: fmt(r.jwtWrapped),
      E_jwtRaw: fmt(r.jwtRaw),
      F_jwtTestSupplier: fmt(r.jwtTestSupplier),
      G_jwtNeveljaven: fmt(r.jwtNeveljaven),
      H_jwtBrezWrapper: fmt(r.jwtBrezWrapper),
      I_xmlRaw: fmt(r.xmlRaw),
      J_xmlEcho: fmt(r.xmlEcho),
      K_soapEcho: fmt(r.soapEcho),
      L_soapBP: fmt(r.soapBP)});
  } catch (err) {
    res.status(500).json({ napaka: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
