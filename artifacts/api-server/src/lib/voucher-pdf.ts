import { existsSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

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

  const renderVoucher = async (item?: { code: string; amount: number }) => {
    doc.font("BookieBold").fontSize(14).fillColor("#1B3B36").text("BOOKIE DARILNI BON");
    doc.moveDown(2).fontSize(30).text(venue);
    doc.moveDown().font("BookieRegular").fontSize(14).fillColor("#333333").text(`Za: ${recipient}`);

    if (item) {
      doc.moveDown(2);
      const sectionTop = doc.y;
      const qrSize = 132;
      const qrX = doc.page.width - doc.page.margins.right - qrSize;
      const qr = await QRCode.toBuffer(item.code, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 2,
        width: qrSize,
      });

      doc.font("BookieRegular").fontSize(12).text("Koda bona", { width: qrX - doc.page.margins.left - 24 });
      doc.font("BookieBold").fontSize(22).text(item.code, {
        characterSpacing: 1.5,
        width: qrX - doc.page.margins.left - 24,
      });
      doc.font("BookieRegular").fontSize(14).text(
        `Vrednost: ${(item.amount / 100).toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}`,
        { width: qrX - doc.page.margins.left - 24 },
      );
      doc.image(qr, qrX, sectionTop, { width: qrSize, height: qrSize });
    }

    doc.font("BookieRegular").fontSize(10).fillColor("#666666")
      .text(
        "Bon lahko uporabite delno. Preostala vrednost ostane na isti kodi.",
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom - 30,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right },
      );
  };

  if (codes.length === 0) {
    await renderVoucher();
  } else {
    for (const [index, item] of codes.entries()) {
      if (index > 0) doc.addPage();
      await renderVoucher(item);
    }
  }
  doc.end();
  return done;
}