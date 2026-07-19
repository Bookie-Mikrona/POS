import { Router, type IRouter, type Request, type Response } from "express";
import { ne } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { readAll, toResponse } from "./nastavitve";
import { registrirajPoslovniProstor } from "../../lib/pos-furs";

const router: IRouter = Router();

router.post("/furs/registriraj-poslovni-prostor", requireEnota, async (req, res): Promise<void> => {
  const {
    tipProstora = "nepremicnina",
    ulica, hisnaStevilka, hisnaStevilkaDodatek,
    skupnost, kraj, postnaStevilka,
    registrskaTablica, vin, premicninaTip,
    veljavnostOd,
    fursNacin} = req.body as {
    tipProstora?: string;
    ulica?: string;
    hisnaStevilka?: string;
    hisnaStevilkaDodatek?: string;
    skupnost?: string;
    kraj?: string;
    postnaStevilka?: string;
    registrskaTablica?: string;
    vin?: string;
    premicninaTip?: string;
    veljavnostOd: string;
    fursNacin?: "simulacija" | "testno" | "produkcija";
  };

  if (!veljavnostOd) {
    res.status(400).json({ error: "Manjka veljavnostOd" });
    return;
  }

  if (tipProstora === "nepremicnina") {
    if (!ulica || !hisnaStevilka || !skupnost || !kraj || !postnaStevilka) {
      res.status(400).json({ error: "Za nepremičnino so obvezni: ulica, hisnaStevilka, skupnost, kraj, postnaStevilka" });
      return;
    }
  } else if (tipProstora === "premicnina") {
    if (!registrskaTablica && !vin && !premicninaTip) {
      res.status(400).json({ error: "Za premičnino je obvezno vsaj eno od: registrskaTablica, vin, premicninaTip" });
      return;
    }
  }

  const tenotaId = (req as any).enotaId ?? 1;
  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  if (!nastavitve.davcnaStevilka) {
    res.status(400).json({ error: "Davčna številka ni nastavljena v nastavitvah" });
    return;
  }
  if (!nastavitve.poslovniProstor) {
    res.status(400).json({ error: "ID poslovnega prostora ni nastavljen v nastavitvah" });
    return;
  }

  // certPem/certKljuc sta samo v nastavitveMap (ne v toResponse — zaupni podatki)
  const certPem = nastavitveMap["certifikatPem"] || undefined;
  const certKljuc = nastavitveMap["certifikatKljuc"] || undefined;
  const certifikatPot = nastavitve.certifikatPot || undefined;
  const certifikatGeslo = nastavitve.certifikatGeslo || undefined;
  const proxyUrl = nastavitve.fursProxyUrl || undefined;
  const jeFursNacin: "simulacija" | "testno" | "produkcija" = fursNacin ?? nastavitve.fursNacin;

  const odgovor = await registrirajPoslovniProstor(
    {
      davcnaStevilka: nastavitve.davcnaStevilka,
      ponudnikDavcna: nastavitve.ponudnikDavcna || undefined,
      poslovniProstorId: nastavitve.poslovniProstor,
      tipProstora: (tipProstora as import('../../lib/pos-furs').FursTipProstora),
      ulica,
      hisnaStevilka,
      hisnaStevilkaDodatek: hisnaStevilkaDodatek || undefined,
      skupnost,
      kraj,
      postnaStevilka,
      registrskaTablica: registrskaTablica || undefined,
      vin: vin || undefined,
      premicninaTip: premicninaTip as import("../../lib/pos-furs").FursPremicninaTip | undefined,
      veljavnostOd,
      certPem,
      certKljuc,
      certifikatPot,
      certifikatGeslo,
      proxyUrl},
    jeFursNacin
  );

  res.json({
    uspeh: odgovor.uspeh,
    napaka: odgovor.napaka ?? null,
    surovOdgovor: odgovor.surovOdgovor,
    poslovniProstorId: nastavitve.poslovniProstor,
    davcnaStevilka: nastavitve.davcnaStevilka,
    fursNacin: jeFursNacin});
});

export default router;
