/**
 * Strežniška generacija PDF poročil (pdfkit — brez brskalnika).
 *
 * Podpira:
 *   - Bilanca stanja
 *   - Izkaz poslovnega izida
 *   - Bruto bilanca (preizkusna bilanca)
 *
 * Vse tri funkcije vrnejo Promise<Buffer> in se razrešijo šele, ko pdfkit
 * zaključi pisanje (stream 'end' dogodek) — ne takoj po doc.end().
 */

import PDFDocument from "pdfkit";

// ── Formatiranje ──────────────────────────────────────────────────────────────

function fmtNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Konstante ─────────────────────────────────────────────────────────────────

const MARGIN = 40;
const PAGE_W = 595.28; // A4 points
const USABLE_W = PAGE_W - MARGIN * 2;

const COLOR_PRIMARY   = "#1a1a2e";
const COLOR_MUTED     = "#6b7280";
const COLOR_LINE      = "#e5e7eb";
const COLOR_SECTION   = "#f3f4f6";
const COLOR_TOTAL     = "#e0e7ff";
const COLOR_POSITIVE  = "#166534";
const COLOR_NEGATIVE  = "#991b1b";

// ── Pomožna funkcija: zberi buffer iz pdfkit streama ─────────────────────────

function collectDocBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

// ── Skupne pomožne funkcije ────────────────────────────────────────────────────

function drawHeader(
  doc: InstanceType<typeof PDFDocument>,
  companyName: string,
  reportTitle: string,
  subtitle: string,
  page: number,
  totalPages: number,
): void {
  if (page === 1) {
    doc.font("Helvetica-Bold").fontSize(13).fillColor(COLOR_PRIMARY)
      .text(companyName, MARGIN, MARGIN);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLOR_PRIMARY)
      .text(reportTitle, MARGIN, MARGIN + 18);
    doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED)
      .text(subtitle, MARGIN, MARGIN + 33);
    doc.moveTo(MARGIN, MARGIN + 46).lineTo(PAGE_W - MARGIN, MARGIN + 46)
      .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  } else {
    doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED)
      .text(`${companyName} — ${reportTitle}`, MARGIN, MARGIN);
    doc.moveTo(MARGIN, MARGIN + 13).lineTo(PAGE_W - MARGIN, MARGIN + 13)
      .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  }
  // Footer
  const genDate = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
  doc.font("Helvetica").fontSize(7).fillColor("#9ca3af")
    .text(`Generirano: ${genDate}`, MARGIN, doc.page.height - MARGIN + 4, { continued: false })
    .text(`Stran ${page} / ${totalPages}`, MARGIN, doc.page.height - MARGIN + 4, { align: "right" });
  doc.fillColor(COLOR_PRIMARY);
}

function contentY(page: number): number {
  return page === 1 ? MARGIN + 55 : MARGIN + 20;
}

// ── Typi ──────────────────────────────────────────────────────────────────────

interface ReportLineItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  balance: string;
}

interface ReportSection {
  class: string;
  label: string;
  items: ReportLineItem[];
  subtotal: string;
}

interface BalanceSheetSide {
  sections: ReportSection[];
  total: string;
}

interface BalanceSheetData {
  aktiva: BalanceSheetSide;
  pasiva: BalanceSheetSide;
}

interface IncomeStatementSide {
  sections: ReportSection[];
  total: string;
}

interface IncomeStatementData {
  revenue: IncomeStatementSide;
  expenses: IncomeStatementSide;
  netResult: string;
}

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  turnoverDebit: string;
  turnoverCredit: string;
  balanceDebit: string;
  balanceCredit: string;
}

// ── Skupni renderer vrstic ────────────────────────────────────────────────────

interface PdfState {
  doc: InstanceType<typeof PDFDocument>;
  y: number;
  page: number;
  totalPages: number;
  companyName: string;
  reportTitle: string;
  subtitle: string;
}

function checkNewPage(state: PdfState, needed = 18): void {
  const bottomLimit = state.doc.page.height - MARGIN - 20;
  if (state.y + needed > bottomLimit) {
    state.doc.addPage();
    state.page++;
    drawHeader(state.doc, state.companyName, state.reportTitle, state.subtitle, state.page, state.totalPages);
    state.y = contentY(state.page);
  }
}

