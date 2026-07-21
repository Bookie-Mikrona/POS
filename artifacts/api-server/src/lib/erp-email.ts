/**
 * E-poštno pošiljanje za ERP modul.
 *
 * Konfiguracija SMTP se bere iz okoliških spremenljivk:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 *
 * Brez teh vrednosti pošiljanje ni možno in endpoint vrne jasno napako.
 */

import nodemailer from "nodemailer";

export function getErpSmtp(): {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
} | null {
  const host     = process.env["SMTP_HOST"]     ?? "";
  const user     = process.env["SMTP_USER"]     ?? "";
  const password = process.env["SMTP_PASSWORD"] ?? "";
  const from     = process.env["SMTP_FROM"]     ?? "";
  const port     = Number(process.env["SMTP_PORT"] ?? "587");

  if (!host || !user || !password || !from) return null;
  return { host, port, user, password, from };
}

export async function posljiPorociloPdf(opts: {
  prejemnik: string;
  companyName: string;
  reportTitle: string;
  subtitle: string;
  filename: string;
  pdfBuffer: Buffer;
}): Promise<{ uspeh: boolean; napaka?: string }> {
  const smtp = getErpSmtp();
  if (!smtp) {
    return {
      uspeh: false,
      napaka:
        "SMTP nastavitve za ERP niso konfigurirane. " +
        "Nastavite spremenljivke SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM.",
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    tls: { rejectUnauthorized: true },
  });

  const genDate = new Date().toLocaleDateString("sl-SI", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  const subject = `${opts.reportTitle} — ${opts.companyName}`;
  const html = `
<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f9fafb; border-radius: 8px;">
  <h2 style="color: #1a1a2e; margin-bottom: 4px;">${opts.companyName}</h2>
  <h3 style="color: #374151; margin-top: 0; margin-bottom: 8px; font-size: 15px;">${opts.reportTitle}</h3>
  <p style="color: #6b7280; font-size: 13px; margin: 0 0 16px;">${opts.subtitle}</p>
  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 14px; margin-bottom: 16px;">
    <p style="margin: 0; font-size: 14px; color: #1e40af;">
      📎 Poročilo je priloženo kot PDF datoteka <strong>${opts.filename}</strong>.
    </p>
  </div>
  <p style="color: #9ca3af; font-size: 12px; margin: 0; text-align: center;">
    Generirano: ${genDate}
  </p>
</div>
`;

  const text = `${opts.companyName}\n${opts.reportTitle}\n${opts.subtitle}\n\nPoročilo je priloženo kot PDF.\nGenerirano: ${genDate}`;

  try {
    await transporter.sendMail({
      from: smtp.from,
      to: opts.prejemnik,
      subject,
      text,
      html,
      attachments: [
        {
          filename: opts.filename,
          content: opts.pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });
    return { uspeh: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { uspeh: false, napaka: msg };
  }
}
