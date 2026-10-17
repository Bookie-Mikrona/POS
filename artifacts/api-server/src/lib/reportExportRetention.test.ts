import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { connect: mocks.connect } }));
vi.mock("./logger", () => ({ logger: { info: mocks.info, error: mocks.error } }));

import {
  cleanupExpiredReportExports,
  parseReportExportRetentionDays,
  REPORT_EXPORT_CLEANUP_BATCH_SIZE,
  REPORT_EXPORT_CLEANUP_INTERVAL_MS,
  REPORT_EXPORT_RETENTION_DAYS,
  reportExportCutoff,
  startReportExportRetentionScheduler,
} from "./reportExportRetention";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockImplementation(async (query: string) => ({
    rows: [{ locked: true }], rowCount: query.includes("DELETE") ? 0 : 1,
  }));
});
afterEach(() => { vi.useRealTimers(); });

describe("report export retention", () => {
  it("defaults to one year and accepts a configured positive number of days", () => {
    expect(parseReportExportRetentionDays(undefined)).toBe(365);
    expect(parseReportExportRetentionDays("30")).toBe(30);
    expect(parseReportExportRetentionDays("36500")).toBe(36500);
  });

  it.each(["", "0", "-1", "1.5", "NaN", "Infinity", " 30 ", "36501", "1e3"])(
    "rejects unsafe configuration %j rather than disabling cleanup", (value) => {
      expect(() => parseReportExportRetentionDays(value)).toThrow("REPORT_EXPORT_RETENTION_DAYS");
    },
  );

  it("computes a rolling cutoff without local timezone or leap-year shifts", () => {
    const now = new Date("2024-03-01T12:00:00Z");
    expect(now.getTime() - reportExportCutoff(now).getTime())
      .toBe(REPORT_EXPORT_RETENTION_DAYS * 86400000);
  });

  it("deletes in bounded batches with the same cutoff and releases the dedicated lock", async () => {
    let batch = 0;
    mocks.query.mockImplementation(async (query: string) => ({
      rows: [{ locked: true }],
      rowCount: query.includes("DELETE") ? (++batch === 1 ? REPORT_EXPORT_CLEANUP_BATCH_SIZE : 2) : 1,
    }));
    const now = new Date("2026-10-17T12:00:00Z");
    expect(await cleanupExpiredReportExports(now)).toBe(REPORT_EXPORT_CLEANUP_BATCH_SIZE + 2);
    const deletes = mocks.query.mock.calls.filter(([q]) => q.includes("DELETE"));
    expect(deletes).toHaveLength(2);
    expect(deletes[0][1]).toEqual([reportExportCutoff(now), REPORT_EXPORT_CLEANUP_BATCH_SIZE]);
    expect(deletes[1][1]).toEqual(deletes[0][1]);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("caps each run so a large backlog cannot monopolize the worker", async () => {
    mocks.query.mockResolvedValue({ rows: [{ locked: true }], rowCount: REPORT_EXPORT_CLEANUP_BATCH_SIZE });
    expect(await cleanupExpiredReportExports()).toBe(100 * REPORT_EXPORT_CLEANUP_BATCH_SIZE);
    expect(mocks.query.mock.calls.filter(([q]) => q.includes("DELETE"))).toHaveLength(100);
  });

  it("does not delete or unlock if another replica owns the lock", async () => {
    mocks.query.mockResolvedValue({ rows: [{ locked: false }] });
    expect(await cleanupExpiredReportExports()).toBe(0);
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("unlocks and releases even if deleting fails", async () => {
    mocks.query.mockImplementation(async (query: string) => {
      if (query.includes("DELETE")) throw new Error("delete failed");
      return { rows: [{ locked: true }] };
    });
    await expect(cleanupExpiredReportExports()).rejects.toThrow("delete failed");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("discards the connection if unlocking fails", async () => {
    const error = new Error("unlock failed");
    mocks.query.mockImplementation(async (query: string) => {
      if (query.includes("pg_advisory_unlock")) throw error;
      return { rows: [{ locked: true }], rowCount: 0 };
    });
    await expect(cleanupExpiredReportExports()).rejects.toThrow("unlock failed");
    expect(mocks.release).toHaveBeenCalledWith(error);
  });

  it("starts once, runs immediately, reports errors and retries hourly", async () => {
    vi.useFakeTimers();
    mocks.connect.mockRejectedValueOnce(new Error("database unavailable"));
    startReportExportRetentionScheduler();
    startReportExportRetentionScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(REPORT_EXPORT_CLEANUP_INTERVAL_MS);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    vi.clearAllTimers();
  });
});
