import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, poslovniProstoriTable, enoteTable, companiesTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { readAll, toResponse } from "./nastavitve";
import { registrirajPoslovniProstor } from "../../lib/pos-furs";

const requireAdmin = requireEnota;

const router: IRouter = Router();

router.get("/poslovni-prostori", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(poslovniProstoriTable)
    .where(and(eq(poslovniProstoriTable.enotaId, tenotaId)))
    .orderBy(poslovniProstoriTable.id);
  res.json(rows);
});

router.post("/poslovni-prostori", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [row] = await db
    .insert(poslovniProstoriTable)
    .values({ ...parsed.data,
 enotaId: tenotaId })
    .returning();
  res.status(201).json(row);
});

router.put("/poslovni-prostori/:id", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [row] = await db
    .update(poslovniProstoriTable)
    .set(parsed.data)
    .where(and(eq(poslovniProstoriTable.id, id), sql`true`, eq(poslovniProstoriTable.enotaId, tenotaId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Prostor ni najden" }); return; }
  res.json(row);
});

router.delete("/poslovni-prostori/:id", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  await db.delete(poslovniProstoriTable)
    .where(and(eq(poslovniProstoriTable.id, id), sql`true`, eq(poslovniProstoriTable.enotaId, tenotaId)));
  res.status(204).send();
});

router.post("/poslovni-prostori/:id/registriraj", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const bodyParsed = { success: true, data: req.body };
  const jeFursNacin: "simulacija" | "testno" | "produkcija" = bodyParsed.success ? (bodyParsed.data.fursNacin ?? "simulacija") : "simulacija";

  const [prostor] = await db
    .select()
    .from(poslovniProstoriTable)
    .where(and(eq(poslovniProstoriTable.id, id), sql`true`, eq(poslovniProstoriTable.enotaId, tenotaId)));
  if (!prostor) { res.status(404).json({ error: "Prostor ni najden" }); return; }

  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  // Fallback za davcnaStevilka: nastavitve → companies tabela prek enote
  let davcna = nastavitve.davcnaStevilka;
  if (!davcna) {
    const [en] = await db.select({ companyId: enoteTable.companyId }).from(enoteTable).where(eq(enoteTable.id, tenotaId));
    if (en?.companyId) {
      const [co] = await db.select({ podjetjeDavcna: companiesTable.podjetjeDavcna }).from(companiesTable).where(eq(companiesTable.id, en.companyId));
      davcna = co?.podjetjeDavcna?.replace(/^SI/i, "") ?? "";
    }
  }
  if (!davcna) {
    res.status(400).json({ error: "Davčna številka ni nastavljena. Vnesite jo v Nastavitvah → Davčni podatki." });
    return;
  }

  const ponudnik = nastavitve.ponudnikDavcna || process.env.ERP_PONUDNIK_DAVCNA || undefined;

  const odgovor = await registrirajPoslovniProstor(
    {
      davcnaStevilka: davcna,
      ponudnikDavcna: ponudnik,
      poslovniProstorId: prostor.prostorId,
      tipProstora: (prostor.tipProstora as import('../../lib/pos-furs').FursTipProstora) ?? "nepremicnina",
      ulica: prostor.ulica ?? undefined,
      hisnaStevilka: prostor.hisnaStevilka ?? undefined,
      hisnaStevilkaDodatek: prostor.hisnaStevilkaDodatek ?? undefined,
      skupnost: prostor.skupnost ?? undefined,
      kraj: prostor.kraj ?? undefined,
      postnaStevilka: prostor.postnaStevilka ?? undefined,
      katastrskaStevilka: prostor.katastrskaStevilka ?? undefined,
      stevilkaStavbe: prostor.stevilkaStavbe ?? undefined,
      stevilkaDelaStavbe: prostor.stevilkaDelaStavbe ?? undefined,
      registrskaTablica: prostor.registrskaTablica ?? undefined,
      vin: prostor.vin ?? undefined,
      premicninaTip: (prostor.premicninaTip as import('../../lib/pos-furs').FursPremicninaTip | undefined) ?? undefined,
      veljavnostOd: prostor.veljavnostOd ?? new Date().toISOString().slice(0, 10),
      certifikatPot: (prostor.certifikatPot ?? nastavitve.certifikatPot) || undefined,
      certifikatGeslo: (prostor.certifikatGeslo ?? nastavitve.certifikatGeslo) || undefined,
      certPem: nastavitveMap["certifikatPem"] || undefined,
      certKljuc: nastavitveMap["certifikatKljuc"] || undefined,
      proxyUrl: nastavitve.fursProxyUrl || undefined},
    jeFursNacin
  );

  if (odgovor.uspeh) {
    await db
      .update(poslovniProstoriTable)
      .set({ zadnjaRegistracija: new Date() })
      .where(and(eq(poslovniProstoriTable.id, id), sql`true`, eq(poslovniProstoriTable.enotaId, tenotaId)));
  }

  res.json({ ...odgovor, poslovniProstorId: prostor.prostorId });
});

