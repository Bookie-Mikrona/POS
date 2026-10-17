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
 *
 * Fonti: DejaVu Sans (TTF, kopirani v dist/assets/fonts/ med buildom).
 * Helvetica / WinAnsi ne podpira šumnikov (š, č, ž …); DejaVu podpira.
 */

import PDFDocument from "pdfkit";
import path from "path";
import QRCode from "qrcode";
import { drawReportDiagnostics, drawReportDiagnosticsNotice, hasReportDiagnostics, finalizeReportPageNumbers, type ReportDiagnostics } from "./report-pdf-diagnostics";

// ── Pot do fontov ─────────────────────────────────────────────────────────────
// report-pdf.ts živi v src/lib/ (dev) oz. dist/lib/ (build).
// Fonti so en nivo višje: src/assets/fonts/ oz. dist/assets/fonts/.
// ".." dvigne iz lib/ na src|dist/, nato "assets/fonts".

const FONT_DIR  = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG  = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");

// ── Formatiranje ──────────────────────────────────────────────────────────────

function fmtNum(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSignedCents(cents: number): string {
  const normalized = Object.is(cents, -0) || cents === 0 ? 0 : cents;
  const formatted = fmtNum(normalized / 100);
  return normalized > 0 ? `+${formatted}` : formatted;
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

/** Registrira DejaVu fonti na novem PDFDocument objektu. */
function registerFonts(doc: InstanceType<typeof PDFDocument>): void {
  doc.registerFont("DejaVuSans",      FONT_REG);
  doc.registerFont("DejaVuSans-Bold", FONT_BOLD);
}

// ── Skupne pomožne funkcije ────────────────────────────────────────────────────

function drawHeader(
  doc: InstanceType<typeof PDFDocument>,
  companyName: string,
  reportTitle: string,
  subtitle: string,
  page: number,
  totalPages: number,
  deferFooter = false,
): void {
  if (page === 1) {
    doc.font("DejaVuSans-Bold").fontSize(13).fillColor(COLOR_PRIMARY)
      .text(companyName, MARGIN, MARGIN);
    doc.font("DejaVuSans-Bold").fontSize(11).fillColor(COLOR_PRIMARY)
      .text(reportTitle, MARGIN, MARGIN + 18);
    doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_MUTED)
      .text(subtitle, MARGIN, MARGIN + 33);
    doc.moveTo(MARGIN, MARGIN + 46).lineTo(PAGE_W - MARGIN, MARGIN + 46)
      .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  } else {
    doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_MUTED)
      .text(`${companyName} — ${reportTitle}`, MARGIN, MARGIN);
    doc.moveTo(MARGIN, MARGIN + 13).lineTo(PAGE_W - MARGIN, MARGIN + 13)
      .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  }
  // Footer — lineBreak: false prepreči cursor overflow čez spodnji rob strani,
  // ki bi ob naslednjem doc.text() sprožil PDFKit auto-addPage (prazna vmesna stran).
  if (!deferFooter) {
    const genDate = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
    doc.font("DejaVuSans").fontSize(7).fillColor("#9ca3af")
      .text(`Generirano: ${genDate}`, MARGIN, doc.page.height - MARGIN - 5, { continued: false, lineBreak: false })
      .text(`Stran ${page} / ${totalPages}`, MARGIN, doc.page.height - MARGIN - 5, { align: "right", lineBreak: false });
  }
  // Vrni PDFKit kazalec na začetek vsebine — prepreči auto-addPage pri prvem
  // eksplicitnem doc.text() klicu po tej glavi (brez tega nastane prazna stran 2).
  doc.y = page === 1 ? MARGIN + 55 : MARGIN + 20;
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

interface BalanceSheetData extends ReportDiagnostics {
  aktiva: BalanceSheetSide;
  pasiva: BalanceSheetSide;
}

interface IncomeStatementSide {
  sections: ReportSection[];
  total: string;
}

interface IncomeStatementData extends ReportDiagnostics {
  revenue: IncomeStatementSide;
  expenses: IncomeStatementSide;
  netResult: string;
}

interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingBalanceDebit: string;
  openingBalanceCredit: string;
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
  deferPageNumbers?: boolean;
}

function checkNewPage(state: PdfState, needed = 18): void {
  const bottomLimit = state.doc.page.height - MARGIN - 20;
  if (state.y + needed > bottomLimit) {
    state.doc.addPage();
    state.page++;
    drawHeader(state.doc, state.companyName, state.reportTitle, state.subtitle, state.page, state.totalPages, state.deferPageNumbers);
    state.y = contentY(state.page);
  }
}

function drawSectionHeader(state: PdfState, label: string, subtotal: string, subtotalCmp?: string): void {
  checkNewPage(state, 20);
  const h = 17;
  state.doc.rect(MARGIN, state.y, USABLE_W, h).fillColor(COLOR_SECTION).fill();
  state.doc.font("DejaVuSans-Bold").fontSize(8.5).fillColor(COLOR_PRIMARY)
    .text(label, MARGIN + 6, state.y + 4, { width: USABLE_W - (subtotalCmp !== undefined ? 220 : 110) - 12, lineBreak: false });
  state.doc.font("DejaVuSans-Bold").fontSize(8.5)
    .text(fmtNum(subtotal), PAGE_W - MARGIN - (subtotalCmp !== undefined ? 220 : 110), state.y + 4, { width: 100, align: "right", lineBreak: false });
  if (subtotalCmp !== undefined) {
    state.doc.font("DejaVuSans").fontSize(8.5).fillColor(COLOR_MUTED)
      .text(fmtNum(subtotalCmp), PAGE_W - MARGIN - 110, state.y + 4, { width: 100, align: "right", lineBreak: false });
  }
  state.y += h + 2;
}

function drawAccountLine(state: PdfState, code: string, name: string, balance: string, cmpBalance?: string): void {
  checkNewPage(state, 15);
  const h = 14;
  state.doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
    .text(code, MARGIN + 14, state.y + 2, { width: 50, lineBreak: false });
  state.doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_PRIMARY)
    .text(name, MARGIN + 70, state.y + 2, { width: USABLE_W - 70 - (cmpBalance !== undefined ? 220 : 110) - 14, lineBreak: false });
  state.doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_PRIMARY)
    .text(fmtNum(balance), PAGE_W - MARGIN - (cmpBalance !== undefined ? 220 : 110), state.y + 2, { width: 100, align: "right", lineBreak: false });
  if (cmpBalance !== undefined) {
    state.doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
      .text(fmtNum(cmpBalance), PAGE_W - MARGIN - 110, state.y + 2, { width: 100, align: "right", lineBreak: false });
  }
  state.y += h;
}

function drawTotalRow(state: PdfState, label: string, value: string, cmpValue?: string, highlight = false): void {
  checkNewPage(state, 22);
  const h = 20;
  state.doc.rect(MARGIN, state.y, USABLE_W, h).fillColor(COLOR_TOTAL).fill();
  state.doc.font("DejaVuSans-Bold").fontSize(9).fillColor(COLOR_PRIMARY)
    .text(label, MARGIN + 6, state.y + 5, { width: USABLE_W - (cmpValue !== undefined ? 220 : 110) - 12, lineBreak: false });
  const n = parseFloat(value);
  const valueColor = highlight ? (n >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE) : COLOR_PRIMARY;

  // Smer rezultata: (+) / (-) pred zneskom (brez SVG ikon)
  const displayValue = highlight
    ? `${n > 0 ? "(+) " : n < 0 ? "(-) " : ""}${fmtNum(value)}`
    : fmtNum(value);

  state.doc.font("DejaVuSans-Bold").fontSize(9).fillColor(valueColor)
    .text(displayValue, PAGE_W - MARGIN - (cmpValue !== undefined ? 220 : 110), state.y + 5, { width: 100, align: "right", lineBreak: false });
  if (cmpValue !== undefined) {
    state.doc.font("DejaVuSans-Bold").fontSize(9).fillColor(COLOR_MUTED)
      .text(fmtNum(cmpValue), PAGE_W - MARGIN - 110, state.y + 5, { width: 100, align: "right", lineBreak: false });
  }
  state.y += h + 4;
  state.doc.fillColor(COLOR_PRIMARY);
}

function drawGroupHeader(state: PdfState, label: string, datePrimary?: string, dateCmp?: string): void {
  checkNewPage(state, 22);
  state.doc.font("DejaVuSans-Bold").fontSize(11).fillColor(COLOR_PRIMARY)
    .text(label, MARGIN, state.y);
  if (datePrimary && dateCmp) {
    state.doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
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
    state.doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_MUTED)
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

  // Ocena strani (grobo: ~40 vrstic na stran)
  const totalRows = current.aktiva.sections.reduce((s, sec) => s + sec.items.length + 1, 0)
    + current.pasiva.sections.reduce((s, sec) => s + sec.items.length + 1, 0) + 6;
  const totalPages = Math.max(1, Math.ceil(totalRows / 38));

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    bufferPages: true,
  });
  registerFonts(doc);

  const bufferPromise = collectDocBuffer(doc);

  const state: PdfState = { doc, y: contentY(1), page: 1, totalPages, companyName, reportTitle, subtitle, deferPageNumbers: true };
  drawHeader(doc, companyName, reportTitle, subtitle, 1, totalPages, true);
  if (hasReportDiagnostics(current) || hasReportDiagnostics(compare)) drawReportDiagnosticsNotice(state, MARGIN);

  renderBalanceSheetSide(state, "AKTIVA", current.aktiva, compare?.aktiva ?? null, asOf, compareAsOf ?? undefined);

  // Ločilna črta
  checkNewPage(state, 10);
  state.doc.moveTo(MARGIN, state.y).lineTo(PAGE_W - MARGIN, state.y)
    .strokeColor(COLOR_LINE).lineWidth(1).stroke();
  state.y += 8;

  renderBalanceSheetSide(state, "PASIVA", current.pasiva, compare?.pasiva ?? null);

  // Kontrola bilance
  const diff = Math.abs(parseFloat(current.aktiva.total) - parseFloat(current.pasiva.total));
  if (diff > 0.01) {
    checkNewPage(state, 20);
    state.doc.font("DejaVuSans-Bold").fontSize(8).fillColor(COLOR_NEGATIVE)
      .text(`Bilanca se ne ujema — razlika: ${fmtNum(diff.toFixed(2))} EUR`, MARGIN, state.y);
    state.y += 14;
  } else {
    checkNewPage(state, 14);
    state.doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_POSITIVE)
      .text(`Bilanca uravnotežena (Aktiva = Pasiva = ${fmtNum(current.aktiva.total)} EUR)`, MARGIN, state.y);
    state.y += 14;
  }

  drawReportDiagnostics(state, current, `Osnovno poročilo: ${asOf}`, MARGIN, checkNewPage);
  if (compare) drawReportDiagnostics(state, compare, `Primerjalno poročilo: ${compareAsOf ?? ""}`, MARGIN, checkNewPage);
  finalizeReportPageNumbers(doc, MARGIN);
  doc.end();
  return bufferPromise;
}

