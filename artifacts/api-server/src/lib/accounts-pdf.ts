import PDFDocument from "pdfkit";
import path from "path";

export interface AccountsPdfRow {
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

const FONT_DIR = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const MARGIN = 42;

function collectBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export async function generateAccountsPdf(accounts: AccountsPdfRow[]): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
  });
  doc.registerFont("DejaVu", FONT_REG);
  doc.registerFont("DejaVuBold", FONT_BOLD);
  const result = collectBuffer(doc);
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - MARGIN * 2;

  const drawHeader = (continued: boolean) => {
    doc.font("DejaVuBold").fontSize(14).fillColor("#172554")
      .text(continued ? "Kontni plan (nadaljevanje)" : "Kontni plan", MARGIN, MARGIN);
    if (!continued) {
      doc.font("DejaVu").fontSize(8).fillColor("#64748b")
        .text(`Izvoz vseh kontov · ${new Date().toLocaleDateString("sl-SI")}`, MARGIN, MARGIN + 22);
    }
    const y = continued ? MARGIN + 22 : MARGIN + 40;
    doc.rect(MARGIN, y, contentWidth, 20).fill("#eef2ff");
    doc.font("DejaVuBold").fontSize(8).fillColor("#172554")
      .text("Koda", MARGIN + 7, y + 6, { width: 64, lineBreak: false })
      .text("Ime konta", MARGIN + 78, y + 6, { width: contentWidth - 200, lineBreak: false })
      .text("Status", pageWidth - MARGIN - 84, y + 6, { width: 76, lineBreak: false });
    doc.y = y + 26;
  };

  drawHeader(false);
  const rowHeight = 18;
  const bottom = doc.page.height - MARGIN - 22;
  accounts.forEach((account, index) => {
    if (doc.y + rowHeight > bottom) {
      doc.addPage();
      drawHeader(true);
    }
    const y = doc.y;
    if (index % 2 === 1) doc.rect(MARGIN, y - 2, contentWidth, rowHeight).fill("#f8fafc");
    doc.font("DejaVu").fontSize(8).fillColor("#334155")
      .text(account.code, MARGIN + 7, y + 2, { width: 64, lineBreak: false })
      .text(account.name, MARGIN + 78, y + 2, { width: contentWidth - 200, lineBreak: false });
    doc.fillColor(account.isActive ? "#166534" : "#991b1b")
      .text(account.isActive ? "Aktivno" : "Neaktivno", pageWidth - MARGIN - 84, y + 2, {
        width: 76,
        lineBreak: false,
      });
    doc.y = y + rowHeight;
  });

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex++) {
    doc.switchToPage(pageIndex);
    doc.font("DejaVu").fontSize(7).fillColor("#94a3b8")
      .text(`Stran ${pageIndex + 1} / ${range.count}`, MARGIN, doc.page.height - MARGIN, {
        width: contentWidth,
        align: "right",
        lineBreak: false,
      });
  }
  doc.end();
  return result;
}