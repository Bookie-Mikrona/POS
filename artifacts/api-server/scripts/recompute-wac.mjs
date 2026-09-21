/**
 * Recompute current stock summaries from immutable movement history.
 * Run: PORT=9999 node --enable-source-maps scripts/recompute-wac.mjs
 */
import { sql } from "drizzle-orm";
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
    // Read only immutable movement snapshots. Never derive history from live
    // documents and never update append-only zaloga_gibi rows.
    const movRes = await db.execute(sql`
      SELECT
        zg.tip,
        zg.kolicina::float8 AS kolicina,
        zg.opomba,
        zg.cena_kos::float8 AS source_cena_kos,
        zg.vrednost::float8 AS vrednost,
        zg.reversal_of_id,
        zg.effective_at_snapshot AS datum_dokumenta
      FROM zaloga_gibi zg
      WHERE zg.artikel_id = ${artikelId}
      ORDER BY datum_dokumenta ASC, zg.id ASC
    `);

    const movements = movRes.rows;
    let runQty = 0, runValue = 0;
    for (const m of movements) {
      const qty = Number(m.kolicina);
      const snapshotCost = m.source_cena_kos != null ? Number(m.source_cena_kos) : null;
      const snapshotValue = m.vrednost != null ? Number(m.vrednost) : null;
      const isOpening = m.opomba?.startsWith("Začetne zaloge");
      let unitCost = 0;
      if (m.reversal_of_id != null) {
        unitCost = snapshotCost ?? 0;
        runQty += qty;
        runValue += snapshotValue ?? qty * unitCost;
      } else if (isOpening) {
        unitCost = snapshotCost ?? 0;
        runQty = qty;
        runValue = snapshotValue ?? qty * unitCost;
      } else if (qty >= 0) {
        unitCost = snapshotCost ?? (runQty > 0 ? runValue / runQty : 0);
        runQty += qty;
        runValue += snapshotValue ?? qty * unitCost;
      } else {
        unitCost = runQty > 0 ? runValue / runQty : 0;
        runQty += qty;
        runValue += snapshotValue ?? qty * unitCost;
      }
      if (Math.abs(runQty) < 0.000001) { runQty = 0; runValue = 0; }
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
