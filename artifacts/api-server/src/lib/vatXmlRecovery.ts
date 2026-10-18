import { pool, type PoolClient } from "@workspace/db";
import { logger } from "./logger";
import { saveVatXmlArchive, type VatXmlArchive } from "./vatXmlStorage";

export const VAT_XML_RECOVERY_BATCH_SIZE = 25;
export const VAT_XML_RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
const RECOVERY_LOCK = 724112;

/** Caller holds the recovery lock on this connection. Never remove inline XML. */
export async function recoverVatXmlBatch(
  client: Pick<PoolClient, "query">,
  afterId: string | null = null,
  limit = VAT_XML_RECOVERY_BATCH_SIZE,
): Promise<{ attempted: number; restored: number; lastId: string | null }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > VAT_XML_RECOVERY_BATCH_SIZE) {
    throw new Error("Invalid VAT XML recovery batch size");
  }
  const { rows } = await client.query<VatXmlArchive>(`
    SELECT id, company_id AS "companyId", period_year AS "periodYear",
           period, xml_inline AS "xmlInline"
    FROM vat_submissions
    WHERE xml_inline IS NOT NULL AND xml_inline <> ''
      AND (xml_storage_path IS NULL OR xml_storage_path = '')
      AND ($1::uuid IS NULL OR id > $1::uuid)
    ORDER BY id
    LIMIT $2
  `, [afterId, limit]);
  let restored = 0;
  for (const submission of rows) {
    try {
      const path = await saveVatXmlArchive(submission);
      const result = await client.query(`
        UPDATE vat_submissions SET xml_storage_path = $1
        WHERE id = $2 AND company_id = $3 AND xml_inline = $4
          AND (xml_storage_path IS NULL OR xml_storage_path = '')
      `, [path, submission.id, submission.companyId, submission.xmlInline]);
      restored += result.rowCount ?? 0;
    } catch (error) {
      // Do not log XML or provider error messages (which can contain payloads).
      logger.warn({
        event: "vat_xml_recovery_failed",
        submissionId: submission.id,
        companyId: submission.companyId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      }, "DDV XML archive recovery will retry in a later batch");
    }
  }
  return { attempted: rows.length, restored, lastId: rows.at(-1)?.id ?? null };
}

let running = false;
let cursor: string | null = null;

export async function runVatXmlRecovery(): Promise<void> {
  if (running) return;
  running = true;
  let client: PoolClient | undefined;
  let locked = false;
  let discard = false;
  try {
    client = await pool.connect();
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked", [RECOVERY_LOCK],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) return;
    const batch = await recoverVatXmlBatch(client, cursor);
    // Rotate past failures so one bad archive cannot starve later submissions.
    cursor = batch.lastId;
    if (batch.attempted) {
      logger.info({ event: "vat_xml_recovery_batch", ...batch }, "DDV XML recovery batch finished");
    }
  } catch (error) {
    logger.error({
      event: "vat_xml_recovery_run_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    }, "DDV XML recovery run failed; next scheduled run will retry");
  } finally {
    if (client && locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [RECOVERY_LOCK]);
      } catch {
        discard = true; // Never return a connection with an uncertain lock to the pool.
      }
    }
    client?.release(discard);
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startVatXmlRecoveryScheduler(): void {
  if (timer) return;
  void runVatXmlRecovery();
  timer = setInterval(() => { void runVatXmlRecovery(); }, VAT_XML_RECOVERY_INTERVAL_MS);
  timer.unref();
}
