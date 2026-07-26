import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { artikliTable, db, zalogaGibiTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";

const router: IRouter = Router();

const zadnjaCenaSql = (artikelIdRef: typeof artikliTable.id) =>
  sql<string | null>`(
    SELECT cena_kos FROM (
      SELECT pp.cena_kos, p.datum
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      WHERE pp.artikel_id = ${artikelIdRef}
      UNION ALL
      SELECT zzp.cena_kos, zz.datum
      FROM zacetne_zaloge_postavke zzp
      JOIN zacetne_zaloge zz ON zz.id = zzp.zacetna_zaloga_id
      WHERE zzp.artikel_id = ${artikelIdRef}
    ) combined
    ORDER BY datum DESC
    LIMIT 1
  )`;

router.get("/zaloge", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      artikelId: artikliTable.id,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: sql<string>`COALESCE(SUM(${zalogaGibiTable.kolicina}), '0')`,
      zadnjaCena: zadnjaCenaSql(artikliTable.id),
      zadnjaPosodobitev: sql<string>`COALESCE((
        SELECT MAX(datum)::text FROM (
          SELECT p.datum FROM prejemnice_postavke pp JOIN prejemnice p ON p.id = pp.prejemnica_id
            WHERE pp.artikel_id = ${artikliTable.id}
          UNION ALL
          SELECT zz.datum FROM zacetne_zaloge_postavke zzp JOIN zacetne_zaloge zz ON zz.id = zzp.zacetna_zaloga_id
            WHERE zzp.artikel_id = ${artikliTable.id}
          UNION ALL
          SELECT inv.datum FROM inventure_postavke ip JOIN inventure inv ON inv.id = ip.inventura_id
            WHERE ip.artikel_id = ${artikliTable.id}
        ) src
      ), NOW()::text)`})
    .from(artikliTable)
    .leftJoin(zalogaGibiTable, eq(zalogaGibiTable.artikelId, artikliTable.id))
    .where(and(eq(artikliTable.nabavniArtikel, true), sql`true`, eq(artikliTable.enotaId, tenotaId)))
    .groupBy(artikliTable.id, artikliTable.ime, artikliTable.imeZaNabavo, artikliTable.enotaMere)
    .orderBy(artikliTable.ime);

  res.json(rows.map(r => ({
    ...r,
    kolicina: Number(r.kolicina),
    zadnjaCena: r.zadnjaCena != null ? Number(r.zadnjaCena) : null})));
});

router.get("/zaloge/kartica/:artikelId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const artikelId = parseInt(req.params.artikelId);
  if (isNaN(artikelId)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const datumOd = req.query.datumOd as string | undefined;
  const datumDo = req.query.datumDo as string | undefined;

  const [artikel] = await db
    .select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      cena: artikliTable.cena})
    .from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const [zalogaRow] = await db
    .select({
      kolicina: sql<string>`COALESCE(SUM(${zalogaGibiTable.kolicina}), '0')`})
    .from(zalogaGibiTable)
    .where(eq(zalogaGibiTable.artikelId, artikelId));

  const kolicina = Number(zalogaRow?.kolicina ?? 0);

  const lastPriceResult = await db.execute(
    sql`SELECT cena_kos FROM (
      SELECT pp.cena_kos, p.datum
      FROM prejemnice_postavke pp
      JOIN prejemnice p ON p.id = pp.prejemnica_id
      WHERE pp.artikel_id = ${artikelId}
      UNION ALL
      SELECT zzp.cena_kos, zz.datum
      FROM zacetne_zaloge_postavke zzp
      JOIN zacetne_zaloge zz ON zz.id = zzp.zacetna_zaloga_id
      WHERE zzp.artikel_id = ${artikelId}
    ) combined
    ORDER BY datum DESC
    LIMIT 1`
  );
  const zadnjaCena = lastPriceResult.rows[0]
    ? Number((lastPriceResult.rows[0] as { cena_kos: string }).cena_kos)
    : null;

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
      zg.id, zg.artikel_id AS "artikelId", a.ime AS "artikelIme",
      zg.tip, zg.kolicina, zg.opomba, zg.referenca_id AS "referencaId",
      zg.ustvarjeno,
      COALESCE(
        CASE WHEN zg.tip = 'prejemnica' THEN p.datum END,
        CASE WHEN zg.opomba LIKE 'Začetne zaloge%' THEN zz.datum END,
        CASE WHEN zg.tip = 'inventura' THEN inv.datum END,
        CASE WHEN zg.tip = 'izdajnica' THEN izd.datum END,
        zg.ustvarjeno
      ) AS "datumDokumenta"
    FROM zaloga_gibi zg
    LEFT JOIN artikli a ON a.id = zg.artikel_id
    LEFT JOIN prejemnice p ON p.id = zg.referenca_id AND zg.tip = 'prejemnica'
    LEFT JOIN zacetne_zaloge zz ON zz.id = zg.referenca_id AND zg.opomba LIKE 'Začetne zaloge%'
    LEFT JOIN inventure inv ON inv.id = zg.referenca_id AND zg.tip = 'inventura'
    LEFT JOIN izdajnice izd ON izd.id = zg.referenca_id AND zg.tip = 'izdajnica'
    WHERE zg.artikel_id = ${artikelId}
    ${datumOdFilter}
    ${datumDoFilter}
    ORDER BY "datumDokumenta" ASC, zg.id ASC
    LIMIT 500`
  );

  type GibRow = { id: number; artikelId: number; artikelIme: string | null; tip: string; kolicina: string; opomba: string | null; referencaId: number | null; ustvarjeno: string; datumDokumenta: string };
  const gibi = gibiResult.rows as GibRow[];

  res.json({
    artikelId: artikel.id,
    artikelIme: artikel.ime,
    imeZaNabavo: artikel.imeZaNabavo,
    enotaMere: artikel.enotaMere,
    cena: Number(artikel.cena),
    zadnjaCena,
    kolicina,
    vrednost: zadnjaCena != null ? kolicina * zadnjaCena : null,
    gibi: gibi.map(g => ({
      ...g,
      kolicina: Number(g.kolicina),
      artikelIme: g.artikelIme ?? artikel.ime}))});
});

router.get("/zaloge/gibi", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const query = { success: true as const, data: req.query };
  if (!query.success) { res.status(400).json({ error: (query as any).error.message }); return; }

  let q = db
    .select({
      id: zalogaGibiTable.id,
      artikelId: zalogaGibiTable.artikelId,
      artikelIme: artikliTable.ime,
      tip: zalogaGibiTable.tip,
      kolicina: zalogaGibiTable.kolicina,
      opomba: zalogaGibiTable.opomba,
      referencaId: zalogaGibiTable.referencaId,
      ustvarjeno: zalogaGibiTable.ustvarjeno})
    .from(zalogaGibiTable)
    .leftJoin(artikliTable, eq(zalogaGibiTable.artikelId, artikliTable.id))
    .$dynamic();

  const conditions = [sql`true`, eq(artikliTable.enotaId, tenotaId)];
  if (query.data.artikelId) {
    conditions.push(eq(zalogaGibiTable.artikelId, Number(query.data.artikelId)));
  }
  q = q.where(and(...conditions));

  const rows = await q.orderBy(desc(zalogaGibiTable.ustvarjeno)).limit(500);

  res.json(rows.map(r => ({
    ...r,
    kolicina: Number(r.kolicina),
    artikelIme: r.artikelIme ?? "–"})));
});

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
