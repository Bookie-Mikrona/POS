import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import { blagajneTable, poslovniProstoriTable, db } from "@workspace/db";
import { requireEnota, type PosRequest } from "../../middlewares/pos";


const router: IRouter = Router();

/**
 * GET /blagajne
 * Vrne samo blagajne za trenutno enoto (X-Enota-Id), katerih poslovni prostor
 * je registriran na FURS (zadnjaRegistracija IS NOT NULL) in aktiven.
 */
router.get("/blagajne", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
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
  const enotaId = (req as PosRequest).enotaId;
  const { ppId, bId, ime, aktivna } = req.body as { ppId: string; bId: string; ime: string; aktivna?: boolean };
  if (!ppId || !bId || !ime) { res.status(400).json({ error: "Manjkajo obvezna polja: ppId, bId, ime" }); return; }

  const existing = await db.select({ id: blagajneTable.id })
    .from(blagajneTable)
    .where(and(eq(blagajneTable.enotaId, enotaId), eq(blagajneTable.ppId, ppId), eq(blagajneTable.bId, bId)));
  if (existing.length > 0) { res.status(409).json({ error: "Blagajna s tem PP in B ID že obstaja v tej enoti" }); return; }

  const [created] = await db.insert(blagajneTable)
    .values({ enotaId, ppId, bId, ime, aktivna: aktivna ?? true })
    .returning();
  res.status(201).json(created);
});

router.put("/blagajne/:id", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const { ppId, bId, ime, aktivna } = req.body as { ppId: string; bId: string; ime: string; aktivna?: boolean };

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
  const enotaId = (req as PosRequest).enotaId;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const [deleted] = await db.delete(blagajneTable)
    .where(and(eq(blagajneTable.id, id), eq(blagajneTable.enotaId, enotaId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Blagajna ni najdena" }); return; }
  res.status(204).send();
});

export default router;
