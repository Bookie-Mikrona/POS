import PDFDocument from "pdfkit";
import path from "path";
import Decimal from "decimal.js";
import type { ExternalJournal } from "./external-export-adapters";

const FONT_DIR = path.join(import.meta.dirname, "..", "assets", "fonts");
const FONT_REG = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");

function collect(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function money(value: string | number): string {
  return Number(value).toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setup(doc: InstanceType<typeof PDFDocument>): void {
  doc.registerFont("DejaVuSans", FONT_REG);
  doc.registerFont("DejaVuSans-Bold", FONT_BOLD);
  doc.font("DejaVuSans");
}

export async function generateJournalExportPdf(entries: ExternalJournal[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
  const done = collect(doc);
  setup(doc);
  let y = 36;
  const newPage = () => {
    if (y < 740) return;
    doc.addPage();
    y = 36;
  };

  for (const entry of entries) {
    if (y > 600) { doc.addPage(); y = 36; }
    doc.font("DejaVuSans-Bold").fontSize(13).fillColor("#1a1a2e")
      .text(entry.companyName, 36, y);
    y += 18;
    doc.font("DejaVuSans-Bold").fontSize(10)
      .text("Zbirna temeljnica — izvoz za zunanje računovodstvo", 36, y);
    y += 14;
    doc.font("DejaVuSans").fontSize(8).fillColor("#4b5563")
      .text(`Datum: ${entry.entryDate}   Referenca: ${entry.reference ?? "—"}   Status: ${entry.status}`, 36, y);
    y += 13;
    doc.text(entry.description, 36, y, { width: 520 });
    y += 18;
    doc.fillColor("#111827").font("DejaVuSans-Bold").fontSize(7)
      .text("KONTO", 36, y).text("NAZIV / OPIS", 95, y).text("SM", 305, y)
      .text("DEBET", 400, y, { width: 65, align: "right" }).text("KREDIT", 470, y, { width: 65, align: "right" });
    y += 10;
    doc.moveTo(36, y).lineTo(540, y).strokeColor("#d1d5db").stroke();
    y += 5;
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    for (const line of entry.lines) {
      newPage();
      const partnerDetails = line.partner
        ? [
            `Partner: ${line.partner}`,
            line.partnerVatId ? `ID DDV: ${line.partnerVatId}` : line.partnerTaxId ? `DŠ: ${line.partnerTaxId}` : null,
            line.partnerRegistrationNumber ? `MŠ: ${line.partnerRegistrationNumber}` : null,
            line.partnerAddress,
          ].filter(Boolean).join(" | ")
        : null;
      doc.font("DejaVuSans").fontSize(7).fillColor("#111827")
        .text(line.accountCode, 36, y, { width: 55 })
        .text(`${line.accountName} — ${line.description}`, 95, y, { width: 205, height: partnerDetails ? 10 : 18 })
        .text(line.costCenter ?? "—", 305, y, { width: 85 })
        .text(line.debit === "0.00" ? "" : money(line.debit), 400, y, { width: 65, align: "right" })
        .text(line.credit === "0.00" ? "" : money(line.credit), 470, y, { width: 65, align: "right" });
      if (partnerDetails) {
        doc.fontSize(6).fillColor("#4b5563").text(partnerDetails, 95, y + 9, { width: 295, height: 18 });
      }
      debit = debit.plus(line.debit);
      credit = credit.plus(line.credit);
      y += partnerDetails ? 28 : 18;
    }
    y += 3;
    doc.moveTo(36, y).lineTo(540, y).strokeColor("#9ca3af").stroke();
    y += 7;
    const balanced = debit.equals(credit);
    doc.font("DejaVuSans-Bold").fontSize(8).fillColor("#111827")
      .text(`KONTROLNI SEŠTEVEK — debet: ${money(debit.toFixed(2))} EUR   kredit: ${money(credit.toFixed(2))} EUR`, 36, y);
    y += 12;
    doc.fillColor(balanced ? "#166534" : "#991b1b")
      .text(balanced ? "KONTROLA: D = K (uravnoteženo)" : "KONTROLA: D ≠ K (izvoz ni veljaven)", 36, y);
    y += 24;
  }
  doc.end();
  return done;
}

export type PosInvoicePdfData = {
  companyName: string;
  invoiceNumber: string;
  issuedAt: string;
  customerName: string | null;
  customerAddress: string | null;
  paymentMethod: string;
  total: string;
  vat: string;
  items: Array<{ name: string; quantity: string; unitPrice: string; total: string; vatRate: string }>;
};

export async function generatePosInvoicePdf(data: PosInvoicePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  const done = collect(doc);
  setup(doc);
  let y = 42;
  doc.font("DejaVuSans-Bold").fontSize(16).fillColor("#1a1a2e").text(data.companyName, 42, y);
  y += 25;
  doc.fontSize(12).text(`RAČUN ${data.invoiceNumber}`, 42, y);
  y += 18;
  doc.font("DejaVuSans").fontSize(9).fillColor("#374151")
    .text(`Datum: ${data.issuedAt}`, 42, y)
    .text(`Način plačila: ${data.paymentMethod}`, 300, y);
  y += 22;
  if (data.customerName) {
    doc.font("DejaVuSans-Bold").fillColor("#111827").text("Kupec", 42, y);
    y += 12;
    doc.font("DejaVuSans").text(data.customerName, 42, y);
    if (data.customerAddress) { y += 12; doc.text(data.customerAddress, 42, y); }
    y += 20;
  }
  doc.font("DejaVuSans-Bold").fontSize(8).text("POSTAVKA", 42, y).text("KOL.", 300, y)
    .text("CENA", 365, y, { width: 75, align: "right" }).text("SKUPAJ", 450, y, { width: 90, align: "right" });
  y += 11;
  doc.moveTo(42, y).lineTo(540, y).strokeColor("#d1d5db").stroke();
  y += 7;
  for (const item of data.items) {
    if (y > 720) { doc.addPage(); y = 42; }
    doc.font("DejaVuSans").fontSize(8).fillColor("#111827").text(`${item.name} (${item.vatRate}% DDV)`, 42, y, { width: 250 })
      .text(item.quantity, 300, y).text(money(item.unitPrice), 365, y, { width: 75, align: "right" })
      .text(money(item.total), 450, y, { width: 90, align: "right" });
    y += 16;
  }
  y += 8;
  doc.moveTo(42, y).lineTo(540, y).strokeColor("#9ca3af").stroke();
  y += 10;
  doc.font("DejaVuSans-Bold").fontSize(10).text(`DDV: ${money(data.vat)} EUR`, 340, y, { width: 200, align: "right" });
  y += 16;
  doc.fontSize(12).text(`ZA PLAČILO: ${money(data.total)} EUR`, 300, y, { width: 240, align: "right" });
  doc.end();
  return done;
}

export type ReceivedInvoicePdfData = {
  supplierName: string;
  customerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  items: Array<{ name: string; quantity: string; unitPrice: string; total: string; vatRate: string }>;
};

export async function generateReceivedInvoicePdf(data: ReceivedInvoicePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  const done = collect(doc);
  setup(doc);
  let y = 42;
  doc.font("DejaVuSans-Bold").fontSize(15).fillColor("#1a1a2e").text("PREJETI RAČUN", 42, y);
  y += 23;
  doc.fontSize(11).text(`${data.supplierName} → ${data.customerName}`, 42, y);
  y += 18;
  doc.font("DejaVuSans").fontSize(9).fillColor("#374151")
    .text(`Račun: ${data.invoiceNumber}   Datum: ${data.invoiceDate}`, 42, y);
  if (data.dueDate) doc.text(`Zapadlost: ${data.dueDate}`, 330, y);
  y += 22;
  doc.font("DejaVuSans-Bold").fontSize(8).fillColor("#111827")
    .text("POSTAVKA", 42, y).text("KOL.", 292, y).text("NETO CENA", 352, y, { width: 82, align: "right" })
    .text("NETO", 450, y, { width: 90, align: "right" });
  y += 11;
  doc.moveTo(42, y).lineTo(540, y).strokeColor("#d1d5db").stroke();
  y += 7;
  for (const item of data.items) {
    if (y > 720) { doc.addPage(); y = 42; }
    doc.font("DejaVuSans").fontSize(8).fillColor("#111827")
      .text(`${item.name} (${item.vatRate}% DDV)`, 42, y, { width: 235 })
      .text(item.quantity, 292, y)
      .text(money(item.unitPrice), 352, y, { width: 82, align: "right" })
      .text(money(item.total), 450, y, { width: 90, align: "right" });
    y += 16;
  }
  y += 8;
  doc.moveTo(42, y).lineTo(540, y).strokeColor("#9ca3af").stroke();
  y += 10;
  doc.font("DejaVuSans-Bold").fontSize(9).text(`OSNOVA: ${money(data.netTotal)} ${data.currency}`, 330, y, { width: 210, align: "right" });
  y += 14;
  doc.text(`DDV: ${money(data.vatTotal)} ${data.currency}`, 330, y, { width: 210, align: "right" });
  y += 17;
  doc.fontSize(12).text(`ZA PLAČILO: ${money(data.grossTotal)} ${data.currency}`, 280, y, { width: 260, align: "right" });
  doc.end();
  return done;
}