import { Router, type IRouter, type Request, type Response } from "express";
import { requireEnota, type PosRequest } from "../../middlewares/pos";
import { fursSOAPEcho, pridobiCompanyCert } from "../../lib/pos-furs";
import { readAll, toResponse } from "./nastavitve";

const router: IRouter = Router();

router.post("/furs/diagnostika", requireEnota, async (req, res) => {
  try {
    const tenotaId = (req as PosRequest).enotaId;
    const nastavitve = toResponse(await readAll("", tenotaId));
    const companyCert = await pridobiCompanyCert((req as PosRequest).companyId);
    if (!companyCert) {
      res.status(400).json({ uspeh: false, napaka: "FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS." });
      return;
    }
    const echo = await fursSOAPEcho(
      nastavitve.fursNacin,
      nastavitve.fursProxyUrl || undefined,
      companyCert.certPem,
      companyCert.certKljuc,
    );
    res.json({
      certifikatNalozen: true,
      testniNacin: nastavitve.fursNacin !== "produkcija",
      echo,
    });
  } catch (err) {
    res.status(500).json({ napaka: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
