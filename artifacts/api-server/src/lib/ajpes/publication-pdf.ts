import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AjpesAnnualReport } from "./annual-model.js";

type PublicationAssessment = AjpesAnnualReport["publicationAssessment"];
type PublicationSection = PublicationAssessment["sections"][number];
type PublicationReport = AjpesAnnualReport;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const LEFT = 42;
const RIGHT = 42;
const TOP = 42;
const BOTTOM = 62;
const CONTENT_BOTTOM = PAGE_HEIGHT - BOTTOM;
const FOOTER_Y = PAGE_HEIGHT - 43;
const FOOTER_HEIGHT = 12;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;

function formatSlovenianDate(date: Date): string {
  return new Intl.DateTimeFormat("sl-SI", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function resolveFontPath(fileName: string): string {
  const candidates = [
    path.join(import.meta.dirname, "..", "..", "assets", "fonts", fileName),
    path.join(import.meta.dirname, "assets", "fonts", fileName),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Publication PDF font is missing. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

const REGULAR_FONT = resolveFontPath("DejaVuSans.ttf");
const BOLD_FONT = resolveFontPath("DejaVuSans-Bold.ttf");

function collectPdfBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Publication PDF requires ${field}.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function publicationReviewDate(settings: PublicationReport["settings"]): string {
  const review = isRecord(settings.publicationReview)
    ? settings.publicationReview
    : undefined;
  const date = review && [
    review.date,
    review.reviewDate,
    review.reviewedAt,
    review.reviewedOn,
    review.at,
  ].find((value) => typeof value === "string" && value.trim());
  if (typeof date !== "string") {
    throw new Error("Publication PDF requires settings.publicationReview date.");
  }
  const match = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (match) {
    const isoDate = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${isoDate}T00:00:00.000Z`);
    if (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === isoDate
    ) {
      return formatSlovenianDate(parsed);
    }
  }
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Publication PDF review date is invalid.");
  }
  return formatSlovenianDate(parsed);
}

function validateReport(report: PublicationReport): PublicationAssessment {
  if (!Number.isInteger(report.year) || report.year < 1900 || report.year > 9999) {
    throw new Error("Publication PDF year must be a valid four-digit year.");
  }
  if (report.year !== 2025) {
    throw new Error("Publication PDF is supported only for the verified 2025 report year.");
  }
  requiredText(report.company?.name, "company.name");
  requiredText(report.company?.street, "company.street");
  requiredText(report.company?.postalCode, "company.postalCode");
  requiredText(report.company?.city, "company.city");
  requiredText(report.company?.registrationNumber, "company.registrationNumber");
  requiredText(report.company?.taxNumber, "company.taxNumber");
  if (report.reviewed !== true || report.canExport !== true) {
    throw new Error("Publication PDF requires an approved and reviewed annual report.");
  }

  const assessment = report.publicationAssessment;
  if (
    !assessment ||
    assessment.ready !== true ||
    assessment.supported !== true ||
    assessment.reviewed !== true ||
    assessment.canExport !== true ||
    (assessment.mode !== "notes" && assessment.mode !== "micro")
  ) {
    throw new Error("Publication PDF requires an approved publication assessment.");
  }
  requiredText(assessment.contentFingerprint, "publicationAssessment.contentFingerprint");
  requiredText(report.sourceFingerprint, "sourceFingerprint");
  if (assessment.contentFingerprint !== report.sourceFingerprint) {
    throw new Error("Publication PDF assessment does not match the reviewed report content.");
  }
  const publicationReview = report.settings.publicationReview;
  if (
    !isRecord(publicationReview) ||
    publicationReview.fingerprint !== report.sourceFingerprint
  ) {
    throw new Error("Publication PDF requires a review for the current report content.");
  }
  if (!Array.isArray(assessment.sections)) {
    throw new Error("Publication PDF assessment sections must be an array.");
  }
  if (!Array.isArray(report.balanceSheet) || !report.balanceSheet.length) {
    throw new Error("Publication PDF requires balance-sheet rows.");
  }
  if (!Array.isArray(report.incomeStatement) || !report.incomeStatement.length) {
    throw new Error("Publication PDF requires income-statement rows.");
  }
  for (const [sectionName, rows] of [
    ["balanceSheet", report.balanceSheet],
    ["incomeStatement", report.incomeStatement],
  ] as const) {
    for (const [index, row] of rows.entries()) {
      requiredText(row?.code, `${sectionName}[${index}].code`);
      requiredText(row?.label, `${sectionName}[${index}].label`);
      requiredText(row?.current, `${sectionName}[${index}].current`);
      requiredText(row?.previous, `${sectionName}[${index}].previous`);
      if (typeof row.bold !== "boolean") {
        throw new Error(`Publication PDF ${sectionName}[${index}].bold must be a boolean.`);
      }
    }
  }
  publicationReviewDate(report.settings);
  return assessment;
}

function validProfileDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return undefined;
  }
  return formatSlovenianDate(date);
}

function formatFinancialAmount(value: string): string {
  const match = value.match(/^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error("Publication PDF encountered a non-decimal financial amount.");
  }
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${match[1]}${integer}${match[3] === undefined ? "" : `,${match[3]}`}`;
}

function fitAmountFontSize(
  doc: InstanceType<typeof PDFDocument>,
  amount: string,
  font: string,
  columnWidth: number,
  maximumFontSize: number,
): number {
  for (let fontSize = maximumFontSize; fontSize >= 4; fontSize -= 0.25) {
    if (doc.font(font).fontSize(fontSize).widthOfString(amount) <= columnWidth - 3) {
      return fontSize;
    }
  }
  throw new Error("Publication PDF financial amount does not fit its comparison column.");
}

function wrapLongWords(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  width: number,
  font: string,
  fontSize: number,
): string {
  const maxChunk = (word: string): string[] => {
    const pieces: string[] = [];
    let piece = "";
    for (const character of word) {
      if (piece && doc.font(font).fontSize(fontSize).widthOfString(piece + character) > width) {
        pieces.push(piece);
        piece = "";
      }
      piece += character;
    }
    if (piece) pieces.push(piece);
    return pieces;
  };

  return text
    .split(/(\s+)/u)
    .map((part) =>
      /^\s+$/u.test(part) || doc.font(font).fontSize(fontSize).widthOfString(part) <= width
        ? part
        : maxChunk(part).join("\n"),
    )
    .join("");
}

function addPage(doc: InstanceType<typeof PDFDocument>): void {
  doc.addPage({ size: "A4", margins: { top: TOP, right: RIGHT, bottom: BOTTOM, left: LEFT } });
}

function ensureSpace(
  doc: InstanceType<typeof PDFDocument>,
  requiredHeight: number,
): void {
  if (doc.y + requiredHeight > CONTENT_BOTTOM) addPage(doc);
}

function writeParagraph(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  options: { font?: string; fontSize?: number; gap?: number; color?: string } = {},
): void {
  const font = options.font ?? "DejaVu";
  const fontSize = options.fontSize ?? 9;
  const gap = options.gap ?? 5;
  const prepared = wrapLongWords(doc, text, CONTENT_WIDTH, font, fontSize);
  const height = doc.font(font).fontSize(fontSize).heightOfString(prepared, {
    width: CONTENT_WIDTH,
    lineGap: 2,
  });
  ensureSpace(doc, Math.min(height, CONTENT_BOTTOM - TOP));
  doc.font(font).fontSize(fontSize).fillColor(options.color ?? "#17202a");
  doc.text(prepared, LEFT, doc.y, { width: CONTENT_WIDTH, lineGap: 2 });
  doc.moveDown(gap / Math.max(fontSize, 1));
}

function writeHeading(doc: InstanceType<typeof PDFDocument>, title: string): void {
  ensureSpace(doc, 36);
  doc.moveDown(0.55);
  doc.font("DejaVu-Bold").fontSize(12).fillColor("#12304a");
  doc.text(wrapLongWords(doc, title, CONTENT_WIDTH, "DejaVu-Bold", 12), LEFT, doc.y, {
    width: CONTENT_WIDTH,
    lineGap: 2,
  });
  doc.moveDown(0.25);
}

function sectionText(section: PublicationSection): string {
  return typeof section.text === "string" ? section.text.trim() : "";
}

function sectionMetadata(section: PublicationSection): string[] {
  const hiddenKeys = new Set(["code", "label", "text"]);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(section)) {
    if (
      hiddenKeys.has(key) ||
      /(^|_)(id|user.?id|actor.?id|clerk.?id)$/i.test(key) ||
      /^(?:user|clerk|actor)[_-][a-z0-9_-]+$/i.test(String(value ?? "")) ||
      /^[0-9a-f-]{24,}$/i.test(String(value ?? "")) ||
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines;
}

function selectedSections(
  assessment: PublicationAssessment,
  report: PublicationReport,
): Map<string, PublicationSection> {
  const allowed = assessment.mode === "micro"
    ? new Set(["disclosure4", "disclosure5", "disclosure6", "disclosure10", "profit_proposal", "profit_adopted", "statement"])
    : assessment.mode === "notes"
      ? new Set(["accounting_policies", "explanations", "profit_proposal", "profit_adopted", "statement"])
      : new Set<string>();
  const sections = new Map<string, PublicationSection>();
  for (const raw of assessment.sections) {
    if (!isRecord(raw) || typeof raw.code !== "string" || typeof raw.label !== "string") continue;
    if (!allowed.has(raw.code) || sections.has(raw.code)) continue;
    const text = typeof raw.text === "string" ? raw.text : "";
    sections.set(raw.code, { ...raw, code: raw.code, label: raw.label, text });
  }

  const profile = report.settings.profile;
  const statementEligible =
    profile?.simplifiedSubmission === "yes" &&
    profile.confirmed === true &&
    report.profileAssessment?.confirmed === true &&
    (profile.size === "micro" || profile.size === "small") &&
    profile.auditRequired === "no" &&
    profile.listed === "no" &&
    profile.specialRegime === "no" &&
    profile.periodStart === `${report.year}-01-01` &&
    profile.periodEnd === `${report.year}-12-31`;
  if (!statementEligible) sections.delete("statement");
  return sections;
}

const SECTION_LABELS: Record<string, string> = {
  accounting_policies: "Računovodske usmeritve",
  explanations: "Pojasnila k izkazom",
  disclosure4: "Razkritje iz 4. točke",
  disclosure5: "Razkritje iz 5. točke",
  disclosure6: "Razkritje iz 6. točke",
  disclosure10: "Razkritje iz 10. točke",
  profit_proposal: "Predlog razporeditve dobička oziroma obravnavanja izgube",
  profit_adopted: "Sprejeta razporeditev dobička oziroma obravnavanje izgube",
  statement: "Izjava za poenostavljeno predložitev",
};

function writePublicationSection(
  doc: InstanceType<typeof PDFDocument>,
  section: PublicationSection,
): void {
  const text = sectionText(section);
  if (!text) return;
  const label = SECTION_LABELS[section.code] ?? section.label;
  writeHeading(doc, label);
  writeParagraph(doc, text, { gap: 2 });
  for (const metadata of sectionMetadata(section)) {
    writeParagraph(doc, metadata, { fontSize: 8, gap: 2, color: "#4b5563" });
  }
  doc.moveDown(0.35);
}

function writeStatementColumns(
  doc: InstanceType<typeof PDFDocument>,
  year: number,
  labelWidth: number,
  amountWidth: number,
  currentX: number,
  previousX: number,
): void {
  const headerHeight = 17;
  ensureSpace(doc, 31);
  const unitY = doc.y;
  doc.font("DejaVu").fontSize(7).fillColor("#4b5563");
  doc.text("Zneski v EUR", currentX, unitY, {
    width: amountWidth * 2,
    align: "right",
    lineBreak: false,
    height: 9,
  });
  const headerY = unitY + 11;
  doc.font("DejaVu-Bold").fontSize(8).fillColor("#374151");
  doc.text("Postavka", LEFT, headerY, { width: labelWidth });
  doc.text(String(year), currentX, headerY, { width: amountWidth, align: "right" });
  doc.text(String(year - 1), previousX, headerY, { width: amountWidth, align: "right" });
  doc.moveTo(LEFT, headerY + headerHeight - 2)
    .lineTo(PAGE_WIDTH - RIGHT, headerY + headerHeight - 2)
    .lineWidth(0.45)
    .stroke("#aab2bd");
  doc.y = headerY + headerHeight + 2;
}

function writeFinancialStatement(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  rows: AjpesAnnualReport["balanceSheet"],
  year: number,
  continuation = false,
): void {
  writeHeading(doc, continuation ? `${title} (nadaljevanje)` : title);
  doc.font("DejaVu-Bold").fontSize(8).fillColor("#374151");
  const labelWidth = 265;
  const amountWidth = (CONTENT_WIDTH - labelWidth) / 2;
  const currentX = LEFT + labelWidth;
  const previousX = currentX + amountWidth;
  writeStatementColumns(doc, year, labelWidth, amountWidth, currentX, previousX);

  for (const row of rows) {
    const font = row.bold ? "DejaVu-Bold" : "DejaVu";
    const fontSize = 7.5;
    const label = wrapLongWords(doc, row.label, labelWidth - 8, font, fontSize);
    const labelHeight = doc.font(font).fontSize(fontSize).heightOfString(label, {
      width: labelWidth - 8,
      lineGap: 1,
    });
    const rowHeight = Math.max(13, labelHeight + 3);
    const currentAmount = formatFinancialAmount(row.current);
    const previousAmount = formatFinancialAmount(row.previous);
    const currentFontSize = fitAmountFontSize(
      doc,
      currentAmount,
      font,
      amountWidth,
      fontSize,
    );
    const previousFontSize = fitAmountFontSize(
      doc,
      previousAmount,
      font,
      amountWidth,
      fontSize,
    );
    if (doc.y + rowHeight > CONTENT_BOTTOM) {
      addPage(doc);
      writeHeading(doc, `${title} (nadaljevanje)`);
      writeStatementColumns(doc, year, labelWidth, amountWidth, currentX, previousX);
    }
    const rowY = doc.y;
    doc.font(font).fontSize(fontSize).fillColor("#17202a");
    doc.text(label, LEFT, rowY, { width: labelWidth - 8, lineGap: 1 });
    // Preserve the model's exact decimal strings: do not coerce to Number.
    doc.font(font).fontSize(currentFontSize).fillColor("#17202a");
    doc.text(currentAmount, currentX, rowY, {
      width: amountWidth,
      align: "right",
      lineBreak: false,
      height: rowHeight,
    });
    doc.font(font).fontSize(previousFontSize).fillColor("#17202a");
    doc.text(previousAmount, previousX, rowY, {
      width: amountWidth,
      align: "right",
      lineBreak: false,
      height: rowHeight,
    });
    if (row.bold) {
      doc.moveTo(LEFT, rowY + rowHeight - 1)
        .lineTo(PAGE_WIDTH - RIGHT, rowY + rowHeight - 1)
        .lineWidth(0.2)
        .stroke("#d5d8dc");
    }
    doc.y = rowY + rowHeight;
  }
  doc.moveDown(0.75);
}

export async function generateAjpesPublicationPdf(
  report: AjpesAnnualReport,
): Promise<Buffer> {
  const publicationReport = report as PublicationReport;
  const assessment = validateReport(publicationReport);
  const selected = selectedSections(assessment, publicationReport);
  const doc = new PDFDocument({
    size: "A4",
    autoFirstPage: false,
    margins: { top: TOP, right: RIGHT, bottom: BOTTOM, left: LEFT },
    bufferPages: true,
    info: {
      Title: `Letno poročilo za javno objavo ${report.year}`,
      Author: "Bookie ERP",
      Subject: "Pripravljeno letno poročilo za javno objavo",
    },
  });
  const output = collectPdfBuffer(doc);
  doc.registerFont("DejaVu", REGULAR_FONT);
  doc.registerFont("DejaVu-Bold", BOLD_FONT);
  addPage(doc);

  doc.font("DejaVu-Bold").fontSize(16).fillColor("#12304a");
  doc.text("Letno poročilo za javno objavo", LEFT, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.3);
  writeParagraph(
    doc,
    "Pripravljeno dokumentno gradivo. Ta dokument ni elektronsko podpisan in ni dokazilo o predložitvi oziroma oddaji na AJPES.",
    { fontSize: 8, color: "#7f1d1d", gap: 9 },
  );

  const profile = report.settings.profile;
  const periodStart = validProfileDate(profile?.periodStart);
  const periodEnd = validProfileDate(profile?.periodEnd);
  const legalFormLabel =
    profile?.legalForm === "doo" ? "d.o.o." :
      profile?.legalForm === "dd" ? "d.d." :
        profile?.legalForm === "sp" ? "s.p." :
          profile?.legalForm === "cooperative" ? "zadruga" :
            profile?.legalForm === "other" ? "druga pravna oblika" : undefined;
  const sizeLabel =
    profile?.size === "micro" ? "Mikro" :
      profile?.size === "small" ? "Majhna" :
        profile?.size === "medium" ? "Srednja" :
          profile?.size === "large" ? "Velika" : undefined;
  writeHeading(doc, "Podatki o družbi in obdobju");
  for (const line of [
    `Družba: ${report.company.name}`,
    `Naslov: ${report.company.street}, ${report.company.postalCode} ${report.company.city}`,
    `Matična številka: ${report.company.registrationNumber}`,
    `Davčna številka: ${report.company.taxNumber}`,
    `Poslovno leto: ${report.year}`,
    ...(periodStart && periodEnd ? [`Poslovno obdobje: ${periodStart}–${periodEnd}`] : []),
    ...(legalFormLabel ? [`Pravna oblika: ${legalFormLabel}`] : []),
    ...(profile?.framework ? [`Računovodski okvir: ${profile.framework}`] : []),
    ...(sizeLabel ? [`Velikost družbe: ${sizeLabel}`] : []),
  ]) {
    writeParagraph(doc, line, { fontSize: 9, gap: 2 });
  }

  writeFinancialStatement(
    doc,
    `Bilanca stanja na dan 31. 12. ${report.year}`,
    report.balanceSheet,
    report.year,
  );
  if (assessment.mode === "micro") {
    for (const code of ["disclosure4", "disclosure5", "disclosure6", "disclosure10"]) {
      const section = selected.get(code);
      if (section) writePublicationSection(doc, section);
    }
  }

  writeFinancialStatement(
    doc,
    `Izkaz poslovnega izida za leto ${report.year}`,
    report.incomeStatement,
    report.year,
  );

  const afterStatements = assessment.mode === "notes"
    ? ["accounting_policies", "explanations", "profit_proposal", "profit_adopted", "statement"]
    : ["profit_proposal", "profit_adopted", "statement"];
  for (const code of afterStatements) {
    const section = selected.get(code);
    if (section) writePublicationSection(doc, section);
  }

  writeHeading(doc, "Sledljivost pregleda");
  writeParagraph(doc, `Prstni odtis pregledane vsebine: ${assessment.contentFingerprint}`, {
    fontSize: 8,
    gap: 2,
  });
  writeParagraph(doc, `Prstni odtis izvornih podatkov: ${report.sourceFingerprint}`, {
    fontSize: 8,
    gap: 2,
  });
  writeParagraph(doc, `Datum pregleda: ${publicationReviewDate(report.settings)}`, {
    fontSize: 8,
    gap: 2,
  });

  const pageRange = doc.bufferedPageRange();
  for (let index = pageRange.start; index < pageRange.start + pageRange.count; index++) {
    doc.switchToPage(index);
    doc.font("DejaVu").fontSize(7).fillColor("#6b7280");
    doc.text(`Pripravljeno gradivo · Stran ${index + 1} / ${pageRange.count}`, LEFT, FOOTER_Y, {
      width: CONTENT_WIDTH,
      align: "center",
      lineBreak: false,
      height: FOOTER_HEIGHT,
    });
  }
  doc.end();
  return output;
}