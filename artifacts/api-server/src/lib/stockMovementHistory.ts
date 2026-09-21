import { sql } from "drizzle-orm";
import type { db as database } from "@workspace/db";

type DbExecutor = Pick<typeof database, "execute" | "insert">;

export async function appendStockMovementReversals(
  executor: DbExecutor,
  input: {
    referenceId: number;
    sourceSnapshots: string[];
    actorSnapshot: string | null;
    reversalSourceSnapshot: string;
    note: string;
    legacyKind?: "prejemnica" | "inventura" | "izdajnica" | "zacetne-zaloge";
  },
): Promise<number[]> {
  if (input.sourceSnapshots.length === 0) return [];

  const legacyMatch = input.legacyKind === "prejemnica"
    ? sql`original.source_snapshot IS NULL AND original.tip = 'prejemnica'`
    : input.legacyKind === "inventura"
      ? sql`original.source_snapshot IS NULL AND original.tip = 'inventura'
            AND (original.opomba IS NULL OR original.opomba NOT LIKE 'Začetne zaloge%')`
      : input.legacyKind === "izdajnica"
        ? sql`original.source_snapshot IS NULL AND original.tip = 'izdajnica'`
        : input.legacyKind === "zacetne-zaloge"
          ? sql`original.source_snapshot IS NULL AND original.tip = 'inventura'
                AND original.opomba LIKE 'Začetne zaloge%'`
          : sql`FALSE`;

  const reversed = await executor.execute<{ artikel_id: number }>(sql`
    INSERT INTO zaloga_gibi (
      artikel_id, tip, kolicina, cena_kos, vrednost, opomba,
      referenca_id, actor_snapshot, source_snapshot, reversal_of_id,
      effective_at_snapshot, ustvarjeno
    )
    SELECT
      original.artikel_id,
      'storno',
      -original.kolicina,
      original.cena_kos,
      CASE WHEN original.vrednost IS NULL THEN NULL ELSE -original.vrednost END,
      ${input.note} || ' [gib #' || original.id || ']',
      original.referenca_id,
      ${input.actorSnapshot},
      ${input.reversalSourceSnapshot},
      original.id,
      original.effective_at_snapshot,
      NOW()
    FROM zaloga_gibi original
    WHERE original.referenca_id = ${input.referenceId}
      AND (
        original.source_snapshot IN (
          ${sql.join(input.sourceSnapshots.map((source) => sql`${source}`), sql`, `)}
        )
        OR (${legacyMatch})
      )
      AND original.reversal_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM zaloga_gibi reversal
        WHERE reversal.reversal_of_id = original.id
      )
    ORDER BY original.id
    RETURNING artikel_id
  `);

  return [...new Set(reversed.rows.map((row) => row.artikel_id))];
}