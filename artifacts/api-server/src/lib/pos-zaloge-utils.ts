import { sql, eq } from "drizzle-orm";
import { db, zalogeTable, zalogaGibiTable } from "@workspace/db";

/**
 * Vrne stanje zaloge (kolicina + WAC cena) ob koncu danega datuma (cutoff),
 * z enako logiko kot recomputeZaloge, toda filtrira gibanja na datum_dokumenta <= cutoff.
 */
export async function getZalogeObDatumu(
  artikelIds: number[],
  cutoff: Date,
  tx?: Tx,
): Promise<Map<number, { kolicina: number; cenaKos: number }>> {
  if (!artikelIds.length) return new Map();

  const executor = tx ?? db;
  const result = new Map<number, { kolicina: number; cenaKos: number }>();

  for (const artikelId of artikelIds) {
    const movementsResult = await executor.execute(sql`
      WITH gibi AS (
        SELECT
          zg.id,
          zg.tip,
          zg.kolicina::float8 AS kolicina,
          zg.opomba,
          CASE
            WHEN zg.tip = 'prejemnica'             THEN pp.cena_kos::float8
            WHEN zg.opomba LIKE 'Začetne zaloge%'  THEN zzp.cena_kos::float8
            ELSE NULL
          END AS source_cena_kos,
          COALESCE(
            CASE WHEN zg.tip = 'prejemnica'                                              THEN p.datum END,
            CASE WHEN zg.opomba LIKE 'Začetne zaloge%'                                  THEN zz.datum END,
            CASE WHEN zg.tip = 'inventura'
                  AND (zg.opomba IS NULL OR zg.opomba NOT LIKE 'Začetne zaloge%')        THEN inv.datum END,
            CASE WHEN zg.tip = 'izdajnica'                                               THEN izd.datum END,
            zg.ustvarjeno
          ) AS datum_dokumenta
        FROM zaloga_gibi zg
        LEFT JOIN prejemnice_postavke pp
          ON pp.prejemnica_id = zg.referenca_id AND pp.artikel_id = ${artikelId} AND zg.tip = 'prejemnica'
        LEFT JOIN prejemnice p
          ON p.id = zg.referenca_id AND zg.tip = 'prejemnica'
        LEFT JOIN zacetne_zaloge_postavke zzp
          ON zzp.zacetna_zaloga_id = zg.referenca_id AND zzp.artikel_id = ${artikelId} AND zg.opomba LIKE 'Začetne zaloge%'
        LEFT JOIN zacetne_zaloge zz
          ON zz.id = zg.referenca_id AND zg.opomba LIKE 'Začetne zaloge%'
        LEFT JOIN inventure inv
          ON inv.id = zg.referenca_id AND zg.tip = 'inventura'
         AND (zg.opomba IS NULL OR zg.opomba NOT LIKE 'Začetne zaloge%')
        LEFT JOIN izdajnice izd
          ON izd.id = zg.referenca_id AND zg.tip = 'izdajnica'
        WHERE zg.artikel_id = ${artikelId}
      )
      SELECT * FROM gibi
      WHERE datum_dokumenta <= ${cutoff}
      ORDER BY datum_dokumenta ASC, id ASC
    `);

    type MovRow = { id: number; tip: string; kolicina: number; opomba: string | null; source_cena_kos: number | null };
    const movements = movementsResult.rows as MovRow[];

    let runQty   = 0;
    let runValue = 0;

    for (const m of movements) {
      const qty = m.kolicina;
      let unitCost: number;
      const isZacetnaZaloga = m.opomba != null && String(m.opomba).startsWith('Začetne zaloge');

      if (isZacetnaZaloga) {
        unitCost = m.source_cena_kos ?? 0;
        runQty   = qty;
        runValue = qty * unitCost;
      } else if (qty >= 0) {
        unitCost = m.source_cena_kos ?? (runQty > 0 ? runValue / runQty : 0);
        runQty   += qty;
        runValue += qty * unitCost;
      } else {
        unitCost = runQty > 0 ? runValue / runQty : 0;
        runQty   += qty;
        runValue += qty * unitCost;
      }
      if (runQty < 0.000001 && runQty > -0.000001) { runQty = 0; runValue = 0; }
    }

    const wacPrice = runQty > 0 ? runValue / runQty : null;
    result.set(artikelId, { kolicina: runQty, cenaKos: wacPrice ?? 0 });
  }

  return result;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Recomputes zaloge.kolicina, zaloge.povprecna_cena, zaloge.skupna_vrednost
 * AND fills zaloga_gibi.cena_kos / zaloga_gibi.vrednost for all rows,
 * using the DRSEČA TEHTANA POVPREČNA CENA (weighted average cost, WAC) method.
 *
 * WAC rules:
 *  - Receipt (prejemnica, začetna zaloga): new_avg = (old_value + qty * unit_price) / (old_qty + qty)
 *  - Outflow (poraba, inventura, izdajnica, storno): use current WAC as unit price
 *  - The average price NEVER changes on outflows — only receipts move it.
 *
 * Movements are processed in document-date order (same order as the kartica view).
 * Concurrency: acquires FOR UPDATE lock on the zaloge row when running inside a tx.
 */
export async function recomputeZaloge(
  artikelIds: number[],
  tx?: Tx,
): Promise<void> {
  const validIds = artikelIds.filter((id): id is number => id != null && typeof id === 'number');
  if (!validIds.length) return;
  // shadow the parameter so the rest of the function uses filtered IDs
  artikelIds = validIds;

  const executor = tx ?? db;

  for (const artikelId of artikelIds) {
    // ── ensure zaloge row exists ───────────────────────────────────────────
    await (tx ?? db).execute(sql`
      INSERT INTO zaloge (artikel_id, kolicina, zadnja_posodobitev)
      VALUES (${artikelId}, '0', NOW())
      ON CONFLICT (artikel_id) DO NOTHING
    `);

    if (tx) {
      // Serialize concurrent recomputes for the same artikel.
      await tx.execute(sql`
        SELECT id FROM zaloge WHERE artikel_id = ${artikelId} FOR UPDATE
      `);
    }

    // ── fetch all movements with their source prices ───────────────────────
    // For receipts the unit cost comes from the source document table.
    // For outflows we compute it from the running WAC.
    const movementsResult = await (tx ?? db).execute(sql`
      SELECT
        zg.id,
        zg.tip,
        zg.kolicina::float8                                               AS kolicina,
        zg.opomba,
        zg.referenca_id,
        -- Source unit price: only filled for inflow documents
        CASE
          WHEN zg.tip = 'prejemnica'
            THEN pp.cena_kos::float8
          WHEN zg.opomba LIKE 'Začetne zaloge%'
            THEN zzp.cena_kos::float8
          ELSE NULL   -- outflow; will use running WAC
        END AS source_cena_kos,
        -- Canonical document date (same logic as kartica view)
        COALESCE(
          CASE WHEN zg.tip = 'prejemnica'                               THEN p.datum END,
          CASE WHEN zg.opomba LIKE 'Začetne zaloge%'                   THEN zz.datum END,
          CASE WHEN zg.tip = 'inventura'
                AND (zg.opomba IS NULL OR zg.opomba NOT LIKE 'Začetne zaloge%')
                                                                        THEN inv.datum END,
          CASE WHEN zg.tip = 'izdajnica'                               THEN izd.datum END,
          zg.ustvarjeno
        ) AS datum_dokumenta
      FROM zaloga_gibi zg
      -- Receipts: join to get the per-article unit cost
      LEFT JOIN prejemnice_postavke pp
        ON pp.prejemnica_id = zg.referenca_id
       AND pp.artikel_id    = ${artikelId}
       AND zg.tip = 'prejemnica'
      LEFT JOIN prejemnice p
        ON p.id  = zg.referenca_id
       AND zg.tip = 'prejemnica'
      -- Beginning balances (stored as inventura gibanje with 'Začetne zaloge' opomba)
      LEFT JOIN zacetne_zaloge_postavke zzp
        ON zzp.zacetna_zaloga_id = zg.referenca_id
       AND zzp.artikel_id        = ${artikelId}
       AND zg.opomba LIKE 'Začetne zaloge%'
      LEFT JOIN zacetne_zaloge zz
        ON zz.id = zg.referenca_id
       AND zg.opomba LIKE 'Začetne zaloge%'
      -- Regular inventory counts
      LEFT JOIN inventure inv
        ON inv.id  = zg.referenca_id
       AND zg.tip  = 'inventura'
       AND (zg.opomba IS NULL OR zg.opomba NOT LIKE 'Začetne zaloge%')
      -- Issue notes
      LEFT JOIN izdajnice izd
        ON izd.id = zg.referenca_id
       AND zg.tip = 'izdajnica'
      WHERE zg.artikel_id = ${artikelId}
      ORDER BY datum_dokumenta ASC, zg.id ASC
    `);

    type MovRow = {
      id: number;
      tip: string;
      kolicina: number;
      opomba: string | null;
      source_cena_kos: number | null;
      datum_dokumenta: string | Date | null;
    };
    const movements = movementsResult.rows as MovRow[];

    // ── iterate and compute WAC ────────────────────────────────────────────
    let runQty   = 0;  // running quantity
    let runValue = 0;  // running value (qty * WAC)
    let lastDatum: Date | null = null;  // datum zadnjega gibanja

    const updates: { id: number; cenaKos: number; vrednost: number }[] = [];

    for (const m of movements) {
      const qty = m.kolicina;  // positive for inflows, negative for outflows
      let unitCost: number;

      const isZacetnaZaloga = m.opomba != null && String(m.opomba).startsWith('Začetne zaloge');

      if (isZacetnaZaloga) {
        // Začetna zaloga = absolutno izhodišče leta: PONASTAVI tekoče stanje, ne seštevaj
        unitCost = m.source_cena_kos ?? 0;
        runQty   = qty;
        runValue = qty * unitCost;
      } else if (qty >= 0) {
        // Navadan pritok: tehtano povprečje s tekočim WAC
        unitCost = m.source_cena_kos ?? (runQty > 0 ? runValue / runQty : 0);
        runQty   += qty;
        runValue += qty * unitCost;
      } else {
        // Odtok: vedno uporabi tekoči WAC
        unitCost = runQty > 0 ? runValue / runQty : 0;
        runQty   += qty;
        runValue += qty * unitCost;
      }

      // Prepreči plovečo vejico pod nič po uravnoteženih gibanjih
      if (runQty < 0.000001 && runQty > -0.000001) { runQty = 0; runValue = 0; }

      if (m.datum_dokumenta) lastDatum = new Date(m.datum_dokumenta as string);
      updates.push({ id: m.id, cenaKos: unitCost, vrednost: qty * unitCost });
    }

    // ── batch-update zaloga_gibi rows ──────────────────────────────────────
    for (const u of updates) {
      await executor.execute(sql`
        UPDATE zaloga_gibi
           SET cena_kos = ${u.cenaKos},
               vrednost  = ${u.vrednost}
         WHERE id = ${u.id}
      `);
    }

    // ── update zaloge summary ──────────────────────────────────────────────
    const finalQty   = runQty;
    const finalValue = runQty > 0 ? runValue : 0;
    const finalAvg   = runQty > 0 ? runValue / runQty : null;
    // zadnja_posodobitev = datum zadnjega gibanja (ne sistemski čas)
    const zadnjaPosodobitev = lastDatum ?? new Date();

    await executor
      .insert(zalogeTable)
      .values({
        artikelId,
        kolicina:       String(finalQty),
        povprecnaCena:  finalAvg != null ? String(finalAvg) : null,
        skupnaVrednost: String(finalValue),
        zadnjaPosodobitev,
      })
      .onConflictDoUpdate({
        target: zalogeTable.artikelId,
        set: {
          kolicina:       String(finalQty),
          povprecnaCena:  finalAvg != null ? String(finalAvg) : null,
          skupnaVrednost: String(finalValue),
          zadnjaPosodobitev,
        },
      });
  }
}