router.post("/poslovni-prostori/:id/zapri", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const bodyParsed = { success: true, data: req.body };
  const jeFursNacin: "simulacija" | "testno" | "produkcija" = bodyParsed.success ? (bodyParsed.data.fursNacin ?? "simulacija") : "simulacija";

  const [prostor] = await db
    .select()
    .from(poslovniProstoriTable)
    .where(and(eq(poslovniProstoriTable.id, id), sql`true`, eq(poslovniProstoriTable.enotaId, tenotaId)));
  if (!prostor) { res.status(404).json({ error: "Prostor ni najden" }); return; }

  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  // Fallback: če davcnaStevilka ni v nastavitvah, jo preberemo iz companies prek enote
  let davcnaStevilkaZapri = nastavitve.davcnaStevilka;
  if (!davcnaStevilkaZapri) {
    const [enotaZapri] = await db.select({ companyId: enoteTable.companyId }).from(enoteTable).where(eq(enoteTable.id, tenotaId));
    if (enotaZapri?.companyId) {
      const [co] = await db.select({ podjetjeDavcna: companiesTable.podjetjeDavcna }).from(companiesTable).where(eq(companiesTable.id, enotaZapri.companyId));
      davcnaStevilkaZapri = co?.podjetjeDavcna?.replace(/^SI/i, "") ?? "";
    }
  }

  if (!davcnaStevilkaZapri) {
    res.status(400).json({ error: "Davčna številka ni nastavljena. Vnesite jo v Nastavitvah → Davčni podatki." });
    return;
  }

  const ponudnikDavcnaZapri = nastavitve.ponudnikDavcna || process.env.ERP_PONUDNIK_DAVCNA || undefined;

  const odgovor = await registrirajPoslovniProstor(
    {
      davcnaStevilka: davcnaStevilkaZapri,
      ponudnikDavcna: ponudnikDavcnaZapri,
      poslovniProstorId: prostor.prostorId,
      tipProstora: (prostor.tipProstora as import('../../lib/pos-furs').FursTipProstora) ?? "nepremicnina",
      ulica: prostor.ulica ?? undefined,
      hisnaStevilka: prostor.hisnaStevilka ?? undefined,
      hisnaStevilkaDodatek: prostor.hisnaStevilkaDodatek ?? undefined,
      skupnost: prostor.skupnost ?? undefined,
      kraj: prostor.kraj ?? undefined,
      postnaStevilka: prostor.postnaStevilka ?? undefined,
      katastrskaStevilka: prostor.katastrskaStevilka ?? undefined,
      stevilkaStavbe: prostor.stevilkaStavbe ?? undefined,
      stevilkaDelaStavbe: prostor.stevilkaDelaStavbe ?? undefined,
      registrskaTablica: prostor.registrskaTablica ?? undefined,
      vin: prostor.vin ?? undefined,
      premicninaTip: (prostor.premicninaTip as import('../../lib/pos-furs').FursPremicninaTip | undefined) ?? undefined,
      veljavnostOd: prostor.veljavnostOd ?? new Date().toISOString().slice(0, 10),
      certifikatPot: (prostor.certifikatPot ?? nastavitve.certifikatPot) || undefined,
      certifikatGeslo: (prostor.certifikatGeslo ?? nastavitve.certifikatGeslo) || undefined,
      certPem: nastavitveMap["certifikatPem"] || undefined,
      certKljuc: nastavitveMap["certifikatKljuc"] || undefined,
      proxyUrl: nastavitve.fursProxyUrl || undefined,
      zapri: true},
    jeFursNacin
  );

  if (odgovor.uspeh) {
    await db
      .update(poslovniProstoriTable)
      .set({ zaprt: true, zadnjaRegistracija: new Date() })
      .where(and(eq(poslovniProstoriTable.id, id), sql`true`, eq(poslovniProstoriTable.enotaId, tenotaId)));
  }

  res.json({ ...odgovor, poslovniProstorId: prostor.prostorId });
});

export default router;
