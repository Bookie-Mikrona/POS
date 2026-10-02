import { describe, expect, it } from "vitest";
import { ledgerPdfMoney, renderPartnerCardPdf, type PartnerCardPdf } from "./partner-ledger-pdf";

const line: PartnerCardPdf["lines"][number] = {
  partnerName: "Preizkus d.o.o.", accountCode: "1200000", accountName: "Terjatve do kupcev",
  importedPartnerCode: "100171", documentType: "issued", documentNumber: "000002",
  reference: "BOOKIE-OLD/K2/2020/60/000002",
  description: "Storitev [Bookie Old GLAVNA #12345, konto 1200000, partner 100171 Preizkus d.o.o.]",
  documentDate: "2020-01-31", durDate: "2020-01-30", postingDate: "2020-02-02", dueDate: "2020-02-08",
  debit: "48.80", credit: "0.00", runningBalance: "386.40", openDebit: "0.00", openCredit: "0.00",
  closings: [],
};
function card(lines: PartnerCardPdf["lines"]): PartnerCardPdf {
  return { companyName: "Preizkus č, š in ž", dateFrom: null, asOfDate: "2026-10-02", mode: "posted",
    lines, openingBalances: [{ accountCode: "1200000", accountName: "Terjatve", balance: "337.60" }], closingBalance: "4.00" };
}
function pages(buffer: Buffer) { return (buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length; }
describe("compact partner ledger PDF", () => {
  it("prints fixed Slovenian cents, thousands and ASCII negative amounts", () => {
    expect(ledgerPdfMoney("1234.5")).toBe("1.234,50");
    expect(ledgerPdfMoney("-1234.5")).toBe("-1.234,50");
    expect(ledgerPdfMoney("0")).toBe("0,00");
  });
  it("does not create an extra page when writing the footer", async () => {
    const pdf = await renderPartnerCardPdf(card([line]));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(pdf)).toBe(1);
  });
  it("paginates compact rows without blank pages and survives long descriptions", async () => {
    const pdf = await renderPartnerCardPdf(card(Array.from({ length: 40 }, () => ({ ...line }))));
    expect(pages(pdf)).toBe(2);
    const long = await renderPartnerCardPdf(card([{ ...line, description: "Zelo dolg opis ".repeat(500) }]));
    expect(pages(long)).toBe(1);
  });
  it("renders partial close, reopening and duplicate evidence without adding turnover rows", async () => {
    const pdf = await renderPartnerCardPdf(card([{ ...line, openDebit: "20.00", closings: [
      { id: "close", type: "close", amount: "48.80", effectiveDate: "2020-02-08", oppositeJournalReference: "BOOKIE-OLD/K2/2020/10/000014" },
      { id: "reopen", type: "reopen", amount: "20.00", effectiveDate: "2020-03-01" },
      { id: "copy", type: "close", amount: "48.80", effectiveDate: "2020-02-08", deduplicatedWith: "posted_payment_allocation" },
    ] }]));
    expect(pages(pdf)).toBe(1);
  });
});