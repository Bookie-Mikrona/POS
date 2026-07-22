import { Router, type IRouter } from "express";
import { and, count, eq, isNull, sum } from "drizzle-orm";
import { db, izmeneTable, natakariTable, racuniTable } from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";

const router: IRouter = Router();

function toResponse(row: typeof izmeneTable.$inferSelect & { natakarIme: string }) {
  return {
    id: row.id,
    natakariId: row.natakariId,
    natakarIme: row.natakarIme,
    zacetek: row.zacetek.toISOString(),
    konec: row.konec ? row.konec.toISOString() : null,
    skupajZnesek: Number(row.skupajZnesek),
    steviloRacunov: row.steviloRacunov,
  };
}

async function getWithNatakar(id: number, enotaId: number) {
  const [row] = await db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec,
      skupajZnesek: izmeneTable.skupajZnesek,
      steviloRacunov: izmeneTable.steviloRacunov,
    })
    .from(izmeneTable)
    .leftJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId)));
  return row;
}

router.get("/izmene/aktivne", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const rows = await db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec,
    })
    .from(izmeneTable)
    .leftJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .where(and(isNull(izmeneTable.konec), eq(izmeneTable.enotaId, enotaId)))
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
      steviloRacunov: Number(agg?.stevilo ?? 0),
    };
  }));

  res.json(result);
});

router.get("/izmene", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const aktivneOnly = req.query.aktivne === "true";

  const baseCondition = eq(izmeneTable.enotaId, enotaId);

  const query = db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec,
      skupajZnesek: izmeneTable.skupajZnesek,
      steviloRacunov: izmeneTable.steviloRacunov,
    })
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
    steviloRacunov: r.steviloRacunov,
  })));
});

router.post("/izmene", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const companyId = (req as PosRequest).companyId;
  const { natakariId } = req.body as { natakariId: number };
  if (!natakariId) { res.status(400).json({ error: "natakariId je obvezen" }); return; }

  // Natakarji so na nivoju podjetja — preverimo companyId, ne enotaId
  const [natakar] = await db
    .select()
    .from(natakariTable)
    .where(and(eq(natakariTable.id, natakariId), eq(natakariTable.companyId, companyId)));
  if (!natakar) { res.status(404).json({ error: "Natakar ni najden" }); return; }
  if (!natakar.aktiven) { res.status(400).json({ error: "Natakar ni aktiven" }); return; }

  // Izmena je vezana na enoto (za dnevne izkaze) — natakar pa je dostopen iz katere koli enote
  const [existing] = await db
    .select()
    .from(izmeneTable)
    .where(and(eq(izmeneTable.natakariId, natakariId), eq(izmeneTable.enotaId, enotaId)));
  const hasOpen = existing && !existing.konec;
  if (hasOpen) { res.status(409).json({ error: "Natakar ima že odprto izmeno v tej enoti" }); return; }

  const [row] = await db
    .insert(izmeneTable)
    .values({ enotaId, natakariId, skupajZnesek: "0", steviloRacunov: 0 })
    .returning();

  res.status(201).json(toResponse({
    ...row!,
    natakarIme: `${natakar.ime} ${natakar.priimek}`,
  }));
});

router.post("/izmene/:id/zapri", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const row = await getWithNatakar(id, enotaId);
  if (!row) { res.status(404).json({ error: "Izmena ni najdena" }); return; }
  if (row.konec) { res.status(400).json({ error: "Izmena je že zaprta" }); return; }

  const [agg] = await db
    .select({
      skupaj: sum(racuniTable.skupaj),
      stevilo: count(racuniTable.id),
    })
    .from(racuniTable)
    .where(eq(racuniTable.izmenaId, id));

  const skupajZnesek = Number(agg?.skupaj ?? 0);
  const steviloRacunov = Number(agg?.stevilo ?? 0);
  const konec = new Date();

  const [updated] = await db
    .update(izmeneTable)
    .set({ konec, skupajZnesek: String(skupajZnesek.toFixed(2)), steviloRacunov })
    .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId)))
    .returning();

  res.json(toResponse({
    ...updated!,
    natakarIme: `${row.natakarIme ?? ""} ${row.natakarPriimek ?? ""}`.trim(),
  }));
});

export default router;
