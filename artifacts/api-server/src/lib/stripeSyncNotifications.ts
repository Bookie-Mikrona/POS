import nodemailer from "nodemailer";
import { z } from "zod";
import { logger } from "./logger";
import type { StripeSyncNotification } from "./stripeSyncFailureMonitor";

type Channel = (notification: StripeSyncNotification) => Promise<void>;

export async function deliverStripeSyncNotification(
  notification: StripeSyncNotification,
  primary: Channel = sendEmail,
  fallback: Channel | undefined = process.env.STRIPE_SYNC_ALERT_FALLBACK_URL?.trim()
    ? sendFallbackWebhook : undefined,
): Promise<void> {
  const payload: StripeSyncNotification = {
    status: notification.status,
    firstDetectedAt: notification.firstDetectedAt,
    failureCount: notification.failureCount,
  };
  try {
    await primary(payload);
    return;
  } catch {
    // Transport errors may include credentials, recipient details or response bodies.
    logger.error({ reason: "stripe_sync_notification_failed", channel: "smtp" }, "Stripe operational notification delivery failed");
  }
  if (!fallback) return;
  try {
    await fallback(payload);
  } catch {
    logger.error({ reason: "stripe_sync_notification_failed", channel: "fallback" }, "Stripe operational notification delivery failed");
  }
}

async function sendEmail(notification: StripeSyncNotification): Promise<void> {
  const result = await sendStripeSyncOperationalNotification(notification);
  if (!result.success) throw new Error(result.code);
}

export type StripeSyncNotificationResult = {
  success: boolean;
  code: "sent" | "recipient_missing" | "recipient_invalid" | "smtp_unconfigured" | "delivery_failed";
};

/** Shared SMTP only. Tests never touch the monitor store, cooldown or fallback. */
export async function sendStripeSyncOperationalNotification(
  notification: StripeSyncNotification | { type: "test" },
): Promise<StripeSyncNotificationResult> {
  const to = process.env.STRIPE_SYNC_ALERT_EMAIL?.trim();
  if (!to) return { success: false, code: "recipient_missing" };
  if (!z.string().email().safeParse(to).success) return { success: false, code: "recipient_invalid" };
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  const port = Number(process.env.SMTP_PORT || 465);
  if (!host || !from || (user && !pass) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { success: false, code: "smtp_unconfigured" };
  }
  const test = "type" in notification && notification.type === "test";
  try {
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: true,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 5_000,
      tls: { rejectUnauthorized: true },
    });
    try {
      const result = await transport.sendMail({
        from, to,
        subject: test ? "[TEST] Stripe operativno obvestilo" : `Stripe synchronization: ${"status" in notification ? notification.status : "test"}`,
        text: test
          ? "To je TESTNO Stripe operativno obvestilo, sproženo iz administracije sistema. Ne pomeni dejanskega incidenta in ne spreminja stanja monitorja ali omejitve pogostosti opozoril."
          : JSON.stringify(notification),
      });
      if (!result.accepted?.length || result.rejected?.length) return { success: false, code: "delivery_failed" };
      return { success: true, code: "sent" };
    } finally {
      transport.close();
    }
  } catch {
    // SMTP errors may contain credentials and recipient addresses.
    return { success: false, code: "delivery_failed" };
  }
}

async function sendFallbackWebhook(notification: StripeSyncNotification): Promise<void> {
  const url = new URL(process.env.STRIPE_SYNC_ALERT_FALLBACK_URL!.trim());
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Operational fallback requires HTTPS without URL credentials");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: notification.status,
      firstDetectedAt: notification.firstDetectedAt,
      failureCount: notification.failureCount,
    }),
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
  });
  // Never consume or log the external response body.
  await response.body?.cancel();
  if (!response.ok) throw new Error("Operational fallback rejected notification");
}
