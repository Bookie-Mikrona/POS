import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";

export interface JolpReportRow {
  code: string;
  label: string;
  bold: boolean;
  current: number;
  previous: number;
}

export interface JolpRenderInput {
  year: number;
  company: {
    name: string;
    street: string;
    postalCode: string;
    city: string;
    registrationNumber: string;
  };
  balanceSheet: JolpReportRow[];
  incomeStatement: JolpReportRow[];
}

function resolveAssetRoot(moduleDir: string): string {
  // In source, this module is src/lib/ajpes/jolp-renderers.ts and the first
  // candidate resolves to src/assets. The production bundle is dist/index.mjs,
  // so import.meta.dirname is dist and the second candidate resolves to
  // dist/assets (copied by build.mjs).
  const candidates = [
    path.join(moduleDir, "..", "..", "assets"),
    path.join(moduleDir, "assets"),
  ];
  const validRoot = candidates.find((candidate) =>
    [
      path.join(candidate, "ajpes", "jolp-template.xlsx"),
      path.join(candidate, "fonts", "DejaVuSans.ttf"),
      path.join(candidate, "fonts", "DejaVuSans-Bold.ttf"),
    ].every((filePath) => existsSync(filePath)),
  );
  if (!validRoot) {
    throw new Error(
      `JOLP renderer assets are missing. Checked: ${candidates.join(", ")}`,
    );
  }
  return validRoot;
}

const ASSET_ROOT = resolveAssetRoot(import.meta.dirname);
const TEMPLATE_PATH = path.join(ASSET_ROOT, "ajpes", "jolp-template.xlsx");
const FONT_DIR = path.join(ASSET_ROOT, "fonts");
const REGULAR_FONT = path.join(FONT_DIR, "DejaVuSans.ttf");
const BOLD_FONT = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");

const SECTION_ROWS = {
  "Bilanca stanja": 46,
  "Izkaz poslovnega izida": 43,
} as const;

type JolpSheetName = keyof typeof SECTION_ROWS;

async function loadTemplate(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  return workbook;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`JOLP report requires ${field}.`);
  }
  return value.trim();
}

function validateReport(report: JolpRenderInput): void {
  if (!Number.isInteger(report.year) || report.year < 1900 || report.year > 9999) {
    throw new Error("JOLP report year must be a valid four-digit year.");
  }

  requiredText(report.company?.name, "company.name");
  requiredText(report.company?.street, "company.street");
  requiredText(report.company?.postalCode, "company.postalCode");
  requiredText(report.company?.city, "company.city");
  requiredText(report.company?.registrationNumber, "company.registrationNumber");

  for (const [sheetName, entries] of [
    ["Bilanca stanja", report.balanceSheet],
    ["Izkaz poslovnega izida", report.incomeStatement],
  ] as const) {
    if (!Array.isArray(entries) || entries.length !== SECTION_ROWS[sheetName]) {
      throw new Error(
        `${sheetName} must contain exactly ${SECTION_ROWS[sheetName]} rows.`,
      );
    }
    for (const [index, row] of entries.entries()) {
      requiredText(row?.code, `${sheetName}[${index}].code`);
      requiredText(row?.label, `${sheetName}[${index}].label`);
      if (typeof row.bold !== "boolean") {
        throw new Error(`${sheetName}[${index}].bold must be a boolean.`);
      }
      if (!Number.isFinite(row.current) || !Number.isFinite(row.previous)) {
        throw new Error(`${sheetName}[${index}] values must be finite numbers.`);
      }
    }
  }
}

function getRowsForSheet(
  report: JolpRenderInput,
  sheetName: JolpSheetName,
): JolpReportRow[] {
  return sheetName === "Bilanca stanja"
    ? report.balanceSheet
    : report.incomeStatement;
}

