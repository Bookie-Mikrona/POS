/**
 * UJP e-računi — sinhronizacija in iskanje proračunskih uporabnikov.
 *
 * POST /api/ujp/sync        — prenese in shrani celoten dnevni seznam iz UJP
 * GET  /api/ujp/poisci      — poišče prejemnika po davčni ali matični številki
 * GET  /api/ujp/status      — datum zadnjega uvoza in število vnosov
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, or, sql } from "drizzle-orm";
import { db, ujpPrejemnikiTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const UJP_URL = "https://storitve.ujp.gov.si/docdir/eracunpu/eRacunPU_Dnevni.txt";

// ── Skupna pomožna funkcija ────────────────────────────────────────────────

export interface UjpNajden {
  sifraPu: string;
  trrSt: string;      // e-naslov za dostavo
  naziv: string;
  maticnaSt: string;
  davcnaSt: string;
}

/** Poišče vse TRR vnose za podano davčno ali matično številko. */
export async function poisciVUjp(davcnaSt?: string | null, maticnaSt?: string | null): Promise<UjpNajden[]> {
  if (!davcnaSt && !maticnaSt) return [];
  const clauses = [];
  if (davcnaSt) clauses.push(eq(ujpPrejemnikiTable.davcnaSt, davcnaSt.replace(/^SI/i, "").trim()));
  if (maticnaSt) clauses.push(eq(ujpPrejemnikiTable.maticnaSt, maticnaSt.trim()));
  const rows = await db.select().from(ujpPrejemnikiTable).where(or(...clauses));
  return rows.map(r => ({
    sifraPu: r.sifraPu,
    trrSt: r.trrSt,
    naziv: r.naziv,
    maticnaSt: r.maticnaSt,
    davcnaSt: r.davcnaSt,
  }));
}

// ── POST /api/ujp/sync ─────────────────────────────────────────────────────

router.post("/ujp/sync", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  let text: string;
  try {
    const r = await fetch(UJP_URL, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`UJP HTTP ${r.status}`);
    text = await r.text();
  } catch (err) {
    res.status(502).json({ error: `Prenos s UJP ni uspel: ${err instanceof Error ? err.message : err}` });
    return;
  }

  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  // Prva vrstica je datum, ostale so podatki
  const dataLines = lines.slice(1);

  const vnosi: Array<{
    sifraPu: string; trrSt: string; naziv: string;
    maticnaSt: string; davcnaSt: string; zadnjiUvoz: Date;
  }> = [];

  const now = new Date();
  for (const line of dataLines) {
    const parts = line.split(";");
    if (parts.length < 5) continue;
    const [sifraPu, trrSt, naziv, maticnaSt, davcnaSt] = parts as [string,string,string,string,string];
    if (!sifraPu || !trrSt || !naziv) continue;
    vnosi.push({ sifraPu: sifraPu.trim(), trrSt: trrSt.trim(), naziv: naziv.trim(), maticnaSt: (maticnaSt ?? "").trim(), davcnaSt: (davcnaSt ?? "").trim(), zadnjiUvoz: now });
  }

  if (vnosi.length === 0) {
    res.status(422).json({ error: "Datoteka ne vsebuje veljavnih vnosov." });
    return;
  }

  // Počisti staro in vstavi novo (atomic truncate + insert v transakciji)
  let uvozenih = 0;
  await db.transaction(async tx => {
    await tx.delete(ujpPrejemnikiTable);
    // Vstavljamo v serijah po 500 (da ne presežemo parametrske meje PG)
    const batchSize = 500;
    for (let i = 0; i < vnosi.length; i += batchSize) {
      const batch = vnosi.slice(i, i + batchSize);
      await tx.insert(ujpPrejemnikiTable).values(batch);
      uvozenih += batch.length;
    }
  });

  res.json({ uvozenih, datum: now.toISOString().slice(0, 10) });
});

// ── GET /api/ujp/status ────────────────────────────────────────────────────

router.get("/ujp/status", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const [row] = await db
    .select({
      skupaj: sql<number>`count(*)::int`,
      zadnjiUvoz: sql<string>`max(${ujpPrejemnikiTable.zadnjiUvoz})`,
    })
    .from(ujpPrejemnikiTable);

  res.json({
    skupaj: row?.skupaj ?? 0,
    zadnjiUvoz: row?.zadnjiUvoz ?? null,
  });
});

// ── GET /api/ujp/poisci?davcna=&maticna= ──────────────────────────────────

router.get("/ujp/poisci", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const davcna = typeof req.query.davcna === "string" ? req.query.davcna.replace(/^SI/i, "").trim() : null;
  const maticna = typeof req.query.maticna === "string" ? req.query.maticna.trim() : null;
  if (!davcna && !maticna) {
    res.status(400).json({ error: "Podajte vsaj davčno (davcna) ali matično (maticna) številko." });
    return;
  }
  const najdeni = await poisciVUjp(davcna, maticna);
  res.json(najdeni);
});

export default router;
