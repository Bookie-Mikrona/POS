import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverStripeSyncNotification, sendStripeSyncOperationalNotification } from "./stripeSyncNotifications";
import { sharedStripeSyncMonitorStore } from "./stripeSyncFailureMonitor";

const smtp = vi.hoisted(() => {
  const sendMail = vi.fn();
  const close = vi.fn();
  return { sendMail, close, createTransport: vi.fn(() => ({ sendMail, close })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.createTransport } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SYNC_ALERT_EMAIL", "operator@example.test");
  vi.stubEnv("SMTP_HOST", "smtp.example.test");
  vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_USER", "test-user");
  vi.stubEnv("SMTP_PASSWORD", "test-password");
  vi.stubEnv("SMTP_FROM", "sender@example.test");
  smtp.sendMail.mockResolvedValue({ accepted: ["operator@example.test"], rejected: [] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Admin test of the shared Stripe SMTP transport", () => {
  it("marks tests clearly without updating the shared monitor or invoking fallback", async () => {
    const update = vi.spyOn(sharedStripeSyncMonitorStore, "update");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("STRIPE_SYNC_ALERT_FALLBACK_URL", "https://fallback.example.test");
    expect(await sendStripeSyncOperationalNotification({ type: "test" })).toEqual({ success: true, code: "sent" });
    expect(smtp.sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      subject: expect.stringContaining("[TEST]"), text: expect.stringContaining("TESTNO"),
    }));
    expect(update).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      requireTLS: true, secure: false, tls: { rejectUnauthorized: true },
    }));
  });

  it("uses the same transport for real incidents and recoveries", async () => {
    await sendStripeSyncOperationalNotification({ type: "test" });
    for (const status of ["open", "resolved"] as const) {
      await deliverStripeSyncNotification({ status, firstDetectedAt: "2026-10-18T10:00:00.000Z", failureCount: 3 });
    }
    expect(smtp.createTransport).toHaveBeenCalledTimes(3);
    expect(smtp.createTransport.mock.calls[1]).toEqual(smtp.createTransport.mock.calls[0]);
    expect(smtp.sendMail.mock.calls[1][0].subject).toContain("open");
    expect(smtp.sendMail.mock.calls[2][0].subject).toContain("resolved");
    expect(smtp.close).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["STRIPE_SYNC_ALERT_EMAIL", "", "recipient_missing"],
    ["STRIPE_SYNC_ALERT_EMAIL", "invalid", "recipient_invalid"],
    ["SMTP_HOST", "", "smtp_unconfigured"],
    ["SMTP_FROM", "", "smtp_unconfigured"],
    ["SMTP_PASSWORD", "", "smtp_unconfigured"],
    ["SMTP_PORT", "invalid", "smtp_unconfigured"],
  ])("returns only a safe reason for %s", async (key, value, code) => {
    vi.stubEnv(key, value);
    expect(await sendStripeSyncOperationalNotification({ type: "test" })).toEqual({ success: false, code });
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("sanitizes delivery errors and leaves shared state alone on failure too", async () => {
    const update = vi.spyOn(sharedStripeSyncMonitorStore, "update");
    smtp.sendMail.mockRejectedValue(new Error("operator@example.test test-password"));
    expect(await sendStripeSyncOperationalNotification({ type: "test" })).toEqual({ success: false, code: "delivery_failed" });
    expect(smtp.close).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not claim success for an unaccepted recipient", async () => {
    smtp.sendMail.mockResolvedValue({ accepted: [], rejected: ["operator@example.test"] });
    expect(await sendStripeSyncOperationalNotification({ type: "test" })).toEqual({ success: false, code: "delivery_failed" });
  });

  it("also requires valid certificates on the implicit TLS port", async () => {
    vi.stubEnv("SMTP_PORT", "465");
    await sendStripeSyncOperationalNotification({ type: "test" });
    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      secure: true, requireTLS: true, tls: { rejectUnauthorized: true },
    }));
  });
});
