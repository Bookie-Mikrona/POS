import { pool, type PoolClient } from "@workspace/db";
import { logger } from "./logger";

export const DEFAULT_REFUND_ALERT_SETTINGS = { overdueHours: 24, criticalHours: 72 };

export function refundAgeState(created: Date | string, settings: typeof DEFAULT_REFUND_ALERT_SETTINGS, now = Date.now()) {
  const ageHours = Math.max(0, (now - new Date(created).getTime()) / 3_600_000);
  return {
    ageHours,
    ageState: ageHours >= settings.criticalHours ? "critical" as const
      : ageHours >= settings.overdueHours ? "overdue" as const : "fresh" as const,
  };
}

export async function readRefundAlertSettings(companyId: string) {
  const result = await pool.query(
    `SELECT overdue_hours AS "overdueHours", critical_hours AS "criticalHours"
     FROM viva_refund_alert_settings WHERE company_id = $1`, [companyId],
  );
  return (result.rows[0] ?? DEFAULT_REFUND_ALERT_SETTINGS) as typeof DEFAULT_REFUND_ALERT_SETTINGS;
}

/** Persistent unique keys are the notification outbox, not process-local state. */
export async function scanUnknownRefundAlerts(now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await scanUnknownRefundAlertsInTransaction(client, now);
    await client.query("COMMIT");
    return created;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Caller owns the transaction; also permits isolated, rollback-only SQL tests. */
export async function scanUnknownRefundAlertsInTransaction(client: PoolClient, now: Date) {
    // Serialize workers without holding a session lock or occupying the pool.
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(7265309) AS locked");
    if (!lock.rows[0].locked) return 0;
    const result = await client.query(`
      WITH candidates AS MATERIALIZED (
        SELECT v.id, v.ustvarjeno,
          COALESCE(s.overdue_hours, 24) AS overdue_hours,
          COALESCE(s.critical_hours, 72) AS critical_hours
        FROM viva_vracila v
        JOIN enote e ON e.id = v.enota_id
        LEFT JOIN viva_refund_alert_settings s ON s.company_id = e.company_id
        WHERE v.status IN ('unknown', 'awaiting_approval')
          AND v.ustvarjeno <= $1::timestamptz - COALESCE(s.overdue_hours, 24) * interval '1 hour'
          AND (
            NOT EXISTS (SELECT 1 FROM viva_refund_alerts a WHERE a.refund_id = v.id AND a.threshold = 'overdue')
            OR (
              v.ustvarjeno <= $1::timestamptz - COALESCE(s.critical_hours, 72) * interval '1 hour'
              AND NOT EXISTS (SELECT 1 FROM viva_refund_alerts a WHERE a.refund_id = v.id AND a.threshold = 'critical')
            )
          )
        ORDER BY v.ustvarjeno, v.id
        LIMIT 500
        FOR UPDATE OF v SKIP LOCKED
      )
      INSERT INTO viva_refund_alerts(refund_id, threshold, threshold_hours, created_at)
      SELECT c.id, t.threshold, t.hours, $1
      FROM candidates c
      CROSS JOIN LATERAL (VALUES ('overdue', c.overdue_hours), ('critical', c.critical_hours)) t(threshold, hours)
      WHERE c.ustvarjeno <= $1::timestamptz - t.hours * interval '1 hour'
      ON CONFLICT (refund_id, threshold) DO NOTHING
      RETURNING id
    `, [now]);
    return result.rowCount ?? 0;
}

let started = false;
export function startUnknownRefundAlertScheduler() {
  if (started) return;
  started = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const created = await scanUnknownRefundAlerts();
      if (created) logger.warn({ created }, "Nejasna Viva vračila: ustvarjena starostna opozorila za administratorje");
    } catch (err) {
      logger.error({ err }, "Pregled nejasnih Viva vračil ni uspel; ponovni poskus čez pet minut");
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), 5 * 60_000).unref();
}
