import PDFDocument from "pdfkit";
import path from "path";

const FONT_DIR = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const MARGIN = 36;
const ROW_HEIGHT = 18;
const LINE = "#d1d5db";
const MUTED = "#6b7280";

type WasteLine = {
  businessDate: string;
  articleName: string;
  unitOfMeasure: string;
  quantity: number;
  unitCost: number;
  totalValue: number;
};

export type PreparedFoodWastePdfRecord = {
  recordNumber: number;
  companyName: string;
  businessUnitName: string;
  recordDate: string;
  periodFrom: string;
  periodTo: string;
  wasteObservedAt: string;
  disposalReason: string;
  signaturePerson: string;
  signatureManager: string;
  status: string;
  dailyLines: WasteLine[];
  summaryLines: Omit<WasteLine, "businessDate">[];
  totalQuantity: number;
};

function collect(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function date(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("sl-SI", {
    timeZone: "Europe/Ljubljana",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function quantity(value: number): string {
  return value.toLocaleString("sl-SI", { maximumFractionDigits: 4 });
}

function money(value: number): string {
  return value.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export async function buildPreparedFoodWasteRecordPdf(
  record: PreparedFoodWastePdfRecord,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  const done = collect(doc);
  doc.registerFont("Regular", FONT_REG);
  doc.registerFont("Bold", FONT_BOLD);

  const contentWidth = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - 28;

  const addPageHeader = () => {
    doc.font("Regular").fontSize(7).fillColor(MUTED)
      .text(`${record.companyName} · ${record.businessUnitName}`, MARGIN, 20, {
        width: contentWidth,
        align: "right",
      });
    doc.y = MARGIN;
    doc.fillColor("#111827");
  };

  const ensureSpace = (height: number) => {
    if (doc.y + height <= bottom()) return;
    doc.addPage();
    addPageHeader();
  };

  const sectionTitle = (title: string) => {
    ensureSpace(28);
    doc.moveDown(0.5);
    doc.x = MARGIN;
    doc.font("Bold").fontSize(8).fillColor("#111827").text(title, MARGIN, doc.y, {
      width: contentWidth,
      lineBreak: false,
    });
    doc.moveDown(0.35);
  };

  const tableHeader = (columns: Array<{ label: string; x: number; width: number; align?: "left" | "right" }>) => {
    ensureSpace(ROW_HEIGHT * 2);
    const y = doc.y;
    doc.rect(MARGIN, y, contentWidth, ROW_HEIGHT).fill("#f3f4f6");
    for (const column of columns) {
      doc.font("Bold").fontSize(7).fillColor("#374151")
        .text(column.label, column.x, y + 5, { width: column.width, align: column.align ?? "left" });
    }
    doc.y = y + ROW_HEIGHT;
  };

  const tableRow = (
    values: Array<{ text: string; x: number; width: number; align?: "left" | "right" }>,
  ) => {
    ensureSpace(ROW_HEIGHT);
    const y = doc.y;
    doc.moveTo(MARGIN, y + ROW_HEIGHT).lineTo(MARGIN + contentWidth, y + ROW_HEIGHT)
      .strokeColor(LINE).lineWidth(0.35).stroke();
    for (const value of values) {
      doc.font("Regular").fontSize(7.5).fillColor("#111827")
        .text(value.text, value.x, y + 5, {
          width: value.width,
          align: value.align ?? "left",
          ellipsis: true,
          lineBreak: false,
        });
    }
    doc.y = y + ROW_HEIGHT;
  };

  addPageHeader();
  doc.font("Bold").fontSize(15).text("ZAPISNIK KALA", { align: "center" });
  doc.font("Bold").fontSize(10).text(`Številka: ${record.recordNumber}`, { align: "center" });
  doc.moveDown(0.8);

  const metaY = doc.y;
  doc.font("Bold").fontSize(8).text("Podjetje:", MARGIN, metaY, { continued: true })
    .font("Regular").text(`  ${record.companyName}`);
  doc.font("Bold").text("Poslovna enota:", { continued: true })
    .font("Regular").text(`  ${record.businessUnitName}`);
  doc.font("Bold").text("Datum zapisnika/odvoza:", { continued: true })
    .font("Regular").text(`  ${date(record.recordDate)}`);
  doc.font("Bold").text("Obdobje kala:", { continued: true })
    .font("Regular").text(`  ${date(record.periodFrom)}–${date(record.periodTo)}`);
  doc.font("Bold").text("Čas ugotovitve:", { continued: true })
    .font("Regular").text(`  ${dateTime(record.wasteObservedAt)}`);
  doc.font("Bold").text("Status:", { continued: true })
    .font("Regular").text(`  ${record.status === "potrjen" ? "Potrjen" : "Osnutek"}`);

  sectionTitle("Razlog odpisa");
  doc.font("Regular").fontSize(8).text(record.disposalReason, {
    width: contentWidth,
  });

  sectionTitle("Artikli po dnevih – lastna vrednost");
  const dailyColumns = [
    { label: "Datum", x: MARGIN, width: 58 },
    { label: "Artikel", x: MARGIN + 62, width: contentWidth - 296 },
    { label: "EM", x: MARGIN + contentWidth - 228, width: 38 },
    { label: "Količina", x: MARGIN + contentWidth - 186, width: 58, align: "right" as const },
    { label: "Lastna cena", x: MARGIN + contentWidth - 122, width: 58, align: "right" as const },
    { label: "Vrednost EUR", x: MARGIN + contentWidth - 58, width: 58, align: "right" as const },
  ];
  tableHeader(dailyColumns);
  for (const line of record.dailyLines) {
    tableRow([
      { text: date(line.businessDate), x: dailyColumns[0].x, width: dailyColumns[0].width },
      { text: line.articleName, x: dailyColumns[1].x, width: dailyColumns[1].width },
      { text: line.unitOfMeasure, x: dailyColumns[2].x, width: dailyColumns[2].width },
      { text: quantity(line.quantity), x: dailyColumns[3].x, width: dailyColumns[3].width, align: "right" },
      { text: money(line.unitCost), x: dailyColumns[4].x, width: dailyColumns[4].width, align: "right" },
      { text: money(line.totalValue), x: dailyColumns[5].x, width: dailyColumns[5].width, align: "right" },
    ]);
  }

  sectionTitle("Rekapitulacija – finančni del");
  const summaryColumns = [
    { label: "Artikel", x: MARGIN, width: contentWidth - 296 },
    { label: "EM", x: MARGIN + contentWidth - 228, width: 38 },
    { label: "Količina", x: MARGIN + contentWidth - 186, width: 58, align: "right" as const },
    { label: "Lastna cena", x: MARGIN + contentWidth - 122, width: 58, align: "right" as const },
    { label: "Vrednost EUR", x: MARGIN + contentWidth - 58, width: 58, align: "right" as const },
  ];
  tableHeader(summaryColumns);
  for (const line of record.summaryLines) {
    tableRow([
      { text: line.articleName, x: summaryColumns[0].x, width: summaryColumns[0].width },
      { text: line.unitOfMeasure, x: summaryColumns[1].x, width: summaryColumns[1].width },
      { text: quantity(line.quantity), x: summaryColumns[2].x, width: summaryColumns[2].width, align: "right" },
      { text: money(line.unitCost), x: summaryColumns[3].x, width: summaryColumns[3].width, align: "right" },
      { text: money(line.totalValue), x: summaryColumns[4].x, width: summaryColumns[4].width, align: "right" },
    ]);
  }
  ensureSpace(ROW_HEIGHT);
  doc.font("Bold").fontSize(8).text(
    `Skupna količina: ${quantity(record.totalQuantity)}`,
    MARGIN,
    doc.y + 5,
    { width: contentWidth, align: "right" },
  );
  const totalValue = record.summaryLines.reduce((total, line) => total + line.totalValue, 0);
  doc.font("Bold").fontSize(8).text(
    `Skupna vrednost odpisa: ${money(totalValue)} EUR`,
    MARGIN,
    doc.y + 5,
    { width: contentWidth, align: "right" },
  );
  doc.y += ROW_HEIGHT * 2 + 8;

  ensureSpace(82);
  doc.font("Bold").fontSize(8).text("Podpisa");
  const signatureY = doc.y + 36;
  const signatureWidth = (contentWidth - 36) / 2;
  doc.moveTo(MARGIN, signatureY).lineTo(MARGIN + signatureWidth, signatureY).strokeColor("#4b5563").stroke();
  doc.moveTo(MARGIN + signatureWidth + 36, signatureY).lineTo(MARGIN + contentWidth, signatureY).stroke();
  doc.font("Regular").fontSize(7).fillColor(MUTED)
    .text(record.signaturePerson, MARGIN, signatureY + 5, { width: signatureWidth, align: "center" })
    .text("Oseba, ki je kalo ugotovila/predala", MARGIN, signatureY + 17, { width: signatureWidth, align: "center" })
    .text(record.signatureManager, MARGIN + signatureWidth + 36, signatureY + 5, { width: signatureWidth, align: "center" })
    .text("Odgovorna oseba", MARGIN + signatureWidth + 36, signatureY + 17, { width: signatureWidth, align: "center" });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const footerY = doc.page.height - MARGIN - 10;
    doc.font("Regular").fontSize(7).fillColor(MUTED)
      .text(`Zapisnik kala št. ${record.recordNumber}`, MARGIN, footerY, {
        width: contentWidth / 2,
        lineBreak: false,
      })
      .text(`Stran ${i + 1} / ${range.count}`, MARGIN + contentWidth / 2, footerY, {
        width: contentWidth / 2,
        align: "right",
        lineBreak: false,
      });
  }

  doc.end();
  return done;
}