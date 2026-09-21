import PDFDocument from "pdfkit";
import path from "path";

const FONT_DIR = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const MARGIN = 42;
const MUTED = "#6b7280";

export type PlateWasteHandoverPdfRecord = {
  companyName: string;
  businessUnitName: string;
  categoryCode: string;
  wasteType: string;
  source: string;
  handoverDate: string;
  entryType: "oddaja" | "popravek";
  quantityKg: number;
  collectorName: string;
  manifestNumber: string;
  note: string;
  correctionOfId: number | null;
  createdByName: string;
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

function quantity(value: number): string {
  return value.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export async function buildPlateWasteHandoverPdf(
  record: PlateWasteHandoverPdfRecord,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN });
  const done = collect(doc);
  doc.registerFont("Regular", FONT_REG);
  doc.registerFont("Bold", FONT_BOLD);

  const contentWidth = doc.page.width - MARGIN * 2;
  const label = (name: string, value: string) => {
    doc.font("Bold").fontSize(10).fillColor("#111827").text(`${name}: `, MARGIN, doc.y, { continued: true });
    doc.font("Regular").text(value || "-");
    doc.moveDown(0.35);
  };

  doc.font("Regular").fontSize(8).fillColor(MUTED)
    .text(`${record.companyName} · ${record.businessUnitName}`, MARGIN, 24, {
      width: contentWidth,
      align: "right",
    });
  doc.y = MARGIN + 20;
  doc.font("Bold").fontSize(17).fillColor("#111827")
    .text("IZPIS ODDAJE ODPADKOV S KROŽNIKOV", { align: "center" });
  doc.moveDown(0.35);
  doc.font("Regular").fontSize(9).fillColor(MUTED)
    .text("Samostojna interna evidenca · koda odpadka 20 01 08", { align: "center" });
  doc.moveDown(1.4);

  doc.rect(MARGIN, doc.y, contentWidth, 74).fill("#f3f4f6");
  const boxY = doc.y + 14;
  doc.font("Bold").fontSize(11).fillColor("#111827")
    .text(record.entryType === "popravek" ? "POPRAVEK ODDAJE" : "ODDAJA", MARGIN + 16, boxY);
  doc.font("Bold").fontSize(22).text(`${quantity(record.quantityKg)} kg`, MARGIN + contentWidth - 150, boxY, {
    width: 130,
    align: "right",
  });
  doc.font("Regular").fontSize(8).fillColor(MUTED)
    .text(record.entryType === "popravek" ? "Sprememba neto oddane količine" : "Količina, predana prevzemniku", MARGIN + 16, boxY + 28);
  doc.y += 98;

  label("Datum", date(record.handoverDate));
  label("Vrsta odpadka", record.wasteType);
  label("Vir", record.source);
  label("Kategorija", record.categoryCode);
  label("Prevzemnik", record.collectorName);
  label("Številka evidenčnega lista", record.manifestNumber);
  if (record.correctionOfId != null) label("Popravek za izvirno oddajo", `ID ${record.correctionOfId}`);
  label("Vnesel", record.createdByName);

  doc.moveDown(0.8);
  doc.font("Bold").fontSize(10).fillColor("#111827").text("Opomba");
  doc.moveDown(0.3);
  doc.font("Regular").fontSize(10).text(record.note || "Brez opombe", {
    width: contentWidth,
  });

  const footerY = doc.page.height - MARGIN - 10;
  doc.font("Regular").fontSize(8).fillColor(MUTED)
    .text("Evidenca ostankov s krožnikov · dokument je ustvarjen iz nespremenljive evidence", MARGIN, footerY, {
      width: contentWidth,
      align: "center",
      lineBreak: false,
    });

  doc.end();
  return done;
}