import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { artikliTable, db, pool } from "@workspace/db";
import { logger } from "./logger";
import { mergeAutomaticAllergens, researchIngredientAllergens } from "./allergen-web-research";
import { razveljaviAlergeneNadrejenih } from "./alergeni-resolver";
import { normalizirajAlergenProfil } from "./alergeni";

let started = false;
let running = 0;
let nextAttemptAt = 0;

/** Lease tokens prevent a timed-out/restarted worker overwriting a newer attempt. */
export async function runNextAllergenResearch(scope?: { enotaId: number; articleIds: number[] }) {
  // A concurrency cap alone does not limit fast 429 responses or tool/token usage.
  if (Date.now() < nextAttemptAt) return false;
  nextAttemptAt = Date.now() + 20_000;
  const token = randomUUID();
  const claimed = await pool.query<{ id: number; artikel_id: number; enota_id: number; attempts: number }>(`
    WITH candidate AS (
      SELECT id FROM pos_allergen_research_jobs
      WHERE ((status='pending' AND attempts < 3 AND available_at <= now())
        OR (status='working' AND lease_until < now()))
        AND ($2::int IS NULL OR (enota_id=$2 AND artikel_id=ANY($3::int[])))
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE pos_allergen_research_jobs j SET status='working',attempts=j.attempts+1,
      lease_token=$1,lease_until=now()+interval '3 minutes'
    FROM candidate c WHERE j.id=c.id RETURNING j.id,j.artikel_id,j.enota_id,j.attempts
  `, [token, scope?.enotaId ?? null, scope?.articleIds ?? null]);
  const job = claimed.rows[0];
  if (!job) { nextAttemptAt = 0; return false; }
  let expectedRevision: number | undefined;
  try {
    const [article] = await db.select().from(artikliTable).where(and(
      eq(artikliTable.id, job.artikel_id), eq(artikliTable.enotaId, job.enota_id),
    ));
    if (!article) throw new Error("Surovina ni več na voljo.");
    expectedRevision = article.alergeniRevision;
    const result = await researchIngredientAllergens(article.imeZaNabavo || article.ime);
    await db.transaction(async tx => {
      // Consistent lock order: job first, article second; both tenant-scoped.
      const owned = await tx.execute(
        // Using the pool outside this transaction would lose lock/lease safety.
        sql`SELECT id FROM pos_allergen_research_jobs
          WHERE id=${job.id} AND lease_token=${token}::uuid AND status='working' FOR UPDATE`,
      );
      if (!(owned as { rows: unknown[] }).rows.length) return;
      await tx.execute(sql`SELECT id FROM artikli WHERE id=${job.artikel_id}
        AND enota_id=${job.enota_id} FOR UPDATE`);
      const [fresh] = await tx.select().from(artikliTable).where(and(
        eq(artikliTable.id, job.artikel_id), eq(artikliTable.enotaId, job.enota_id),
      ));
      // A concurrent manual edit or actual verified declaration always wins.
      if (fresh && fresh.alergeniRevision === expectedRevision && fresh.ime === article.ime
        && fresh.imeZaNabavo === article.imeZaNabavo && fresh.nabavniArtikel && fresh.aktiven
        && fresh.alergeniStatus === "nepreverjeno") {
        const profile = mergeAutomaticAllergens(fresh, result);
        await tx.update(artikliTable).set({ ...profile, alergeniRevision: fresh.alergeniRevision + 1 })
          .where(and(eq(artikliTable.id, fresh.id), eq(artikliTable.enotaId, job.enota_id)));
        await razveljaviAlergeneNadrejenih(fresh.id, tx as unknown as typeof db, false);
      }
      await tx.execute(sql`UPDATE pos_allergen_research_jobs SET status='done',lease_until=NULL,
        lease_token=NULL,error=NULL WHERE id=${job.id} AND lease_token=${token}::uuid`);
    });
  } catch (error) {
    // Store only a generic operational error; upstream errors can contain credentials.
    const detail = error as { name?: string; message?: string; status?: number; headers?: Headers; cause?: { code?: string } };
    const retryHeaderSeconds = Number(typeof detail.headers?.get === "function" ? detail.headers.get("retry-after") : null);
    const retryDelay = detail.status === 429
      ? Math.max(75_000, Number.isFinite(retryHeaderSeconds) ? Math.min(600_000, retryHeaderSeconds * 1000) : 0)
      : 60_000;
    if (detail.status === 429) nextAttemptAt = Math.max(nextAttemptAt, Date.now() + retryDelay);
    const reason = typeof detail.message === "string" && /^(Spletno iskanje|Spletni odgovor|Spletni viri|Alergen nima|Neveljaven dokaz)/.test(detail.message)
      ? detail.message : error instanceof SyntaxError ? "Neveljaven JSON odgovora." : "Napaka spletnega klica ali zapisa.";
    logger.warn({
      jobId: job.id, artikelId: job.artikel_id, reason,
      httpStatus: typeof detail.status === "number" ? detail.status : undefined,
      sqlState: /^[A-Z0-9]{5}$/.test(detail.cause?.code ?? "") ? detail.cause!.code : undefined,
    }, "Automatic allergen research failed");
    const failedLease = await pool.query(`UPDATE pos_allergen_research_jobs SET status=$3,
      available_at=now()+($5::int * interval '1 millisecond'),
      lease_until=NULL,lease_token=NULL,error=$4 WHERE id=$1 AND lease_token=$2`,
    [job.id, token, job.attempts >= 3 ? "failed" : "pending", "Spletno iskanje alergenov ni uspelo.", retryDelay]);
    if (failedLease.rowCount && job.attempts >= 3 && expectedRevision !== undefined) {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM artikli WHERE id=${job.artikel_id} AND enota_id=${job.enota_id} FOR UPDATE`);
        const [a] = await tx.select().from(artikliTable).where(and(
          eq(artikliTable.id, job.artikel_id), eq(artikliTable.enotaId, job.enota_id),
        ));
        if (!a || a.alergeniRevision !== expectedRevision || a.alergeniStatus !== "nepreverjeno") return;
        const note = ["Samodejno spletno iskanje alergenov ni uspelo. Preverite deklaracijo; ni potrjeno brez alergenov.",
          a.alergeniOpombaVira ?? ""].join("\n").slice(0, 2000);
        const profile = normalizirajAlergenProfil({ ...a, alergeniOpombaVira: note });
        await tx.update(artikliTable).set({ ...profile, alergeniRevision: a.alergeniRevision + 1 })
          .where(and(eq(artikliTable.id, a.id), eq(artikliTable.enotaId, job.enota_id)));
      });
    }
  }
  return true;
}

export function startAllergenResearchRunner() {
  if (started) return;
  started = true;
  const tick = () => {
    if (running >= 2) return;
    running++;
    void runNextAllergenResearch().catch(() => {
      logger.error("Automatic allergen outbox is unavailable; check its schema migration.");
    }).finally(() => { running--; });
  };
  tick();
  setInterval(tick, 2000).unref();
}