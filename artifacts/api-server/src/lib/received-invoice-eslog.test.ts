import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildReceivedInvoicePackage } from "./document-export-package";
import {
  generirajPrejetiEracunXml, toUneceUnitCode, validateReceivedInvoiceForEslog,
  type ReceivedInvoiceData,
} from "./received-invoice-eslog";
import { generirajEracunXml } from "./eracun/generator";

function validInvoice(): ReceivedInvoiceData {
  return {
    header: {
      documentType: "RACUN",
      documentNumber: "DOB-2026-18",
      documentDate: "2026-08-20",
      dueDate: "2026-09-19",
      deliveryDate: "2026-08-19",
      currency: "EUR",
      netTotal: "120.00",
      vatTotal: "26.40",
      grossTotal: "146.40",
      paymentMethod: "30",
      paymentReference: "SI00 2026-18",
      supplier: {
        name: "Dobavitelj d.o.o.", taxId: "12345678", vatId: "SI12345678", registrationNumber: "7654321",
        street: "Dobaviteljska 1", postCode: "1000", city: "Ljubljana", country: "SI",
        iban: "SI56191000000123456", bic: "BACXSI22",
      },
      customer: { name: "Naše podjetje d.o.o.", taxId: "87654321", vatId: "SI87654321", address: "Naša 2", country: "SI" },
    },
    lines: [{
      name: "Moka", quantity: "10", unitCode: "KGM", netUnitPrice: "12.00", netAmount: "120.00",
      vatCategory: "S", vatRate: "22", vatBase: "120.00", vatAmount: "26.40",
    }],
  };
}

describe("prejeti e-SLOG račun", () => {
  it("uporabi nespremenljiv snapshot dobavitelja in DDV povzetek", () => {
    const snapshot = validInvoice();
    const xml = generirajPrejetiEracunXml(snapshot);
    expect(xml).toContain("Dobavitelj d.o.o.");
    expect(xml).toContain("Naše podjetje d.o.o.");
    expect(xml).toContain("<cac:TaxSubtotal>");
    snapshot.header.supplier.name = "Pozneje urejen partner";
    expect(xml).toContain("Dobavitelj d.o.o.");
    expect(toUneceUnitCode("kg")).toBe("KGM");
  });

  it("zavrne račun brez obveznega podatka, ne ustvari napačnega XML", () => {
    const incomplete = validInvoice();
    incomplete.header.documentNumber = null;
    const validation = validateReceivedInvoiceForEslog(incomplete);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(" ")).toContain("številka");
    expect(() => generirajPrejetiEracunXml(incomplete)).toThrow("Prejeti e-SLOG ni popoln");
  });

  it("ne obravnava dobavnice kot e-SLOG Invoice", () => {
    const deliveryNote = validInvoice();
    deliveryNote.header.documentType = "DOBAVNICA";
    expect(validateReceivedInvoiceForEslog(deliveryNote)).toMatchObject({ valid: false });
  });

  it("zapakira XML, PDF in izvirnik prejetega računa", async () => {
    const xml = generirajPrejetiEracunXml(validInvoice());
    const zipBuffer = await buildReceivedInvoicePackage({
      invoiceNumber: "DOB-2026-18",
      xml,
      pdf: Buffer.from("%PDF-test"),
      original: { filename: "dobavitelj.xml", content: Buffer.from("<source/>") },
      warnings: [],
    });
    const zip = await JSZip.loadAsync(zipBuffer);
    expect(await zip.file("prejeti-racun-DOB-2026-18.xml")?.async("string")).toContain("<Invoice");
    expect(await zip.file("izvirnik-dobavitelj.xml")?.async("string")).toBe("<source/>");
    expect(await zip.file("VALIDACIJA.txt")?.async("string")).toContain("strukturno pripravljen");
  });

  it("zavrne neskladne skupne zneske", () => {
    const inconsistent = validInvoice();
    inconsistent.header.grossTotal = "146.00";
    expect(validateReceivedInvoiceForEslog(inconsistent).errors.join(" ")).toContain("Bruto skupaj");
  });

  it("zavrne DDV vrstico, katere osnova in davek ne ustrezata stopnji", () => {
    const inconsistent = validInvoice();
    inconsistent.lines[0].vatBase = "100.00";
    inconsistent.lines[0].vatAmount = "20.00";
    const messages = validateReceivedInvoiceForEslog(inconsistent).errors.join(" ");
    expect(messages).toContain("DDV osnova");
    expect(messages).toContain("DDV znesek");
  });

  it("zavrne nezdružljivo DDV kategorijo in ceno vrstice", () => {
    const inconsistent = validInvoice();
    inconsistent.lines[0].vatCategory = "Z";
    inconsistent.lines[0].netUnitPrice = "1.00";
    const messages = validateReceivedInvoiceForEslog(inconsistent).errors.join(" ");
    expect(messages).toContain("kategorija Z");
    expect(messages).toContain("količina × neto cena");
  });

  it("ne pokvari ločenega generatorja izdanega računa", () => {
    const xml = generirajEracunXml({
      stevilkaRacuna: "A-1",
      datumCas: new Date("2026-08-20T12:00:00Z"),
      skupaj: "122.00", ddv: "22.00", osnova: "100.00",
      postavke: [{ ime: "Izdana postavka", kolicina: "1", cenaBrutoKos: "122.00", davek: "22" }],
      izdajatelj: { naziv: "Izdajatelj", podjetjeDavcna: "12345678", idZaDdv: "SI12345678" },
      prejemnik: { naziv: "Kupec", davcnaStevilka: "87654321" },
    });
    expect(xml).toContain("<cbc:ID>A-1</cbc:ID>");
  });
});