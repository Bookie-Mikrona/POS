import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, eq, isNull, sql, sum } from "drizzle-orm";
import { db, izmeneTable, natakariTable, racuniTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

function toResponse(row: typeof izmeneTable.$inferSelect & { natakarIme: string }) {
  return {
    id: row.id,
    natakariId: row.natakariId,
    natakarIme: row.natakarIme,
    zacetek: row.zacetek.toISOString(),
    konec: row.konec ? row.konec.toISOString() : null,
    skupajZnesek: Number(row.skupajZnesek),
    steviloRacunov: row.steviloRacunov};
}

async function getWithNatakar(id: number, _davcna: string, tenotaId: number) {
  const [row] = await db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec,
      skupajZnesek: izmeneTable.skupajZnesek,
      steviloRacunov: izmeneTable.steviloRacunov})
    .from(izmeneTable)
    .leftJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .where(and(eq(izmeneTable.id, id), sql`true`, eq(izmeneTable.enotaId, tenotaId)));
  return row;
}

router.get("/izmene/aktivne", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec})
    .from(izmeneTable)
    .leftJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .where(and(isNull(izmeneTable.konec), sql`true`, eq(izmeneTable.enotaId, tenotaId)))
    .orderBy(izmeneTable.zacetek);

  const result = await Promise.all(rows.map(async (r) => {
    const [agg] = await db
      .select({ skupaj: sum(racuniTable.skupaj), stevilo: count(racuniTable.id) })
      .from(racuniTable)
      .where(eq(racuniTable.izmenaId, r.id));
    return {
      id: r.id,
      natakariId: r.natakariId,
      natakarIme: `${r.natakarIme ?? ""} ${r.natakarPriimek ?? ""}`.trim(),
      zacetek: r.zacetek.toISOString(),
      konec: null,
      skupajZnesek: Number(agg?.skupaj ?? 0),
      steviloRacunov: Number(agg?.stevilo ?? 0)};
  }));

  res.json(result);
});

router.get("/izmene", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const aktivneOnly = req.query.aktivne === "true";

  const baseCondition = and(eq(izmeneTable.enotaId, tenotaId));

  const query = db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec,
      skupajZnesek: izmeneTable.skupajZnesek,
      steviloRacunov: izmeneTable.steviloRacunov})
    .from(izmeneTable)
    .leftJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id));

  const rows = aktivneOnly
    ? await query.where(and(isNull(izmeneTable.konec), baseCondition)).orderBy(izmeneTable.zacetek)
    : await query.where(baseCondition).orderBy(izmeneTable.zacetek);

  res.json(rows.map(r => ({
    id: r.id,
    natakariId: r.natakariId,
    natakarIme: `${r.natakarIme ?? ""} ${r.natakarPriimek ?? ""}`.trim(),
    zacetek: r.zacetek.toISOString(),
    konec: r.konec ? r.konec.toISOString() : null,
    skupajZnesek: Number(r.skupajZnesek),
    steviloRacunov: r.steviloRacunov})));
});

router.post("/izmene", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { natakariId } = req.body as { natakariId: number };
  if (!natakariId) { res.status(400).json({ error: "natakariId je obvezen" }); return; }

  const [natakar] = await db.select().from(natakariTable)
    .where(and(eq(natakariTable.id, natakariId), sql`true`, eq(natakariTable.enotaId, tenotaId)));
  if (!natakar) { res.status(404).json({ error: "Natakar ni najden" }); return; }
  if (!natakar.aktiven) { res.status(400).json({ error: "Natakar ni aktiven" }); return; }

  const [existing] = await db
    .select()
    .from(izmeneTable)
    .where(and(eq(izmeneTable.natakariId, natakariId), sql`true`, eq(izmeneTable.enotaId, tenotaId)));
  const hasOpen = existing && !existing.konec;
  if (hasOpen) { res.status(409).json({ error: "Natakar ima že odprto izmeno" }); return; }

  const [row] = await db
    .insert(izmeneTable)
    .values({
 enotaId: tenotaId, natakariId, skupajZnesek: "0", steviloRacunov: 0 })
    .returning();

  res.status(201).json(toResponse({
    ...row!,
    natakarIme: `${natakar.ime} ${natakar.priimek}`}));
});

router.post("/izmene/:id/zapri", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const row = await getWithNatakar(id, "", tenotaId);
  if (!row) { res.status(404).json({ error: "Izmena ni najdena" }); return; }
  if (row.konec) { res.status(400).json({ error: "Izmena je že zaprta" }); return; }

  const [agg] = await db
    .select({
      skupaj: sum(racuniTable.skupaj),
      stevilo: count(racuniTable.id)})
    .from(racuniTable)
    .where(eq(racuniTable.izmenaId, id));

  const skupajZnesek = Number(agg?.skupaj ?? 0);
  const steviloRacunov = Number(agg?.stevilo ?? 0);
  const konec = new Date();

  const [updated] = await db
    .update(izmeneTable)
    .set({ konec, skupajZnesek: String(skupajZnesek.toFixed(2)), steviloRacunov })
    .where(and(eq(izmeneTable.id, id), sql`true`, eq(izmeneTable.enotaId, tenotaId)))
    .returning();

  res.json(toResponse({
    ...updated!,
    natakarIme: `${row.natakarIme ?? ""} ${row.natakarPriimek ?? ""}`.trim()}));
});

export default router;
