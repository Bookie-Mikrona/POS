import nodemailer from "nodemailer";
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
  const to = process.env.STRIPE_SYNC_ALERT_EMAIL?.trim();
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!to || !host || !from) throw new Error("Operational SMTP is not configured");
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD,
    } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 5_000,
    tls: { rejectUnauthorized: true },
  });
  try {
    const result = await transport.sendMail({
      from, to,
      subject: `Stripe synchronization: ${notification.status}`,
      text: JSON.stringify(notification),
    });
    if (!result.accepted?.length || result.rejected?.length) {
      throw new Error("Operational SMTP did not accept all recipients");
    }
  } finally {
    transport.close();
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
