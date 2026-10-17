import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { db, erpSmtpSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";

// Domain-separated key, using the existing durable application secret.
function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Ključ za zaščito SMTP gesla ni nastavljen.");
  return scryptSync(secret, "bookie-erp-smtp-v1", 32);
}

export function encryptSmtpPassword(password: string, companyId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(companyId));
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64")).join(":");
}

export function decryptSmtpPassword(value: string, companyId: string) {
  const parts = value.split(":").map(p => Buffer.from(p, "base64"));
  if (parts.length !== 3 || parts[0]!.length !== 12 || parts[1]!.length !== 16) {
    throw new Error("Neveljaven zaščiten zapis SMTP gesla.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), parts[0]!);
  decipher.setAAD(Buffer.from(companyId));
  decipher.setAuthTag(parts[1]!);
  return Buffer.concat([decipher.update(parts[2]!), decipher.final()]).toString("utf8");
}

export async function getSmtpRow(companyId: string) {
  const [row] = await db.select().from(erpSmtpSettingsTable)
    .where(eq(erpSmtpSettingsTable.companyId, companyId)).limit(1);
  return row;
}

export async function getErpSmtp(companyId: string) {
  const row = await getSmtpRow(companyId);
  if (!row) return null;
  return { host: row.host, port: row.port, user: row.user, from: row.from,
    password: decryptSmtpPassword(row.passwordEncrypted, companyId) };
}

export function createErpTransport(smtp: NonNullable<Awaited<ReturnType<typeof getErpSmtp>>>) {
  return nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    requireTLS: true,
    auth: { user: smtp.user, pass: smtp.password },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
}
