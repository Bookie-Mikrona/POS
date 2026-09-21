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
          zg.cena_kos::float8 AS source_cena_kos,
          zg.vrednost::float8 AS vrednost,
          zg.reversal_of_id,
          zg.effective_at_snapshot AS datum_dokumenta
        FROM zaloga_gibi zg
        WHERE zg.artikel_id = ${artikelId}
      )
      SELECT * FROM gibi
      WHERE datum_dokumenta <= ${cutoff}
      ORDER BY datum_dokumenta ASC, id ASC
    `);

    type MovRow = { id: number; tip: string; kolicina: number; opomba: string | null; source_cena_kos: number | null; vrednost: number | null; reversal_of_id: number | null };
    const movements = movementsResult.rows as MovRow[];

    let runQty   = 0;
    let runValue = 0;

    for (const m of movements) {
      const qty = m.kolicina;
      let unitCost: number;
      const isZacetnaZaloga = m.opomba != null && String(m.opomba).startsWith('Začetne zaloge');

      if (m.reversal_of_id != null) {
        runQty += qty;
        runValue += m.vrednost ?? qty * (m.source_cena_kos ?? 0);
      } else if (isZacetnaZaloga) {
        unitCost = m.source_cena_kos ?? 0;
        runQty   = qty;
        runValue = m.vrednost ?? qty * unitCost;
      } else if (qty >= 0) {
        unitCost = m.source_cena_kos ?? (runQty > 0 ? runValue / runQty : 0);
        runQty   += qty;
        runValue += m.vrednost ?? qty * unitCost;
      } else {
        unitCost = runQty > 0 ? runValue / runQty : 0;
        runQty   += qty;
        runValue += m.vrednost ?? qty * unitCost;
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
    // Costs, values and business dates come from immutable movement snapshots.
    // Running WAC is only a compatibility fallback for legacy rows without one.
    const movementsResult = await (tx ?? db).execute(sql`
      SELECT
        zg.id,
        zg.tip,
        zg.kolicina::float8                                               AS kolicina,
        zg.opomba,
        zg.referenca_id,
        zg.cena_kos::float8 AS source_cena_kos,
        zg.vrednost::float8 AS vrednost,
        zg.reversal_of_id,
        zg.effective_at_snapshot AS datum_dokumenta
      FROM zaloga_gibi zg
      WHERE zg.artikel_id = ${artikelId}
      ORDER BY datum_dokumenta ASC, zg.id ASC
    `);

    type MovRow = {
      id: number;
      tip: string;
      kolicina: number;
      opomba: string | null;
      source_cena_kos: number | null;
      vrednost: number | null;
      reversal_of_id: number | null;
      datum_dokumenta: string | Date | null;
    };
    const movements = movementsResult.rows as MovRow[];

    // ── iterate and compute WAC ────────────────────────────────────────────
    let runQty   = 0;  // running quantity
    let runValue = 0;  // running value (qty * WAC)
    let lastDatum: Date | null = null;  // datum zadnjega gibanja

    for (const m of movements) {
      const qty = m.kolicina;  // positive for inflows, negative for outflows
      let unitCost: number;

      const isZacetnaZaloga = m.opomba != null && String(m.opomba).startsWith('Začetne zaloge');

      if (m.reversal_of_id != null) {
        unitCost = m.source_cena_kos ?? 0;
        runQty += qty;
        runValue += m.vrednost ?? qty * unitCost;
      } else if (isZacetnaZaloga) {
        // Začetna zaloga = absolutno izhodišče leta: PONASTAVI tekoče stanje, ne seštevaj
        unitCost = m.source_cena_kos ?? 0;
        runQty   = qty;
        runValue = m.vrednost ?? qty * unitCost;
      } else if (qty >= 0) {
        // Navadan pritok: tehtano povprečje s tekočim WAC
        unitCost = m.source_cena_kos ?? (runQty > 0 ? runValue / runQty : 0);
        runQty   += qty;
        runValue += m.vrednost ?? qty * unitCost;
      } else {
        // Odtok: uporabi zamrznjeno vrednost; tekoči WAC je samo legacy fallback.
        unitCost = runQty > 0 ? runValue / runQty : 0;
        runQty   += qty;
        runValue += m.vrednost ?? qty * unitCost;
      }

      // Prepreči plovečo vejico pod nič po uravnoteženih gibanjih
      if (runQty < 0.000001 && runQty > -0.000001) { runQty = 0; runValue = 0; }

      if (m.datum_dokumenta) lastDatum = new Date(m.datum_dokumenta as string);
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
