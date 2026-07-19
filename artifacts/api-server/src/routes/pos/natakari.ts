import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, natakariTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

router.get("/natakari", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(natakariTable)
    .where(and(eq(natakariTable.enotaId, tenotaId)))
    .orderBy(natakariTable.id);
  res.json(rows.map(r => ({
    ...r,
    davcnaStevilka: r.davcnaStevilka ?? null,
    ustvarjeno: r.ustvarjeno.toISOString()})));
});

router.post("/natakari", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { ime, priimek, davcnaStevilka, aktiven } = req.body as {
    ime: string; priimek: string; davcnaStevilka?: string | null; aktiven: boolean;
  };
  if (!ime || !priimek) { res.status(400).json({ error: "ime in priimek sta obvezna" }); return; }

  const [row] = await db.insert(natakariTable).values({
    enotaId: tenotaId,
    ime, priimek, davcnaStevilka: davcnaStevilka ?? null, aktiven: aktiven ?? true}).returning();

  res.status(201).json({ ...row, davcnaStevilka: row!.davcnaStevilka ?? null, ustvarjeno: row!.ustvarjeno.toISOString() });
});

router.put("/natakari/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const { ime, priimek, davcnaStevilka, aktiven } = req.body as {
    ime: string; priimek: string; davcnaStevilka?: string | null; aktiven: boolean;
  };

  const [row] = await db
    .update(natakariTable)
    .set({ ime, priimek, davcnaStevilka: davcnaStevilka ?? null, aktiven })
    .where(and(eq(natakariTable.id, id), sql`true`, eq(natakariTable.enotaId, tenotaId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Natakar ni najden" }); return; }
  res.json({ ...row, davcnaStevilka: row.davcnaStevilka ?? null, ustvarjeno: row.ustvarjeno.toISOString() });
});

router.delete("/natakari/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  await db.delete(natakariTable)
    .where(and(eq(natakariTable.id, id), sql`true`, eq(natakariTable.enotaId, tenotaId)));
  res.status(204).send();
});

export default router;
