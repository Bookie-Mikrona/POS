import PDFDocument from "pdfkit";
import Decimal from "decimal.js";
import { existsSync } from "node:fs";
import path from "node:path";

type Closing = Record<string, any>;
type Line = {
  partnerName: string; accountCode: string; accountName: string;
  importedPartnerCode?: string | null; documentType: string | null;
  documentNumber: string | null; reference: string | null; description: string;
  documentDate: string | null; postingDate: string; dueDate: string | null;
  durDate?: string | null;
  originalDocumentNumber?: string | null;
  debit: string; credit: string; runningBalance: string; openDebit: string; openCredit: string;
  closings: Closing[];
};
export type PartnerCardPdf = {
  companyName: string; dateFrom?: string | null; asOfDate: string; mode: string;
  lines: Line[];
  openingBalances: Array<{ accountCode: string; accountName: string; balance: string }>;
  closingBalance: string;
};

export function ledgerPdfMoney(value: Decimal.Value): string {
  const [whole, fraction] = new Decimal(value).toFixed(2).split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
}
function date(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "—";
}
function reference(value: string | null | undefined) {
  return /^BOOKIE-OLD\/K2\/(\d{4})\/([^/]+)\/(.+)$/.exec(value ?? "");
}
function documentLabel(line: Line): string {
  return reference(line.reference)?.[2] ?? ({ issued: "IR", received: "PR", payment: "PL", manual: "TK" }[line.documentType ?? ""] ?? "—");
}
function cleanDescription(value: string): string {
  return value.replace(/\s*\[Bookie Old GLAVNA #[^\]]+\]\s*$/, "").trim();
}
function closingReference(closing: Closing): string {
  const proof = closing.counterpartProof;
  if (proof?.year && proof?.type && proof?.voucherNumber) {
    return [proof.year, proof.type, proof.voucherNumber, proof.documentNumber].filter(Boolean).join(" ");
  }
  const ref = reference(closing.oppositeJournalReference);
  if (ref) {
    const number = closing.oppositeDocumentNumber;
    return `${ref[1]} ${ref[2]} ${ref[3]}${number && !String(number).startsWith("BOOKIE-OLD/") ? ` ${number}` : ""}`;
  }
  if (closing.oppositeDocumentNumber) return String(closing.oppositeDocumentNumber);
  if (closing.oppositeSourceLineReference) return `Izvor št. ${closing.oppositeSourceLineReference}`;
  return closing.type === "reopen" ? "Ponovno odprtje" : "Zapiranje";
}

/** Compact landscape statement; evidence is under its parent, not new turnover. */
export function renderPartnerCardPdf(card: PartnerCardPdf, openOnly = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const fontDir = [path.join(import.meta.dirname, "assets", "fonts"), path.join(import.meta.dirname, "..", "assets", "fonts")]
      .find(dir => existsSync(path.join(dir, "DejaVuSans.ttf")));
    const normal = path.join(fontDir ?? "", "DejaVuSans.ttf");
    const bold = path.join(fontDir ?? "", "DejaVuSans-Bold.ttf");
    if (!existsSync(normal)) { reject(new Error("Manjka pisava DejaVu za slovenski PDF.")); doc.end(); return; }
    doc.registerFont("Body", normal);
    doc.registerFont("Bold", existsSync(bold) ? bold : normal);
    const margin = 24;
    const width = doc.page.width - 2 * margin;
    const baseWidths = [20, 34, 56, 93, 51, 51, 51, 60, 60, 65, 126, 62, 65];
    const widths = baseWidths.map(w => w * width / 794);
    const headings = ["Vr.", "Tem.", "Številka", "Opis knjižbe", "Dat. dok.", "DUR", "Dat. zap.", "Debet", "Kredit", "Saldo", "Veza", "Znesek zap.", "Ostanek"];
    const first = card.lines[0];
    const partner = first?.partnerName ?? "Ni postavk";
    const partnerCode = first?.importedPartnerCode
      ?? first?.description.match(/, partner ([^\s,\]]+)/)?.[1] ?? "";
    const account = first ? `${first.accountCode} ${first.accountName}`
      : card.openingBalances.map(b => `${b.accountCode} ${b.accountName}`).join("; ");
    const years = [...new Set(card.lines.map(l => reference(l.reference)?.[1] ?? l.postingDate.slice(0, 4)))].sort();
    const scope = years.length ? `${years[0]}${years.length > 1 ? `–${years.at(-1)}` : ""}` : "brez prometa";
    let page = 0;
    let y = 0;
    const text = (value: string, x: number, atY: number, cellWidth: number, height: number, align: "left" | "right" = "left") =>
      doc.text(value, x, atY, { width: cellWidth, height, align, lineBreak: false });
    function header() {
      page += 1;
      doc.font("Bold").fontSize(9).fillColor("#111111");
      text(card.companyName, margin, 23, width, 16);
      doc.fontSize(11);
      text("KARTICA PARTNERJA", margin, 43, width, 18);
      doc.font("Body").fontSize(8);
      text(`Partner: ${partnerCode ? `${partnerCode}  ` : ""}${partner}`, margin, 64, width, 14);
      text(`Konto: ${account}`, margin, 78, width, 14);
      text(`Obdobje: ${card.dateFrom ? date(card.dateFrom) : `preneseni promet ${scope}`} do ${date(card.asOfDate)}; ${openOnly ? "samo odprte" : "vse postavke"}; ${card.mode === "drafts" ? "OSNUTKI — brez računovodskih učinkov" : "knjižene postavke"}`, margin, 92, width, 14);
      doc.fontSize(7);
      text("DUR je iz izvirne evidence; — pomeni manjkajoč vir. Veze lahko kažejo starejše izvorne knjižbe. Zapiranja niso dodaten promet.", margin, 108, width, 12);
      let x = margin;
      doc.rect(margin, 126, width, 20).fill("#eeeeee");
      doc.font("Bold").fontSize(7);
      headings.forEach((heading, i) => {
        doc.fillColor("#111111");
        text(heading, x + 2, 132, widths[i]! - 4, 12, i >= 7 && i !== 10 ? "right" : "left");
        x += widths[i]!;
      });
      y = 149;
    }
    function ensure(height: number) {
      if (y + height > doc.page.height - 44) { doc.addPage(); header(); }
    }
    function row(cells: string[], evidence = false, emphasis = false) {
      doc.font(emphasis ? "Bold" : "Body").fontSize(7.5);
      const heights = cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i]! - 4 }));
      const height = Math.max(13, Math.min(96, Math.max(...heights))) + 3;
      ensure(height);
      if (emphasis) doc.rect(margin, y - 1, width, height).fill("#eeeeee");
      let x = margin;
      doc.font(emphasis ? "Bold" : "Body").fontSize(7.5).fillColor(evidence ? "#444444" : "#111111");
      cells.forEach((cell, i) => {
        doc.text(cell, x + 2, y + 1, { width: widths[i]! - 4, height: height - 2, ellipsis: true,
          align: i >= 7 && i !== 10 ? "right" : "left" });
        x += widths[i]!;
      });
      y += height;
      if (!evidence) doc.moveTo(margin, y - 1).lineTo(margin + width, y - 1).strokeColor("#dddddd").lineWidth(0.3).stroke();
    }
    header();
    for (const opening of card.openingBalances) {
      row(["", "", "", "Začetno stanje", "", "", "", "", "", ledgerPdfMoney(opening.balance), "", "", ""], false, true);
    }
    for (const line of card.lines) {
      const ref = reference(line.reference);
      const remainder = new Decimal(line.openDebit).minus(line.openCredit);
      const docNumber = line.originalDocumentNumber ?? (line.documentNumber?.startsWith("BOOKIE-OLD/") ? ref?.[3] ?? line.documentNumber : line.documentNumber);
      const sorted = [...line.closings].sort((a, b) => String(a.effectiveDate ?? "").localeCompare(String(b.effectiveDate ?? "")) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
      const evidenceCells = (closing: Closing): [string, string] => [
        `${closing.type === "reopen" ? "Odprtje: " : ""}${closingReference(closing)}${closing.warning && !closing.oppositeJournalReference && !closing.counterpartProof ? " (brez knjižbe v obsegu)" : ""}`,
        closing.deduplicatedWith ? "dokazilo" : ledgerPdfMoney(closing.type === "reopen" ? new Decimal(closing.amount ?? 0).negated() : closing.amount ?? 0),
      ];
      const firstClosing = sorted[0] ? evidenceCells(sorted[0]) : ["", ""];
      row([documentLabel(line), ref?.[3] ?? "", docNumber ?? "—", cleanDescription(line.description),
        date(line.documentDate ?? line.postingDate), date(line.durDate), date(line.dueDate),
        ledgerPdfMoney(line.debit), ledgerPdfMoney(line.credit), ledgerPdfMoney(line.runningBalance),
        firstClosing[0]!, firstClosing[1]!, ledgerPdfMoney(remainder)]);
      for (const closing of sorted.slice(1)) {
        const [label, amount] = evidenceCells(closing);
        row(["", "", "", "", "", "", "", "", "", "", label, amount, ""], true);
      }
    }
    const sums = card.lines.reduce((sum, line) => ({
      d: sum.d.plus(line.debit), c: sum.c.plus(line.credit), od: sum.od.plus(line.openDebit), oc: sum.oc.plus(line.openCredit),
    }), { d: new Decimal(0), c: new Decimal(0), od: new Decimal(0), oc: new Decimal(0) });
    row(["", "", "", "SKUPAJ PROMET", "", "", "", ledgerPdfMoney(sums.d), ledgerPdfMoney(sums.c),
      ledgerPdfMoney(card.closingBalance), "", "", ledgerPdfMoney(sums.od.minus(sums.oc))], false, true);
    ensure(20);
    doc.font("Body").fontSize(8).fillColor("#111111");
    text(`Odprti debet: ${ledgerPdfMoney(sums.od)} EUR    Odprti kredit: ${ledgerPdfMoney(sums.oc)} EUR    Vsi zneski so v EUR.`, margin, y + 5, width, 14);
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Body").fontSize(7).fillColor("#666666");
      text(`Bookie ERP · Stanje na dan ${date(card.asOfDate)}`, margin, doc.page.height - 24, width - 100, 10);
      text(`Stran ${i + 1} / ${page}`, doc.page.width - margin - 100, doc.page.height - 24, 100, 10, "right");
    }
    doc.end();
  });
}