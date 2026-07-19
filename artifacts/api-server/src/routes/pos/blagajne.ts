import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { blagajneTable, db } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

router.get("/blagajne", async (req, res): Promise<void> => {
  const rows = await db.select().from(blagajneTable).where(sql`true`);
  res.json(rows);
});

router.post("/blagajne", requireEnota, async (req, res): Promise<void> => {
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error }); return; }
  const existing = await db.select().from(blagajneTable)
    .where(and(eq(blagajneTable.ppId, parsed.data.ppId), eq(blagajneTable.bId, parsed.data.bId)));
  if (existing.length > 0) { res.status(409).json({ error: "Blagajna s tem PP in B ID že obstaja" }); return; }
  const [created] = await db.insert(blagajneTable).values({
 ...parsed.data }).returning();
  res.status(201).json(created);
});

router.put("/blagajne/:id", requireEnota, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error }); return; }
  const existing = await db.select().from(blagajneTable)
    .where(and(eq(blagajneTable.ppId, parsed.data.ppId), eq(blagajneTable.bId, parsed.data.bId)));
  if (existing.length > 0 && existing[0].id !== id) { res.status(409).json({ error: "Blagajna s tem PP in B ID že obstaja" }); return; }
  const [updated] = await db.update(blagajneTable).set(parsed.data).where(and(eq(blagajneTable.id, id))).returning();
  if (!updated) { res.status(404).json({ error: "Blagajna ni najdena" }); return; }
  res.json(updated);
});

router.delete("/blagajne/:id", requireEnota, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const [deleted] = await db.delete(blagajneTable).where(and(eq(blagajneTable.id, id))).returning();
  if (!deleted) { res.status(404).json({ error: "Blagajna ni najdena" }); return; }
  res.status(204).send();
});

export default router;
