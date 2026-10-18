import { afterEach, describe, expect, it, vi } from "vitest";
import { StripeSyncFailureMonitor, SharedStripeSyncFailureMonitor, type StripeSyncMonitorStore, type StripeSyncNotification } from "./stripeSyncFailureMonitor";
import { deliverStripeSyncNotification } from "./stripeSyncNotifications";

vi.mock("./logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
afterEach(() => vi.unstubAllEnvs());

describe("Stripe sync operational monitor", () => {
  it("alerts on the threshold and applies a cooldown", () => {
    const monitor = new StripeSyncFailureMonitor(3, 60_000, 15_000);
    expect(monitor.recordFailure(1_000)).toBeNull();
    expect(monitor.recordFailure(2_000)).toBeNull();
    expect(monitor.recordFailure(3_000)).toEqual({ type: "alert", failureCount: 3, windowMs: 2_000, firstDetectedAt: new Date(1_000).toISOString() });
    expect(monitor.recordFailure(4_000)).toBeNull();
    expect(monitor.recordFailure(18_000)).toEqual({ type: "alert", failureCount: 5, windowMs: 17_000, firstDetectedAt: new Date(1_000).toISOString() });
  });

  it("reports recovery and resets the counter", () => {
    const monitor = new StripeSyncFailureMonitor(3, 60_000, 15_000);
    monitor.recordFailure(1_000);
    monitor.recordFailure(2_000);
    monitor.recordFailure(3_000);
    expect(monitor.recordSuccess(5_000)).toEqual({ type: "recovery", failureCount: 3, outageDurationMs: 4_000, firstDetectedAt: new Date(1_000).toISOString() });
    expect(monitor.recordFailure(6_000)).toBeNull();
  });

  it("does not alert for isolated or expired failures", () => {
    const monitor = new StripeSyncFailureMonitor(3, 5_000, 15_000);
    expect(monitor.recordFailure(1_000)).toBeNull();
    expect(monitor.recordSuccess(2_000)).toBeNull();
    expect(monitor.recordFailure(7_001)).toBeNull();
    expect(monitor.recordFailure(8_000)).toBeNull();
    expect(monitor.recordFailure(9_000)).toEqual({ type: "alert", failureCount: 3, windowMs: 1_999, firstDetectedAt: new Date(7_001).toISOString() });
  });

  it("keeps the same incident and cooldown after the threshold window expires", () => {
    const monitor = new StripeSyncFailureMonitor(3, 5_000, 15_000);
    monitor.recordFailure(1_000);
    monitor.recordFailure(2_000);
    monitor.recordFailure(3_000);
    expect(monitor.recordFailure(8_000)).toBeNull();
    expect(monitor.recordFailure(18_000)).toMatchObject({
      failureCount: 5, firstDetectedAt: new Date(1_000).toISOString(),
    });
  });
});

describe("Stripe sync channel failover", () => {
  const notification = {
    status: "open" as const, firstDetectedAt: "2026-10-18T10:00:00.000Z", failureCount: 3,
  };

  it("does not use the fallback after primary success", async () => {
    const primary = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn();
    await deliverStripeSyncNotification(notification, primary, fallback);
    expect(primary).toHaveBeenCalledExactlyOnceWith(notification);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("sends only the notification to fallback after SMTP failure", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("secret Stripe details"));
    const fallback = vi.fn().mockResolvedValue(undefined);
    await deliverStripeSyncNotification(notification, primary, fallback);
    expect(fallback).toHaveBeenCalledExactlyOnceWith(notification);
  });

  it("contains failures of both channels", async () => {
    await expect(deliverStripeSyncNotification(notification,
      vi.fn().mockRejectedValue(new Error("smtp")),
      vi.fn().mockRejectedValue(new Error("fallback")),
    )).resolves.toBeUndefined();
  });

  it("allows the fallback to remain unconfigured", async () => {
    vi.stubEnv("STRIPE_SYNC_ALERT_FALLBACK_URL", "");
    await expect(deliverStripeSyncNotification(notification,
      vi.fn().mockRejectedValue(new Error("smtp")),
    )).resolves.toBeUndefined();
  });

  it("only delivers the shared claim across monitor instances, including failed delivery", async () => {
    const state = new StripeSyncFailureMonitor();
    let now = 1_000;
    const store: StripeSyncMonitorStore = {
      update: async op => op === "failure" ? state.recordFailure(now++) : state.recordSuccess(now++),
    };
    const primary = vi.fn().mockRejectedValue(new Error("smtp"));
    const fallback = vi.fn().mockRejectedValue(new Error("fallback"));
    const deliver = (n: StripeSyncNotification) => deliverStripeSyncNotification(n, primary, fallback);
    const a = new SharedStripeSyncFailureMonitor(store, deliver);
    const b = new SharedStripeSyncFailureMonitor(store, deliver);
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).recordFailure()));
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0][0]).toEqual({
      status: "open", failureCount: 3, firstDetectedAt: new Date(1_000).toISOString(),
    });
    await b.recordSuccess();
    expect(fallback).toHaveBeenLastCalledWith({
      status: "resolved", failureCount: 12, firstDetectedAt: new Date(1_000).toISOString(),
    });
  });

  it("contains shared store failures without attempting either channel", async () => {
    const deliver = vi.fn();
    const monitor = new SharedStripeSyncFailureMonitor({
      update: vi.fn().mockRejectedValue(new Error("db")),
    }, deliver);
    await expect(monitor.recordFailure()).resolves.toBeUndefined();
    await expect(monitor.recordSuccess()).resolves.toBeUndefined();
    expect(deliver).not.toHaveBeenCalled();
  });
});