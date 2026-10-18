import nodemailer from "nodemailer";
import { buildEmailSender, type CompanyEmailSender } from "./email-sender";
import type { SmtpKonfiguracija } from "./pos-email";

export interface SupplierOrderEmailLine {
  articleName: string;
  supplierItemName: string | null;
  supplierCode: string | null;
  supplierGtin?: string | null;
  packageFactor?: number | null;
  baseUnit?: string | null;
  packageQuantity: number;
  packageName: string | null;
  unitPrice: number | null;
}

export interface SupplierOrderEmailInput {
  number: string;
  supplierName: string;
  expectedDeliveryDate: string | null;
  /** Only the supplier-facing instruction; internal notes must never be passed in. */
  supplierNotes: string | null;
  lines: SupplierOrderEmailLine[];
}

const escapeHtml = (value: string) => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const qty = (value: number) => new Intl.NumberFormat("sl-SI", { maximumFractionDigits: 3 }).format(value);
const money = (value: number | null) =>
  value == null ? "—" : new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(value);
const deliveryDate = (iso: string | null) => {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : null;
};

export function buildSupplierOrderEmail(order: SupplierOrderEmailInput, companyName: string) {
  const date = deliveryDate(order.expectedDeliveryDate);
  const subject = `Naročilo ${order.number} — ${companyName}`;
  const textLines = order.lines.map(line => {
    const name = line.supplierItemName?.trim() || line.articleName;
    const code = (line.supplierCode ? ` [${line.supplierCode}]` : "")
      + (line.supplierGtin ? ` (EAN ${line.supplierGtin})` : "");
    const unit = line.baseUnit && line.packageFactor ? ` (1 pak. = ${qty(line.packageFactor)} ${line.baseUnit})` : "";
    return `- ${name}${code}: ${qty(line.packageQuantity)}${line.packageName ? ` ${line.packageName}` : ""}${unit}`
      + (line.unitPrice == null ? "" : ` po ${money(line.unitPrice)}`);
  });
  const text = [
    `Pozdravljeni,`,
    ``,
    `pošiljamo naročilo ${order.number} podjetja ${companyName}.`,
    date ? `Želeni datum dostave: ${date}` : null,
    ``,
    ...textLines,
    order.supplierNotes?.trim() ? `\nNavodilo: ${order.supplierNotes.trim()}` : null,
    ``,
    `Prosimo za potrditev prejema naročila.`,
  ].filter(line => line !== null).join("\n");
  const rows = order.lines.map(line => {
    const name = line.supplierItemName?.trim() || line.articleName;
    return `<tr><td style="padding:6px 8px;border-top:1px solid #e5e7eb">${escapeHtml(name)}${line.supplierCode ? ` <span style="color:#888">[${escapeHtml(line.supplierCode)}]</span>` : ""}${line.supplierGtin ? ` <span style="color:#888">EAN ${escapeHtml(line.supplierGtin)}</span>` : ""}</td>`
      + `<td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right">${escapeHtml(qty(line.packageQuantity))}${line.packageName ? ` ${escapeHtml(line.packageName)}` : ""}${line.baseUnit && line.packageFactor ? ` <span style="color:#888">(1 pak. = ${escapeHtml(qty(line.packageFactor))} ${escapeHtml(line.baseUnit)})</span>` : ""}</td>`
      + `<td style="padding:6px 8px;border-top:1px solid #e5e7eb;text-align:right">${escapeHtml(money(line.unitPrice))}</td></tr>`;
  }).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 4px">Naročilo ${escapeHtml(order.number)}</h2>
<p style="color:#555;margin:0 0 16px">${escapeHtml(companyName)}${date ? ` · želeni datum dostave ${escapeHtml(date)}` : ""}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:#888"><th style="padding:6px 8px">Artikel</th><th style="padding:6px 8px;text-align:right">Količina</th><th style="padding:6px 8px;text-align:right">Cena pakiranja</th></tr></thead><tbody>${rows}</tbody></table>
${order.supplierNotes?.trim() ? `<p style="margin-top:16px"><strong>Navodilo:</strong> ${escapeHtml(order.supplierNotes.trim())}</p>` : ""}
<p style="color:#555;margin-top:16px">Prosimo za potrditev prejema naročila.</p></div>`;
  return { subject, text, html };
}

export async function posljiNarociloDobavitelju(
  smtp: SmtpKonfiguracija,
  recipient: string,
  order: SupplierOrderEmailInput,
  companyName: string,
  sender?: CompanyEmailSender,
): Promise<{ uspeh: boolean; napaka?: string }> {
  if (!smtp.smtpAktiven) return { uspeh: false, napaka: "Pošiljanje e-pošte ni aktivirano" };
  if (!smtp.smtpHost || !smtp.smtpUser || !smtp.smtpPassword || !smtp.smtpFrom) {
    return { uspeh: false, napaka: "SMTP nastavitve niso popolne" };
  }
  const transporter = nodemailer.createTransport({
    host: smtp.smtpHost,
    port: smtp.smtpPort || 465,
    secure: (smtp.smtpPort || 465) === 465,
    auth: { user: smtp.smtpUser, pass: smtp.smtpPassword },
    tls: { rejectUnauthorized: true },
  });
  try {
    const { subject, text, html } = buildSupplierOrderEmail(order, companyName);
    await transporter.sendMail({
      ...buildEmailSender(smtp.smtpFrom, recipient, companyName, sender),
      to: recipient,
      subject,
      text,
      html,
    });
    return { uspeh: true };
  } catch (err) {
    return { uspeh: false, napaka: err instanceof Error ? err.message : String(err) };
  }
}
