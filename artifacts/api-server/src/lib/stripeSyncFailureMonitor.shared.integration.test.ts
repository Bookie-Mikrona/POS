import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { expect, it, vi } from "vitest";
import { createPostgresStripeSyncMonitorStore, SharedStripeSyncFailureMonitor } from "./stripeSyncFailureMonitor";
import { deliverStripeSyncNotification } from "./stripeSyncNotifications";

it("claims a single notification across concurrent replicas and a restarted monitor", async () => {
  // A private disposable settings key; never touch the live monitor's state.
  const key = `test_stripe_sync_monitor_${randomUUID()}`;
  const primary = vi.fn().mockRejectedValue(new Error("SMTP offline"));
  const fallback = vi.fn().mockResolvedValue(undefined);
  const deliver = (n: Parameters<typeof deliverStripeSyncNotification>[0]) =>
    deliverStripeSyncNotification(n, primary, fallback);
  const replica = () => new SharedStripeSyncFailureMonitor(createPostgresStripeSyncMonitorStore(key), deliver);
  try {
    const a = replica();
    const b = replica();
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).recordFailure()));
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0][0]).toEqual({
      status: "open", failureCount: 3, firstDetectedAt: expect.any(String),
    });
    await replica().recordFailure();
    expect(fallback).toHaveBeenCalledTimes(1);
    await replica().recordSuccess();
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(fallback.mock.calls[1][0]).toEqual({
      status: "resolved", failureCount: 13,
      firstDetectedAt: fallback.mock.calls[0][0].firstDetectedAt,
    });
  } finally {
    await pool.query("DELETE FROM system_settings WHERE key = $1", [key]);
  }
});
