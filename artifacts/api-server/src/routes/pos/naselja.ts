import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { slovenianCollated } from "../../lib/slovenian-collation";
import { db, naseljaTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

const createNaseljeSchema = z.object({
  naziv: z.string().trim().min(1).max(160),
  oddaljenostKm: z.coerce.number().finite().min(0).nullable().optional(),
  cenaDostave: z.coerce.number().finite().min(0).default(0),
  casDostaveMin: z.coerce.number().int().min(0).default(0),
  aktivno: z.boolean().default(true),
});

const updateNaseljeSchema = createNaseljeSchema.partial();

function idParam(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function mapNaselje(row: typeof naseljaTable.$inferSelect) {
  return {
    ...row,
    oddaljenostKm: row.oddaljenostKm == null ? null : Number(row.oddaljenostKm),
    cenaDostave: Number(row.cenaDostave),
  };
}

router.get("/naselja", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const vse = req.query.vse === "true";
  const rows = await db
    .select()
    .from(naseljaTable)
    .where(and(
      eq(naseljaTable.enotaId, enotaId),
      ...(vse ? [] : [eq(naseljaTable.aktivno, true)]),
    ))
    .orderBy(asc(slovenianCollated(naseljaTable.naziv)), asc(naseljaTable.id));
  res.json(rows.map(mapNaselje));
});

router.get("/naselja/:id", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Neveljaven ID naselja" });
    return;
  }
  const [row] = await db.select().from(naseljaTable).where(and(
    eq(naseljaTable.id, id),
    eq(naseljaTable.enotaId, enotaId),
  ));
  if (!row) {
    res.status(404).json({ error: "Naselje ni najdeno" });
    return;
  }
  res.json(mapNaselje(row));
});

router.post("/naselja", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const parsed = createNaseljeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Napačni podatki naselja", details: parsed.error.flatten() });
    return;
  }
  const [row] = await db.insert(naseljaTable).values({
    enotaId,
    naziv: parsed.data.naziv,
    oddaljenostKm: parsed.data.oddaljenostKm == null ? null : String(parsed.data.oddaljenostKm),
    cenaDostave: String(parsed.data.cenaDostave),
    casDostaveMin: parsed.data.casDostaveMin,
    aktivno: parsed.data.aktivno,
  }).returning();
  res.status(201).json(mapNaselje(row));
});

router.put("/naselja/:id", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Neveljaven ID naselja" });
    return;
  }
  const parsed = updateNaseljeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Napačni podatki naselja", details: parsed.error.flatten() });
    return;
  }
  const updates: Partial<typeof naseljaTable.$inferInsert> = {};
  if (parsed.data.naziv !== undefined) updates.naziv = parsed.data.naziv;
  if (parsed.data.oddaljenostKm !== undefined) {
    updates.oddaljenostKm = parsed.data.oddaljenostKm == null ? null : String(parsed.data.oddaljenostKm);
  }
  if (parsed.data.cenaDostave !== undefined) updates.cenaDostave = String(parsed.data.cenaDostave);
  if (parsed.data.casDostaveMin !== undefined) updates.casDostaveMin = parsed.data.casDostaveMin;
  if (parsed.data.aktivno !== undefined) updates.aktivno = parsed.data.aktivno;

  const [row] = await db.update(naseljaTable).set(updates).where(and(
    eq(naseljaTable.id, id),
    eq(naseljaTable.enotaId, enotaId),
  )).returning();
  if (!row) {
    res.status(404).json({ error: "Naselje ni najdeno" });
    return;
  }
  res.json(mapNaselje(row));
});

router.delete("/naselja/:id", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Neveljaven ID naselja" });
    return;
  }
  const [row] = await db.update(naseljaTable)
    .set({ aktivno: false })
    .where(and(eq(naseljaTable.id, id), eq(naseljaTable.enotaId, enotaId)))
    .returning({ id: naseljaTable.id });
  if (!row) {
    res.status(404).json({ error: "Naselje ni najdeno" });
    return;
  }
  res.sendStatus(204);
});

export default router;