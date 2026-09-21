import { pool } from "@workspace/db";
import { logger } from "./logger";

/** Gost lahko z izrecnim opt-inom poveže svojo QR zgodovino največ 30 dni. */
export const QR_GUEST_HISTORY_RETENTION_DAYS = 30;
export const QR_GUEST_HISTORY_RETENTION_MS =
  QR_GUEST_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const QR_GUEST_HISTORY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function qrGuestHistoryCutoff(now = new Date()): Date {
  return new Date(now.getTime() - QR_GUEST_HISTORY_RETENTION_MS);
}

/**
 * Odstrani samo povezovalni psevdonim s starih terminalnih QR naročil.
 * Naročila, postavke, aktivacijske seje in idempotency zapisi ostanejo.
 */
export async function anonymizeExpiredQrOrderDeviceLinks(now = new Date()): Promise<number> {
  const result = await pool.query(`
    UPDATE narocila
    SET qr_naprava_id = NULL
    WHERE vir = 'qr_gost'
      AND status IN ('zakljuceno', 'preklicano')
      AND qr_naprava_id IS NOT NULL
      AND posodobljeno <= $1
  `, [qrGuestHistoryCutoff(now)]);

  return result.rowCount ?? 0;
}

async function runCleanup(): Promise<void> {
  try {
    const count = await anonymizeExpiredQrOrderDeviceLinks();
    logger.info({ count }, "QR zgodovina: stari psevdonimi anonimizirani");
  } catch (err) {
    logger.error({ err }, "QR zgodovina: napaka pri anonimizaciji psevdonimov");
  }
}

/**
 * Zaženi ob zagonu API-ja in nato vsako uro. SQL cutoff onemogoči dostop takoj
 * po 30 dneh, fizična anonimizacija pa ob zdravem procesu sledi najpozneje v uri.
 */
export function startQrHistoryRetentionScheduler(): void {
  logger.info(
    { retentionDays: QR_GUEST_HISTORY_RETENTION_DAYS },
    "QR zgodovina: urnik anonimizacije nastavljen",
  );
  void runCleanup();
  const timer = setInterval(() => { void runCleanup(); }, QR_GUEST_HISTORY_CLEANUP_INTERVAL_MS);
  timer.unref();
}