export type QrMizaPdfItem = {
  stevilka: number;
  ime: string | null;
  javniUrl: string;
};

export function buildQrMizaPdfContent(
  miza: QrMizaPdfItem,
  prostorNaziv: string,
  qrWifiSsid: string | null = null,
  qrWifiPassword: string | null = null,
) {
  return {
    mizaNaziv: miza.ime?.trim() || `Miza ${miza.stevilka}`,
    prostor: `Prostor: ${prostorNaziv}`,
    navodila: [
      "1. Skenirajte QR kodo s fotoaparatom telefona.",
      "2. Odprite povezavo in dovolite uporabo lokacije (GPS).",
      "3. Če GPS ni dosegljiv ali dovolj natančen, se povežite na spodnji Wi-Fi in poskusite znova.",
    ],
    wifiSsid: qrWifiSsid?.trim() || "Ni nastavljeno",
    wifiPassword: qrWifiPassword && qrWifiPassword.trim() !== "" ? qrWifiPassword : "Ni nastavljeno",
    slogan: "Naročite hitro, uživajte dlje.",
    pomoc: "Če se meni ne aktivira, prosite osebje za pomoč.",
  };
}

/**
 * A4 tiskovni izpis QR kod za mize.
 *
 * Vsaka miza dobi svojo stran A4, da je list mogoče namestiti neposredno na
 * ustrezno mizo brez rezanja ali ugibanja, kam sodi QR koda.
 */
export async function generateQrMizePdf(opts: {
  podjetjeNaziv: string;
  enotaNaziv: string;
  prostorNaziv: string;
  qrWifiSsid?: string | null;
  qrWifiPassword?: string | null;
  createdAt: Date;
  mize: QrMizaPdfItem[];
}): Promise<Buffer> {
  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const margin = 42;
  const cardWidth = PAGE_W - margin * 2;
  const createdDate = opts.createdAt.toLocaleDateString("sl-SI", {
    timeZone: "Europe/Ljubljana",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    autoFirstPage: true,
  });
  registerFonts(doc);
  const bufferPromise = collectDocBuffer(doc);

  const drawPageChrome = () => {
    doc.roundedRect(margin, 28, cardWidth, 6, 3)
      .fillColor("#2563eb").fill();
    doc.font("DejaVuSans-Bold").fontSize(14).fillColor(COLOR_PRIMARY)
      .text(opts.podjetjeNaziv, margin, 44, {
        width: cardWidth,
        height: 18,
        lineBreak: false,
        ellipsis: true,
      });
    doc.font("DejaVuSans").fontSize(9).fillColor(COLOR_MUTED)
      .text(`Enota: ${opts.enotaNaziv}`, margin, 66, {
        width: cardWidth,
        height: 13,
        lineBreak: false,
        ellipsis: true,
      })
      .text(`Prostor: ${opts.prostorNaziv}`, margin, 82, {
        width: cardWidth,
        height: 13,
        lineBreak: false,
        ellipsis: true,
      });
    doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
      .text(`QR naročanje  ·  Izdelano ${createdDate}`, margin, 99, {
        width: cardWidth,
        height: 11,
        lineBreak: false,
        ellipsis: true,
      });
    doc.moveTo(margin, 115).lineTo(PAGE_W - margin, 115)
      .strokeColor("#dbe4f0").lineWidth(0.8).stroke();
  };

  const drawQrPage = async (miza: QrMizaPdfItem) => {
    const qrDataUrl = await QRCode.toDataURL(miza.javniUrl, {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 800,
      color: { dark: "#14213d", light: "#ffffff" },
    });

    const content = buildQrMizaPdfContent(
      miza,
      opts.prostorNaziv,
      opts.qrWifiSsid ?? null,
      opts.qrWifiPassword ?? null,
    );
    const qrBox = 230;
    const qrX = (PAGE_W - qrBox) / 2;
    const qrY = 240;
    const panelX = margin;
    const panelW = cardWidth;

    doc.roundedRect(panelX, 128, panelW, 90, 16)
      .fillColor("#eff6ff").fill()
      .lineWidth(1).strokeColor("#bfdbfe").stroke();
    doc.font("DejaVuSans-Bold").fontSize(9).fillColor("#2563eb")
      .text("DOBRODOŠLI", panelX + 22, 144, { width: panelW - 44, lineBreak: false });
    doc.font("DejaVuSans-Bold").fontSize(27).fillColor(COLOR_PRIMARY)
      .text(content.mizaNaziv, panelX + 22, 161, {
        width: panelW - 44,
        height: 34,
        lineBreak: false,
        ellipsis: true,
      });
    doc.font("DejaVuSans").fontSize(10).fillColor(COLOR_MUTED)
      .text(content.prostor, panelX + 22, 196, {
        width: panelW - 44,
        lineBreak: false,
        ellipsis: true,
      });

    doc.roundedRect(qrX - 18, qrY - 18, qrBox + 36, qrBox + 36, 18)
      .fillColor("#ffffff").fill()
      .lineWidth(1).strokeColor("#dbe4f0").stroke();
    doc.image(qrDataUrl, qrX, qrY, { width: qrBox, height: qrBox });
    doc.font("DejaVuSans-Bold").fontSize(11).fillColor(COLOR_PRIMARY)
      .text("Skenirajte za meni", qrX - 18, qrY + qrBox + 30, {
        width: qrBox + 36,
        align: "center",
        lineBreak: false,
      });
    doc.font("DejaVuSans").fontSize(8.5).fillColor(COLOR_MUTED)
      .text("Vaš meni. Vaš tempo. Vaša miza.", qrX - 18, qrY + qrBox + 48, {
        width: qrBox + 36,
        align: "center",
        lineBreak: false,
      });

    const instructionY = 552;
    doc.roundedRect(panelX, instructionY, panelW, 190, 14)
      .fillColor("#f8fafc").fill()
      .lineWidth(1).strokeColor("#e2e8f0").stroke();
    doc.font("DejaVuSans-Bold").fontSize(13).fillColor(COLOR_PRIMARY)
      .text("Kako odprete QR meni?", panelX + 20, instructionY + 18, {
        width: panelW - 40,
        lineBreak: false,
      });
    const instructionPositions = [instructionY + 47, instructionY + 66, instructionY + 85];
    content.navodila.forEach((navodilo, index) => {
      doc.font("DejaVuSans").fontSize(9.5).fillColor(COLOR_PRIMARY)
        .text(navodilo, panelX + 20, instructionPositions[index], {
          width: panelW - 40,
          height: index === 2 ? 28 : 15,
          lineBreak: index === 2,
          ellipsis: true,
        });
    });

    const wifiBoxY = instructionY + 119;
    doc.roundedRect(panelX + 20, wifiBoxY, panelW - 40, 54, 9)
      .fillColor("#ffffff").fill()
      .lineWidth(1).strokeColor("#bfdbfe").stroke();
    doc.font("DejaVuSans-Bold").fontSize(8.5).fillColor("#2563eb")
      .text("WI-FI AP / SSID", panelX + 32, wifiBoxY + 10, {
        width: 88,
        lineBreak: false,
      })
      .text("GESLO", panelX + 32, wifiBoxY + 31, {
        width: 88,
        lineBreak: false,
      });
    doc.font("DejaVuSans-Bold").fontSize(10).fillColor(COLOR_PRIMARY)
      .text(content.wifiSsid, panelX + 124, wifiBoxY + 8, {
        width: panelW - 156,
        height: 15,
        lineBreak: false,
        ellipsis: true,
      })
      .text(content.wifiPassword, panelX + 124, wifiBoxY + 29, {
        width: panelW - 156,
        height: 15,
        lineBreak: false,
        ellipsis: true,
      });

    doc.font("DejaVuSans-Bold").fontSize(12).fillColor("#2563eb")
      .text(content.slogan, panelX, 754, {
        width: panelW,
        align: "center",
        lineBreak: false,
      });
    doc.font("DejaVuSans").fontSize(7).fillColor("#94a3b8")
      .text(content.pomoc, panelX, 774, {
        width: panelW,
        align: "center",
        lineBreak: false,
      });
    doc.font("DejaVuSans").fontSize(6.5).fillColor("#94a3b8")
      .text(miza.javniUrl, panelX, 791, {
        width: panelW,
        align: "center",
        lineBreak: false,
        ellipsis: true,
      });
  };

  drawPageChrome();
  for (let index = 0; index < opts.mize.length; index += 1) {
    if (index > 0) {
      doc.addPage();
      drawPageChrome();
    }
    await drawQrPage(opts.mize[index]);
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
    state.doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_MUTED)
      .text("Ni knjiženih postavk.", MARGIN + 6, state.y);
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
  registerFonts(doc);

  const bufferPromise = collectDocBuffer(doc);

  const state: PdfState = { doc, y: contentY(1), page: 1, totalPages, companyName, reportTitle, subtitle, deferPageNumbers: true };
  drawHeader(doc, companyName, reportTitle, subtitle, 1, totalPages, true);
  if (hasReportDiagnostics(current) || hasReportDiagnostics(compare)) drawReportDiagnosticsNotice(state, MARGIN);

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

  // Marža
  const rev = parseFloat(current.revenue.total);
  if (rev > 0) {
    const marza = ((parseFloat(current.netResult) / rev) * 100).toFixed(1);
    checkNewPage(state, 14);
    state.doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_MUTED)
      .text(`Marža poslovnega izida: ${marza}%`, MARGIN + 6, state.y);
    state.y += 14;
  }

  drawReportDiagnostics(state, current, `Osnovno obdobje: ${dateFrom} – ${dateTo}`, MARGIN, checkNewPage);
  if (compare) drawReportDiagnostics(state, compare, `Primerjalno obdobje: ${compareDateFrom ?? ""} – ${compareDateTo ?? ""}`, MARGIN, checkNewPage);
  finalizeReportPageNumbers(doc, MARGIN);
  doc.end();
  return bufferPromise;
}

