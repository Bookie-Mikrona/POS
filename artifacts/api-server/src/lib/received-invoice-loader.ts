/**
 * Deljeni nalagalnik podatkov prejetega računa za e-SLOG izvoz.
 * Uporablja se tako v ERP external-exports endpointu kot v POS uvoz endpointu.
 */
import { and, eq } from "drizzle-orm";
import {
  db, enoteTable, prejemnicePostavkeTable, prejemniceTable, uvozSejaTable,
} from "@workspace/db";
import type { ReceivedInvoiceData, ReceivedInvoiceLine } from "./received-invoice-eslog";

export function asReceiptDate(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/**
 * Naloži podatke prejemnice za e-SLOG generiranje.
 * Vrne podatke iz snapshot polj glave (ne živega šifranta partnerja)
 * ter kanonične podatke vrstic. Če prejemnica ne obstaja ali ne pripada
 * podjetju, vrne null.
 */
export async function loadReceivedInvoice(companyId: string, receiptId: number): Promise<{
  data: ReceivedInvoiceData;
  source: { content: Buffer; filename: string } | undefined;
} | null> {
  const [header] = await db.select({
    id: prejemniceTable.id,
    documentType: prejemniceTable.vrstaDokumenta,
    documentNumber: prejemniceTable.stDokumenta,
    documentDate: prejemniceTable.datumDokumenta,
    dueDate: prejemniceTable.datumZapadlosti,
    deliveryDate: prejemniceTable.datumDobave,
    currency: prejemniceTable.valuta,
    netTotal: prejemniceTable.ddvOsnova,
    vatTotal: prejemniceTable.ddvZnesek,
    grossTotal: prejemniceTable.brutoSkupaj,
    paymentMethod: prejemniceTable.placilniNacin,
    paymentReference: prejemniceTable.placilniSklic,
    // Snapshot polja — ne posodobljeni ob spremembi partnerja
    supplierName: prejemniceTable.dobaviteljNaziv,
    supplierTaxId: prejemniceTable.dobaviteljDavcna,
    supplierVatId: prejemniceTable.dobaviteljIdDdv,
    supplierRegistrationNumber: prejemniceTable.dobaviteljMaticna,
    supplierStreet: prejemniceTable.dobaviteljUlica,
    supplierPostCode: prejemniceTable.dobaviteljPosta,
    supplierCity: prejemniceTable.dobaviteljKraj,
    supplierCountry: prejemniceTable.dobaviteljDrzava,
    supplierIban: prejemniceTable.dobaviteljIban,
    supplierBic: prejemniceTable.dobaviteljBic,
    customerName: prejemniceTable.prejemnikNaziv,
    customerTaxId: prejemniceTable.prejemnikDavcna,
    customerVatId: prejemniceTable.prejemnikIdDdv,
    customerAddress: prejemniceTable.prejemnikNaslov,
    customerCountry: prejemniceTable.prejemnikDrzava,
    original: uvozSejaTable.vsebina,
    originalFilename: uvozSejaTable.imeDatoteke,
  }).from(prejemniceTable)
    .innerJoin(enoteTable, eq(enoteTable.id, prejemniceTable.enotaId))
    .leftJoin(uvozSejaTable, eq(uvozSejaTable.id, prejemniceTable.uvozSejaId))
    .where(and(eq(prejemniceTable.id, receiptId), eq(enoteTable.companyId, companyId)))
    .limit(1);

  if (!header) return null;

  const rows = await db.select({
    name: prejemnicePostavkeTable.izvNaziv,
    quantity: prejemnicePostavkeTable.kolicina,
    unitCode: prejemnicePostavkeTable.enotaMere,
    netUnitPrice: prejemnicePostavkeTable.netoCena,
    netAmount: prejemnicePostavkeTable.netoZnesek,
    vatCategory: prejemnicePostavkeTable.ddvKategorija,
    vatRate: prejemnicePostavkeTable.ddvStopnja,
    vatBase: prejemnicePostavkeTable.ddvOsnova,
    vatAmount: prejemnicePostavkeTable.ddvZnesek,
  }).from(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, receiptId));

  const lines: ReceivedInvoiceLine[] = rows.map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitCode: line.unitCode,
    netUnitPrice: line.netUnitPrice,
    netAmount: line.netAmount,
    vatCategory: line.vatCategory,
    vatRate: line.vatRate,
    vatBase: line.vatBase,
    vatAmount: line.vatAmount,
  }));

  return {
    data: {
      header: {
        documentType: header.documentType,
        documentNumber: header.documentNumber,
        documentDate: asReceiptDate(header.documentDate),
        dueDate: asReceiptDate(header.dueDate),
        deliveryDate: asReceiptDate(header.deliveryDate),
        currency: header.currency,
        netTotal: header.netTotal,
        vatTotal: header.vatTotal,
        grossTotal: header.grossTotal,
        paymentMethod: header.paymentMethod,
        paymentReference: header.paymentReference,
        supplier: {
          name: header.supplierName, taxId: header.supplierTaxId, vatId: header.supplierVatId,
          registrationNumber: header.supplierRegistrationNumber, street: header.supplierStreet,
          postCode: header.supplierPostCode, city: header.supplierCity, country: header.supplierCountry,
          iban: header.supplierIban, bic: header.supplierBic,
        },
        customer: {
          name: header.customerName, taxId: header.customerTaxId, vatId: header.customerVatId,
          address: header.customerAddress, country: header.customerCountry,
        },
      },
      lines,
    },
    source: header.original
      ? { content: Buffer.from(header.original), filename: header.originalFilename ?? "izvirnik" }
      : undefined,
  };
}
