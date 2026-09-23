import { pool } from "@workspace/db";

const STRIPE_CONNECTION_ALERT_KEY = "stripe_connection_misconfigured";
let lastObservationMs = 0;

export type StripeConnectionAlert = {
  alertKey: typeof STRIPE_CONNECTION_ALERT_KEY;
  status: "open" | "resolved";
  firstDetectedAt: string;
  lastDetectedAt: string;
  occurrenceCount: number;
  resolvedAt: string | null;
};

export function nextStripeConnectionObservation(): Date {
  lastObservationMs = Math.max(Date.now(), lastObservationMs + 1);
  return new Date(lastObservationMs);
}

type Queryable = {
  query: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function mapAlert(row: Record<string, unknown>): StripeConnectionAlert {
  return {
    alertKey: STRIPE_CONNECTION_ALERT_KEY,
    status: row.status as "open" | "resolved",
    firstDetectedAt: new Date(row.first_detected_at as string | Date).toISOString(),
    lastDetectedAt: new Date(row.last_detected_at as string | Date).toISOString(),
    occurrenceCount: Number(row.occurrence_count),
    resolvedAt: row.resolved_at
      ? new Date(row.resolved_at as string | Date).toISOString()
      : null,
  };
}

export async function recordStripeConnectionMisconfigured(
  client: Queryable = pool,
  observedAt: Date = nextStripeConnectionObservation(),
): Promise<void> {
  await client.query(
    `INSERT INTO stripe_connection_alerts (
       alert_key, status, first_detected_at, last_detected_at,
       occurrence_count, last_observed_at, resolved_at, updated_at
     )
     VALUES ($1, 'open', $2, $2, 1, $2, NULL, now())
     ON CONFLICT (alert_key) DO UPDATE SET
       status = 'open',
       first_detected_at = CASE
         WHEN stripe_connection_alerts.status = 'resolved' THEN EXCLUDED.first_detected_at
         ELSE stripe_connection_alerts.first_detected_at
       END,
       last_detected_at = EXCLUDED.last_detected_at,
       occurrence_count = CASE
         WHEN stripe_connection_alerts.status = 'resolved' THEN 1
         ELSE stripe_connection_alerts.occurrence_count + 1
       END,
       last_observed_at = EXCLUDED.last_observed_at,
       resolved_at = NULL,
       updated_at = now()
     WHERE stripe_connection_alerts.last_observed_at <= EXCLUDED.last_observed_at`,
    [STRIPE_CONNECTION_ALERT_KEY, observedAt.toISOString()],
  );
}

export async function resolveStripeConnectionMisconfigured(
  client: Queryable = pool,
  observedAt: Date = nextStripeConnectionObservation(),
): Promise<void> {
  await client.query(
    `INSERT INTO stripe_connection_alerts (
       alert_key, status, first_detected_at, last_detected_at,
       occurrence_count, last_observed_at, resolved_at, updated_at
     )
     VALUES ($1, 'resolved', $2, $2, 0, $2, now(), now())
     ON CONFLICT (alert_key) DO UPDATE SET
       status = 'resolved',
       last_observed_at = EXCLUDED.last_observed_at,
       resolved_at = now(),
       updated_at = now()
     WHERE stripe_connection_alerts.last_observed_at <= EXCLUDED.last_observed_at`,
    [STRIPE_CONNECTION_ALERT_KEY, observedAt.toISOString()],
  );
}

export async function getStripeConnectionAlert(
  client: Queryable = pool,
): Promise<StripeConnectionAlert | null> {
  const result = await client.query(
    `SELECT status, first_detected_at, last_detected_at,
            occurrence_count, resolved_at
     FROM stripe_connection_alerts
     WHERE alert_key = $1 AND occurrence_count > 0`,
    [STRIPE_CONNECTION_ALERT_KEY],
  );
  return result.rows[0] ? mapAlert(result.rows[0]) : null;
}