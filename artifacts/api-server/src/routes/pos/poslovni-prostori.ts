import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, poslovniProstoriTable, enoteTable, companiesTable } from "@workspace/db";
import { requireEnota, type PosRequest } from "../../middlewares/pos";
import { readAll, toResponse } from "./nastavitve";
import { registrirajPoslovniProstor } from "../../lib/pos-furs";

const router: IRouter = Router();

/**
 * GET /poslovni-prostori
 * - admin → vse prostore podjetja (vse enote)
 * - admin_enote / uporabnik → samo prostore lastne enote
 */
router.get("/poslovni-prostori", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;

  if (vloga === "admin") {
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));
    const rows = await db.select().from(poslovniProstoriTable)
      .where(inArray(poslovniProstoriTable.enotaId, enotaIds))
      .orderBy(poslovniProstoriTable.enotaId, poslovniProstoriTable.id);
    res.json(rows);
    return;
  }

  const enotaId = posReq.enotaId;
  const rows = await db.select().from(poslovniProstoriTable)
    .where(eq(poslovniProstoriTable.enotaId, enotaId))
    .orderBy(poslovniProstoriTable.id);
  res.json(rows);
});

/**
 * POST /poslovni-prostori
 * - admin → enotaId iz body (obvezno); ostali → req.enotaId
 */
router.post("/poslovni-prostori", requireEnota, async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;

  let effectiveEnotaId = posReq.enotaId;
  if (vloga === "admin") {
    const bodyEnotaId = req.body.enotaId ? Number(req.body.enotaId) : null;
    if (!bodyEnotaId) { res.status(400).json({ error: "Admin mora določiti enotaId" }); return; }
    const [enota] = await db.select({ id: enoteTable.id }).from(enoteTable)
      .where(and(eq(enoteTable.id, bodyEnotaId), eq(enoteTable.companyId, companyId)));
    if (!enota) { res.status(403).json({ error: "Enota ne obstaja ali ne pripada podjetju" }); return; }
    effectiveEnotaId = enota.id;
  }

  const { enotaId: _omit, ...bodyBrezEnote } = req.body as Record<string, unknown>;
  const [row] = await db
    .insert(poslovniProstoriTable)
    .values({ ...bodyBrezEnote, enotaId: effectiveEnotaId } as typeof poslovniProstoriTable.$inferInsert)
    .returning();
  res.status(201).json(row);
});

/**
 * PUT /poslovni-prostori/:id
 * - admin → preveri lastništvo prek companyId, ne filtrira po enotaId
 * - ostali → preveri enotaId
 */
router.put("/poslovni-prostori/:id", requireEnota, async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const { enotaId: _omit, ...bodyBrezEnote } = req.body as Record<string, unknown>;

  if (vloga === "admin") {
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));
    const [row] = await db
      .update(poslovniProstoriTable)
      .set(bodyBrezEnote as typeof poslovniProstoriTable.$inferInsert)
      .where(and(eq(poslovniProstoriTable.id, id), inArray(poslovniProstoriTable.enotaId, enotaIds)))
      .returning();
    if (!row) { res.status(404).json({ error: "Prostor ni najden" }); return; }
    res.json(row);
    return;
  }

  const enotaId = posReq.enotaId;
  const [row] = await db
    .update(poslovniProstoriTable)
    .set(bodyBrezEnote as typeof poslovniProstoriTable.$inferInsert)
    .where(and(eq(poslovniProstoriTable.id, id), eq(poslovniProstoriTable.enotaId, enotaId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Prostor ni najden" }); return; }
  res.json(row);
});

/**
 * DELETE /poslovni-prostori/:id
 */
router.delete("/poslovni-prostori/:id", requireEnota, async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  if (vloga === "admin") {
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));
    await db.delete(poslovniProstoriTable)
      .where(and(eq(poslovniProstoriTable.id, id), inArray(poslovniProstoriTable.enotaId, enotaIds)));
    res.status(204).send();
    return;
  }

  const enotaId = posReq.enotaId;
  await db.delete(poslovniProstoriTable)
    .where(and(eq(poslovniProstoriTable.id, id), eq(poslovniProstoriTable.enotaId, enotaId)));
  res.status(204).send();
});

