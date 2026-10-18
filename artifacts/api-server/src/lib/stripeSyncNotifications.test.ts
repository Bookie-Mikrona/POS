import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn(), error: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));
vi.mock("./logger", () => ({ logger: { error: mocks.error } }));
import { deliverStripeSyncNotification } from "./stripeSyncNotifications";

const notification = {
  status: "open" as const, firstDetectedAt: "2026-10-18T10:00:00.000Z", failureCount: 3,
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
  mocks.sendMail.mockResolvedValue({ accepted: ["ops@example.invalid"], rejected: [] });
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SMTP_HOST", "smtp.example.invalid");
  vi.stubEnv("SMTP_FROM", "bookie@example.invalid");
  vi.stubEnv("SMTP_PORT", "465");
  vi.stubEnv("STRIPE_SYNC_ALERT_EMAIL", "ops@example.invalid");
  vi.stubEnv("STRIPE_SYNC_ALERT_FALLBACK_URL", "https://ops.example.invalid/secret");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Stripe notification transports", () => {
  it("sends via SMTP with bounded timeouts without contacting fallback", async () => {
    await deliverStripeSyncNotification({ ...notification, sensitive: "Stripe payload" } as typeof notification);
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: "ops@example.invalid", text: JSON.stringify(notification),
    }));
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      secure: true, connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 5_000,
      tls: { rejectUnauthorized: true },
    }));
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["rejection", "no accepted recipients", "partial rejection", "missing SMTP"])(
    "uses a minimal HTTPS fallback on %s", async mode => {
      if (mode === "rejection") mocks.sendMail.mockRejectedValue(new Error("sensitive SMTP credentials"));
      if (mode === "no accepted recipients") mocks.sendMail.mockResolvedValue({ accepted: [] });
      if (mode === "partial rejection") mocks.sendMail.mockResolvedValue({ accepted: ["a"], rejected: ["b"] });
      if (mode === "missing SMTP") vi.stubEnv("SMTP_HOST", "");
      await deliverStripeSyncNotification({ ...notification, sensitive: "Stripe payload" } as typeof notification);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        new URL("https://ops.example.invalid/secret"),
        expect.objectContaining({
          method: "POST", redirect: "error", signal: expect.any(AbortSignal),
          body: JSON.stringify(notification),
        }),
      );
      expect(JSON.stringify(mocks.error.mock.calls)).not.toMatch(/credentials|Stripe payload|ops\.example/);
    },
  );

  it.each(["http://ops.example.invalid", "https://user:password@ops.example.invalid", "not a URL"])(
    "contains invalid fallback configuration: %s", async url => {
      vi.stubEnv("STRIPE_SYNC_ALERT_FALLBACK_URL", url);
      mocks.sendMail.mockRejectedValue(new Error("smtp"));
      await expect(deliverStripeSyncNotification(notification)).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mocks.error).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["network", "HTTP rejection", "timeout"])("contains fallback %s failure", async mode => {
    mocks.sendMail.mockRejectedValue(new Error("smtp"));
    if (mode === "HTTP rejection") fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    else fetchMock.mockRejectedValue(mode === "timeout"
      ? new DOMException("sensitive URL", "TimeoutError") : new Error("sensitive URL"));
    await expect(deliverStripeSyncNotification(notification)).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("sensitive");
  });
});
