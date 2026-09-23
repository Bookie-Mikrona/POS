export type StripeSyncAlertEvent = {
  type: "alert";
  failureCount: number;
  windowMs: number;
};

export type StripeSyncRecoveryEvent = {
  type: "recovery";
  failureCount: number;
  outageDurationMs: number;
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
  ) {}

  recordFailure(now = Date.now()): StripeSyncAlertEvent | null {
    if (this.failureCount === 0 || now - this.firstFailureAt > this.windowMs) {
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
    };
  }

  recordSuccess(now = Date.now()): StripeSyncRecoveryEvent | null {
    const event = this.alerted
      ? {
          type: "recovery" as const,
          failureCount: this.failureCount,
          outageDurationMs: Math.max(0, now - this.firstFailureAt),
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

export const stripeSyncFailureMonitor = new StripeSyncFailureMonitor();