function drawSectionHeader(state: PdfState, label: string, subtotal: string, subtotalCmp?: string): void {
  checkNewPage(state, 20);
  const h = 17;
  state.doc.rect(MARGIN, state.y, USABLE_W, h).fillColor(COLOR_SECTION).fill();
  state.doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLOR_PRIMARY)
    .text(label, MARGIN + 6, state.y + 4, { width: USABLE_W - (subtotalCmp !== undefined ? 220 : 110) - 12, lineBreak: false });
  state.doc.font("Helvetica-Bold").fontSize(8.5)
    .text(fmtNum(subtotal), PAGE_W - MARGIN - (subtotalCmp !== undefined ? 220 : 110), state.y + 4, { width: 100, align: "right", lineBreak: false });
  if (subtotalCmp !== undefined) {
    state.doc.font("Helvetica").fontSize(8.5).fillColor(COLOR_MUTED)
      .text(fmtNum(subtotalCmp), PAGE_W - MARGIN - 110, state.y + 4, { width: 100, align: "right", lineBreak: false });
  }
  state.y += h + 2;
}

function drawAccountLine(state: PdfState, code: string, name: string, balance: string, cmpBalance?: string): void {
  checkNewPage(state, 15);
  const h = 14;
  state.doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_MUTED)
    .text(code, MARGIN + 14, state.y + 2, { width: 50, lineBreak: false });
  state.doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_PRIMARY)
    .text(name, MARGIN + 70, state.y + 2, { width: USABLE_W - 70 - (cmpBalance !== undefined ? 220 : 110) - 14, lineBreak: false });
  state.doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_PRIMARY)
    .text(fmtNum(balance), PAGE_W - MARGIN - (cmpBalance !== undefined ? 220 : 110), state.y + 2, { width: 100, align: "right", lineBreak: false });
  if (cmpBalance !== undefined) {
    state.doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_MUTED)
      .text(fmtNum(cmpBalance), PAGE_W - MARGIN - 110, state.y + 2, { width: 100, align: "right", lineBreak: false });
  }
  state.y += h;
}

function drawTotalRow(state: PdfState, label: string, value: string, cmpValue?: string, highlight = false): void {
  checkNewPage(state, 22);
  const h = 20;
  state.doc.rect(MARGIN, state.y, USABLE_W, h).fillColor(COLOR_TOTAL).fill();
  state.doc.font("Helvetica-Bold").fontSize(9).fillColor(COLOR_PRIMARY)
    .text(label, MARGIN + 6, state.y + 5, { width: USABLE_W - (cmpValue !== undefined ? 220 : 110) - 12, lineBreak: false });
  const n = parseFloat(value);
  const valueColor = highlight ? (n >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE) : COLOR_PRIMARY;
  state.doc.font("Helvetica-Bold").fontSize(9).fillColor(valueColor)
    .text(fmtNum(value), PAGE_W - MARGIN - (cmpValue !== undefined ? 220 : 110), state.y + 5, { width: 100, align: "right", lineBreak: false });
  if (cmpValue !== undefined) {
    state.doc.font("Helvetica-Bold").fontSize(9).fillColor(COLOR_MUTED)
      .text(fmtNum(cmpValue), PAGE_W - MARGIN - 110, state.y + 5, { width: 100, align: "right", lineBreak: false });
  }
  state.y += h + 4;
  state.doc.fillColor(COLOR_PRIMARY);
}

function drawGroupHeader(state: PdfState, label: string, datePrimary?: string, dateCmp?: string): void {
  checkNewPage(state, 22);
  state.doc.font("Helvetica-Bold").fontSize(11).fillColor(COLOR_PRIMARY)
    .text(label, MARGIN, state.y);
  if (datePrimary && dateCmp) {
    state.doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_MUTED)
      .text(datePrimary, PAGE_W - MARGIN - 220, state.y + 2, { width: 100, align: "right", lineBreak: false })
      .text(dateCmp, PAGE_W - MARGIN - 110, state.y + 2, { width: 100, align: "right", lineBreak: false });
  }
  state.y += 16;
  state.doc.moveTo(MARGIN, state.y).lineTo(PAGE_W - MARGIN, state.y)
    .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  state.y += 6;
}

// ── Bilanca stanja ────────────────────────────────────────────────────────────