function populateWorkbook(
  workbook: ExcelJS.Workbook,
  report: JolpRenderInput,
): void {
  const expectedSheets = Object.keys(SECTION_ROWS);
  if (
    workbook.worksheets.length !== expectedSheets.length ||
    workbook.worksheets.some((sheet, index) => sheet.name !== expectedSheets[index])
  ) {
    throw new Error("JOLP template is missing its expected report sheets.");
  }

  for (const sheetName of expectedSheets as JolpSheetName[]) {
    const worksheet = workbook.getWorksheet(sheetName);
    if (!worksheet) {
      throw new Error(`JOLP template is missing the "${sheetName}" sheet.`);
    }

    const rows = getRowsForSheet(report, sheetName);
    const firstTemplateRow = 14;
    if (worksheet.rowCount !== firstTemplateRow + rows.length - 1) {
      throw new Error(`JOLP template has an unexpected number of ${sheetName} rows.`);
    }
    for (let index = 0; index < rows.length; index++) {
      const rowNumber = firstTemplateRow + index;
      const templateLabel = worksheet.getCell(rowNumber, 1).value;
      if (
        typeof templateLabel !== "string" ||
        rows[index].label.trim() !== templateLabel.trim()
      ) {
        throw new Error(
          `${sheetName} row ${rowNumber} label does not match the JOLP template.`,
        );
      }
      const templateBold = Boolean(worksheet.getCell(rowNumber, 1).font?.bold);
      if (rows[index].bold !== templateBold) {
        throw new Error(
          `${sheetName} row ${rowNumber} bold setting does not match the JOLP template.`,
        );
      }

      worksheet.getCell(rowNumber, 2).value = rows[index].current;
      worksheet.getCell(rowNumber, 3).value = rows[index].previous;
      worksheet.getCell(rowNumber, 2).numFmt = "#,##0.00";
      worksheet.getCell(rowNumber, 3).numFmt = "#,##0.00";
    }

    worksheet.getCell("A5").value = report.company.name.trim();
    worksheet.getCell("A7").value = report.company.street.trim();
    worksheet.getCell("A8").value =
      `${report.company.postalCode.trim()} ${report.company.city.trim()}`;
    worksheet.getCell("A9").value =
      `Matična številka: ${report.company.registrationNumber.trim()}`;
    worksheet.getCell("B13").value = report.year;
    worksheet.getCell("C13").value = report.year - 1;
    worksheet.getCell("A12").value =
      sheetName === "Bilanca stanja"
        ? `Bilanca stanja na dan 31.12.${report.year}`
        : `Izkaz poslovnega izida v obdobju od 1.1. do 31.12.${report.year}`;
  }
}

