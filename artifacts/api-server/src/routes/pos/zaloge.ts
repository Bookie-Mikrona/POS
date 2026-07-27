import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { artikliTable, db, zalogaGibiTable, zalogeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";

const router: IRouter = Router();

// ── GET /zaloge ─────────────────────────────────────────────────────────────
router.get("/zaloge", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  // Join artikli → zaloge to get the cached WAC and value
  const rows = await db
    .select({
      artikelId:      artikliTable.id,
      artikelIme:     artikliTable.ime,
      imeZaNabavo:    artikliTable.imeZaNabavo,
      enotaMere:      artikliTable.enotaMere,
      kolicina:       sql<string>`COALESCE(${zalogeTable.kolicina}, '0')`,
      povprecnaCena:  zalogeTable.povprecnaCena,
      skupnaVrednost: zalogeTable.skupnaVrednost,
      zadnjaPosodobitev: sql<string>`COALESCE(${zalogeTable.zadnjaPosodobitev}::text, NOW()::text)`,
      zadnjaNabavnaCena: sql<string | null>`(
        SELECT pp.cena_kos::float8
        FROM prejemnice_postavke pp
        JOIN prejemnice p ON p.id = pp.prejemnica_id
        WHERE pp.artikel_id = ${artikliTable.id}
          AND p.enota_id = ${tenotaId}
        ORDER BY p.datum DESC
        LIMIT 1
      )`,
    })
    .from(artikliTable)
    .leftJoin(zalogeTable, eq(zalogeTable.artikelId, artikliTable.id))
    .where(and(eq(artikliTable.nabavniArtikel, true), eq(artikliTable.enotaId, tenotaId)))
    .orderBy(artikliTable.ime);

  res.json(rows.map(r => ({
    ...r,
    kolicina:           Number(r.kolicina),
    povprecnaCena:      r.povprecnaCena  != null ? Number(r.povprecnaCena)  : null,
    skupnaVrednost:     r.skupnaVrednost != null ? Number(r.skupnaVrednost) : null,
    zadnjaNabavnaCena:  r.zadnjaNabavnaCena != null ? Number(r.zadnjaNabavnaCena) : null,
    // backward-compat alias za prikaz v zalogah (WAC)
    zadnjaCena:         r.povprecnaCena  != null ? Number(r.povprecnaCena)  : null,
  })));
});