function renderBalanceSheetSide(
  state: PdfState,
  sideLabel: string,
  data: BalanceSheetSide,
  cmpData?: BalanceSheetSide | null,
  dateLabel?: string,
  cmpLabel?: string,
): void {
  drawGroupHeader(state, sideLabel, dateLabel, cmpLabel ?? (cmpData ? "" : undefined));
  const showCmp = !!cmpData;

  for (const sec of data.sections) {
    const cmpSec = cmpData?.sections.find((s) => s.class === sec.class);
    drawSectionHeader(state, sec.label, sec.subtotal, showCmp ? (cmpSec?.subtotal ?? "0.00") : undefined);
    for (const item of sec.items) {
      const cmpItem = cmpSec?.items.find((ci) => ci.accountId === item.accountId);
      drawAccountLine(state, item.accountCode, item.accountName, item.balance, showCmp ? (cmpItem?.balance ?? "0.00") : undefined);
    }
    state.y += 4;
  }
  if (data.sections.length === 0) {
    state.doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED)
      .text("Ni knjiženih postavk.", MARGIN + 6, state.y);
    state.y += 14;
  }
  const totalLabel = sideLabel === "AKTIVA" ? "SKUPAJ AKTIVA" : "SKUPAJ PASIVA";
  drawTotalRow(state, totalLabel, data.total, showCmp ? cmpData?.total : undefined);
  state.y += 4;
}

export async function generateBalanceSheetPdf(opts: {
  companyName: string;
  asOf: string;
  compareAsOf?: string | null;
  current: BalanceSheetData;
  compare?: BalanceSheetData | null;
}): Promise<Buffer> {
  const { companyName, asOf, compareAsOf, current, compare } = opts;
  const reportTitle = "BILANCA STANJA";
  const subtitle = compareAsOf
    ? `Stanje na dan: ${asOf}  |  Primerjava: ${compareAsOf}`
    : `Stanje na dan: ${asOf}`;

  // Estimate pages (rough: 1 page per ~40 rows)
  const totalRows = current.aktiva.sections.reduce((s, sec) => s + sec.items.length + 1, 0)
    + current.pasiva.sections.reduce((s, sec) => s + sec.items.length + 1, 0) + 6;
  const totalPages = Math.max(1, Math.ceil(totalRows / 38));

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    bufferPages: true,
  });

  // Start collecting the buffer BEFORE calling doc.end()
  const bufferPromise = collectDocBuffer(doc);

  const state: PdfState = { doc, y: contentY(1), page: 1, totalPages, companyName, reportTitle, subtitle };
  drawHeader(doc, companyName, reportTitle, subtitle, 1, totalPages);

  renderBalanceSheetSide(state, "AKTIVA", current.aktiva, compare?.aktiva ?? null, asOf, compareAsOf ?? undefined);

  // Separator
  checkNewPage(state, 10);
  state.doc.moveTo(MARGIN, state.y).lineTo(PAGE_W - MARGIN, state.y)
    .strokeColor(COLOR_LINE).lineWidth(1).stroke();
  state.y += 8;

  renderBalanceSheetSide(state, "PASIVA", current.pasiva, compare?.pasiva ?? null);

  // Balance check
  const diff = Math.abs(parseFloat(current.aktiva.total) - parseFloat(current.pasiva.total));
  if (diff > 0.01) {
    checkNewPage(state, 20);
    state.doc.font("Helvetica-Bold").fontSize(8).fillColor(COLOR_NEGATIVE)
      .text(`Bilanca se ne ujema — razlika: ${fmtNum(diff.toFixed(2))} EUR`, MARGIN, state.y);
    state.y += 14;
  } else {
    checkNewPage(state, 14);
    state.doc.font("Helvetica").fontSize(8).fillColor(COLOR_POSITIVE)
      .text(`Bilanca uravnotezena (Aktiva = Pasiva = ${fmtNum(current.aktiva.total)} EUR)`, MARGIN, state.y);
    state.y += 14;
  }

  doc.end();
  return bufferPromise;
}

// ── Izkaz poslovnega izida ────────────────────────────────────────────────────

function renderIncomeSide(
  state: PdfState,
  sideLabel: string,
  data: IncomeStatementSide,
  cmpData?: IncomeStatementSide | null,
): void {
  const showCmp = !!cmpData;
  for (const sec of data.sections) {
    const cmpSec = cmpData?.sections.find((s) => s.class === sec.class);
    drawSectionHeader(state, sec.label, sec.subtotal, showCmp ? (cmpSec?.subtotal ?? "0.00") : undefined);
    for (const item of sec.items) {
      const cmpItem = cmpSec?.items.find((ci) => ci.accountId === item.accountId);
      drawAccountLine(state, item.accountCode, item.accountName, item.balance, showCmp ? (cmpItem?.balance ?? "0.00") : undefined);
    }
    state.y += 4;
  }
  if (data.sections.length === 0) {
    state.doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED)
      .text("Ni knjizenih postavk.", MARGIN + 6, state.y);
    state.y += 14;
  }
  const totalLabel = sideLabel === "PRIHODKI" ? "SKUPAJ PRIHODKI" : "SKUPAJ ODHODKI";
  drawTotalRow(state, totalLabel, data.total, showCmp ? cmpData?.total : undefined);
  state.y += 4;
}

