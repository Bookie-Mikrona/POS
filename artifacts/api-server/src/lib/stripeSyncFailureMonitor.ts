import { pool } from "@workspace/db";
import { logger } from "./logger";
import { deliverStripeSyncNotification } from "./stripeSyncNotifications";
export { sendStripeSyncOperationalNotification } from "./stripeSyncNotifications";
export type { StripeSyncNotificationResult } from "./stripeSyncNotifications";

export type StripeSyncAlertEvent = {
  type: "alert";
  failureCount: number;
  windowMs: number;
  firstDetectedAt: string;
};

export type StripeSyncRecoveryEvent = {
  type: "recovery";
  failureCount: number;
  outageDurationMs: number;
  firstDetectedAt: string;
};

type MonitorState = {
  failureCount: number;
  firstFailureAt: number;
  lastAlertAt: number;
  alerted: boolean;
};

export class StripeSyncFailureMonitor {
  private failureCount = 0;
  private firstFailureAt = 0;
  private lastAlertAt = 0;
  private alerted = false;

  constructor(
    private readonly threshold = 3,
    private readonly windowMs = 5 * 60_000,
    private readonly alertCooldownMs = 15 * 60_000,
    state?: MonitorState,
  ) {
    if (state) Object.assign(this, state);
  }

  snapshot(): MonitorState {
    return {
      failureCount: this.failureCount,
      firstFailureAt: this.firstFailureAt,
      lastAlertAt: this.lastAlertAt,
      alerted: this.alerted,
    };
  }

  recordFailure(now = Date.now()): StripeSyncAlertEvent | null {
    if (this.failureCount === 0 || (!this.alerted && now - this.firstFailureAt > this.windowMs)) {
      this.failureCount = 1;
      this.firstFailureAt = now;
      this.alerted = false;
      this.lastAlertAt = 0;
      return null;
    }
    this.failureCount += 1;
    const reachedThreshold = this.failureCount >= this.threshold;
    const cooldownElapsed =
      this.lastAlertAt === 0 || now - this.lastAlertAt >= this.alertCooldownMs;
    if (!reachedThreshold || !cooldownElapsed) return null;
    this.alerted = true;
    this.lastAlertAt = now;
    return {
      type: "alert",
      failureCount: this.failureCount,
      windowMs: now - this.firstFailureAt,
      firstDetectedAt: new Date(this.firstFailureAt).toISOString(),
    };
  }

  recordSuccess(now = Date.now()): StripeSyncRecoveryEvent | null {
    const event = this.alerted
      ? {
          type: "recovery" as const,
          failureCount: this.failureCount,
          outageDurationMs: Math.max(0, now - this.firstFailureAt),
          firstDetectedAt: new Date(this.firstFailureAt).toISOString(),
        }
      : null;
    this.reset();
    return event;
  }

  reset() {
    this.failureCount = 0;
    this.firstFailureAt = 0;
    this.lastAlertAt = 0;
    this.alerted = false;
  }
}

type MonitorEvent = StripeSyncAlertEvent | StripeSyncRecoveryEvent;
export type StripeSyncNotification = {
  status: "open" | "resolved";
  firstDetectedAt: string;
  failureCount: number;
};

export interface StripeSyncMonitorStore {
  update(operation: "failure" | "success"): Promise<MonitorEvent | null>;
}

// The row lock serializes every replica. The cooldown is claimed and committed
// before either channel is attempted; delivery failures cannot cause a storm.
export function createPostgresStripeSyncMonitorStore(
  key = "stripe_sync_failure_monitor",
): StripeSyncMonitorStore {
  return {
    async update(operation) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO system_settings (key, value)
           VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
          [key, JSON.stringify(new StripeSyncFailureMonitor().snapshot())],
        );
        const result = await client.query(
          `SELECT value, clock_timestamp() AS observed_at FROM system_settings
           WHERE key = $1 FOR UPDATE`,
          [key],
        );
        const monitor = new StripeSyncFailureMonitor(
          3, 5 * 60_000, 15 * 60_000, JSON.parse(result.rows[0].value),
        );
        const now = new Date(result.rows[0].observed_at).getTime();
        const event = operation === "failure" ? monitor.recordFailure(now) : monitor.recordSuccess(now);
        await client.query(
          `UPDATE system_settings SET value = $2, updated_at = now()
           WHERE key = $1`,
          [key, JSON.stringify(monitor.snapshot())],
        );
        await client.query("COMMIT");
        return event;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export const sharedStripeSyncMonitorStore = createPostgresStripeSyncMonitorStore();

export class SharedStripeSyncFailureMonitor {
  constructor(
    private readonly store: StripeSyncMonitorStore = sharedStripeSyncMonitorStore,
    private readonly deliver: (notification: StripeSyncNotification) => Promise<void> = deliverStripeSyncNotification,
  ) {}

  async recordFailure(): Promise<void> { await this.record("failure"); }
  async recordSuccess(): Promise<void> { await this.record("success"); }

  private async record(operation: "failure" | "success"): Promise<void> {
    try {
      const event = await this.store.update(operation);
      if (!event) return;
      logger[event.type === "alert" ? "warn" : "info"]({
        reason: event.type === "alert" ? "stripe_sync_repeated_failures" : "stripe_sync_recovered",
        failureCount: event.failureCount,
        firstDetectedAt: event.firstDetectedAt,
      }, "Stripe synchronization incident state changed");
      // Explicit allowlist: never forward Stripe objects, errors or request data.
      await this.deliver({
        status: event.type === "alert" ? "open" : "resolved",
        firstDetectedAt: event.firstDetectedAt,
        failureCount: event.failureCount,
      });
    } catch {
      logger.error({ reason: "stripe_sync_monitor_failed", operation }, "Stripe operational monitoring failed");
    }
  }
}

export const stripeSyncFailureMonitor = new SharedStripeSyncFailureMonitor();
