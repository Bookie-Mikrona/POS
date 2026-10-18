import nodemailer from "nodemailer";

/** Global environment transport only. Never consult company or POS settings. */
export function getPlatformSmtpStatus() {
  const present = {
    host: Boolean(process.env.SMTP_HOST?.trim()),
    from: Boolean(process.env.SMTP_FROM?.trim()),
    user: Boolean(process.env.SMTP_USER?.trim()),
    password: Boolean(process.env.SMTP_PASSWORD),
  };
  const port = Number(process.env.SMTP_PORT || 465);
  const portValid = Number.isInteger(port) && port > 0 && port <= 65535;
  const missing = [
    ...(!present.host ? ["SMTP_HOST"] : []),
    ...(!present.from ? ["SMTP_FROM"] : []),
    ...(present.user !== present.password ? [present.user ? "SMTP_PASSWORD" : "SMTP_USER"] : []),
    ...(!portValid ? ["SMTP_PORT"] : []),
  ];
  return { configured: missing.length === 0, present, portValid, missing };
}

/** Same transport as platform operational notifications, with bounded timeouts. */
export function createPlatformSmtpTransport() {
  if (!getPlatformSmtpStatus().configured) throw new Error("Platform SMTP is not configured");
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(), port, secure: port === 465, requireTLS: true,
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD,
    } : undefined,
    connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 5_000,
    tls: { rejectUnauthorized: true },
  });
}