// ── GET /zaloge/kartica/:artikelId ──────────────────────────────────────────
router.get("/zaloge/kartica/:artikelId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const artikelId = parseInt(req.params.artikelId);
  if (isNaN(artikelId)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const datumOd = req.query.datumOd as string | undefined;
  const datumDo = req.query.datumDo as string | undefined;

  const [artikel] = await db
    .select({
      id:          artikliTable.id,
      ime:         artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere:   artikliTable.enotaMere,
      cena:        artikliTable.cena,
    })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, tenotaId)));

  if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  // Read WAC from the cached zaloge row
  const [zalogaRow] = await db
    .select({
      kolicina:       zalogeTable.kolicina,
      povprecnaCena:  zalogeTable.povprecnaCena,
      skupnaVrednost: zalogeTable.skupnaVrednost,
    })
    .from(zalogeTable)
    .where(eq(zalogeTable.artikelId, artikelId));

  const kolicina       = Number(zalogaRow?.kolicina       ?? 0);
  const povprecnaCena  = zalogaRow?.povprecnaCena  != null ? Number(zalogaRow.povprecnaCena)  : null;
  const skupnaVrednost = zalogaRow?.skupnaVrednost != null ? Number(zalogaRow.skupnaVrednost) : null;

  // Date range filters
  const datumOdFilter = datumOd ? sql` AND COALESCE(
        CASE WHEN zg.tip = 'prejemnica' THEN p.datum END,
        CASE WHEN zg.opomba LIKE 'Začetne zaloge%' THEN zz.datum END,
        CASE WHEN zg.tip = 'inventura' THEN inv.datum END,
        CASE WHEN zg.tip = 'izdajnica' THEN izd.datum END,
        zg.ustvarjeno
      ) >= ${datumOd}::date` : sql``;
  const datumDoFilter = datumDo ? sql` AND COALESCE(
        CASE WHEN zg.tip = 'prejemnica' THEN p.datum END,
        CASE WHEN zg.opomba LIKE 'Začetne zaloge%' THEN zz.datum END,
        CASE WHEN zg.tip = 'inventura' THEN inv.datum END,
        CASE WHEN zg.tip = 'izdajnica' THEN izd.datum END,
        zg.ustvarjeno
      ) < (${datumDo}::date + INTERVAL '1 day')` : sql``;

  const gibiResult = await db.execute(
    sql`SELECT
      zg.id,
      zg.artikel_id   AS "artikelId",
      a.ime           AS "artikelIme",
      zg.tip,
      zg.kolicina::float8  AS kolicina,
      zg.cena_kos::float8  AS "cenaKos",
      zg.vrednost::float8  AS vrednost,
      zg.opomba,
      zg.referenca_id AS "referencaId",
      zg.ustvarjeno,
      COALESCE(
        CASE WHEN zg.tip = 'prejemnica'                                    THEN p.datum END,
        CASE WHEN zg.opomba LIKE 'Začetne zaloge%'                        THEN zz.datum END,
        CASE WHEN zg.tip = 'inventura'                                     THEN inv.datum END,
        CASE WHEN zg.tip = 'izdajnica'                                     THEN izd.datum END,
        zg.ustvarjeno
      ) AS "datumDokumenta"
    FROM zaloga_gibi zg
    LEFT JOIN artikli a   ON a.id  = zg.artikel_id
    LEFT JOIN prejemnice p         ON p.id   = zg.referenca_id AND zg.tip = 'prejemnica'
    LEFT JOIN zacetne_zaloge zz    ON zz.id  = zg.referenca_id AND zg.opomba LIKE 'Začetne zaloge%'
    LEFT JOIN inventure inv        ON inv.id  = zg.referenca_id AND zg.tip = 'inventura'
    LEFT JOIN izdajnice izd        ON izd.id  = zg.referenca_id AND zg.tip = 'izdajnica'
    WHERE zg.artikel_id = ${artikelId}
    ${datumOdFilter}
    ${datumDoFilter}
    ORDER BY "datumDokumenta" ASC, zg.id ASC
    LIMIT 500`
  );

  type GibRow = {
    id: number; artikelId: number; artikelIme: string | null;
    tip: string; kolicina: number; cenaKos: number | null; vrednost: number | null;
    opomba: string | null; referencaId: number | null; ustvarjeno: string; datumDokumenta: string;
  };
  const gibi = gibiResult.rows as GibRow[];

  // Compute running balance for display
  let runQty   = 0;
  let runValue = 0;
  const gibiWithBalance = gibi.map(g => {
    runQty   += g.kolicina;
    runValue += g.vrednost ?? 0;
    const runAvg = runQty > 0.00001 ? runValue / runQty : null;
    return {
      ...g,
      artikelIme:     g.artikelIme ?? artikel.ime,
      stanjeKolicina: runQty,
      stanjeVrednost: runQty > 0 ? runValue : 0,
      stanjePovprecnaCena: runAvg,
    };
  });

  res.json({
    artikelId:      artikel.id,
    artikelIme:     artikel.ime,
    imeZaNabavo:    artikel.imeZaNabavo,
    enotaMere:      artikel.enotaMere,
    cena:           Number(artikel.cena),
    // WAC fields (use zadnjaCena alias for backward compat)
    zadnjaCena:     povprecnaCena,
    povprecnaCena,
    kolicina,
    vrednost:       skupnaVrednost,
    skupnaVrednost,
    gibi:           gibiWithBalance,
  });
});

// ── GET /zaloge/gibi ────────────────────────────────────────────────────────
router.get("/zaloge/gibi", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  let q = db
    .select({
      id:         zalogaGibiTable.id,
      artikelId:  zalogaGibiTable.artikelId,
      artikelIme: artikliTable.ime,
      tip:        zalogaGibiTable.tip,
      kolicina:   zalogaGibiTable.kolicina,
      cenaKos:    zalogaGibiTable.cenaKos,
      vrednost:   zalogaGibiTable.vrednost,
      opomba:     zalogaGibiTable.opomba,
      referencaId: zalogaGibiTable.referencaId,
      ustvarjeno: zalogaGibiTable.ustvarjeno,
    })
    .from(zalogaGibiTable)
    .leftJoin(artikliTable, eq(zalogaGibiTable.artikelId, artikliTable.id))
    .$dynamic();

  const conditions = [sql`true`, eq(artikliTable.enotaId, tenotaId)];
  if (req.query.artikelId) {
    conditions.push(eq(zalogaGibiTable.artikelId, Number(req.query.artikelId)));
  }
  q = q.where(and(...conditions));

  const rows = await q.orderBy(zalogaGibiTable.ustvarjeno).limit(500);

  res.json(rows.map(r => ({
    ...r,
    kolicina: Number(r.kolicina),
    cenaKos:  r.cenaKos  != null ? Number(r.cenaKos)  : null,
    vrednost: r.vrednost != null ? Number(r.vrednost) : null,
    artikelIme: r.artikelIme ?? "–",
  })));
});

// ── POST /zaloge/reconcile ──────────────────────────────────────────────────
router.post("/zaloge/reconcile", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const artikliRows = await db
    .select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId), eq(artikliTable.nabavniArtikel, true)));

  const artikelIds = artikliRows.map(a => a.id);
  await recomputeZaloge(artikelIds);

  res.json({ popravljeno: artikelIds.length });
});

export default router;