/**
 * POST /poslovni-prostori/:id/registriraj
 * Za nastavitve lookup vedno uporabi prostor.enotaId (ne req.enotaId),
 * da admin, ki je na drugačni enoti kot prostor, dobi pravilne nastavitve.
 */
router.post("/poslovni-prostori/:id/registriraj", requireEnota, async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const jeFursNacin: "simulacija" | "testno" | "produkcija" = req.body?.fursNacin ?? "simulacija";

  // Poišči prostor — admin sme dostopati do prostora katere koli enote podjetja
  let whereClause;
  if (vloga === "admin") {
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));
    whereClause = and(eq(poslovniProstoriTable.id, id), inArray(poslovniProstoriTable.enotaId, enotaIds));
  } else {
    whereClause = and(eq(poslovniProstoriTable.id, id), eq(poslovniProstoriTable.enotaId, posReq.enotaId));
  }

  const [prostor] = await db.select().from(poslovniProstoriTable).where(whereClause);
  if (!prostor) { res.status(404).json({ error: "Prostor ni najden" }); return; }

  // Nastavitve lookup z DEJANSKE enote prostora (ne nujno req.enotaId)
  const nastavitveMap = await readAll("", prostor.enotaId);
  const nastavitve = toResponse(nastavitveMap);

  let davcna = nastavitve.davcnaStevilka;
  if (!davcna) {
    const [en] = await db.select({ companyId: enoteTable.companyId }).from(enoteTable).where(eq(enoteTable.id, prostor.enotaId));
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
      proxyUrl: nastavitve.fursProxyUrl || undefined,
    },
    jeFursNacin
  );

  if (odgovor.uspeh) {
    await db
      .update(poslovniProstoriTable)
      .set({ zadnjaRegistracija: new Date() })
      .where(eq(poslovniProstoriTable.id, id));
  }

  res.json({ ...odgovor, poslovniProstorId: prostor.prostorId });
});

/**
 * POST /poslovni-prostori/:id/zapri
 */
router.post("/poslovni-prostori/:id/zapri", requireEnota, async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const jeFursNacin: "simulacija" | "testno" | "produkcija" = req.body?.fursNacin ?? "simulacija";

  let whereClause;
  if (vloga === "admin") {
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));
    whereClause = and(eq(poslovniProstoriTable.id, id), inArray(poslovniProstoriTable.enotaId, enotaIds));
  } else {
    whereClause = and(eq(poslovniProstoriTable.id, id), eq(poslovniProstoriTable.enotaId, posReq.enotaId));
  }

  const [prostor] = await db.select().from(poslovniProstoriTable).where(whereClause);
  if (!prostor) { res.status(404).json({ error: "Prostor ni najden" }); return; }

  const nastavitveMap = await readAll("", prostor.enotaId);
  const nastavitve = toResponse(nastavitveMap);

  let davcnaStevilka = nastavitve.davcnaStevilka;
  if (!davcnaStevilka) {
    const [en] = await db.select({ companyId: enoteTable.companyId }).from(enoteTable).where(eq(enoteTable.id, prostor.enotaId));
    if (en?.companyId) {
      const [co] = await db.select({ podjetjeDavcna: companiesTable.podjetjeDavcna }).from(companiesTable).where(eq(companiesTable.id, en.companyId));
      davcnaStevilka = co?.podjetjeDavcna?.replace(/^SI/i, "") ?? "";
    }
  }
  if (!davcnaStevilka) {
    res.status(400).json({ error: "Davčna številka ni nastavljena. Vnesite jo v Nastavitvah → Davčni podatki." });
    return;
  }

  const ponudnik = nastavitve.ponudnikDavcna || process.env.ERP_PONUDNIK_DAVCNA || undefined;

  const odgovor = await registrirajPoslovniProstor(
    {
      davcnaStevilka,
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
      proxyUrl: nastavitve.fursProxyUrl || undefined,
      zapri: true,
    },
    jeFursNacin
  );

  if (odgovor.uspeh) {
    await db
      .update(poslovniProstoriTable)
      .set({ zaprt: true, zadnjaRegistracija: new Date() })
      .where(eq(poslovniProstoriTable.id, id));
  }

  res.json({ ...odgovor, poslovniProstorId: prostor.prostorId });
});

export default router;
