/**
 * One-time WAC backfill script.
 * Run: PORT=9999 node --enable-source-maps scripts/recompute-wac.mjs
 */
import { sql, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function recomputeAll() {
  // Get all artikelIds that have any zaloga_gibi rows
  const result = await db.execute(sql`
    SELECT DISTINCT artikel_id FROM zaloga_gibi ORDER BY artikel_id
  `);
  const ids = result.rows.map(r => r.artikel_id);
  console.log(`Found ${ids.length} articles to recompute.`);

  for (const artikelId of ids) {
    // Fetch all movements with source prices
    const movRes = await db.execute(sql`
      SELECT
        zg.id,
        zg.tip,
        zg.kolicina::float8                                               AS kolicina,
        zg.opomba,
        CASE
          WHEN zg.tip = 'prejemnica'
            THEN pp.cena_kos::float8
          WHEN zg.opomba LIKE 'Začetne zaloge%'
            THEN zzp.cena_kos::float8
          ELSE NULL
        END AS source_cena_kos,
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
      ORDER BY datum_dokumenta ASC, zg.id ASC
    `);

    const movements = movRes.rows;
    let runQty = 0, runValue = 0;
    const updates = [];

    for (const m of movements) {
      const qty = Number(m.kolicina);
      let unitCost;
      if (qty >= 0) {
        unitCost = m.source_cena_kos != null ? Number(m.source_cena_kos) : (runQty > 0 ? runValue / runQty : 0);
      } else {
        unitCost = runQty > 0 ? runValue / runQty : 0;
      }
      const lineValue = qty * unitCost;
      runQty += qty;
      runValue += lineValue;
      if (Math.abs(runQty) < 0.000001) { runQty = 0; runValue = 0; }
      updates.push({ id: m.id, cenaKos: unitCost, vrednost: lineValue });
    }

    // Batch update
    for (const u of updates) {
      await db.execute(sql`
        UPDATE zaloga_gibi SET cena_kos = ${u.cenaKos}, vrednost = ${u.vrednost} WHERE id = ${u.id}
      `);
    }

    // Update zaloge summary
    const finalQty = runQty;
    const finalValue = runQty > 0 ? runValue : 0;
    const finalAvg = runQty > 0 ? runValue / runQty : null;

    await db.execute(sql`
      INSERT INTO zaloge (artikel_id, kolicina, povprecna_cena, skupna_vrednost, zadnja_posodobitev)
      VALUES (${artikelId}, ${String(finalQty)}, ${finalAvg != null ? String(finalAvg) : null}, ${String(finalValue)}, NOW())
      ON CONFLICT (artikel_id) DO UPDATE SET
        kolicina = EXCLUDED.kolicina,
        povprecna_cena = EXCLUDED.povprecna_cena,
        skupna_vrednost = EXCLUDED.skupna_vrednost,
        zadnja_posodobitev = EXCLUDED.zadnja_posodobitev
    `);

    const artName = movements[0] ? `artikel_id=${artikelId}` : `artikel_id=${artikelId} (no movements)`;
    console.log(`  ${artName}: qty=${finalQty.toFixed(4)}, wac=${finalAvg?.toFixed(6) ?? 'N/A'}, value=${finalValue.toFixed(4)}`);
  }

  console.log("Done.");
  await pool.end();
}

recomputeAll().catch(e => { console.error(e); process.exit(1); });