export async function generateJolpXlsx(
  report: JolpRenderInput,
): Promise<Buffer> {
  validateReport(report);
  const workbook = await loadTemplate();
  populateWorkbook(workbook, report);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function collectPdfBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function formatAmount(value: number): string {
  return value.toLocaleString("sl-SI", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function readLogo(workbook: ExcelJS.Workbook): Buffer | undefined {
  const worksheet = workbook.getWorksheet("Bilanca stanja");
  const image = worksheet?.getImages()[0];
  if (!image) return undefined;
  const imageId = Number(image.imageId);
  if (!Number.isInteger(imageId)) return undefined;
  const asset = workbook.getImage(imageId);
  return asset.buffer ? Buffer.from(asset.buffer) : undefined;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 37;
const BOTTOM_MARGIN = 42;
const CONTENT_BOTTOM = PAGE_HEIGHT - 72;
const FOOTER_Y = PAGE_HEIGHT - 58;
const LABEL_WIDTH = 337;
const CURRENT_WIDTH = 90;
const PREVIOUS_WIDTH = 90;

export async function generateJolpPdf(
  report: JolpRenderInput,
): Promise<Buffer> {
  validateReport(report);
  const workbook = await loadTemplate();
  populateWorkbook(workbook, report);
  const logo = readLogo(workbook);
  const doc = new PDFDocument({
    size: "A4",
    autoFirstPage: false,
    margins: { top: 34, right: MARGIN_X, bottom: BOTTOM_MARGIN, left: MARGIN_X },
    bufferPages: true,
    info: {
      Title: `JOLP letno poročilo ${report.year}`,
      Author: "Bookie ERP",
      Subject: "JOLP annual report",
    },
  });
  const output = collectPdfBuffer(doc);
  doc.registerFont("DejaVu", REGULAR_FONT);
  doc.registerFont("DejaVu-Bold", BOLD_FONT);

  const startPage = (sheetName: JolpSheetName, continuation: boolean): number => {
    doc.addPage();
    let y = 32;
    if (logo && !continuation) {
      doc.image(logo, MARGIN_X, y, { fit: [116, 34] });
    }
    y += logo && !continuation ? 42 : 0;

    doc.font("DejaVu-Bold").fontSize(9).fillColor("#111827");
    doc.text(report.company.name.trim(), MARGIN_X, y, {
      width: PAGE_WIDTH - 2 * MARGIN_X,
      lineGap: 1,
    });
    y = doc.y + 2;
    doc.font("DejaVu").fontSize(8);
    doc.text(report.company.street.trim(), MARGIN_X, y);
    y = doc.y + 1;
    doc.text(
      `${report.company.postalCode.trim()} ${report.company.city.trim()}`,
      MARGIN_X,
      y,
    );
    y = doc.y + 1;
    doc.text(`Matična številka: ${report.company.registrationNumber.trim()}`, MARGIN_X, y);
    y = doc.y + 8;

    const title =
      sheetName === "Bilanca stanja"
        ? `Bilanca stanja na dan 31.12.${report.year}`
        : `Izkaz poslovnega izida v obdobju od 1.1. do 31.12.${report.year}`;
    doc.font("DejaVu-Bold").fontSize(10);
    doc.text(continuation ? `${title} (nadaljevanje)` : title, MARGIN_X, y, {
      width: PAGE_WIDTH - 2 * MARGIN_X,
    });
    y = doc.y + 4;

    const headersY = y;
    doc.font("DejaVu").fontSize(7.5).fillColor("#374151");
    doc.text("Podatki so v EUR s centi", MARGIN_X, headersY, {
      width: PAGE_WIDTH - 2 * MARGIN_X,
      align: "right",
    });
    y = headersY + 13;
    doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).lineWidth(0.6).stroke("#9ca3af");
    y += 5;
    doc.font("DejaVu-Bold").fontSize(7.5).fillColor("#111827");
    doc.text("Postavka", MARGIN_X, y, { width: LABEL_WIDTH });
    doc.text(String(report.year), MARGIN_X + LABEL_WIDTH, y, {
      width: CURRENT_WIDTH,
      align: "right",
    });
    doc.text(String(report.year - 1), MARGIN_X + LABEL_WIDTH + CURRENT_WIDTH, y, {
      width: PREVIOUS_WIDTH,
      align: "right",
    });
    y += 13;
    doc.moveTo(MARGIN_X, y).lineTo(PAGE_WIDTH - MARGIN_X, y).lineWidth(0.35).stroke("#9ca3af");
    return y + 4;
  };

  let cursorY = 0;
  for (const sheetName of Object.keys(SECTION_ROWS) as JolpSheetName[]) {
    const worksheet = workbook.getWorksheet(sheetName)!;
    const rows = getRowsForSheet(report, sheetName);
    cursorY = startPage(sheetName, false);

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const sourceCell = worksheet.getCell(index + 14, 1);
      const bold = Boolean(sourceCell.font?.bold);
      const font = bold ? "DejaVu-Bold" : "DejaVu";
      const fontSize = 7.5;
      const labelHeight = doc.font(font).fontSize(fontSize).heightOfString(row.label, {
        width: LABEL_WIDTH - 5,
        lineGap: 1,
      });
      const rowHeight = Math.max(12, labelHeight + 2);
      if (cursorY + rowHeight > CONTENT_BOTTOM) {
        cursorY = startPage(sheetName, true);
      }
      doc.font(font).fontSize(fontSize).fillColor("#111827");
      doc.text(row.label, MARGIN_X, cursorY, {
        width: LABEL_WIDTH - 5,
        lineGap: 1,
      });
      doc.text(formatAmount(row.current), MARGIN_X + LABEL_WIDTH, cursorY, {
        width: CURRENT_WIDTH,
        align: "right",
        lineBreak: false,
      });
      doc.text(
        formatAmount(row.previous),
        MARGIN_X + LABEL_WIDTH + CURRENT_WIDTH,
        cursorY,
        { width: PREVIOUS_WIDTH, align: "right", lineBreak: false },
      );
      if (bold) {
        doc.moveTo(MARGIN_X, cursorY + rowHeight - 1)
          .lineTo(PAGE_WIDTH - MARGIN_X, cursorY + rowHeight - 1)
          .lineWidth(0.22)
          .stroke("#d1d5db");
      }
      cursorY += rowHeight;
    }
  }

  const pageRange = doc.bufferedPageRange();
  for (let index = pageRange.start; index < pageRange.start + pageRange.count; index++) {
    doc.switchToPage(index);
    doc.font("DejaVu").fontSize(7).fillColor("#6b7280");
    doc.text(
      `JOLP · Stran ${index + 1} / ${pageRange.count}`,
      MARGIN_X,
      FOOTER_Y,
      {
        width: PAGE_WIDTH - 2 * MARGIN_X,
        align: "center",
        lineBreak: false,
      },
    );
  }
  doc.end();
  return output;
}