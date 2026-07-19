import { sql, eq } from "drizzle-orm";
import { db, zalogeTable, zalogaGibiTable } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Recomputes zaloge.kolicina for the given artikelIds from the zaloga_gibi event log.
 * Uses a full (all-time) SUM — no year filter — so the cached value is always correct
 * regardless of when the recompute runs (avoids wrong-year issues near midnight on Dec 31).
 * Call this after inserting/deleting zaloga_gibi rows to keep the cache consistent.
 *
 * Concurrency safety: when called inside a transaction (tx provided), the function
 * acquires a FOR UPDATE row-lock on each zaloge row before reading the sum.
 * This serializes concurrent recomputes for the same artikel, preventing a
 * lost-update where two simultaneous inserts each read their own partial SUM and
 * the later commit overwrites the earlier one's result.
 */
export async function recomputeZaloge(
  artikelIds: number[],
  tx?: Tx,
): Promise<void> {
  if (!artikelIds.length) return;

  const executor = tx ?? db;

  for (const artikelId of artikelIds) {
    if (tx) {
      // Ensure the zaloge row exists so we have something to lock.
      await tx.execute(sql`
        INSERT INTO zaloge (artikel_id, kolicina, zadnja_posodobitev)
        VALUES (${artikelId}, '0', NOW())
        ON CONFLICT (artikel_id) DO NOTHING
      `);
      // Lock the row for the duration of this transaction. Any concurrent
      // transaction that reaches this point for the same artikelId will wait
      // until we commit, then re-read the by-then-complete zaloga_gibi sum.
      await tx.execute(sql`
        SELECT id FROM zaloge WHERE artikel_id = ${artikelId} FOR UPDATE
      `);
    }

    const [result] = await executor
      .select({
        vsota: sql<string>`COALESCE(SUM(${zalogaGibiTable.kolicina}), '0')`,
      })
      .from(zalogaGibiTable)
      .where(eq(zalogaGibiTable.artikelId, artikelId));

    const kolicina = String(Number(result?.vsota ?? 0));

    await executor
      .insert(zalogeTable)
      .values({
        artikelId,
        kolicina,
        zadnjaPosodobitev: new Date(),
      })
      .onConflictDoUpdate({
        target: zalogeTable.artikelId,
        set: {
          kolicina,
          zadnjaPosodobitev: new Date(),
        },
      });
  }
}
