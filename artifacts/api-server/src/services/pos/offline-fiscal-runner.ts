import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { readAll, toResponse } from "../../routes/pos/nastavitve";
import { claimAndSubmitOfflineReceipt } from "./offline-fiscal-worker";

const BATCH_SIZE = 10;
const POLL_INTERVAL_MS = 15_000;

type DueReceipt = { id: string; enota_id: number; company_id: string };

/**
 * Select a bounded due set. SKIP LOCKED coordinates scheduler processes while
 * claimAndSubmit performs the authoritative lease CAS. Backoff tops out at
 * 16 minutes and is derived only from durable attempts.
 */
export async function runOfflineFiscalOnce(options: {
  throwOnError?: boolean;
  fursModeOverride?: "testno" | "produkcija";
  hooks?: Parameters<typeof claimAndSubmitOfflineReceipt>[0]["hooks"];
} = {}): Promise<number> {
  if (process.env.OFFLINE_FISCAL_PRODUCTION_ENABLED !== "true") return 0;
  const candidates = await db.transaction(async tx => {
    const result = await tx.execute(sql`
      SELECT r.id, r.enota_id, e.company_id
       FROM offline_fiscal_receipts r
      JOIN enote e ON e.id = r.enota_id
       JOIN nastavitve offline_setting
         ON offline_setting.enota_id = r.enota_id
        AND offline_setting.kljuc = 'offlineFiscalEnabled'
        AND offline_setting.vrednost = 'true'
       LEFT JOIN racuni linked_racun ON linked_racun.id = r.racun_id
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS attempt_count, max(created_at) AS last_attempt_at
        FROM offline_furs_transport_attempts a
        WHERE a.offline_receipt_id = r.id
      ) attempts ON true
      WHERE r.production_enabled = true
        AND (
          (
            r.furs_state = 'pending'
            AND (
              attempts.last_attempt_at IS NULL
              OR attempts.last_attempt_at <= now() -
                make_interval(secs => LEAST(960, 15 * power(2, LEAST(attempts.attempt_count, 6)))::integer)
            )
          )
          OR (r.furs_state = 'sending' AND r.claim_lease_until < now())
           OR (
             r.furs_state = 'confirmed'
             AND linked_racun.business_finalized_at IS NULL
             AND (r.claim_token IS NULL OR r.claim_lease_until < now())
             AND (r.finalization_next_attempt_at IS NULL OR r.finalization_next_attempt_at <= now())
           )
        )
      ORDER BY r.submission_deadline_at, r.id
      FOR UPDATE OF r SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    `);
    return result.rows as DueReceipt[];
  });

  for (const candidate of candidates) {
    try {
      const settings = options.fursModeOverride
        ? { fursNacin: options.fursModeOverride, fursProxyUrl: "" }
        : toResponse(await readAll("", candidate.enota_id));
      if (settings.fursNacin === "simulacija") continue;
      await claimAndSubmitOfflineReceipt({
        receiptId: candidate.id, enotaId: candidate.enota_id, companyId: candidate.company_id,
        actor: "offline-fiscal-runner", fursMode: settings.fursNacin,
        proxyUrl: settings.fursProxyUrl || undefined,
         hooks: options.hooks,
      });
    } catch (error) {
      logger.error({ err: error, receiptId: candidate.id }, "Offline FURS runner attempt failed");
      if (options.throwOnError) throw error;
    }
  }
  return candidates.length;
}

/** Start once after HTTP startup and then poll. Feature is default-off. */
export function startOfflineFiscalRunner(): void {
  if (process.env.OFFLINE_FISCAL_PRODUCTION_ENABLED !== "true") {
    logger.info("Offline FURS runner disabled");
    return;
  }
  void runOfflineFiscalOnce();
  const timer = setInterval(() => { void runOfflineFiscalOnce(); }, POLL_INTERVAL_MS);
  timer.unref();
  logger.info({ pollIntervalMs: POLL_INTERVAL_MS, batchSize: BATCH_SIZE }, "Offline FURS runner started");
}