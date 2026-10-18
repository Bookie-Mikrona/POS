import { db, pool, reportExportsTable, type PoolClient } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export const REPORT_EXPORT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const REPORT_EXPORT_CLEANUP_BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 100;
// Dedicated namespace; all replicas must use the same lock.
const CLEANUP_LOCK = 724111;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseReportExportRetentionDays(raw: string | undefined): number {
  if (raw === undefined) return 365;
  const days = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(days) || days > 36500) {
    throw new Error("REPORT_EXPORT_RETENTION_DAYS must be an integer between 1 and 36500");
  }
  return days;
}

export const REPORT_EXPORT_RETENTION_DAYS = parseReportExportRetentionDays(
  process.env.REPORT_EXPORT_RETENTION_DAYS,
);

// Decimal MB, independently budgeted for each company, not for the whole server.
export function parseReportExportQuotaMb(raw: string | undefined): number {
  if (raw === undefined) return 500;
  const mb = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(mb) || mb > 1000000) {
    throw new Error("REPORT_EXPORT_QUOTA_MB must be an integer between 1 and 1000000");
  }
  return mb;
}

export function parseReportExportCompanyQuotas(raw: string | undefined): Map<string, number> {
  if (raw === undefined) return new Map();
  const entries: unknown = JSON.parse(raw);
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw new Error("REPORT_EXPORT_QUOTA_MB_BY_COMPANY must be a JSON object of company UUIDs to MB");
  }
  return new Map(Object.entries(entries).map(([id, mb]) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      || typeof mb !== "number") {
      throw new Error("REPORT_EXPORT_QUOTA_MB_BY_COMPANY must contain company UUIDs and integer MB values");
    }
    return [id.toLowerCase(), parseReportExportQuotaMb(String(mb)) * 1000000];
  }));
}

const defaultQuotaBytes = parseReportExportQuotaMb(process.env.REPORT_EXPORT_QUOTA_MB) * 1000000;
const companyQuotas = parseReportExportCompanyQuotas(process.env.REPORT_EXPORT_QUOTA_MB_BY_COMPANY);

export function reportExportQuotaBytes(companyId: string): number {
  return companyQuotas.get(companyId.toLowerCase()) ?? defaultQuotaBytes;
}

export class ReportExportTooLargeError extends Error {
  constructor(quotaBytes: number) {
    super(`PDF presega kvoto zgodovine izvozov (${quotaBytes / 1000000} MB). Izvoz ni bil shranjen ali poslan. Obstoječe kopije ostanejo nespremenjene.`);
  }
}

export function assertReportExportFitsQuota(companyId: string, bytes: number): void {
  const quota = reportExportQuotaBytes(companyId);
  if (bytes > quota) throw new ReportExportTooLargeError(quota);
}

/**
 * One transaction/connection: the tenant lock serializes replicas before measuring
 * bytes, pruning the oldest prefix and inserting. Failed inserts roll pruning back.
 * Use actual bytea lengths, including legacy copies; no byte-size backfill needed.
 */
export async function saveReportExport(values: typeof reportExportsTable.$inferInsert): Promise<void> {
  assertReportExportFitsQuota(values.companyId, values.pdfData.length);
  const availableBytes = reportExportQuotaBytes(values.companyId) - values.pdfData.length;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(724112, hashtext(${values.companyId.toLowerCase()}))`);
    await tx.execute(sql`DELETE FROM report_exports
      WHERE company_id = ${values.companyId} AND exported_at < ${reportExportCutoff()}`);
    // Newest-first running total: remove an oldest prefix, including the first
    // whole PDF that crosses the budget. Stable ID ordering breaks timestamp ties.
    await tx.execute(sql`WITH ranked AS (
      SELECT id, SUM(octet_length(pdf_data)) OVER (
        ORDER BY exported_at DESC, id DESC ROWS UNBOUNDED PRECEDING
      ) AS retained_bytes
      FROM report_exports WHERE company_id = ${values.companyId}
    )
    DELETE FROM report_exports WHERE company_id = ${values.companyId}
      AND id IN (SELECT id FROM ranked WHERE retained_bytes > ${availableBytes})`);
    await tx.insert(reportExportsTable).values(values);
  });
}

export function reportExportCutoff(now = new Date()): Date {
  return new Date(now.getTime() - REPORT_EXPORT_RETENTION_DAYS * DAY_MS);
}

/** Delete only disposable report copies, never accounting source records. */
export async function deleteExpiredReportExportBatch(
  client: Pick<PoolClient, "query">,
  cutoff: Date,
): Promise<number> {
  const result = await client.query(`
    DELETE FROM report_exports
    WHERE id IN (
      SELECT id FROM report_exports
      WHERE exported_at < $1
      ORDER BY exported_at, id
      LIMIT $2
    )
  `, [cutoff, REPORT_EXPORT_CLEANUP_BATCH_SIZE]);
  return result.rowCount ?? 0;
}

export async function cleanupExpiredReportExports(now = new Date()): Promise<number> {
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [CLEANUP_LOCK]);
    locked = result.rows[0]?.locked === true;
    if (!locked) return 0;
    const cutoff = reportExportCutoff(now);
    let deleted = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const count = await deleteExpiredReportExportBatch(client, cutoff);
      deleted += count;
      if (count < REPORT_EXPORT_CLEANUP_BATCH_SIZE) break;
    }
    logger.info({ deleted, cutoff, retentionDays: REPORT_EXPORT_RETENTION_DAYS },
      "Zgodovina izvozov: čiščenje zaključeno");
    return deleted;
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [CLEANUP_LOCK]);
    } catch (err) {
      // Never return a connection with a held session lock to the pool.
      releaseError = err instanceof Error ? err : new Error(String(err));
      throw err;
    } finally {
      client.release(releaseError);
    }
  }
}

let started = false;
let running = false;

export function startReportExportRetentionScheduler(): void {
  if (started) return;
  started = true;
  logger.info({ retentionDays: REPORT_EXPORT_RETENTION_DAYS },
    "Zgodovina izvozov: urno čiščenje nastavljeno");
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupExpiredReportExports();
    } catch (err) {
      logger.error({ err }, "Zgodovina izvozov: čiščenje ni uspelo; ponovni poskus čez eno uro");
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => { void run(); }, REPORT_EXPORT_CLEANUP_INTERVAL_MS).unref();
}