// ── Bruto bilanca ─────────────────────────────────────────────────────────────

type LedgerView = "bilanca" | "zakljucni";
type LedgerField = "openingBalanceDebit" | "openingBalanceCredit" | "turnoverDebit" |
  "turnoverCredit" | "balanceDebit" | "balanceCredit";

/**
 * Account ledger in the form of the submitted Bilanca / Zaključni račun.
 * All three signed saldo columns are debit minus credit, NOT natural-side balances.
 */
async function generateLedgerStatementPdf(opts: {
  companyName: string; dateFrom: string; dateTo: string;
  rows: TrialBalanceRow[]; statementView: LedgerView;
  accountClass?: string;
}): Promise<Buffer> {
  const { companyName, dateFrom, dateTo, rows, statementView } = opts;
  const closing = statementView === "bilanca";
  const headers = closing
    ? ["Debet", "Kredit", "Saldo"]
    : ["Debet OTV", "Kredit OTV", "Saldo OTV", "Debet tekoči", "Kredit tekoči", "Saldo tekoči", "Debet skupaj", "Kredit skupaj", "Saldo"];
  const pairs: [LedgerField, LedgerField][] = closing
    ? [["balanceDebit", "balanceCredit"]]
    : [["openingBalanceDebit", "openingBalanceCredit"], ["turnoverDebit", "turnoverCredit"], ["balanceDebit", "balanceCredit"]];
  const width = closing ? 841.89 : 1190.55;
  const height = closing ? 595.28 : 841.89;
  const numericWidth = closing ? 114 : 92;
  const leftWidth = closing ? 350 : 275;
  const numX = MARGIN + leftWidth;
  const title = (closing ? "BILANCA KONTOV" : "ZAKLJUČNI RAČUN") +
    (opts.accountClass ? ` — Razred ${opts.accountClass}` : "");
  const doc = new PDFDocument({
    size: [width, height],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    autoFirstPage: false,
  });
  registerFonts(doc);
  const bufferPromise = collectDocBuffer(doc);
  let y = 0;

  const amount = (row: TrialBalanceRow, field: LedgerField) => Number(row[field]);
  const values = (subset: TrialBalanceRow[]): number[] =>
    pairs.flatMap(([debit, credit]) => {
      const d = subset.reduce((sum, row) => sum + amount(row, debit), 0);
      const c = subset.reduce((sum, row) => sum + amount(row, credit), 0);
      return [d, c, d - c];
    });
  const drawAmounts = (numbers: number[], atY: number, bold = false) => {
    doc.font(bold ? "DejaVuSans-Bold" : "DejaVuSans").fontSize(closing ? 8 : 7);
    numbers.forEach((number, i) => doc.text(fmtNum(number), numX + i * numericWidth, atY, {
      width: numericWidth - 5, align: "right", lineBreak: false, height: 12,
    }));
  };
  const addPage = () => {
    doc.addPage({ size: [width, height] });
    y = 37;
    doc.font("DejaVuSans-Bold").fontSize(10).fillColor(COLOR_PRIMARY)
      .text(companyName, MARGIN, y, { width: width - 2 * MARGIN, lineBreak: false });
    y += 17;
    doc.font("DejaVuSans-Bold").fontSize(11).text(title, MARGIN, y, { lineBreak: false });
    doc.font("DejaVuSans").fontSize(8).text(`${dateFrom} – ${dateTo}  ·  konti nove GK`, MARGIN + 310, y + 2, { lineBreak: false });
    y += 25;
    doc.rect(MARGIN, y, width - 2 * MARGIN, 19).fillColor(COLOR_SECTION).fill();
    doc.font("DejaVuSans-Bold").fontSize(closing ? 8 : 6.8).fillColor(COLOR_PRIMARY);
    doc.text("Konto", MARGIN + 3, y + 4, { width: 65, lineBreak: false });
    doc.text("Naziv konta", MARGIN + 76, y + 4, { width: leftWidth - 78, lineBreak: false });
    headers.forEach((header, i) => doc.text(header, numX + i * numericWidth, y + 4, {
      width: numericWidth - 5, align: "right", lineBreak: false, height: 11,
    }));
    y += 23;
  };
  const ensureSpace = (needed = 17) => {
    // PDFKit can paginate positioned text near the bottom independently of our
    // row cursor; leave enough clearance to keep every account on one page.
    if (y + needed > height - MARGIN - 70) addPage();
  };
  addPage();
  let group: string | null = null;
  let groupRows: TrialBalanceRow[] = [];
  const drawSubtotal = () => {
    if (!groupRows.length) return;
    ensureSpace(21);
    doc.rect(MARGIN, y, width - 2 * MARGIN, 17).fillColor(COLOR_SECTION).fill();
    doc.font("DejaVuSans-Bold").fontSize(8).fillColor(COLOR_PRIMARY)
      .text(`Skupaj razred ${group}`, MARGIN + 3, y + 3, { width: leftWidth - 5, lineBreak: false });
    drawAmounts(values(groupRows), y + 3, true);
    y += 20;
  };
  for (const row of rows) {
    const digit = row.accountCode.slice(0, 1);
    if (group !== digit) {
      drawSubtotal();
      group = digit;
      groupRows = [];
    }
    ensureSpace();
    doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_PRIMARY);
    doc.text(row.accountCode, MARGIN + 3, y + 2, { width: 68, lineBreak: false });
    doc.text(row.accountName, MARGIN + 76, y + 2, { width: leftWidth - 78, lineBreak: false, ellipsis: true });
    drawAmounts(values([row]), y + 2);
    y += 16;
    groupRows.push(row);
  }
  drawSubtotal();
  ensureSpace(25);
  doc.rect(MARGIN, y, width - 2 * MARGIN, 21).fillColor(COLOR_TOTAL).fill();
  doc.font("DejaVuSans-Bold").fontSize(9).fillColor(COLOR_PRIMARY)
    .text("SKUPAJ", MARGIN + 3, y + 5, { width: leftWidth - 5, lineBreak: false });
  drawAmounts(values(rows), y + 5, true);
  doc.end();
  return bufferPromise;
}