export async function generateIncomeStatementPdf(opts: {
  companyName: string;
  dateFrom: string;
  dateTo: string;
  compareDateFrom?: string | null;
  compareDateTo?: string | null;
  current: IncomeStatementData;
  compare?: IncomeStatementData | null;
}): Promise<Buffer> {
  const { companyName, dateFrom, dateTo, compareDateFrom, compareDateTo, current, compare } = opts;
  const reportTitle = "IZKAZ POSLOVNEGA IZIDA";
  const subtitle = compareDateFrom
    ? `Obdobje: ${dateFrom} - ${dateTo}  |  Primerjava: ${compareDateFrom} - ${compareDateTo}`
    : `Obdobje: ${dateFrom} - ${dateTo}`;

  const totalRows = current.revenue.sections.reduce((s, sec) => s + sec.items.length + 1, 0)
    + current.expenses.sections.reduce((s, sec) => s + sec.items.length + 1, 0) + 6;
  const totalPages = Math.max(1, Math.ceil(totalRows / 38));

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    bufferPages: true,
  });

  const bufferPromise = collectDocBuffer(doc);

  const state: PdfState = { doc, y: contentY(1), page: 1, totalPages, companyName, reportTitle, subtitle };
  drawHeader(doc, companyName, reportTitle, subtitle, 1, totalPages);

  const datePrimary = `${dateFrom} - ${dateTo}`;
  const dateCmp = compareDateFrom ? `${compareDateFrom} - ${compareDateTo}` : undefined;
  drawGroupHeader(state, "PRIHODKI", datePrimary, dateCmp);
  renderIncomeSide(state, "PRIHODKI", current.revenue, compare?.revenue ?? null);

  checkNewPage(state, 10);
  state.doc.moveTo(MARGIN, state.y).lineTo(PAGE_W - MARGIN, state.y)
    .strokeColor(COLOR_LINE).lineWidth(0.8).stroke();
  state.y += 8;

  drawGroupHeader(state, "ODHODKI");
  renderIncomeSide(state, "ODHODKI", current.expenses, compare?.expenses ?? null);

  checkNewPage(state, 10);
  state.doc.moveTo(MARGIN, state.y).lineTo(PAGE_W - MARGIN, state.y)
    .strokeColor(COLOR_LINE).lineWidth(1).stroke();
  state.y += 6;

  drawTotalRow(state, "POSLOVNI IZID OBDOBJA", current.netResult, compare?.netResult ?? undefined, true);

  // Margin indicator
  const rev = parseFloat(current.revenue.total);
  if (rev > 0) {
    const margin = ((parseFloat(current.netResult) / rev) * 100).toFixed(1);
    checkNewPage(state, 14);
    state.doc.font("Helvetica").fontSize(8).fillColor(COLOR_MUTED)
      .text(`Marza poslovnega izida: ${margin}%`, MARGIN + 6, state.y);
    state.y += 14;
  }

  doc.end();
  return bufferPromise;
}

// ── Bruto bilanca ─────────────────────────────────────────────────────────────

