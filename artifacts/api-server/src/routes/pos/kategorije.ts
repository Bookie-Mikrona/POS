import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, eq, sql } from "drizzle-orm";
import { artikliTable, db, kategorijeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

router.get("/kategorije", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(kategorijeTable)
    .where(and(eq(kategorijeTable.enotaId, tenotaId)))
    .orderBy(kategorijeTable.vrstniRed);
  res.json((rows));
});

router.post("/kategorije", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) {
    res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
    return;
  }
  const data = parsed.data;
  const [row] = await db.insert(kategorijeTable).values({
    enotaId: tenotaId,
    ime: data.ime,
    barva: data.barva,
    vrstniRed: data.vrstniRed ?? 0,
    tip: data.tip ?? null}).returning();
  res.status(201).json((row));
});

router.get("/kategorije/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const [row] = await db.select().from(kategorijeTable)
    .where(and(eq(kategorijeTable.id, params.data.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)));
  if (!row) { res.status(404).json({ error: "Kategorija ni najdena" }); return; }
  res.json((row));
});

router.put("/kategorije/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const [row] = await db.update(kategorijeTable).set(parsed.data)
    .where(and(eq(kategorijeTable.id, params.data.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Kategorija ni najdena" }); return; }
  res.json((row));
});

router.delete("/kategorije/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [steviloArtiklov] = await db
    .select({ stevilo: count() })
    .from(artikliTable)
    .where(and(eq(artikliTable.kategorijaId, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if ((steviloArtiklov?.stevilo ?? 0) > 0) {
    res.status(409).json({ error: "Kategorije ni mogoče izbrisati, ker vsebuje aktivne artikle." });
    return;
  }

  await db.delete(kategorijeTable)
    .where(and(eq(kategorijeTable.id, params.data.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)));
  res.sendStatus(204);
});

export default router;