export async function generateTrialBalancePdf(opts: {
  companyName: string;
  dateFrom: string;
  dateTo: string;
  rows: TrialBalanceRow[];
  totalOpeningBalanceDebit: string;
  totalOpeningBalanceCredit: string;
  totalTurnoverDebit: string;
  totalTurnoverCredit: string;
  totalBalanceDebit: string;
  totalBalanceCredit: string;
  statementView?: LedgerView;
  accountClass?: string;
}): Promise<Buffer> {
  if (opts.statementView) return generateLedgerStatementPdf({ ...opts, statementView: opts.statementView });
  const { companyName, dateFrom, dateTo, rows } = opts;
  const reportTitle = "BRUTO BILANCA (PREIZKUSNA BILANCA)" +
    (opts.accountClass ? ` — Razred ${opts.accountClass}` : "");
  const subtitle = `Obdobje: ${dateFrom} - ${dateTo} · Neto saldo: + breme / − dobro`;

  // A4 ležeče za 8-stolpčno postavitev
  const PAGE_W_L = 841.89;
  const PAGE_H_L = 595.28;
  const USABLE_W_L = PAGE_W_L - MARGIN * 2;
  const NUM_W_L = 72;

  // Stolpčne pozicije (ležeče)
  const COL_CODE  = MARGIN;
  const COL_NAME  = MARGIN + 55;
  const COL_NET    = PAGE_W_L - MARGIN - NUM_W_L;
  const COL_SAL_C  = COL_NET - NUM_W_L - 4;
  const COL_SAL_D  = COL_SAL_C - NUM_W_L - 4;
  const COL_PROM_C = COL_SAL_D - NUM_W_L - 4;
  const COL_PROM_D = COL_PROM_C - NUM_W_L - 4;
  const COL_OB_C   = COL_PROM_D - NUM_W_L - 4;
  const COL_OB_D   = COL_OB_C - NUM_W_L - 4;
  const NAME_W     = COL_OB_D - COL_NAME - 8;

  const ROW_HEIGHT = 12;
  const FOOTER_Y = PAGE_H_L - MARGIN - 15;
  const CONTENT_BOTTOM = FOOTER_Y - 12;

  const doc = new PDFDocument({
    size: [PAGE_W_L, PAGE_H_L],
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    bufferPages: true,
  });
  registerFonts(doc);

  const bufferPromise = collectDocBuffer(doc);

  function drawLandscapeHeader(page: number) {
    if (page === 1) {
      doc.font("DejaVuSans-Bold").fontSize(12).fillColor(COLOR_PRIMARY)
        .text(companyName, MARGIN, MARGIN);
      doc.font("DejaVuSans-Bold").fontSize(10)
        .text(reportTitle, MARGIN, MARGIN + 17);
      doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_MUTED)
        .text(subtitle, MARGIN, MARGIN + 31);
      doc.moveTo(MARGIN, MARGIN + 43).lineTo(PAGE_W_L - MARGIN, MARGIN + 43)
        .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
    } else {
      doc.font("DejaVuSans").fontSize(8).fillColor(COLOR_MUTED)
        .text(`${companyName} — ${reportTitle}`, MARGIN, MARGIN);
      doc.moveTo(MARGIN, MARGIN + 13).lineTo(PAGE_W_L - MARGIN, MARGIN + 13)
        .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
    }
    doc.fillColor(COLOR_PRIMARY);
  }

  let currentPage = 1;
  let y = MARGIN + 50;

  drawLandscapeHeader(1);

  function contentStartY(page: number) {
    return page === 1 ? MARGIN + 50 : MARGIN + 20;
  }

  function drawTableHeader() {
    const hY = y;
    doc.rect(MARGIN, hY, USABLE_W_L, 26).fillColor(COLOR_SECTION).fill();
    doc.font("DejaVuSans-Bold").fontSize(7).fillColor(COLOR_PRIMARY);
    doc.text("Šifra",       COL_CODE + 2, hY + 3, { width: 50,                          lineBreak: false });
    doc.text("Naziv konta", COL_NAME + 2, hY + 3, { width: NAME_W,                      lineBreak: false });
    // Skupinska oznaka stolpcev
    doc.text("Začetni saldo",    COL_OB_D,   hY + 3, { width: NUM_W_L * 2 + 4, align: "center", lineBreak: false });
    doc.text("Promet v obdobju", COL_PROM_D, hY + 3, { width: NUM_W_L * 2 + 4, align: "center", lineBreak: false });
    doc.text("Skupaj — breme/dobro", COL_SAL_D, hY + 3, { width: NUM_W_L * 2 + 4, align: "center", lineBreak: false });
    doc.text("Neto saldo", COL_NET, hY + 3, { width: NUM_W_L, align: "center", lineBreak: false });
    // Pod-oznake
    doc.font("DejaVuSans").fontSize(6.5).fillColor(COLOR_MUTED);
    doc.text("Breme", COL_OB_D,   hY + 16, { width: NUM_W_L, align: "right", lineBreak: false });
    doc.text("Dobro", COL_OB_C,   hY + 16, { width: NUM_W_L, align: "right", lineBreak: false });
    doc.text("Breme", COL_PROM_D, hY + 16, { width: NUM_W_L, align: "right", lineBreak: false });
    doc.text("Dobro", COL_PROM_C, hY + 16, { width: NUM_W_L, align: "right", lineBreak: false });
    doc.text("Breme", COL_SAL_D,  hY + 16, { width: NUM_W_L, align: "right", lineBreak: false });
    doc.text("Dobro", COL_SAL_C,  hY + 16, { width: NUM_W_L, align: "right", lineBreak: false });
    doc.text("+ / −", COL_NET, hY + 16, { width: NUM_W_L, align: "right", lineBreak: false });
    y = hY + 28;
    doc.fillColor(COLOR_PRIMARY);
  }

  drawTableHeader();

  function nextPage() {
    doc.addPage({ size: [PAGE_W_L, PAGE_H_L] });
    currentPage++;
    y = contentStartY(currentPage);
    drawLandscapeHeader(currentPage);
    drawTableHeader();
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    if (y + ROW_HEIGHT > CONTENT_BOTTOM) nextPage();

    const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
    doc.rect(MARGIN, y, USABLE_W_L, ROW_HEIGHT).fillColor(bg).fill();
    doc.font("DejaVuSans").fontSize(7).fillColor(COLOR_MUTED)
      .text(row.accountCode, COL_CODE + 2, y + 2, { width: 50, lineBreak: false });
    doc.font("DejaVuSans").fontSize(7).fillColor(COLOR_PRIMARY)
      .text(row.accountName, COL_NAME + 2, y + 2, {
        width: NAME_W, height: ROW_HEIGHT - 3, lineBreak: false, ellipsis: true,
      });

    const od = parseFloat(row.openingBalanceDebit);
    const oc = parseFloat(row.openingBalanceCredit);
    const td = parseFloat(row.turnoverDebit);
    const tc = parseFloat(row.turnoverCredit);
    const bd = parseFloat(row.balanceDebit);
    const bc = parseFloat(row.balanceCredit);
    const netCents = Math.round((bd - bc) * 100);

    // Začetni saldo (siva)
    doc.font("DejaVuSans").fontSize(7).fillColor(COLOR_MUTED);
    if (od !== 0) doc.text(fmtNum(od), COL_OB_D, y + 2, { width: NUM_W_L, align: "right", lineBreak: false });
    if (oc !== 0) doc.text(fmtNum(oc), COL_OB_C, y + 2, { width: NUM_W_L, align: "right", lineBreak: false });

    // Promet (modra)
    doc.fillColor("#1d4ed8");
    if (td !== 0) doc.text(fmtNum(td), COL_PROM_D, y + 2, { width: NUM_W_L, align: "right", lineBreak: false });
    if (tc !== 0) doc.text(fmtNum(tc), COL_PROM_C, y + 2, { width: NUM_W_L, align: "right", lineBreak: false });

    // Zaključni saldo (krepko, primarna barva)
    doc.fillColor(COLOR_PRIMARY);
    if (bd !== 0) doc.font("DejaVuSans-Bold").fontSize(7).text(fmtNum(bd), COL_SAL_D, y + 2, { width: NUM_W_L, align: "right", lineBreak: false });
    if (bc !== 0) doc.font("DejaVuSans-Bold").fontSize(7).text(fmtNum(bc), COL_SAL_C, y + 2, { width: NUM_W_L, align: "right", lineBreak: false });
    doc.font("DejaVuSans-Bold").fontSize(7).fillColor(COLOR_PRIMARY)
      .text(formatSignedCents(netCents), COL_NET, y + 2, { width: NUM_W_L, align: "right", lineBreak: false });

    y += ROW_HEIGHT;
  }

  // Skupaj in kontrola bilance morata ostati skupaj in nad nogo strani.
  if (y + 18 + 22 > CONTENT_BOTTOM) nextPage();
  doc.rect(MARGIN, y, USABLE_W_L, 18).fillColor(COLOR_TOTAL).fill();
  doc.font("DejaVuSans-Bold").fontSize(8).fillColor(COLOR_PRIMARY)
    .text("SKUPAJ", COL_CODE + 2, y + 4, { width: 200, lineBreak: false });
  doc.fillColor(COLOR_MUTED);
  doc.text(fmtNum(opts.totalOpeningBalanceDebit),  COL_OB_D,   y + 4, { width: NUM_W_L, align: "right", lineBreak: false });
  doc.text(fmtNum(opts.totalOpeningBalanceCredit), COL_OB_C,   y + 4, { width: NUM_W_L, align: "right", lineBreak: false });
  doc.fillColor("#1d4ed8");
  doc.text(fmtNum(opts.totalTurnoverDebit),        COL_PROM_D, y + 4, { width: NUM_W_L, align: "right", lineBreak: false });
  doc.text(fmtNum(opts.totalTurnoverCredit),       COL_PROM_C, y + 4, { width: NUM_W_L, align: "right", lineBreak: false });
  doc.fillColor(COLOR_PRIMARY);
  doc.text(fmtNum(opts.totalBalanceDebit),         COL_SAL_D,  y + 4, { width: NUM_W_L, align: "right", lineBreak: false });
  doc.text(fmtNum(opts.totalBalanceCredit),        COL_SAL_C,  y + 4, { width: NUM_W_L, align: "right", lineBreak: false });
  const totalNetCents = Math.round(
    (parseFloat(opts.totalBalanceDebit) - parseFloat(opts.totalBalanceCredit)) * 100,
  );
  doc.font("DejaVuSans-Bold").fillColor(COLOR_PRIMARY)
    .text(formatSignedCents(totalNetCents), COL_NET, y + 4, { width: NUM_W_L, align: "right", lineBreak: false });
  y += 22;

  // Kontrola bilance
  const balanced = parseFloat(opts.totalTurnoverDebit).toFixed(2) === parseFloat(opts.totalTurnoverCredit).toFixed(2);
  doc.font("DejaVuSans").fontSize(8).fillColor(balanced ? COLOR_POSITIVE : COLOR_NEGATIVE)
    .text(
      balanced ? "Bilanca uravnotežena" : "Bilanca ni uravnotežena",
      MARGIN, y, { width: USABLE_W_L, lineBreak: false },
    );

  // Število strani je znano šele po izpisu vseh vrstic. Nogo dodaj naknadno
  // znotraj spodnjega roba; PDFKit sicer sam vstavi skoraj prazne strani.
  const pageRange = doc.bufferedPageRange();
  const genDate = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
  for (let page = pageRange.start; page < pageRange.start + pageRange.count; page++) {
    doc.switchToPage(page);
    // Footer je v spodnjem robu, zato zanj izključimo PDFKitov samodejni
    // prelom strani (ta sicer doda prazno stran tudi pri ročni koordinati).
    doc.page.margins.bottom = 0;
    doc.font("DejaVuSans").fontSize(7).fillColor("#9ca3af");
    doc.text(`Generirano: ${genDate}`, MARGIN, FOOTER_Y, { width: 220, lineBreak: false });
    doc.text(`Stran ${page - pageRange.start + 1} / ${pageRange.count}`,
      PAGE_W_L - MARGIN - 120, FOOTER_Y, { width: 120, align: "right", lineBreak: false });
  }
  doc.end();
  return bufferPromise;
}

// ── Temeljnica amortizacije OS ─────────────────────────────────────────────────

