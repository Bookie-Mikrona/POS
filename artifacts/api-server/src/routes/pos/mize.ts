import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, mizeTable, narocilaTable } from "@workspace/db";
import { broadcast } from "../../lib/pos-sse";

const router: IRouter = Router();

router.get("/mize", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(mizeTable)
    .where(and(eq(mizeTable.enotaId, tenotaId)))
    .orderBy(mizeTable.stevilka);
  res.json((rows));
});

router.post("/mize", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const [row] = await db.insert(mizeTable).values({
    enotaId: tenotaId,
    stevilka: parsed.data.stevilka,
    ime: parsed.data.ime ?? null,
    kapaciteta: parsed.data.kapaciteta ?? 4,
    status: (parsed.data.status as "prosta" | "zasedena" | "rezervirana") ?? "prosta",
    prostorId: parsed.data.prostorId ?? null}).returning();
  broadcast("update", { type: "miza" });
  res.status(201).json((row));
});

router.get("/mize/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const [row] = await db.select().from(mizeTable)
    .where(and(eq(mizeTable.id, params.data.id), sql`true`, eq(mizeTable.enotaId, tenotaId)));
  if (!row) { res.status(404).json({ error: "Miza ni najdena" }); return; }
  res.json((row));
});

router.put("/mize/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const updateData: Partial<typeof mizeTable.$inferInsert> = {};
  if (parsed.data.stevilka !== undefined) updateData.stevilka = parsed.data.stevilka;
  if (parsed.data.ime !== undefined) updateData.ime = parsed.data.ime;
  if (parsed.data.kapaciteta !== undefined) updateData.kapaciteta = parsed.data.kapaciteta;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status as "prosta" | "zasedena" | "rezervirana";
  if (parsed.data.prostorId !== undefined) updateData.prostorId = parsed.data.prostorId;
  const [row] = await db.update(mizeTable).set(updateData)
    .where(and(eq(mizeTable.id, params.data.id), sql`true`, eq(mizeTable.enotaId, tenotaId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Miza ni najdena" }); return; }
  broadcast("update", { type: "miza", id: params.data.id });
  res.json((row));
});

router.delete("/mize/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  // Preveri odprta naročila za to mizo
  const odprta = await db.select({ id: narocilaTable.id })
    .from(narocilaTable)
    .where(and(eq(narocilaTable.mizaId, params.data.id), eq(narocilaTable.status, "odprto")));
  if (odprta.length > 0) {
    res.status(409).json({ error: "Mize ni mogoče izbrisati — ima odprta naročila." });
    return;
  }

  // Zgodovinska naročila: odveži mizo (miza_id → NULL) da FK constraint ne blokira
  await db.update(narocilaTable)
    .set({ mizaId: null })
    .where(and(eq(narocilaTable.mizaId, params.data.id), ne(narocilaTable.status, "odprto")));

  await db.delete(mizeTable)
    .where(and(eq(mizeTable.id, params.data.id), sql`true`, eq(mizeTable.enotaId, tenotaId)));
  broadcast("update", { type: "miza" });
  res.sendStatus(204);
});

export default router;
