import { describe, expect, it } from "vitest";
import { StripeSyncFailureMonitor } from "./stripeSyncFailureMonitor";

describe("Stripe sync operational monitor", () => {
  it("alerts on the threshold and applies a cooldown", () => {
    const monitor = new StripeSyncFailureMonitor(3, 60_000, 15_000);
    expect(monitor.recordFailure(1_000)).toBeNull();
    expect(monitor.recordFailure(2_000)).toBeNull();
    expect(monitor.recordFailure(3_000)).toEqual({ type: "alert", failureCount: 3, windowMs: 2_000 });
    expect(monitor.recordFailure(4_000)).toBeNull();
    expect(monitor.recordFailure(18_000)).toEqual({ type: "alert", failureCount: 5, windowMs: 17_000 });
  });

  it("reports recovery and resets the counter", () => {
    const monitor = new StripeSyncFailureMonitor(3, 60_000, 15_000);
    monitor.recordFailure(1_000);
    monitor.recordFailure(2_000);
    monitor.recordFailure(3_000);
    expect(monitor.recordSuccess(5_000)).toEqual({ type: "recovery", failureCount: 3, outageDurationMs: 4_000 });
    expect(monitor.recordFailure(6_000)).toBeNull();
  });

  it("does not alert for isolated or expired failures", () => {
    const monitor = new StripeSyncFailureMonitor(3, 5_000, 15_000);
    expect(monitor.recordFailure(1_000)).toBeNull();
    expect(monitor.recordSuccess(2_000)).toBeNull();
    expect(monitor.recordFailure(7_001)).toBeNull();
    expect(monitor.recordFailure(8_000)).toBeNull();
    expect(monitor.recordFailure(9_000)).toEqual({ type: "alert", failureCount: 3, windowMs: 1_999 });
  });
});