export interface AmortizacijaTemeljnicaOpts {
  companyName: string;
  companyTaxId?: string | null;
  leto: number;
  /** Mesec, do katerega velja obračun (1–12). Privzeto 12 = celo leto. */
  doMeseca?: number;
  datumIzpisa: string;
  vrstice: Array<{
    kontoStroskaCode: string | null;
    kontoStroskaName: string | null;
    kontoPopravkaCode: string | null;
    kontoPopravkaName: string | null;
    znesek: string;
    steviloSredstev: number;
  }>;
  skupajBreme: string;
  skupajDobro: string;
  uravnotezeno: boolean;
  brezKontov: number;
}

/**
 * Generira PDF temeljnice amortizacije OS.
 * NEODVISNO od GLK accounting_periods — samo OS vloga zadosti.
 * Vsebuje agregirane knjižbene vrstice po konto-parih z bilančno vsoto.
 */
export async function generateAmortizacijaTemeljnicaPdf(
  opts: AmortizacijaTemeljnicaOpts,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    bufferPages: true,
  });
  registerFonts(doc);
  const bufferPromise = collectDocBuffer(doc);

  const letoNapis = (opts.doMeseca && opts.doMeseca < 12)
    ? `Leto: ${opts.leto} (do ${opts.doMeseca}/${opts.leto})`
    : `Leto: ${opts.leto}`;
  const subtitle = [
    letoNapis,
    opts.companyTaxId ? `Davčna: ${opts.companyTaxId}` : null,
    `Datum izpisa: ${opts.datumIzpisa}`,
  ].filter(Boolean).join("  ·  ");

  const estLines = opts.vrstice.length;
  const estPages = Math.max(1, Math.ceil((estLines * 14 + 140) / (842 - MARGIN * 2 - 60)));

  drawHeader(doc, opts.companyName, "Temeljnica amortizacije OS", subtitle, 1, estPages);

  const state: PdfState = {
    doc,
    y: contentY(1),
    page: 1,
    totalPages: estPages,
    companyName: opts.companyName,
    reportTitle: "Temeljnica amortizacije OS",
    subtitle,
  };

  // ── Stolpci (A4 portrait, USABLE_W ≈ 515pt) ──────────────────────────────
  const C_BK  = MARGIN;        // konto breme koda — 55pt
  const C_BN  = MARGIN + 57;   // naziv breme — 168pt
  const C_DK  = MARGIN + 227;  // konto dobro koda — 55pt
  const C_DN  = MARGIN + 284;  // naziv dobro — 140pt
  const C_ZR  = PAGE_W - MARGIN - 88; // znesek začetek — 88pt širina

  // ── Glava tabele ──────────────────────────────────────────────────────────
  checkNewPage(state, 30);
  doc.rect(MARGIN, state.y, USABLE_W, 16).fillColor(COLOR_PRIMARY).fill();
  doc.font("DejaVuSans-Bold").fontSize(7.5).fillColor("#ffffff");
  doc.text("Konto breme",  C_BK + 2,  state.y + 4, { width: 52,  lineBreak: false });
  doc.text("Naziv breme",  C_BN + 2,  state.y + 4, { width: 164, lineBreak: false });
  doc.text("Konto dobro",  C_DK + 2,  state.y + 4, { width: 52,  lineBreak: false });
  doc.text("Naziv dobro",  C_DN + 2,  state.y + 4, { width: 136, lineBreak: false });
  doc.text("Znesek (€)",   C_ZR,      state.y + 4, { width: 85,  align: "right", lineBreak: false });
  state.y += 18;

  // ── Vrstice ───────────────────────────────────────────────────────────────
  let rowIdx = 0;
  for (const v of opts.vrstice) {
    checkNewPage(state, 16);
    if (rowIdx % 2 === 0) {
      doc.rect(MARGIN, state.y, USABLE_W, 14).fillColor("#f9fafb").fill();
    }
    doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED);
    doc.text(v.kontoStroskaCode ?? "—", C_BK + 2,  state.y + 2, { width: 52,  lineBreak: false });
    doc.fillColor(COLOR_PRIMARY);
    doc.text(v.kontoStroskaName ?? "—", C_BN + 2,  state.y + 2, { width: 164, lineBreak: false });
    doc.fillColor(COLOR_MUTED);
    doc.text(v.kontoPopravkaCode ?? "—", C_DK + 2,  state.y + 2, { width: 52,  lineBreak: false });
    doc.fillColor(COLOR_PRIMARY);
    doc.text(v.kontoPopravkaName ?? "—", C_DN + 2,  state.y + 2, { width: 136, lineBreak: false });
    doc.font("DejaVuSans-Bold").fontSize(7.5);
    doc.text(fmtNum(v.znesek), C_ZR, state.y + 2, { width: 85, align: "right", lineBreak: false });
    state.y += 14;
    rowIdx++;
  }

  // ── Razdelilna črta ───────────────────────────────────────────────────────
  state.y += 4;
  checkNewPage(state, 26);
  doc.moveTo(MARGIN, state.y).lineTo(PAGE_W - MARGIN, state.y)
    .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  state.y += 4;

  // ── Skupaj vrstica ────────────────────────────────────────────────────────
  checkNewPage(state, 20);
  doc.rect(MARGIN, state.y, USABLE_W, 18).fillColor(COLOR_TOTAL).fill();
  doc.font("DejaVuSans-Bold").fontSize(8).fillColor(COLOR_PRIMARY);
  doc.text("SKUPAJ V BREME = V DOBRO", MARGIN + 4, state.y + 4, { width: 250, lineBreak: false });
  doc.text(fmtNum(opts.skupajBreme), C_ZR, state.y + 4, { width: 85, align: "right", lineBreak: false });
  state.y += 22;

  // ── Bilančni status ───────────────────────────────────────────────────────
  checkNewPage(state, 18);
  doc.font("DejaVuSans").fontSize(8)
    .fillColor(opts.uravnotezeno ? COLOR_POSITIVE : COLOR_NEGATIVE)
    .text(
      opts.uravnotezeno
        ? "✓  Temeljnica je uravnotežena (skupaj breme = skupaj dobro)"
        : "⚠  Temeljnica NI uravnotežena — preverite nastavitve kontov",
      MARGIN, state.y,
    );
  state.y += 14;

  // ── Opozorilo za izpuščena sredstva ──────────────────────────────────────
  if (opts.brezKontov > 0) {
    checkNewPage(state, 14);
    doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_NEGATIVE)
      .text(
        `⚠  ${opts.brezKontov} sredstev izpuščenih: nekonfiguriran, neaktiven ali skupinski konto.`,
        MARGIN, state.y,
      );
    state.y += 12;
  }

  // ── Legenda / opomba ──────────────────────────────────────────────────────
  state.y += 8;
  checkNewPage(state, 24);
  doc.font("DejaVuSans").fontSize(7).fillColor(COLOR_MUTED)
    .text(
      "Ta izpis je samostojen dokument OS modula in ni vezan na računovodska obdobja glavne knjige. " +
      "Za knjiženje v GLK uporabite funkcijo »Pripravi knjižbo« (zahteva ERP vlogo).",
      MARGIN, state.y, { width: USABLE_W },
    );

  doc.end();
  return bufferPromise;
}

// ── Kartica osnovnega sredstva ─────────────────────────────────────────────────

