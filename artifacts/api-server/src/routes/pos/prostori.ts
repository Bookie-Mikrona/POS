import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, mizeTable, prostoriTable } from "@workspace/db";
import { broadcast } from "../../lib/pos-sse";

const router: IRouter = Router();

router.get("/prostori", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(prostoriTable)
    .where(and(eq(prostoriTable.enotaId, tenotaId)))
    .orderBy(asc(prostoriTable.vrstniRed), asc(prostoriTable.id));
  res.json((rows));
});

router.post("/prostori", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const [row] = await db.insert(prostoriTable).values({
    enotaId: tenotaId,
    ime: parsed.data.ime,
    vrstniRed: parsed.data.vrstniRed ?? 0}).returning();
  broadcast("update", { type: "prostor" });
  res.status(201).json(row);
});

router.put("/prostori/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const updateData: Partial<typeof prostoriTable.$inferInsert> = {};
  if (parsed.data.ime !== undefined) updateData.ime = parsed.data.ime;
  if (parsed.data.vrstniRed !== undefined) updateData.vrstniRed = parsed.data.vrstniRed;
  const [row] = await db.update(prostoriTable).set(updateData)
    .where(and(eq(prostoriTable.id, params.data.id), sql`true`, eq(prostoriTable.enotaId, tenotaId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Prostor ni najden" }); return; }
  broadcast("update", { type: "prostor" });
  res.json((row));
});

router.delete("/prostori/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  await db.update(mizeTable)
    .set({ prostorId: null })
    .where(and(eq(mizeTable.prostorId, params.data.id), sql`true`, eq(mizeTable.enotaId, tenotaId)));
  await db.delete(prostoriTable)
    .where(and(eq(prostoriTable.id, params.data.id), sql`true`, eq(prostoriTable.enotaId, tenotaId)));
  broadcast("update", { type: "prostor" });
  res.sendStatus(204);
});

export default router;
