import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import path from "node:path";

export interface SavedAmortizationReport {
  company: { naziv: string; naslov: string | null; podjetjeDavcna: string };
  companyIdentitySource?: "snapshot" | "current";
  leto: number;
  doMeseca: number;
  status: string;
  printedAt: Date;
  rows: { inventarnaSt: string; naziv: string; osnova: string; stopnja: string; obracunano: string;
    identitySource?: "snapshot" | "current" }[];
}

function metadata(report: SavedAmortizationReport) {
  const endDay = new Date(Date.UTC(report.leto, report.doMeseca, 0)).getUTCDate();
  return [
    report.company.naziv,
    report.company.naslov ?? "",
    `Davčna številka: ${report.company.podjetjeDavcna}`,
    `Amortizacijski obračun — leto ${report.leto}`,
    `Obdobje: 01.01.${report.leto}–${endDay}.${String(report.doMeseca).padStart(2, "0")}.${report.leto}`,
    `Status: ${report.status === "zakljucen" ? "Zaključen" : "Odprt"}`,
    `Datum tiska: ${report.printedAt.toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" })}`,
    "Vir: shranjeni obračun (brez ponovnega izračuna). Zneski v EUR.",
    report.companyIdentitySource === "snapshot"
      ? "Glava podjetja: posnetek ob shranitvi obračuna."
      : "Glava podjetja: trenutni register; zgodovinski posnetek manjka.",
    "Identiteta sredstva: posnetek ob shranitvi obračuna.",
    ...(report.rows.some(row => row.identitySource !== "snapshot")
      ? ["Izjema [R]: naziv in/ali inventarna št. iz trenutnega registra; zgodovinski podatek ni potrjen."]
      : []),
  ].filter(Boolean);
}

const headers = ["Inventarna št.", "Naziv sredstva", "Osnova (EUR)", "Stopnja (%)", "Amortizacija (EUR)"];
const total = (report: SavedAmortizationReport) =>
  report.rows.reduce((sum, row) => sum.plus(row.obracunano), new Decimal(0)).toFixed(2);
const assetName = (row: SavedAmortizationReport["rows"][number]) =>
  row.identitySource === "snapshot" ? row.naziv : `${row.naziv} [R]`;

export async function savedAmortizationExcel(report: SavedAmortizationReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Obračun");
  sheet.columns = [{ width: 20 }, { width: 60 }, { width: 23 }, { width: 18 }, { width: 25 }];
  for (const line of metadata(report)) sheet.addRow([line]);
  sheet.addRow([]);
  const header = sheet.addRow(headers);
  header.font = { bold: true };
  for (const row of report.rows) {
    sheet.addRow([row.inventarnaSt, assetName(row), Number(row.osnova), Number(row.stopnja), Number(row.obracunano)]);
  }
  sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: sheet.rowCount, column: 5 } };
  sheet.views = [{ state: "frozen", ySplit: header.number }];
  const sum = sheet.addRow(["SKUPAJ", "", "", "", Number(total(report))]);
  sum.font = { bold: true };
  for (let i = header.number + 1; i <= sheet.rowCount; i++) {
    for (const col of [3, 5]) sheet.getRow(i).getCell(col).numFmt = "#,##0.00";
    sheet.getRow(i).getCell(4).numFmt = "0.000";
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function savedAmortizationPdf(report: SavedAmortizationReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  const result = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const fonts = path.join(import.meta.dirname, "..", "assets", "fonts");
  doc.registerFont("regular", path.join(fonts, "DejaVuSans.ttf"));
  doc.registerFont("bold", path.join(fonts, "DejaVuSans-Bold.ttf"));
  doc.font("regular").fontSize(9);
  for (const line of metadata(report)) doc.text(line);
  doc.moveDown();
  const widths = [95, 335, 110, 95, 135];
  let y = doc.y;
  const drawRow = (values: string[], bold = false) => {
    doc.font(bold ? "bold" : "regular").fontSize(9);
    // Split oversized cells into bounded row continuations, without dropping text.
    const wrapped = values.map((value, i) => {
      const lines: string[] = [];
      let line = "";
      for (const char of value) {
        if (char === "\n" || doc.widthOfString(line + char) > widths[i] - 12) {
          lines.push(line);
          line = char === "\n" ? "" : char;
        } else line += char;
      }
      lines.push(line);
      return lines;
    });
    if (wrapped.some((lines) => lines.length > 20)) {
      const count = Math.max(...wrapped.map((lines) => lines.length));
      for (let offset = 0; offset < count; offset += 20) {
        drawRow(wrapped.map((lines) => lines.slice(offset, offset + 20).join("\n")), bold);
      }
      return;
    }
    const height = Math.max(22, ...values.map((value, i) =>
      doc.heightOfString(value, { width: widths[i] - 10 }) + 10));
    if (y + height > doc.page.height - 55) {
      doc.addPage();
      y = 36;
      drawRow(headers, true);
      doc.font(bold ? "bold" : "regular").fontSize(9);
    }
    let x = 36;
    values.forEach((value, i) => {
      doc.text(value, x + 5, y + 5, { width: widths[i] - 10, align: i > 1 ? "right" : "left" });
      x += widths[i];
    });
    y += height;
    doc.moveTo(36, y).lineTo(806, y).strokeColor("#cccccc").stroke();
  };
  const fmt = (value: string, digits: number) => Number(value).toLocaleString("sl-SI", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  drawRow(headers, true);
  for (const row of report.rows) {
    drawRow([row.inventarnaSt, assetName(row), fmt(row.osnova, 2), fmt(row.stopnja, 3), fmt(row.obracunano, 2)]);
  }
  drawRow(["SKUPAJ", `${report.rows.length} sredstev`, "", "", fmt(total(report), 2)], true);
  const pages = doc.bufferedPageRange();
  for (let page = 0; page < pages.count; page++) {
    doc.switchToPage(page);
    doc.font("regular").fontSize(8).text(`Stran ${page + 1} / ${pages.count}`, 36, doc.page.height - 35, {
      lineBreak: false,
    });
  }
  doc.end();
  return result;
}