/** ISO "YYYY-MM-DD" → "dd.mm.yyyy" za PDF */
function fmtDat(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return "—";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export interface KarticaKronoloskiDogodek {
  datum: string;
  opis: string;
  spremembaNv: string;
  obracunanaAm: string;
  skupniPv: string;
  neodpisana: string;
}

export interface KarticaPdfOpts {
  companyName: string;
  companyDavcna: string;
  datumIzpisa: string;            // "dd.mm.yyyy"
  inventarnaSt: string;
  naziv: string;
  skupinaKoda: string | null;
  skupinaNaziv: string | null;
  skupinaStopnja: string | null;      // računovodska, "2.500" → "2,5 %"
  skupinaDavcnaStopnja: string | null; // davčna (prikaži, če se razlikuje od računovodske)
  costCenterCode: string | null;
  costCenterName: string | null;
  kontoOsCode: string | null;
  kontoPopravkaCode: string | null;
  kontoStroskaCode: string | null;
  datumNabave: string | null;
  datumAktivacije: string | null;
  datumOdtujitve: string | null;
  razlogIzlocitve: string | null;
  status: string;
  opomba: string | null;
  skupnaNabavna: string;
  skupnaOdpisana: string;
  sedanjaVrednostPredObracunom: string;
  sedanjaVrednostPoObracunu: string;
  obracunPeriod: string | null;
  skupnaAmortizacijaObracunana: string;
  dograditve: Array<{
    seq: number;
    nazivVlaganja: string | null;
    nabavnaVrednost: string;
    datumNabave: string;
    datumAktivacije: string | null;
    /** Naziv dobavitelja (iz counterparties prek JOIN). */
    partnerNaziv?: string | null;
    /** Davčna številka dobavitelja. */
    partnerTaxId?: string | null;
    /** Številka prejetega računa. */
    stRacuna?: string | null;
    /** Datum prejetega računa (ISO). */
    datumRacuna?: string | null;
  }>;
  /** Nabavni dokument za seq=0 (osnovni nakup). */
  seq0Partner?: { naziv: string; taxId: string | null } | null;
  seq0StRacuna?: string | null;
  seq0DatumRacuna?: string | null;
  kronoloskiPregled: KarticaKronoloskiDogodek[];
}

/**
 * Generira PDF kartico osnovnega sredstva (A4 portrait).
 * Vsebuje: identifikacijo, vrednosti, dograditve in kronološki pregled.
 */
// ══════════════════════════════════════════════════════════════════════════════
// OS Register PDF — landscape A4, vsi SRS stolpci
// ══════════════════════════════════════════════════════════════════════════════

// Landscape A4: width=841.89, height=595.28
const LM  = 22;                          // levi/desni rob
const LPW = 841.89;                      // landscape page width
const LPH = 595.28;                      // landscape page height
const LUW = LPW - LM * 2;               // usable width ≈ 797.89

// Stolpci (x koordinata = LM + sum predhodnih širin)
const RC: Record<string, { x: number; w: number; align: "left" | "right" | "center" }> = (() => {
  const cols: Array<[string, number, "left" | "right" | "center"]> = [
    ["inv",    64, "left"],
    ["naziv", 118, "left"],
    ["skup",   42, "left"],
    ["pct",    38, "right"],
    ["doba",   30, "right"],
    ["dnab",   55, "left"],
    ["dakt",   52, "left"],
    ["nvzac",  60, "right"],
    ["pvzac",  58, "right"],
    ["nedzac", 60, "right"],
    ["novnab", 57, "right"],
    ["amort",  54, "right"],
    ["nvkon",  60, "right"],
    ["nedkon", 55, "right"],
  ];
  let x = LM;
  const map: Record<string, { x: number; w: number; align: "left" | "right" | "center" }> = {};
  for (const [name, w, align] of cols) {
    map[name] = { x, w: w - 2, align };
    x += w;
  }
  return map;
})();

/** Izpis krajšega datuma "dd.mm.yyyy" za ISO "YYYY-MM-DD". */
function fmtDatL(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  return `${p[2]}.${p[1]}.${p[0]}`;
}

/** Izpis amortizacijske stopnje v sl-SI formatu "X,XX %". */
function fmtPct(v: string | null | undefined): string {
  if (!v) return "—";
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + " %";
}

/** Doba koristnosti = 100/stopnja (zaokroženo na 1 decimalno mesto). */
function calcDoba(stonja: string | null | undefined): string {
  if (!stonja) return "—";
  const n = parseFloat(stonja);
  if (!n || n <= 0) return "—";
  const d = 100 / n;
  return d.toLocaleString("sl-SI", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + " l.";
}

export interface OsRegisterPdfOpts {
  companyName: string;
  companyDavcna: string | null;
  datumIzpisa: string;   // "dd.mm.yyyy"
  /** "na dan DD.MM.YYYY" — datumKonca iz periode */
  datumKonca: string;
  /** Obračunsko obdobje, npr. "12/2024" ali null (predogled). */
  obracunPeriod: string | null;
  vrstice: Array<{
    inventarnaSt: string;
    naziv: string;
    skupinaKoda: string | null;
    skupinaNaziv: string | null;
    racunovodskaStonja: string | null;
    datumNabave: string | null;
    datumAktivacije: string | null;
    zacNV: string;
    zacPV: string;
    zacNed: string;
    noveNabave: string;
    amortObdobja: string;
    konNV: string;
    konNed: string;
    status: string;
  }>;
  seštevki: {
    zacNV: string;
    zacPV: string;
    zacNed: string;
    noveNabave: string;
    amortObdobja: string;
    konNV: string;
    konNed: string;
  };
}

const REG_STATUS_LABELS: Record<string, string> = {
  v_teku: "V teku",
  v_uporabi: "V up.",
  odpisano: "Odpisano",
  izloceno: "Izločeno",
};

function drawRegHeader(
  doc: InstanceType<typeof PDFDocument>,
  companyName: string,
  reportTitle: string,
  subtitle: string,
  page: number,
  totalPages: number,
): void {
  if (page === 1) {
    doc.font("DejaVuSans-Bold").fontSize(11).fillColor(COLOR_PRIMARY)
      .text(companyName, LM, LM);
    doc.font("DejaVuSans-Bold").fontSize(10).fillColor(COLOR_PRIMARY)
      .text(reportTitle, LM, LM + 16);
    doc.font("DejaVuSans").fontSize(7).fillColor(COLOR_MUTED)
      .text(subtitle, LM, LM + 29);
    doc.moveTo(LM, LM + 40).lineTo(LPW - LM, LM + 40)
      .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  } else {
    doc.font("DejaVuSans").fontSize(7).fillColor(COLOR_MUTED)
      .text(`${companyName} — ${reportTitle}`, LM, LM);
    doc.moveTo(LM, LM + 11).lineTo(LPW - LM, LM + 11)
      .strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  }
  const genDate = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
  doc.font("DejaVuSans").fontSize(6.5).fillColor("#9ca3af")
    .text(`Generirano: ${genDate}`, LM, LPH - LM - 4, { continued: false, lineBreak: false })
    .text(`Stran ${page} / ${totalPages}`, LM, LPH - LM - 4, { align: "right", lineBreak: false });
  doc.y = page === 1 ? LM + 48 : LM + 18;
  doc.fillColor(COLOR_PRIMARY);
}

function drawRegColumnHeaders(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
): number {
  const rowH = 16;
  doc.rect(LM, y, LUW, rowH).fillColor("#f3f4f6").fill();

  // Skupinski naslovi (2 vrstici glave)
  const headers: Array<[string, string]> = [
    ["inv", "Inv. št."],
    ["naziv", "Naziv"],
    ["skup", "Skup."],
    ["pct", "Rac.%"],
    ["doba", "Doba"],
    ["dnab", "Dat. nabave"],
    ["dakt", "Dat. akt."],
    ["nvzac", "NV (1.1.)"],
    ["pvzac", "PV (1.1.)"],
    ["nedzac", "Ned. (1.1.)"],
    ["novnab", "Nov. nab."],
    ["amort", "Amort."],
    ["nvkon", "NV (k)"],
    ["nedkon", "Ned. (k)"],
  ];

  doc.font("DejaVuSans-Bold").fontSize(6).fillColor("#374151");
  for (const [key, label] of headers) {
    const c = RC[key];
    doc.text(label, c.x + 1, y + 4, { width: c.w, align: c.align === "right" ? "right" : "left", lineBreak: false });
  }
  doc.moveTo(LM, y + rowH).lineTo(LPW - LM, y + rowH).strokeColor(COLOR_LINE).lineWidth(0.5).stroke();
  return y + rowH + 1;
}

interface RegPdfState {
  doc: InstanceType<typeof PDFDocument>;
  y: number;
  page: number;
  totalPages: number;
  companyName: string;
  title: string;
  subtitle: string;
}

function checkRegNewPage(state: RegPdfState, needed = 12): boolean {
  const bottomLimit = LPH - LM - 18;
  if (state.y + needed > bottomLimit) {
    state.doc.addPage();
    state.page++;
    drawRegHeader(state.doc, state.companyName, state.title, state.subtitle, state.page, state.totalPages);
    state.y = state.page === 1 ? LM + 48 : LM + 18;
    state.y = drawRegColumnHeaders(state.doc, state.y);
    return true;
  }
  return false;
}

/**
 * Generira PDF celotnega registra OS (A4 landscape, vsi SRS stolpci).
 */
export async function generateOsRegisterPdf(opts: OsRegisterPdfOpts): Promise<Buffer> {
  const n = opts.vrstice.length;
  const rowH = 11;
  const linesPerPage = Math.floor((LPH - LM * 2 - 60) / rowH);
  const totalPages = Math.max(1, Math.ceil((n * rowH + 80) / (LPH - LM * 2 - 60)));

  const doc = new PDFDocument({
    size: [LPH, LPW], // landscape: swap width/height
    margins: { top: LM, bottom: LM, left: LM, right: LM },
    autoFirstPage: true,
    bufferPages: true,
    layout: "landscape",
  });
  registerFonts(doc);
  const bufferPromise = collectDocBuffer(doc);

  const subtitle = [
    opts.companyDavcna ? `DDV: ${opts.companyDavcna}` : null,
    opts.obracunPeriod ? `Obračun: ${opts.obracunPeriod}` : "predogled",
    `Izpisano: ${opts.datumIzpisa}`,
  ].filter(Boolean).join("  ·  ");

  const title = `Register osnovnih sredstev — na dan ${opts.datumKonca}`;

  drawRegHeader(doc, opts.companyName, title, subtitle, 1, totalPages);

  const state: RegPdfState = {
    doc,
    y: LM + 48,
    page: 1,
    totalPages,
    companyName: opts.companyName,
    title,
    subtitle,
  };

  state.y = drawRegColumnHeaders(doc, state.y);

  function drawRegCell(key: string, text: string, bold = false, color = COLOR_PRIMARY) {
    const c = RC[key];
    doc.font(bold ? "DejaVuSans-Bold" : "DejaVuSans")
      .fontSize(6.5).fillColor(color)
      .text(text, c.x + 1, state.y + 1.5, {
        width: c.w - 1,
        align: c.align,
        lineBreak: false,
        ellipsis: true,
      });
  }

  for (let i = 0; i < opts.vrstice.length; i++) {
    const v = opts.vrstice[i];
    checkRegNewPage(state, rowH);

    // Zebrasta ozadja
    if (i % 2 === 0) doc.rect(LM, state.y, LUW, rowH).fillColor("#f9fafb").fill();

    const dobaStr = calcDoba(v.racunovodskaStonja);
    drawRegCell("inv",    v.inventarnaSt,                           true,  COLOR_PRIMARY);
    drawRegCell("naziv",  v.naziv,                                  false, COLOR_PRIMARY);
    drawRegCell("skup",   v.skupinaKoda ?? "—",                     false, COLOR_MUTED);
    drawRegCell("pct",    fmtPct(v.racunovodskaStonja),             false, COLOR_MUTED);
    drawRegCell("doba",   dobaStr,                                   false, COLOR_MUTED);
    drawRegCell("dnab",   fmtDatL(v.datumNabave),                   false, COLOR_MUTED);
    drawRegCell("dakt",   fmtDatL(v.datumAktivacije),               false, COLOR_MUTED);
    drawRegCell("nvzac",  fmtNum(v.zacNV),                          false, COLOR_PRIMARY);
    drawRegCell("pvzac",  fmtNum(v.zacPV),                          false, COLOR_MUTED);
    drawRegCell("nedzac", fmtNum(v.zacNed),                         false, COLOR_PRIMARY);
    drawRegCell("novnab", parseFloat(v.noveNabave) > 0 ? fmtNum(v.noveNabave) : "—", false, "#92400e");
    drawRegCell("amort",  parseFloat(v.amortObdobja) > 0 ? fmtNum(v.amortObdobja) : "—", false, "#92400e");
    drawRegCell("nvkon",  fmtNum(v.konNV),                          false, COLOR_PRIMARY);
    drawRegCell("nedkon", fmtNum(v.konNed),                         true,  "#166534");

    state.y += rowH;
  }

  // Ločilna linija
  state.y += 2;
  doc.moveTo(LM, state.y).lineTo(LPW - LM, state.y).strokeColor("#374151").lineWidth(0.8).stroke();
  state.y += 3;

  // Seštevki
  checkRegNewPage(state, 14);
  doc.rect(LM, state.y, LUW, 14).fillColor(COLOR_TOTAL).fill();
  doc.font("DejaVuSans-Bold").fontSize(6.5).fillColor(COLOR_PRIMARY)
    .text(`SKUPAJ (${opts.vrstice.length})`, LM + 2, state.y + 3.5, { width: 200, lineBreak: false });

  const se = opts.seštevki;
  const seMap: Record<string, string> = {
    nvzac: se.zacNV, pvzac: se.zacPV, nedzac: se.zacNed,
    novnab: se.noveNabave, amort: se.amortObdobja, nvkon: se.konNV, nedkon: se.konNed,
  };
  for (const [key, val] of Object.entries(seMap)) {
    const c = RC[key];
    doc.font("DejaVuSans-Bold").fontSize(6.5).fillColor(COLOR_PRIMARY)
      .text(fmtNum(val), c.x + 1, state.y + 3.5, { width: c.w - 1, align: "right", lineBreak: false });
  }
  state.y += 14;

  // Popravek footer na vsaki strani
  const range = doc.bufferedPageRange();
  for (let p = 0; p < range.count; p++) {
    doc.switchToPage(range.start + p);
    const genDate = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
    doc.font("DejaVuSans").fontSize(6.5).fillColor("#9ca3af")
      .text(`Generirano: ${genDate}`, LM, LPH - LM - 4, { continued: false, lineBreak: false })
      .text(`Stran ${p + 1} / ${range.count}`, LM, LPH - LM - 4, { align: "right", lineBreak: false });
  }

  doc.end();
  return bufferPromise;
}

// ══════════════════════════════════════════════════════════════════════════════

export async function generateKarticaPdf(opts: KarticaPdfOpts): Promise<Buffer> {
  const kronoRows = opts.kronoloskiPregled.length;
  const dogRows = opts.dograditve.length;
  const estLines = 22 + dogRows + kronoRows;
  const estPages = Math.max(1, Math.ceil((estLines * 13 + 240) / (842 - MARGIN * 2 - 60)));

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: true,
    bufferPages: true,
  });
  registerFonts(doc);
  const bufferPromise = collectDocBuffer(doc);

  const subtitle = [
    `Inv. št.: ${opts.inventarnaSt}`,
    opts.companyDavcna ? `Davčna: ${opts.companyDavcna}` : null,
    `Datum izpisa: ${opts.datumIzpisa}`,
  ].filter(Boolean).join("  ·  ");

  drawHeader(doc, opts.companyName, "Kartica osnovnega sredstva", subtitle, 1, estPages);

  const state: PdfState = {
    doc,
    y: contentY(1),
    page: 1,
    totalPages: estPages,
    companyName: opts.companyName,
    reportTitle: "Kartica osnovnega sredstva",
    subtitle,
  };

  // ── IDENTIFIKACIJA ──────────────────────────────────────────────────────────
  checkNewPage(state, 20);
  doc.rect(MARGIN, state.y, USABLE_W, 15).fillColor(COLOR_PRIMARY).fill();
  doc.font("DejaVuSans-Bold").fontSize(8).fillColor("#ffffff")
    .text("IDENTIFIKACIJA", MARGIN + 4, state.y + 3.5, { lineBreak: false });
  state.y += 17;

  const COL_L = MARGIN;
  const COL_R = MARGIN + Math.floor(USABLE_W / 2) + 5;
  const COL_LW = Math.floor(USABLE_W / 2) - 5;
  const COL_RW = Math.ceil(USABLE_W / 2) - 5;
  const LABEL_W = 82;

  function infoRow(label: string, value: string, col: "L" | "R", y: number): void {
    const x = col === "L" ? COL_L : COL_R;
    const cw = col === "L" ? COL_LW : COL_RW;
    doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
      .text(label, x, y, { width: LABEL_W, lineBreak: false });
    doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_PRIMARY)
      .text(value || "—", x + LABEL_W + 2, y, { width: cw - LABEL_W - 4, lineBreak: false });
  }

  const statusLabel: Record<string, string> = {
    v_teku: "V teku", v_uporabi: "V uporabi", odpisano: "Odpisano", izloceno: "Izločeno",
  };
  // Formatiraj stopnjo sl-SI (2.500 → "2,5"; 10.000 → "10")
  const fmtSto = (s: string | null | undefined): string | null =>
    s ? parseFloat(s).toLocaleString("sl-SI", { minimumFractionDigits: 0, maximumFractionDigits: 3 }) : null;
  const racSto = fmtSto(opts.skupinaStopnja);
  const davSto = fmtSto(opts.skupinaDavcnaStopnja);
  const stoStr = racSto
    ? (davSto && davSto !== racSto ? `${racSto} % (rač.) / ${davSto} % (dav.)` : `${racSto} %`)
    : null;
  const skupinaStr = opts.skupinaKoda
    ? `${opts.skupinaKoda}${opts.skupinaNaziv ? ` — ${opts.skupinaNaziv}` : ""}` +
      (stoStr ? ` · ${stoStr}` : "")
    : "—";

  const leftRows: [string, string][] = [
    ["Inventarna št.", opts.inventarnaSt],
    ["Naziv", opts.naziv],
    ["Status", statusLabel[opts.status] ?? opts.status],
    ["Datum nabave", fmtDat(opts.datumNabave)],
    ["Datum aktivacije", fmtDat(opts.datumAktivacije)],
    ...(opts.datumOdtujitve ? [["Datum odtujitve", fmtDat(opts.datumOdtujitve)] as [string, string]] : []),
    ...(opts.razlogIzlocitve ? [["Razlog izločitve", opts.razlogIzlocitve] as [string, string]] : []),
    ...(opts.opomba ? [["Opomba", opts.opomba] as [string, string]] : []),
  ];
  const stmStr = opts.costCenterCode
    ? `${opts.costCenterCode}${opts.costCenterName ? ` — ${opts.costCenterName}` : ""}`
    : "—";
  const rightRows: [string, string][] = [
    ["Amort. skupina", skupinaStr],
    ["Konto OS", opts.kontoOsCode ?? "—"],
    ["Konto popravka", opts.kontoPopravkaCode ?? "—"],
    ["Konto stroška", opts.kontoStroskaCode ?? "—"],
    ["Strok. mesto", stmStr],
  ];

  const infoH = 13;
  const maxRows = Math.max(leftRows.length, rightRows.length);
  checkNewPage(state, maxRows * infoH + 4);
  for (let i = 0; i < maxRows; i++) {
    const y = state.y + i * infoH;
    if (i % 2 === 0) doc.rect(MARGIN, y, USABLE_W, infoH).fillColor("#f9fafb").fill();
    if (i < leftRows.length) infoRow(leftRows[i][0], leftRows[i][1], "L", y + 2.5);
    if (i < rightRows.length) infoRow(rightRows[i][0], rightRows[i][1], "R", y + 2.5);
  }
  state.y += maxRows * infoH + 8;

  // ── VREDNOSTI ───────────────────────────────────────────────────────────────
  checkNewPage(state, 52);
  doc.rect(MARGIN, state.y, USABLE_W, 15).fillColor(COLOR_PRIMARY).fill();
  doc.font("DejaVuSans-Bold").fontSize(8).fillColor("#ffffff")
    .text("VREDNOSTI", MARGIN + 4, state.y + 3.5, { lineBreak: false });
  state.y += 17;

  const VW = (USABLE_W - 9) / 4;
  const vrednostiData: [string, string, string, boolean][] = [
    ["Nabavna vrednost", fmtNum(opts.skupnaNabavna) + " €", "", false],
    ["Uvožena odpisana", fmtNum(opts.skupnaOdpisana) + " €", "akumul. na dan uvoza", false],
    ["Sedanja (pred obr.)", fmtNum(opts.sedanjaVrednostPredObracunom) + " €", "NV − uvožena odpisana", true],
    [
      opts.obracunPeriod ? `Sedanja (po ${opts.obracunPeriod})` : "Sedanja (po obr.)",
      fmtNum(opts.sedanjaVrednostPoObracunu) + " €",
      opts.obracunPeriod ? `amort. −${fmtNum(opts.skupnaAmortizacijaObracunana)} €` : "ni obračunov",
      true,
    ],
  ];

  for (let i = 0; i < 4; i++) {
    const [label, val, sub, highlight] = vrednostiData[i];
    const x = MARGIN + i * (VW + 3);
    doc.rect(x, state.y, VW, 32)
      .fillColor(highlight ? "#f0fdf4" : "#f9fafb").fill();
    doc.rect(x, state.y, VW, 32).strokeColor(COLOR_LINE).lineWidth(0.4).stroke();
    doc.font("DejaVuSans").fontSize(6.5).fillColor(COLOR_MUTED)
      .text(label, x + 4, state.y + 4, { width: VW - 8, lineBreak: false });
    doc.font("DejaVuSans-Bold").fontSize(8.5)
      .fillColor(highlight ? "#166534" : COLOR_PRIMARY)
      .text(val, x + 4, state.y + 13, { width: VW - 8, lineBreak: false });
    if (sub) {
      doc.font("DejaVuSans").fontSize(6).fillColor(COLOR_MUTED)
        .text(sub, x + 4, state.y + 24, { width: VW - 8, lineBreak: false });
    }
  }
  state.y += 38;

  // ── DOGRADITVE (samo kadar obstajajo) ───────────────────────────────────────
  if (opts.dograditve.length > 0) {
    state.y += 6;
    checkNewPage(state, 20 + opts.dograditve.length * 13);
    doc.rect(MARGIN, state.y, USABLE_W, 15).fillColor(COLOR_SECTION).fill();
    doc.font("DejaVuSans-Bold").fontSize(8).fillColor(COLOR_PRIMARY)
      .text(`DOGRADITVE (${opts.dograditve.length})`, MARGIN + 4, state.y + 3.5, { lineBreak: false });
    state.y += 17;

    const D_SEQ = MARGIN;
    const D_NAZ = MARGIN + 36;
    const D_NV  = PAGE_W - MARGIN - 170;
    const D_DNB = PAGE_W - MARGIN - 98;
    const D_DAK = PAGE_W - MARGIN - 48;

    doc.rect(MARGIN, state.y, USABLE_W, 13).fillColor(COLOR_PRIMARY).fill();
    doc.font("DejaVuSans-Bold").fontSize(7).fillColor("#ffffff");
    doc.text("Seq",          D_SEQ + 2,  state.y + 3, { width: 32, lineBreak: false });
    doc.text("Opis vlaganja",D_NAZ + 2,  state.y + 3, { width: D_NV - D_NAZ - 4, lineBreak: false });
    doc.text("Nabavna (€)",  D_NV,       state.y + 3, { width: 67, align: "right", lineBreak: false });
    doc.text("Datum nakupa", D_DNB,      state.y + 3, { width: 46, align: "right", lineBreak: false });
    doc.text("Aktivacija",   D_DAK,      state.y + 3, { width: 46, align: "right", lineBreak: false });
    state.y += 15;

    opts.dograditve.forEach((d, i) => {
      // Vrstica ima 2 vrstici kadar je dobavitelj/st.računa prisoten
      const hasExtra = !!(d.partnerNaziv || d.stRacuna || d.datumRacuna);
      const rowH = hasExtra ? 22 : 13;
      checkNewPage(state, rowH);
      if (i % 2 === 0) doc.rect(MARGIN, state.y, USABLE_W, rowH).fillColor("#f9fafb").fill();
      doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
        .text(String(d.seq), D_SEQ + 2, state.y + 2.5, { width: 32, lineBreak: false });
      doc.fillColor(COLOR_PRIMARY)
        .text(d.nazivVlaganja ?? "—", D_NAZ + 2, state.y + 2.5, { width: D_NV - D_NAZ - 4, lineBreak: false });
      doc.font("DejaVuSans-Bold").fontSize(7.5)
        .text(fmtNum(d.nabavnaVrednost), D_NV, state.y + 2.5, { width: 67, align: "right", lineBreak: false });
      doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
        .text(fmtDat(d.datumNabave), D_DNB, state.y + 2.5, { width: 46, align: "right", lineBreak: false })
        .text(fmtDat(d.datumAktivacije), D_DAK, state.y + 2.5, { width: 46, align: "right", lineBreak: false });
      if (hasExtra) {
        // Druga vrstica: dobavitelj + št. in datum računa
        const dobStr = [
          d.partnerNaziv ? `Dobavitelj: ${d.partnerNaziv}${d.partnerTaxId ? ` (${d.partnerTaxId})` : ""}` : null,
          d.stRacuna ? `Račun: ${d.stRacuna}` : null,
          d.datumRacuna ? fmtDat(d.datumRacuna) : null,
        ].filter(Boolean).join("   ");
        doc.font("DejaVuSans").fontSize(6.5).fillColor(COLOR_MUTED)
          .text(dobStr, D_NAZ + 2, state.y + 13, { width: USABLE_W - D_NAZ + MARGIN - 4, lineBreak: false });
      }
      state.y += rowH;
    });
    state.y += 4;
  }

  // ── KRONOLOŠKI PREGLED ──────────────────────────────────────────────────────
  state.y += 6;
  checkNewPage(state, 30);
  doc.rect(MARGIN, state.y, USABLE_W, 15).fillColor(COLOR_PRIMARY).fill();
  doc.font("DejaVuSans-Bold").fontSize(8).fillColor("#ffffff")
    .text("KRONOLOŠKI PREGLED GIBANJA VREDNOSTI", MARGIN + 4, state.y + 3.5, { lineBreak: false });
  state.y += 17;

  // Stolpci: Datum(70) | Opis(160) | Spr.NV(70) | AM(63) | Sk.PV(75) | Neodp.(77)
  const K_DAT  = MARGIN;       // x=40
  const K_OPIS = MARGIN + 72;  // x=112
  const K_SNV  = MARGIN + 234; // x=274 (right-align, w=68)
  const K_AM   = MARGIN + 304; // x=344 (right-align, w=63)
  const K_PV   = MARGIN + 369; // x=409 (right-align, w=73)
  const K_NED  = MARGIN + 444; // x=484 (right-align, w=71.28)

  doc.rect(MARGIN, state.y, USABLE_W, 14).fillColor("#374151").fill();
  doc.font("DejaVuSans-Bold").fontSize(7).fillColor("#ffffff");
  doc.text("Datum",        K_DAT + 2,  state.y + 3.5, { width: 68, lineBreak: false });
  doc.text("Opis dogodka", K_OPIS + 2, state.y + 3.5, { width: 158, lineBreak: false });
  doc.text("Spr. NV (€)",  K_SNV,      state.y + 3.5, { width: 68,   align: "right", lineBreak: false });
  doc.text("AM (€)",       K_AM,       state.y + 3.5, { width: 63,   align: "right", lineBreak: false });
  doc.text("Sk. PV (€)",   K_PV,       state.y + 3.5, { width: 73,   align: "right", lineBreak: false });
  doc.text("Neodpisana (€)",K_NED,     state.y + 3.5, { width: 71,   align: "right", lineBreak: false });
  state.y += 16;

  if (opts.kronoloskiPregled.length === 0) {
    checkNewPage(state, 14);
    doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
      .text("Ni podatkov.", MARGIN + 4, state.y + 2);
    state.y += 14;
  } else {
    for (let i = 0; i < opts.kronoloskiPregled.length; i++) {
      checkNewPage(state, 13);
      const ev = opts.kronoloskiPregled[i];
      if (i % 2 === 0) doc.rect(MARGIN, state.y, USABLE_W, 13).fillColor("#f9fafb").fill();
      doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
        .text(fmtDat(ev.datum), K_DAT + 2, state.y + 2.5, { width: 68, lineBreak: false });
      doc.fillColor(COLOR_PRIMARY)
        .text(ev.opis, K_OPIS + 2, state.y + 2.5, { width: 158, lineBreak: false });
      const nv = parseFloat(ev.spremembaNv);
      if (nv > 0) {
        doc.font("DejaVuSans-Bold").fontSize(7.5).fillColor("#166534")
          .text(`+${fmtNum(ev.spremembaNv)}`, K_SNV, state.y + 2.5, { width: 68, align: "right", lineBreak: false });
      } else {
        doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
          .text("—", K_SNV, state.y + 2.5, { width: 68, align: "right", lineBreak: false });
      }
      const am = parseFloat(ev.obracunanaAm);
      if (am > 0) {
        doc.font("DejaVuSans-Bold").fontSize(7.5).fillColor(COLOR_NEGATIVE)
          .text(fmtNum(ev.obracunanaAm), K_AM, state.y + 2.5, { width: 63, align: "right", lineBreak: false });
      } else {
        doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_MUTED)
          .text("—", K_AM, state.y + 2.5, { width: 63, align: "right", lineBreak: false });
      }
      doc.font("DejaVuSans").fontSize(7.5).fillColor(COLOR_PRIMARY)
        .text(fmtNum(ev.skupniPv), K_PV, state.y + 2.5, { width: 73, align: "right", lineBreak: false });
      doc.font("DejaVuSans-Bold").fontSize(7.5).fillColor(COLOR_PRIMARY)
        .text(fmtNum(ev.neodpisana), K_NED, state.y + 2.5, { width: 71, align: "right", lineBreak: false });
      state.y += 13;
    }

    // Zaključna vrstica
    state.y += 2;
    checkNewPage(state, 18);
    const zadnji = opts.kronoloskiPregled[opts.kronoloskiPregled.length - 1];
    doc.rect(MARGIN, state.y, USABLE_W, 16).fillColor(COLOR_TOTAL).fill();
    doc.font("DejaVuSans-Bold").fontSize(8).fillColor(COLOR_PRIMARY)
      .text("SEDANJA VREDNOST", MARGIN + 4, state.y + 4, { width: 200, lineBreak: false })
      .text(fmtNum(zadnji.neodpisana) + " €", K_NED, state.y + 4, { width: 71, align: "right", lineBreak: false });
    state.y += 20;
  }

  // Opomba
  state.y += 4;
  checkNewPage(state, 18);
  doc.font("DejaVuSans").fontSize(6.5).fillColor(COLOR_MUTED)
    .text(
      "Kartica je generirana samodejno iz evidence osnovnih sredstev. " +
      "Skupni popravek vrednosti (PV) = uvožena odpisana + Σ obračunov. " +
      "Sedanja (neodpisana) vrednost = skupna NV − skupni PV.",
      MARGIN, state.y, { width: USABLE_W },
    );

  doc.end();
  return bufferPromise;
}
