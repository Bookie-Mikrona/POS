import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  genericCsvAdapter, genericXmlAdapter, journalBalance, journalExportAdapters, validateEslogForExport,
  type ExternalJournal,
} from "./external-export-adapters";
import { generateJournalExportPdf } from "./external-export-pdf";
import { buildEslogInvoicePackage } from "./document-export-package";
import { isExternalExportAccessAllowed } from "./external-export-access";

const journal: ExternalJournal = {
  id: "11111111-1111-1111-1111-111111111111",
  companyName: "Test podjetje d.o.o.",
  documentDate: "2026-08-01",
  entryDate: "2026-08-01",
  reference: "POS:PRODAJA:2026-08-01:SM:E1",
  description: "Dnevna prodaja",
  status: "draft",
  lines: [
    { accountCode: "1000", accountName: "Blagajna", debit: "122.00", credit: "0.00", partner: null, partnerId: null, partnerTaxId: null, partnerVatId: null, partnerRegistrationNumber: null, partnerAddress: null, costCenter: "Ljubljana", vatCode: null, vatRate: null, vatAmount: "0.00", date: "2026-08-01", reference: "POS:PRODAJA:2026-08-01:SM:E1", description: "Gotovina" },
    { accountCode: "7600", accountName: "Prihodki", debit: "0.00", credit: "100.00", partner: null, partnerId: null, partnerTaxId: null, partnerVatId: null, partnerRegistrationNumber: null, partnerAddress: null, costCenter: "Ljubljana", vatCode: "S22", vatRate: "22.00", vatAmount: "22.00", date: "2026-08-01", reference: "POS:PRODAJA:2026-08-01:SM:E1", description: "Prihodki" },
    { accountCode: "2600", accountName: "Izhodni DDV", debit: "0.00", credit: "22.00", partner: null, partnerId: null, partnerTaxId: null, partnerVatId: null, partnerRegistrationNumber: null, partnerAddress: null, costCenter: "Ljubljana", vatCode: "S22", vatRate: "22.00", vatAmount: "22.00", date: "2026-08-01", reference: "POS:PRODAJA:2026-08-01:SM:E1", description: "DDV" },
  ],
};

describe("izvoz za zunanje računovodstvo", () => {
  it("izdela stabilen UTF-8 CSV s zahtevanimi stolpci in uravnoteženim D=K", () => {
    const csv = genericCsvAdapter.serialize([journal]);
    expect(csv.startsWith("\uFEFFkonto;naziv;debet;kredit;partner;stroskovno_mesto")).toBe(true);
    expect(csv).toContain("1000;Blagajna;122.00;0.00");
    expect(journalBalance([journal])).toEqual({ balanced: true, debit: "122.00", credit: "122.00" });
  });

  it("izdela kanonični XML in ohrani adapter registry razširljiv", () => {
    const xml = genericXmlAdapter.serialize([journal]);
    expect(xml).toContain('<BookieJournalExport version="1.0" format="bookie-xml-v1">');
    expect(xml).toContain('accountCode="7600"');
    expect(journalExportAdapters["bookie-csv-v1"]).toBe(genericCsvAdapter);
    expect(journalExportAdapters["bookie-xml-v1"]).toBe(genericXmlAdapter);
  });

  it("na kontu 2200000 izvozi popolno identifikacijo poslovnega partnerja", async () => {
    const partnerJournal: ExternalJournal = {
      ...journal,
      lines: [{
        ...journal.lines[0],
        accountCode: "2200000",
        accountName: "Obveznosti do dobaviteljev",
        partner: "DAVIDOV HRAM VELETRGOVINA D.O.O. LJUBNO",
        partnerId: "7b76badd-2f2c-4caa-8dfe-ba9c4de447a9",
        partnerTaxId: "58843302",
        partnerVatId: "SI58843302",
        partnerRegistrationNumber: "5531667000",
        partnerAddress: "Loke 15, 3333 Ljubno ob Savinji, SI",
      }, {
        ...journal.lines[0],
        accountCode: "2200000",
        accountName: "Obveznosti do dobaviteljev",
        debit: "0.00",
        credit: "122.00",
        partner: "DAVIDOV HRAM VELETRGOVINA D.O.O. LJUBNO",
        partnerId: "7b76badd-2f2c-4caa-8dfe-ba9c4de447a9",
        partnerTaxId: "58843302",
        partnerVatId: "SI58843302",
        partnerRegistrationNumber: "5531667000",
        partnerAddress: "Loke 15, 3333 Ljubno ob Savinji, SI",
      }],
    };
    const csv = genericCsvAdapter.serialize([partnerJournal]);
    expect(csv).toContain("opis;partner_id;partner_davcna;partner_id_za_ddv;partner_maticna;partner_naslov");
    expect(csv).toContain("7b76badd-2f2c-4caa-8dfe-ba9c4de447a9;58843302;SI58843302;5531667000;Loke 15, 3333 Ljubno ob Savinji, SI");
    const xml = genericXmlAdapter.serialize([partnerJournal]);
    expect(xml).toContain('partnerVatId="SI58843302"');
    expect(xml).toContain('partnerRegistrationNumber="5531667000"');
    const pdf = await generateJournalExportPdf([partnerJournal]);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("izdela PDF zbirnik s kontrolnim seštevkom", async () => {
    const pdf = await generateJournalExportPdf([journal]);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(500);
  });

  it("omogoči POS administratorju izvoz brez GLK računovodske vloge", () => {
    expect(isExternalExportAccessAllowed(null, "admin")).toBe(true);
    expect(isExternalExportAccessAllowed("viewer", "blagajnik")).toBe(false);
    expect(isExternalExportAccessAllowed("accountant", null)).toBe(true);
  });

  it("pakira veljavni e-SLOG XML in PDF v ZIP z XSD opozorilom", async () => {
    const xml = '<?xml version="1.0"?><Invoice><CustomizationID>urn:eslog:2.0</CustomizationID></Invoice>';
    expect(validateEslogForExport(xml)).toMatchObject({ valid: true, mode: "structural-no-xsd" });
    const zipBuffer = await buildEslogInvoicePackage({ invoiceNumber: "PP-1/2026", xml, pdf: Buffer.from("%PDF-test") });
    const zip = await JSZip.loadAsync(zipBuffer);
    expect(Object.keys(zip.files).sort()).toEqual(["VALIDACIJA.txt", "eracun-PP-1_2026.xml", "racun-PP-1_2026.pdf"]);
    expect(await zip.file("VALIDACIJA.txt")?.async("string")).toContain("XSD datoteka ni nameščena");
  });
});