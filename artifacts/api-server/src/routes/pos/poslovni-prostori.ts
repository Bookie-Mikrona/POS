import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, poslovniProstoriTable } from "@workspace/db";
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

  if (!nastavitve.davcnaStevilka) {
    res.status(400).json({ error: "Davčna številka ni nastavljena v nastavitvah" });
    return;
  }

  const odgovor = await registrirajPoslovniProstor(
    {
      davcnaStevilka: nastavitve.davcnaStevilka,
      ponudnikDavcna: nastavitve.ponudnikDavcna || undefined,
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

  if (!nastavitve.davcnaStevilka) {
    res.status(400).json({ error: "Davčna številka ni nastavljena v nastavitvah" });
    return;
  }

  const odgovor = await registrirajPoslovniProstor(
    {
      davcnaStevilka: nastavitve.davcnaStevilka,
      ponudnikDavcna: nastavitve.ponudnikDavcna || undefined,
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