export async function generateTrialBalancePdf(opts: {
  companyName: string;
  dateFrom: string;
  dateTo: string;
  rows: TrialBalanceRow[];
  totalTurnoverDebit: string;
  totalTurnoverCredit: string;
  totalBalanceDebit: string;
  totalBalanceCredit: string;
}): Promise<Buffer> {
  const { companyName, dateFrom, dateTo, rows } = opts;
  const reportTitle = "BRUTO BILANCA (PREIZKUSNA BILANCA)";
  const subtitle = `Obdobje: ${dateFrom} - ${dateTo}`;

  const totalPages = Math.max(1, Math.ceil((rows.length + 3) / 42));

  // Column layout: Code | Name | Promet D | Promet C | Saldo D | Saldo C
  const COL_CODE = MARGIN;
  const COL_NAME = MARGIN + 55;
  const COL_PROM_D = PAGE_W - MARGIN - 310;
  const COL_PROM_C = PAGE_W - MARGIN - 220;
  const COL_SAL_D  = PAGE_W - MARGIN - 115;
  const COL_SAL_C  = PAGE_W - MARGIN - 10;
  const NUM_W = 100;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    bufferPages: true,
  });

  const bufferPromise = collectDocBuffer(doc);

  const state: PdfState = { doc, y: contentY(1), page: 1, totalPages, companyName, reportTitle, subtitle };
  drawHeader(doc, companyName, reportTitle, subtitle, 1, totalPages);

  // Table header renderer
  function drawTableHeader() {
    const hY = state.y;
    doc.rect(MARGIN, hY, USABLE_W, 26).fillColor(COLOR_SECTION).fill();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(COLOR_PRIMARY);
    doc.text("Sifra", COL_CODE + 2, hY + 3, { width: 50, lineBreak: false });
    doc.text("Naziv konta", COL_NAME + 2, hY + 3, { width: 120, lineBreak: false });
    doc.text("Promet v obdobju", COL_PROM_D, hY + 3, { width: COL_PROM_C + NUM_W - COL_PROM_D, align: "center", lineBreak: false });
    doc.text("Saldo (kumulativno)", COL_SAL_D, hY + 3, { width: NUM_W, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor(COLOR_MUTED);
    doc.text("Breme", COL_PROM_D, hY + 15, { width: NUM_W, align: "right", lineBreak: false });
    doc.text("Dobro", COL_PROM_C, hY + 15, { width: NUM_W, align: "right", lineBreak: false });
    doc.text("Breme", COL_SAL_D, hY + 15, { width: NUM_W, align: "right", lineBreak: false });
    doc.text("Dobro", COL_SAL_C - NUM_W, hY + 15, { width: NUM_W, align: "right", lineBreak: false });
    state.y = hY + 28;
    state.doc.fillColor(COLOR_PRIMARY);
  }

  drawTableHeader();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    checkNewPage(state, 14);
    if (state.y === contentY(state.page)) drawTableHeader();

    const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
    doc.rect(MARGIN, state.y, USABLE_W, 13).fillColor(bg).fill();
    doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_MUTED)
      .text(row.accountCode, COL_CODE + 2, state.y + 2, { width: 50, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(COLOR_PRIMARY)
      .text(row.accountName, COL_NAME + 2, state.y + 2, { width: COL_PROM_D - COL_NAME - 8, lineBreak: false });

    const td = parseFloat(row.turnoverDebit);
    const tc = parseFloat(row.turnoverCredit);
    const bd = parseFloat(row.balanceDebit);
    const bc = parseFloat(row.balanceCredit);

    doc.font("Helvetica").fontSize(7.5).fillColor("#1d4ed8");
    if (td !== 0) doc.text(fmtNum(td), COL_PROM_D, state.y + 2, { width: NUM_W, align: "right", lineBreak: false });
    if (tc !== 0) doc.text(fmtNum(tc), COL_PROM_C, state.y + 2, { width: NUM_W, align: "right", lineBreak: false });
    doc.fillColor(COLOR_PRIMARY);
    if (bd !== 0) doc.font("Helvetica-Bold").fontSize(7.5).text(fmtNum(bd), COL_SAL_D, state.y + 2, { width: NUM_W, align: "right", lineBreak: false });
    if (bc !== 0) doc.font("Helvetica-Bold").fontSize(7.5).text(fmtNum(bc), COL_SAL_C - NUM_W, state.y + 2, { width: NUM_W, align: "right", lineBreak: false });

    state.y += 13;
  }

  // Totals row
  checkNewPage(state, 20);
  doc.rect(MARGIN, state.y, USABLE_W, 18).fillColor(COLOR_TOTAL).fill();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COLOR_PRIMARY)
    .text("SKUPAJ", COL_CODE + 2, state.y + 4, { width: 200, lineBreak: false });
  doc.fillColor("#1d4ed8");
  doc.text(fmtNum(opts.totalTurnoverDebit), COL_PROM_D, state.y + 4, { width: NUM_W, align: "right", lineBreak: false });
  doc.text(fmtNum(opts.totalTurnoverCredit), COL_PROM_C, state.y + 4, { width: NUM_W, align: "right", lineBreak: false });
  doc.fillColor(COLOR_PRIMARY);
  doc.text(fmtNum(opts.totalBalanceDebit), COL_SAL_D, state.y + 4, { width: NUM_W, align: "right", lineBreak: false });
  doc.text(fmtNum(opts.totalBalanceCredit), COL_SAL_C - NUM_W, state.y + 4, { width: NUM_W, align: "right", lineBreak: false });
  state.y += 22;

  // Balance check
  const balanced = parseFloat(opts.totalTurnoverDebit).toFixed(2) === parseFloat(opts.totalTurnoverCredit).toFixed(2);
  doc.font("Helvetica").fontSize(8).fillColor(balanced ? COLOR_POSITIVE : COLOR_NEGATIVE)
    .text(balanced ? "Bilanca uravnotezena" : "Bilanca ni uravnotezena", MARGIN, state.y);

  doc.end();
  return bufferPromise;
}
