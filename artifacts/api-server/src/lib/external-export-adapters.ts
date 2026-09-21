import { create } from "xmlbuilder2";
import Decimal from "decimal.js";

export type ExternalJournalLine = {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  partner: string | null;
  partnerId: string | null;
  partnerTaxId: string | null;
  partnerVatId: string | null;
  partnerRegistrationNumber: string | null;
  partnerAddress: string | null;
  costCenter: string | null;
  vatCode: string | null;
  vatRate: string | null;
  vatAmount: string;
  date: string;
  reference: string | null;
  description: string;
};

export type ExternalJournal = {
  id: string;
  companyName: string;
  documentDate: string | null;
  entryDate: string;
  reference: string | null;
  description: string;
  status: string;
  lines: ExternalJournalLine[];
};

export interface JournalExportAdapter {
  readonly id: string;
  readonly label: string;
  serialize(entries: ExternalJournal[]): string;
}

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

/** Stabilen, UTF-8 in podpičje-ločen BOOKIE format za prihodnje profile. */
export const genericCsvAdapter: JournalExportAdapter = {
  id: "bookie-csv-v1",
  label: "BOOKIE CSV v1",
  serialize(entries) {
    const header = [
      "konto", "naziv", "debet", "kredit", "partner", "stroskovno_mesto",
      "ddv_koda", "ddv_stopnja", "ddv_znesek", "datum", "referenca", "opis",
      "partner_id", "partner_davcna", "partner_id_za_ddv", "partner_maticna", "partner_naslov",
    ];
    const rows = entries.flatMap((entry) => entry.lines.map((line) => [
      line.accountCode, line.accountName, line.debit, line.credit, line.partner,
      line.costCenter, line.vatCode, line.vatRate, line.vatAmount, line.date,
      line.reference, line.description,
      line.partnerId, line.partnerTaxId, line.partnerVatId,
      line.partnerRegistrationNumber, line.partnerAddress,
    ].map(csvCell).join(";")));
    return `\uFEFF${[header.join(";"), ...rows].join("\r\n")}\r\n`;
  },
};

/** Kanonični BOOKIE XML; ni izvozni profil tretjega računovodskega programa. */
export const genericXmlAdapter: JournalExportAdapter = {
  id: "bookie-xml-v1",
  label: "BOOKIE XML v1",
  serialize(entries) {
    const root = create({ version: "1.0", encoding: "UTF-8" })
      .ele("BookieJournalExport", { version: "1.0", format: "bookie-xml-v1" });
    for (const entry of entries) {
      const journal = root.ele("Journal", {
        id: entry.id,
        companyName: entry.companyName,
        entryDate: entry.entryDate,
        documentDate: entry.documentDate ?? "",
        reference: entry.reference ?? "",
        status: entry.status,
      });
      journal.ele("Description").txt(entry.description);
      const lines = journal.ele("Lines");
      for (const line of entry.lines) {
        lines.ele("Line", {
          accountCode: line.accountCode,
          accountName: line.accountName,
          debit: line.debit,
          credit: line.credit,
          partner: line.partner ?? "",
          partnerId: line.partnerId ?? "",
          partnerTaxId: line.partnerTaxId ?? "",
          partnerVatId: line.partnerVatId ?? "",
          partnerRegistrationNumber: line.partnerRegistrationNumber ?? "",
          partnerAddress: line.partnerAddress ?? "",
          costCenter: line.costCenter ?? "",
          vatCode: line.vatCode ?? "",
          vatRate: line.vatRate ?? "",
          vatAmount: line.vatAmount,
          date: line.date,
          reference: line.reference ?? "",
        }).txt(line.description);
      }
    }
    return root.end({ prettyPrint: true });
  },
};

/** Registry je namenoma odprt za kasnejše uradne profile Pantheon/Minimax/Vasco. */
export const journalExportAdapters: Record<string, JournalExportAdapter> = {
  [genericCsvAdapter.id]: genericCsvAdapter,
  [genericXmlAdapter.id]: genericXmlAdapter,
};

export function journalBalance(entries: ExternalJournal[]): { balanced: boolean; debit: string; credit: string } {
  const totals = entries.flatMap((entry) => entry.lines).reduce(
    (total, line) => ({ debit: total.debit.plus(line.debit), credit: total.credit.plus(line.credit) }),
    { debit: new Decimal(0), credit: new Decimal(0) },
  );
  return {
    balanced: totals.debit.equals(totals.credit),
    debit: totals.debit.toFixed(2),
    credit: totals.credit.toFixed(2),
  };
}

export type EslogValidationResult = {
  valid: boolean;
  mode: "structural-no-xsd";
  warnings: string[];
};

/**
 * Uradna e-SLOG 2.0 XSD ni del repozitorija, zato ne simuliramo XSD validacije.
 * Pred prenosom preverimo vsaj XML strukturo in jasno vrnemo omejitev.
 */
export function validateEslogForExport(xml: string): EslogValidationResult {
  const warnings = ["Uradna e-SLOG 2.0 XSD datoteka ni nameščena; izvedena je le strukturna validacija XML."];
  const compact = xml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
  const invoice = /<\s*(?:\w+:)?Invoice(?:\s|>)/.test(compact);
  const customizationId = /<\s*(?:\w+:)?CustomizationID(?:\s[^>]*)?>[\s\S]*?<\/\s*(?:\w+:)?CustomizationID\s*>/i.test(compact);
  const closingInvoice = /<\/\s*(?:\w+:)?Invoice\s*>\s*$/i.test(compact);
  return {
    valid: invoice && customizationId && closingInvoice,
    mode: "structural-no-xsd",
    warnings,
  };
}