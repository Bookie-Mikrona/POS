import PDFDocument from "pdfkit";
import Decimal from "decimal.js";
import path from "node:path";
import { existsSync } from "node:fs";
import type { posMonthlyInvoicesTable } from "@workspace/db";

export function monthlyInvoicePdf(invoice: typeof posMonthlyInvoicesTable.$inferSelect): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const dir = [path.join(import.meta.dirname, "assets/fonts"), path.join(import.meta.dirname, "../assets/fonts")]
      .find(d => existsSync(path.join(d, "DejaVuSans.ttf")));
    if (!dir) { reject(new Error("Manjka pisava za slovenski PDF.")); doc.end(); return; }
    doc.registerFont("Body", path.join(dir, "DejaVuSans.ttf"));
    doc.registerFont("Bold", path.join(dir, "DejaVuSans-Bold.ttf"));
    const s = invoice.snapshot;
    const money = (v: string) => new Decimal(v).toFixed(2).replace(".", ",") + " EUR";
    const date = (v: string) => v.split("-").reverse().join(".");
    const text = (v: string, size = 10, bold = false) => doc.font(bold ? "Bold" : "Body").fontSize(size).text(v, { width: 510 });
    if (s.isTest) text("TESTNI DOKUMENT – NI ZA PLAČILO", 13, true);
    text(s.issuer.name, 15, true); text(s.issuer.address); text(`Davčna / ID za DDV: ${s.issuer.taxId}`);
    doc.moveDown();
    text(`MESEČNI RAČUN ${invoice.invoiceNumber}`, 16, true);
    text(`Obdobje: ${invoice.month} · Enota: ${s.unitName}`);
    text(`Datum izdaje: ${date(invoice.invoiceDate)} · Rok plačila: ${date(invoice.dueDate)}`);
    doc.moveDown();
    text("Prejemnik", 10, true); text(s.recipient.name, 12, true); text(s.recipient.address); text(`Davčna / ID za DDV: ${s.recipient.taxId}`);
    doc.moveDown();
    text("Specifikacija malic in drugih pogodbenih postavk", 12, true);
    for (const line of s.lines) {
      const unitNet = new Decimal(line.gross).div(line.quantity).mul(100).div(new Decimal(line.rate).plus(100)).toDecimalPlaces(4).toString().replace(".", ",");
      text(`${line.label}\n${line.quantity.replace(".", ",")} kos · cena brez DDV/kos ${unitNet} EUR · DDV ${line.rate.replace(".", ",")} % · skupaj ${money(line.gross)}`);
      doc.moveDown(0.35);
    }
    doc.moveDown(); text("Obračun DDV (iz že izdanih dnevnih računov)", 11, true);
    for (const b of s.vatBuckets) text(`${b.rate.replace(".", ",")} %: osnova ${money(b.net)} · DDV ${money(b.vat)} · skupaj ${money(b.gross)}`);
    text(`Osnova: ${money(s.totalNet)} · DDV: ${money(s.totalVat)}`);
    text(`ZA PLAČILO: ${money(s.totalGross)}`, 14, true);
    if (s.issuer.iban) {
      text(`IBAN: ${s.issuer.iban}${s.issuer.bic ? ` · BIC: ${s.issuer.bic}` : ""}`);
      text(`Referenca: SI00 ${invoice.year}-${invoice.sequence} · Namen: ${invoice.invoiceNumber}`);
    }
    doc.moveDown();
    text("Račun združuje spodaj navedene že izdane dnevne POS račune. Ne predstavlja nove prodaje ali ponovnega obračuna DDV. Za plačilo uporabite ta mesečni račun; dnevnih računov ne plačujte še enkrat.", 9);
    doc.addPage();
    text(`Dnevni POS računi – specifikacija ${invoice.invoiceNumber}`, 13, true);
    for (const r of s.receipts) text(`${date(r.date)} · ${r.number} · ${money(r.gross)}`);
    doc.moveDown(); text(`Skupaj ${s.receipts.length} računov: ${money(s.totalGross)}`, 11, true);
    doc.end();
  });
}