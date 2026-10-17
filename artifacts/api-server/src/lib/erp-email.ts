/**
 * E-poštno pošiljanje za ERP modul.
 *
 * Konfiguracija SMTP se bere iz zaščitenih nastavitev aktivnega podjetja.
 */

import { buildEmailSender, type CompanyEmailSender } from "./email-sender";
import { getErpSmtp, createErpTransport } from "./erp-smtp-settings";
export { getErpSmtp } from "./erp-smtp-settings";

export async function posljiPorociloPdf(opts: {
  companyId: string;
  prejemnik: string;
  companyName: string;
  reportTitle: string;
  subtitle: string;
  filename: string;
  pdfBuffer: Buffer;
}, sender?: CompanyEmailSender): Promise<{ uspeh: boolean; napaka?: string }> {
  let smtp;
  try {
    smtp = await getErpSmtp(opts.companyId);
  } catch {
    return { uspeh: false, napaka: "SMTP nastavitev ni mogoče prebrati. Preverite zaščito gesla v nastavitvah ERP." };
  }
  if (!smtp) {
    return {
      uspeh: false,
      napaka:
        "SMTP nastavitve za ERP niso konfigurirane. " +
        "Odprite Nastavitve podjetja → Podjetje → E-pošta poročil (SMTP).",
    };
  }

  const transporter = createErpTransport(smtp);

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
      ...buildEmailSender(smtp.from, opts.prejemnik, opts.companyName, sender),
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
    return { uspeh: false, napaka: "Pošiljanje ni uspelo. Preverite SMTP nastavitve in dosegljivost strežnika." };
  } finally {
    transporter.close();
  }
}
