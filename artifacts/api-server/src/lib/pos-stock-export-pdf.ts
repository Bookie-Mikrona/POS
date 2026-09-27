import PDFDocument from "pdfkit";
import path from "path";

const FONT_DIR = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const MARGIN = 40;
const HEADER_HEIGHT = 25;
const ROW_HEIGHT = 30;
const GROUP_HEIGHT = 17;
const MUTED = "#6b7280";
const LINE = "#d1d5db";

export type StockExportRow = {
  id: number;
  name: string;
  unit: string;
  quantity: number;
  averageCost: number | null;
  totalValue: number | null;
  vatRate?: number | null;
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
      .text(input.kind === "popis"
        ? `Enota: ${input.unitName}`
        : `Enota: ${input.unitName}  ·  Datum: ${date(input.generatedAt)}`,
      MARGIN, MARGIN + 22, { width: contentWidth, lineBreak: false });
    if (input.kind === "popis") {
      const y = MARGIN + 38;
      doc.font("Regular").fontSize(8).fillColor(MUTED)
        .text(`Natisnjeno: ${date(input.generatedAt)}`, MARGIN, y + 3, { width: 195, lineBreak: false })
        .text("Datum inventure:", MARGIN + 200, y + 3, { width: 90, lineBreak: false });
      doc.rect(MARGIN + 292, y, 105, 17).strokeColor("#9ca3af").lineWidth(0.6).stroke();
      doc.y = MARGIN + 62;
    } else {
      doc.y = MARGIN + 42;
    }
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
          { label: "ID", width: 44, align: "right" as const },
          { label: "Artikel", width: 133, align: "left" as const },
          { label: "EM", width: 36, align: "left" as const },
          { label: "Knjižno", width: 58, align: "right" as const },
          { label: "Prešteto", width: 65, align: "right" as const },
          { label: "Nabavna cena", width: 89, align: "right" as const },
          { label: "Opombe", width: contentWidth - 425, align: "left" as const },
        ]
      : [
          { label: "ID", width: 44, align: "right" as const },
          { label: "Artikel", width: 153, align: "left" as const },
          { label: "EM", width: 40, align: "left" as const },
          { label: "Prešteto", width: 66, align: "right" as const },
          { label: "Nabavna cena", width: 88, align: "right" as const },
          { label: "Opombe", width: contentWidth - 391, align: "left" as const },
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

  const vatRank = (rate: number | null | undefined): number => {
    if (rate === 5) return 0;
    if (rate === 9.5) return 1;
    if (rate === 22) return 2;
    if (rate === 0) return 3;
    return 4;
  };
  const collator = new Intl.Collator("sl-SI");
  const sortedRows = [...input.rows].sort((a, b) => {
    const aRank = vatRank(a.vatRate);
    const bRank = vatRank(b.vatRate);
    if (aRank !== bRank) return aRank - bRank;
    if (aRank === 4 && a.vatRate !== b.vatRate) {
      if (a.vatRate == null) return 1;
      if (b.vatRate == null) return -1;
      return a.vatRate - b.vatRate;
    }
    return collator.compare(a.name, b.name);
  });
  const vatLabel = (rate: number | null | undefined): string =>
    rate == null ? "DDV —" : `DDV ${rate.toLocaleString("sl-SI", { maximumFractionDigits: 2 })} %`;

  drawPageHeader();
  drawTableHeader();
  let previousRate: number | null | undefined;
  let hasPreviousRate = false;
  for (const row of sortedRows) {
    const startsGroup = !hasPreviousRate || row.vatRate !== previousRate;
    const priorPage = doc.page;
    if (doc.y + ROW_HEIGHT + GROUP_HEIGHT > bottom) newPage();
    const pageChanged = doc.page !== priorPage;
    if (startsGroup || pageChanged) {
      const y = doc.y;
      doc.font("Bold").fontSize(8).fillColor("#374151")
        .text(vatLabel(row.vatRate), MARGIN + 4, y + 4, {
          width: contentWidth - 8,
          lineBreak: false,
        });
      doc.y = y + GROUP_HEIGHT;
    }
    previousRate = row.vatRate;
    hasPreviousRate = true;
    const y = doc.y;
    doc.moveTo(MARGIN, y + ROW_HEIGHT).lineTo(MARGIN + contentWidth, y + ROW_HEIGHT)
      .strokeColor(LINE).lineWidth(0.4).stroke();

    const values = input.kind === "stock"
      ? input.scope === "material"
        ? [row.name, row.unit, quantity(row.quantity), money(row.averageCost), money(row.totalValue)]
        : [row.name, row.unit, quantity(row.quantity)]
      : input.includeBookQuantity
        ? [
            String(row.id),
            row.name,
            row.unit,
            quantity(row.quantity),
            "",
            row.averageCost != null && row.averageCost > 0 ? money(row.averageCost) : "",
            "",
          ]
        : [
            String(row.id),
            row.name,
            row.unit,
            "",
            row.averageCost != null && row.averageCost > 0 ? money(row.averageCost) : "",
            "",
          ];

    values.forEach((value, index) => {
      const column = columns[index];
      const isPopisBlank = input.kind === "popis" && value === "";
      const isWriteInColumn = input.includeBookQuantity
        ? index === 4 || index === 6 || (index === 5 && !value)
        : index === 3 || index === 5 || (index === 4 && !value);
      if (isPopisBlank && isWriteInColumn) {
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
    doc.font("Regular").fontSize(7).fillColor(MUTED);
    const footer = `Stran ${index + 1} / ${pageRange.count}`;
    const footerX = doc.page.width - MARGIN - doc.widthOfString(footer);
    doc.text(footer, footerX, doc.page.height - MARGIN - 16, {
      lineBreak: false,
      continued: false,
    });
  }

  doc.end();
  return done;
}