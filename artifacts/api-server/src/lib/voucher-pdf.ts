import { existsSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

const bundledFonts = path.join(import.meta.dirname, "assets", "fonts");
const sourceFonts = path.join(import.meta.dirname, "..", "assets", "fonts");
const fontDir = existsSync(path.join(bundledFonts, "DejaVuSans.ttf")) ? bundledFonts : sourceFonts;

export async function voucherPdf(venue: string, recipient: string, codes: Array<{ code: string; amount: number }>) {
  const doc = new PDFDocument({ size: "A4", margin: 54 });
  doc.registerFont("BookieRegular", path.join(fontDir, "DejaVuSans.ttf"));
  doc.registerFont("BookieBold", path.join(fontDir, "DejaVuSans-Bold.ttf"));

  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.font("BookieBold").fontSize(14).fillColor("#1B3B36").text("BOOKIE DARILNI BON");
  doc.moveDown(2).fontSize(30).text(venue);
  doc.moveDown().font("BookieRegular").fontSize(14).fillColor("#333333").text(`Za: ${recipient}`);
  for (const item of codes) {
    doc.moveDown(1.5).fontSize(12).text("Koda bona")
      .font("BookieBold").fontSize(22).text(item.code, { characterSpacing: 1.5 });
    doc.font("BookieRegular").fontSize(14).text(
      `Vrednost: ${(item.amount / 100).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}`,
    );
  }
  doc.moveDown(2).fontSize(10).fillColor("#666666")
    .text("Bon lahko uporabite delno. Preostala vrednost ostane na isti kodi.");
  doc.end();
  return done;
}