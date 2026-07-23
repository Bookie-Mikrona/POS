import { Router, type IRouter } from "express";
import { and, count, eq, isNull, sum } from "drizzle-orm";
import { db, blagajneTable, enoteTable, izmeneTable, natakariTable, racuniTable } from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";

const router: IRouter = Router();

function toResponse(row: typeof izmeneTable.$inferSelect & { natakarIme: string; enotaIme?: string | null; blagajnaIme?: string | null }) {
  return {
    id: row.id,
    natakariId: row.natakariId,
    natakarIme: row.natakarIme,
    zacetek: row.zacetek.toISOString(),
    konec: row.konec ? row.konec.toISOString() : null,
    skupajZnesek: Number(row.skupajZnesek),
    steviloRacunov: row.steviloRacunov,
    enotaId: row.enotaId,
    enotaIme: row.enotaIme ?? null,
    blagajnaId: row.blagajnaId ?? null,
    blagajnaIme: row.blagajnaIme ?? null,
  };
}

// Skupni select za vse poizvedbe
const izmenaSelect = {
  id: izmeneTable.id,
  natakariId: izmeneTable.natakariId,
  enotaId: izmeneTable.enotaId,
  blagajnaId: izmeneTable.blagajnaId,
  natakarIme: natakariTable.ime,
  natakarPriimek: natakariTable.priimek,
  enotaIme: enoteTable.ime,
  blagajnaIme: blagajneTable.ime,
  zacetek: izmeneTable.zacetek,
  konec: izmeneTable.konec,
  skupajZnesek: izmeneTable.skupajZnesek,
  steviloRacunov: izmeneTable.steviloRacunov,
} as const;

function baseQuery() {
  return db
    .select(izmenaSelect)
    .from(izmeneTable)
    .leftJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .leftJoin(enoteTable, eq(izmeneTable.enotaId, enoteTable.id))
    .leftJoin(blagajneTable, eq(izmeneTable.blagajnaId, blagajneTable.id));
}

function rowToObj(r: typeof izmenaSelect & Record<string, unknown>) {
  return {
    id: r.id as number,
    natakariId: r.natakariId as number,
    natakarIme: `${(r.natakarIme as string | null) ?? ""} ${(r.natakarPriimek as string | null) ?? ""}`.trim(),
    zacetek: (r.zacetek as Date).toISOString(),
    konec: r.konec ? (r.konec as Date).toISOString() : null,
    skupajZnesek: Number(r.skupajZnesek),
    steviloRacunov: r.steviloRacunov as number,
    enotaId: r.enotaId as number,
    enotaIme: (r.enotaIme as string | null) ?? null,
    blagajnaId: (r.blagajnaId as number | null) ?? null,
    blagajnaIme: (r.blagajnaIme as string | null) ?? null,
  };
}

async function getWithNatakar(id: number, enotaId: number) {
  const [row] = await baseQuery()
    .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId)));
  return row;
}

router.get("/izmene/aktivne", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const rows = await baseQuery()
    .where(and(isNull(izmeneTable.konec), eq(izmeneTable.enotaId, enotaId)))
    .orderBy(izmeneTable.zacetek);

  const result = await Promise.all(rows.map(async (r) => {
    const [agg] = await db
      .select({ skupaj: sum(racuniTable.skupaj), stevilo: count(racuniTable.id) })
      .from(racuniTable)
      .where(eq(racuniTable.izmenaId, r.id));
    return {
      ...rowToObj(r),
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

  const rows = aktivneOnly
    ? await baseQuery().where(and(isNull(izmeneTable.konec), baseCondition)).orderBy(izmeneTable.zacetek)
    : await baseQuery().where(baseCondition).orderBy(izmeneTable.zacetek);

  res.json(rows.map(rowToObj));
});

router.post("/izmene", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const companyId = (req as PosRequest).companyId;
  const { natakariId, blagajnaId } = req.body as { natakariId: number; blagajnaId?: number | null };
  if (!natakariId) { res.status(400).json({ error: "natakariId je obvezen" }); return; }

  // Natakarji so na nivoju podjetja — preverimo companyId, ne enotaId
  const [natakar] = await db
    .select()
    .from(natakariTable)
    .where(and(eq(natakariTable.id, natakariId), eq(natakariTable.companyId, companyId)));
  if (!natakar) { res.status(404).json({ error: "Natakar ni najden" }); return; }
  if (!natakar.aktiven) { res.status(400).json({ error: "Natakar ni aktiven" }); return; }

  // Preveri blagajno — mora biti iz iste enote
  let resolvedBlagajnaId: number | null = blagajnaId ?? null;
  if (resolvedBlagajnaId) {
    const [blagajna] = await db
      .select({ id: blagajneTable.id })
      .from(blagajneTable)
      .where(and(eq(blagajneTable.id, resolvedBlagajnaId), eq(blagajneTable.enotaId, enotaId)));
    if (!blagajna) resolvedBlagajnaId = null; // ne pripada tej enoti — ignoriramo
  }

  // Izmena je vezana na enoto (za dnevne izkaze) — natakar pa je dostopen iz katere koli enote
  const [existing] = await db
    .select()
    .from(izmeneTable)
    .where(and(eq(izmeneTable.natakariId, natakariId), eq(izmeneTable.enotaId, enotaId)));
  const hasOpen = existing && !existing.konec;
  if (hasOpen) { res.status(409).json({ error: "Natakar ima že odprto izmeno v tej enoti" }); return; }

  const [row] = await db
    .insert(izmeneTable)
    .values({ enotaId, natakariId, blagajnaId: resolvedBlagajnaId, skupajZnesek: "0", steviloRacunov: 0 })
    .returning();

  // Pridobi enoto/blagajno za odgovor
  const [full] = await baseQuery().where(eq(izmeneTable.id, row!.id));
  res.status(201).json(rowToObj(full!));
});

router.post("/izmene/:id/zapri", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const row = await getWithNatakar(id, enotaId);
  if (!row) { res.status(404).json({ error: "Izmena ni najdena" }); return; }
  if (row.konec) { res.status(400).json({ error: "Izmena je že zaprta" }); return; }

  const [agg] = await db
    .select({ skupaj: sum(racuniTable.skupaj), stevilo: count(racuniTable.id) })
    .from(racuniTable)
    .where(eq(racuniTable.izmenaId, id));

  const skupajZnesek = Number(agg?.skupaj ?? 0);
  const steviloRacunov = Number(agg?.stevilo ?? 0);
  const konec = new Date();

  await db
    .update(izmeneTable)
    .set({ konec, skupajZnesek: String(skupajZnesek.toFixed(2)), steviloRacunov })
    .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId)));

  // Vrni polni objekt z enoto/blagajno
  const [updated] = await baseQuery().where(eq(izmeneTable.id, id));
  res.json(rowToObj(updated!));
});

export default router;
