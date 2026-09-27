import PDFDocument from "pdfkit";
import path from "path";

const FONT_DIR = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const MARGIN = 40;
const HEADER_HEIGHT = 25;
const ROW_HEIGHT = 30;
const MUTED = "#6b7280";
const LINE = "#d1d5db";

export type StockExportRow = {
  name: string;
  unit: string;
  quantity: number;
  averageCost: number | null;
  totalValue: number | null;
};

export type StockExportPdfInput = {
  kind: "stock" | "popis";
  scope: "material" | "drobni";
  unitName: string;
  generatedAt: Date;
  includeBookQuantity: boolean;
  rows: StockExportRow[];
};

function collect(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function date(value: Date): string {
  return new Intl.DateTimeFormat("sl-SI", {
    timeZone: "Europe/Ljubljana",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function quantity(value: number): string {
  return value.toLocaleString("sl-SI", { maximumFractionDigits: 4 });
}

function money(value: number | null): string {
  return value == null
    ? "—"
    : `${value.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
}

export async function buildStockExportPdf(input: StockExportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  const done = collect(doc);
  doc.info.Title = input.kind === "stock" ? "Stanje zaloge" : "Popis zaloge";
  doc.info.Subject = `${input.kind}/${input.scope}; enota=${input.unitName}; postavk=${input.rows.length}`;
  doc.registerFont("Regular", FONT_REG);
  doc.registerFont("Bold", FONT_BOLD);

  const contentWidth = doc.page.width - MARGIN * 2;
  const title = input.kind === "stock"
    ? `Stanje zaloge — ${input.scope === "material" ? "material" : "drobni inventar"}`
    : `Popis — ${input.scope === "material" ? "material" : "drobni inventar"}`;
  const bottom = doc.page.height - MARGIN - 18;

  const drawPageHeader = () => {
    doc.font("Bold").fontSize(14).fillColor("#111827")
      .text(title, MARGIN, MARGIN, { width: contentWidth, lineBreak: false });
    doc.font("Regular").fontSize(8).fillColor(MUTED)
      .text(`Enota: ${input.unitName}  ·  Datum: ${date(input.generatedAt)}`, MARGIN, MARGIN + 22, {
        width: contentWidth,
        lineBreak: false,
      });
    doc.y = MARGIN + 42;
  };

  const columns = input.kind === "stock"
    ? input.scope === "material"
      ? [
          { label: "Artikel", width: 210, align: "left" as const },
          { label: "EM", width: 48, align: "left" as const },
          { label: "Količina", width: 78, align: "right" as const },
          { label: "Povp. cena", width: 82, align: "right" as const },
          { label: "Vrednost", width: contentWidth - 418, align: "right" as const },
        ]
      : [
          { label: "Artikel", width: 290, align: "left" as const },
          { label: "EM", width: 65, align: "left" as const },
          { label: "Količina", width: contentWidth - 355, align: "right" as const },
        ]
    : input.includeBookQuantity
      ? [
          { label: "Artikel", width: 205, align: "left" as const },
          { label: "EM", width: 45, align: "left" as const },
          { label: "Knjižno", width: 68, align: "right" as const },
          { label: "Prešteto", width: 82, align: "right" as const },
          { label: "Opombe", width: contentWidth - 400, align: "left" as const },
        ]
      : [
          { label: "Artikel", width: 235, align: "left" as const },
          { label: "EM", width: 55, align: "left" as const },
          { label: "Prešteto", width: 90, align: "right" as const },
          { label: "Opombe", width: contentWidth - 380, align: "left" as const },
        ];
  const positions = columns.map((column, index) =>
    MARGIN + columns.slice(0, index).reduce((total, prior) => total + prior.width, 0));

  const drawTableHeader = () => {
    const y = doc.y;
    doc.rect(MARGIN, y, contentWidth, HEADER_HEIGHT).fill("#f3f4f6");
    columns.forEach((column, index) => {
      doc.font("Bold").fontSize(7.5).fillColor("#374151")
        .text(column.label, positions[index] + 4, y + 8, {
          width: column.width - 8,
          align: column.align,
          lineBreak: false,
        });
    });
    doc.y = y + HEADER_HEIGHT;
  };

  const newPage = () => {
    doc.addPage();
    drawPageHeader();
    drawTableHeader();
  };

  drawPageHeader();
  drawTableHeader();
  for (const row of input.rows) {
    if (doc.y + ROW_HEIGHT > bottom) newPage();
    const y = doc.y;
    doc.moveTo(MARGIN, y + ROW_HEIGHT).lineTo(MARGIN + contentWidth, y + ROW_HEIGHT)
      .strokeColor(LINE).lineWidth(0.4).stroke();

    const values = input.kind === "stock"
      ? input.scope === "material"
        ? [row.name, row.unit, quantity(row.quantity), money(row.averageCost), money(row.totalValue)]
        : [row.name, row.unit, quantity(row.quantity)]
      : input.includeBookQuantity
        ? [row.name, row.unit, quantity(row.quantity), "", ""]
        : [row.name, row.unit, "", ""];

    values.forEach((value, index) => {
      const column = columns[index];
      const isPopisBlank = input.kind === "popis" && value === "";
      if (isPopisBlank && index >= (input.includeBookQuantity ? 3 : 2)) {
        // Leave the counted/notes fields printable and genuinely blank.
        doc.moveTo(positions[index] + 5, y + ROW_HEIGHT - 7)
          .lineTo(positions[index] + column.width - 5, y + ROW_HEIGHT - 7)
          .strokeColor("#9ca3af").lineWidth(0.35).stroke();
      } else {
        doc.font("Regular").fontSize(7.5).fillColor("#111827")
          .text(value, positions[index] + 4, y + 10, {
            width: column.width - 8,
            align: column.align,
            ellipsis: true,
            lineBreak: false,
          });
      }
    });
    doc.y = y + ROW_HEIGHT;
  }

  const pageRange = doc.bufferedPageRange();
  for (let index = pageRange.start; index < pageRange.start + pageRange.count; index += 1) {
    doc.switchToPage(index);
    doc.font("Regular").fontSize(7).fillColor(MUTED)
      .text(`Stran ${index + 1} / ${pageRange.count}`, MARGIN, doc.page.height - MARGIN - 8, {
        width: contentWidth,
        align: "right",
        lineBreak: false,
      });
  }

  doc.end();
  return done;
}