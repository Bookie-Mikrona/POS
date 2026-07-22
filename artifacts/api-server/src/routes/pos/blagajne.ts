import { Router, type IRouter } from "express";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { blagajneTable, enoteTable, poslovniProstoriTable, db } from "@workspace/db";
import { requireEnota, type PosRequest } from "../../middlewares/pos";


const router: IRouter = Router();

/**
 * GET /blagajne
 * - admin + ?all=true  → Vse blagajne podjetja brez filtra registracije (za upravljanje v nastavitvah)
 * - admin brez ?all     → Blagajne trenutne enote (registrirane, za switcher)
 * - admin_enote/uporabnik → Blagajne dodeljene enote (registrirane)
 */
router.get("/blagajne", requireEnota, async (req, res): Promise<void> => {
  const posReq = req as PosRequest;
  const enotaId = posReq.enotaId;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const all = req.query.all === "true";

  if (vloga === "admin" && all) {
    // Upravljalski pogled: vse blagajne podjetja, brez filtra registracije
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));
    const rows = await db
      .select({
        id: blagajneTable.id,
        enotaId: blagajneTable.enotaId,
        ppId: blagajneTable.ppId,
        bId: blagajneTable.bId,
        ime: blagajneTable.ime,
        aktivna: blagajneTable.aktivna,
        ustvarjeno: blagajneTable.ustvarjeno,
      })
      .from(blagajneTable)
      .where(inArray(blagajneTable.enotaId, enotaIds))
      .orderBy(blagajneTable.enotaId, blagajneTable.id);
    res.json(rows);
    return;
  }

  // Standardni pogled: samo registrirane blagajne za trenutno enoto
  const rows = await db
    .select({
      id: blagajneTable.id,
      enotaId: blagajneTable.enotaId,
      ppId: blagajneTable.ppId,
      bId: blagajneTable.bId,
      ime: blagajneTable.ime,
      aktivna: blagajneTable.aktivna,
      ustvarjeno: blagajneTable.ustvarjeno,
    })
    .from(blagajneTable)
    .innerJoin(
      poslovniProstoriTable,
      and(
        eq(poslovniProstoriTable.prostorId, blagajneTable.ppId),
        eq(poslovniProstoriTable.enotaId, blagajneTable.enotaId),
        isNotNull(poslovniProstoriTable.zadnjaRegistracija),
        eq(poslovniProstoriTable.aktiven, true),
      ),
    )
    .where(eq(blagajneTable.enotaId, enotaId));
  res.json(rows);
});

router.post("/blagajne", requireEnota, async (req, res): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const { ppId, bId, ime, aktivna, enotaId: bodyEnotaId } = req.body as { ppId: string; bId: string; ime: string; aktivna?: boolean; enotaId?: number };
  if (!ppId || !bId || !ime) { res.status(400).json({ error: "Manjkajo obvezna polja: ppId, bId, ime" }); return; }

  // Admin sme določiti katero koli enoto podjetja; ostali dobijo svojo
  let effectiveEnotaId = posReq.enotaId;
  if (vloga === "admin" && bodyEnotaId) {
    // Preveri, da enota pripada podjetju
    const [enota] = await db.select({ id: enoteTable.id }).from(enoteTable)
      .where(and(eq(enoteTable.id, Number(bodyEnotaId)), eq(enoteTable.companyId, companyId)));
    if (!enota) { res.status(403).json({ error: "Enota ne obstaja ali ne pripada podjetju" }); return; }
    effectiveEnotaId = enota.id;
  }

  const existing = await db.select({ id: blagajneTable.id })
    .from(blagajneTable)
    .where(and(eq(blagajneTable.enotaId, effectiveEnotaId), eq(blagajneTable.ppId, ppId), eq(blagajneTable.bId, bId)));
  if (existing.length > 0) { res.status(409).json({ error: "Blagajna s tem PP in B ID že obstaja v tej enoti" }); return; }

  const [created] = await db.insert(blagajneTable)
    .values({ enotaId: effectiveEnotaId, ppId, bId, ime, aktivna: aktivna ?? true })
    .returning();
  res.status(201).json(created);
});

router.put("/blagajne/:id", requireEnota, async (req, res): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const { ppId, bId, ime, aktivna, enotaId: bodyEnotaId } = req.body as { ppId: string; bId: string; ime: string; aktivna?: boolean; enotaId?: number };

  if (vloga === "admin") {
    // Admin sme urejati blagajne katerekoli enote podjetja
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));

    // Preveri morebitno podvajanje PP+B kombinacije
    const existing = await db.select({ id: blagajneTable.id, enotaId: blagajneTable.enotaId })
      .from(blagajneTable)
      .where(and(inArray(blagajneTable.enotaId, enotaIds), eq(blagajneTable.ppId, ppId), eq(blagajneTable.bId, bId)));
    if (existing.length > 0 && existing[0].id !== id) { res.status(409).json({ error: "Blagajna s tem PP in B ID že obstaja" }); return; }

    // Določi enoto (bodisi nova iz body, bodisi obstoječa)
    let targetEnotaId: number | undefined;
    if (bodyEnotaId) {
      const [enota] = await db.select({ id: enoteTable.id }).from(enoteTable)
        .where(and(eq(enoteTable.id, Number(bodyEnotaId)), eq(enoteTable.companyId, companyId)));
      if (!enota) { res.status(403).json({ error: "Enota ne obstaja ali ne pripada podjetju" }); return; }
      targetEnotaId = enota.id;
    }

    const setData: Record<string, unknown> = { ppId, bId, ime, ...(aktivna !== undefined ? { aktivna } : {}) };
    if (targetEnotaId) setData.enotaId = targetEnotaId;

    const [updated] = await db.update(blagajneTable)
      .set(setData)
      .where(and(eq(blagajneTable.id, id), inArray(blagajneTable.enotaId, enotaIds)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Blagajna ni najdena" }); return; }
    res.json(updated);
    return;
  }

  // admin_enote / uporabnik — samo lastna enota
  const enotaId = posReq.enotaId;
  const existing = await db.select({ id: blagajneTable.id })
    .from(blagajneTable)
    .where(and(eq(blagajneTable.enotaId, enotaId), eq(blagajneTable.ppId, ppId), eq(blagajneTable.bId, bId)));
  if (existing.length > 0 && existing[0].id !== id) { res.status(409).json({ error: "Blagajna s tem PP in B ID že obstaja v tej enoti" }); return; }

  const [updated] = await db.update(blagajneTable)
    .set({ ppId, bId, ime, ...(aktivna !== undefined ? { aktivna } : {}) })
    .where(and(eq(blagajneTable.id, id), eq(blagajneTable.enotaId, enotaId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Blagajna ni najdena" }); return; }
  res.json(updated);
});

router.delete("/blagajne/:id", requireEnota, async (req, res): Promise<void> => {
  const posReq = req as PosRequest;
  const vloga = posReq.vloga;
  const companyId = posReq.companyId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  if (vloga === "admin") {
    const enotaIds = db.select({ id: enoteTable.id }).from(enoteTable).where(eq(enoteTable.companyId, companyId));
    const [deleted] = await db.delete(blagajneTable)
      .where(and(eq(blagajneTable.id, id), inArray(blagajneTable.enotaId, enotaIds)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Blagajna ni najdena" }); return; }
    res.status(204).send();
    return;
  }

  const enotaId = posReq.enotaId;
  const [deleted] = await db.delete(blagajneTable)
    .where(and(eq(blagajneTable.id, id), eq(blagajneTable.enotaId, enotaId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Blagajna ni najdena" }); return; }
  res.status(204).send();
});

export default router;
