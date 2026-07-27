import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { artikliTable, db, zalogaGibiTable, zalogeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";

const router: IRouter = Router();

// ── GET /zaloge ─────────────────────────────────────────────────────────────
router.get("/zaloge", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  // Osnovna poizvedba: artikli + WAC iz zaloge
  const rows = await db
    .select({
      artikelId:         artikliTable.id,
      artikelIme:        artikliTable.ime,
      imeZaNabavo:       artikliTable.imeZaNabavo,
      enotaMere:         artikliTable.enotaMere,
      kolicina:          sql<string>`COALESCE(${zalogeTable.kolicina}, '0')`,
      povprecnaCena:     zalogeTable.povprecnaCena,
      skupnaVrednost:    zalogeTable.skupnaVrednost,
      zadnjaPosodobitev: sql<string>`COALESCE(${zalogeTable.zadnjaPosodobitev}::text, NOW()::text)`,
    })
    .from(artikliTable)
    .leftJoin(zalogeTable, eq(zalogeTable.artikelId, artikliTable.id))
    .where(and(eq(artikliTable.nabavniArtikel, true), eq(artikliTable.enotaId, tenotaId)))
    .orderBy(artikliTable.ime);

  // Ločena poizvedba: zadnja nabavna cena — prejemnice + začetne zaloge, novejša zmaga
  const zadnjeNabavneRes = await db.execute(sql`
    SELECT DISTINCT ON (artikel_id)
      artikel_id          AS "artikelId",
      cena_kos::float8    AS "zadnjaNabavnaCena",
      vrsta_cen           AS "zadnjaVrstaCen"
    FROM (
      SELECT pp.artikel_id, pp.cena_kos, p.vrsta_cen, p.datum
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      WHERE p.enota_id = ${tenotaId}
      UNION ALL
      SELECT zzp.artikel_id, zzp.cena_kos, 'neto' AS vrsta_cen, zz.datum
      FROM zacetne_zaloge_postavke zzp
      JOIN zacetne_zaloge zz ON zz.id = zzp.zacetna_zaloga_id
      WHERE zz.enota_id = ${tenotaId}
    ) vsi
    ORDER BY artikel_id, datum DESC
  `);
  const zadnjeNabavne = new Map<number, { cena: number; vrstaCen: string }>(
    (zadnjeNabavneRes.rows as { artikelId: number; zadnjaNabavnaCena: number; zadnjaVrstaCen: string }[])
      .map(r => [r.artikelId, { cena: r.zadnjaNabavnaCena, vrstaCen: r.zadnjaVrstaCen }])
  );

  res.json(rows.map(r => ({
    ...r,
    kolicina:          Number(r.kolicina),
    povprecnaCena:     r.povprecnaCena  != null ? Number(r.povprecnaCena)  : null,
    skupnaVrednost:    r.skupnaVrednost != null ? Number(r.skupnaVrednost) : null,
    zadnjaNabavnaCena: zadnjeNabavne.get(r.artikelId)?.cena ?? null,
    zadnjaVrstaCen:    zadnjeNabavne.get(r.artikelId)?.vrstaCen ?? null,
    // backward-compat alias za prikaz WAC v tabeli zalog
    zadnjaCena:        r.povprecnaCena  != null ? Number(r.povprecnaCena)  : null,
  })));
});

// ── GET /zaloge/zadnje-nabavne ───────────────────────────────────────────────
// Vrne zadnjo nabavno ceno za vsak artikel (prejemnice + začetne zaloge).
// Kliče se direktno ob odprtju dialoga — brez predpomnilnika.
router.get("/zaloge/zadnje-nabavne", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const result = await db.execute(sql`
    SELECT DISTINCT ON (artikel_id)
      artikel_id         AS "artikelId",
      cena_kos::float8   AS "zadnjaNabavnaCena",
      vrsta_cen          AS "zadnjaVrstaCen"
    FROM (
      SELECT pp.artikel_id, pp.cena_kos, p.vrsta_cen, p.datum
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      WHERE p.enota_id = ${enotaId}
      UNION ALL
      SELECT zzp.artikel_id, zzp.cena_kos, 'neto' AS vrsta_cen, zz.datum
      FROM zacetne_zaloge_postavke zzp
      JOIN zacetne_zaloge zz ON zz.id = zzp.zacetna_zaloga_id
      WHERE zz.enota_id = ${enotaId}
    ) vsi
    ORDER BY artikel_id, datum DESC
  `);
  res.json(result.rows);
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
      p.stevilka      AS "prejStevilka",
      COALESCE(sk.kratki_naziv, sk.naziv) AS "dobaviteljNaziv",
      izd.stevilka    AS "izdStevilka",
      COALESCE(
        CASE WHEN zg.tip = 'prejemnica'                                    THEN p.datum END,
        CASE WHEN zg.opomba LIKE 'Začetne zaloge%'                        THEN zz.datum END,
        CASE WHEN zg.tip = 'inventura'                                     THEN inv.datum END,
        CASE WHEN zg.tip = 'izdajnica'                                     THEN izd.datum END,
        zg.ustvarjeno
      ) AS "datumDokumenta"
    FROM zaloga_gibi zg
    LEFT JOIN artikli a            ON a.id   = zg.artikel_id
    LEFT JOIN prejemnice p         ON p.id   = zg.referenca_id AND zg.tip = 'prejemnica'
    LEFT JOIN shranjeni_kupci sk   ON sk.id  = p.dobavitelj_id
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
    prejStevilka: string | null; dobaviteljNaziv: string | null; izdStevilka: string | null;
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
