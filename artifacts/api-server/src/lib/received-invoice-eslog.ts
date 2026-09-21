import Decimal from "decimal.js";
import { create } from "xmlbuilder2";

export type ReceivedInvoiceDocumentType = "RACUN" | "DOBAVNICA" | "DOBROPIS" | "BREMEPIS" | null;

export type ReceivedInvoiceHeader = {
  documentType: ReceivedInvoiceDocumentType;
  documentNumber: string | null;
  documentDate: string | null;
  dueDate: string | null;
  deliveryDate: string | null;
  currency: string | null;
  netTotal: string | null;
  vatTotal: string | null;
  grossTotal: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  supplier: {
    name: string | null; taxId: string | null; vatId: string | null; registrationNumber: string | null;
    street: string | null; postCode: string | null; city: string | null; country: string | null;
    iban: string | null; bic: string | null;
  };
  customer: { name: string | null; taxId: string | null; vatId: string | null; address: string | null; country: string | null; };
};

export type ReceivedInvoiceLine = {
  name: string | null;
  quantity: string | null;
  unitCode: string | null;
  netUnitPrice: string | null;
  netAmount: string | null;
  vatCategory: string | null;
  vatRate: string | null;
  vatBase: string | null;
  vatAmount: string | null;
};

export type ReceivedInvoiceData = { header: ReceivedInvoiceHeader; lines: ReceivedInvoiceLine[] };

const unitMap: Record<string, string> = {
  KOS: "H87", KOM: "H87", PCE: "H87", EA: "H87", H87: "H87",
  KG: "KGM", KGM: "KGM", G: "GRM", GRM: "GRM", L: "LTR", LTR: "LTR",
  ML: "MLT", MLT: "MLT", M: "MTR", MTR: "MTR", M2: "MTK", MTK: "MTK",
  M3: "MTQ", MTQ: "MTQ", KAR: "CT", CT: "CT", SKA: "BX", BX: "BX",
};
const validUnitCodes = new Set(Object.values(unitMap));
const validVatCategories = new Set(["S", "Z", "E", "AE", "K", "G", "O"]);

export function toUneceUnitCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return unitMap[value.trim().toUpperCase()] ?? null;
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
function decimal(value: string | null | undefined): Decimal | null {
  if (!present(value)) return null;
  try {
    const parsed = new Decimal(value!);
    return parsed.isFinite() ? parsed : null;
  } catch { return null; }
}

export function validateReceivedInvoiceForEslog(data: ReceivedInvoiceData): { valid: boolean; errors: string[]; warnings: string[] } {
  const { header, lines } = data;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (header.documentType !== "RACUN") {
    errors.push("Dokument ni vrste RACUN; dobavnica, dobropis ali bremepis se ne izvozi kot e-SLOG Invoice.");
    return { valid: false, errors, warnings };
  }
  if (!present(header.documentNumber)) errors.push("Manjka dobaviteljeva številka računa.");
  if (!present(header.documentDate)) errors.push("Manjka datum dobaviteljevega računa.");
  if (!present(header.supplier.name)) errors.push("Manjka nespremenljiv naziv dobavitelja.");
  if (!present(header.supplier.taxId) && !present(header.supplier.vatId)) errors.push("Manjka davčna številka ali ID za DDV dobavitelja.");
  if (!present(header.customer.name) || (!present(header.customer.taxId) && !present(header.customer.vatId))) {
    errors.push("Manjka nespremenljiv podatek o prejemniku računa.");
  }
  if (!present(header.netTotal) || !present(header.vatTotal) || !present(header.grossTotal)) {
    errors.push("Manjkajo avtoritativni zneski osnove, DDV ali bruto skupaj.");
  }
  const netTotal = decimal(header.netTotal);
  const vatTotal = decimal(header.vatTotal);
  const grossTotal = decimal(header.grossTotal);
  if (!netTotal || !vatTotal || !grossTotal) errors.push("Zneski računa niso veljavna decimalna števila.");
  if (!lines.length) errors.push("Račun nima postavk.");
  let linesNet = new Decimal(0);
  let linesVat = new Decimal(0);
  lines.forEach((line, index) => {
    const label = `Postavka ${index + 1}`;
    if (!present(line.name) || !present(line.quantity) || !present(line.unitCode) || !present(line.netUnitPrice) || !present(line.netAmount)) {
      errors.push(`${label} nima popolnih kanoničnih podatkov (naziv, količina, enota, neto cena, neto znesek).`);
    }
    if (!present(line.vatRate) || !present(line.vatBase) || !present(line.vatAmount)) {
      errors.push(`${label} nima popolnih DDV podatkov.`);
    }
    const quantity = decimal(line.quantity);
    const unitPrice = decimal(line.netUnitPrice);
    const netAmount = decimal(line.netAmount);
    const vatRate = decimal(line.vatRate);
    const vatBase = decimal(line.vatBase);
    const vatAmount = decimal(line.vatAmount);
    if (!quantity || !unitPrice || !netAmount || !vatRate || !vatBase || !vatAmount) {
      errors.push(`${label} vsebuje neveljavno decimalno vrednost.`);
    } else {
      linesNet = linesNet.plus(netAmount);
      linesVat = linesVat.plus(vatAmount);
      if (quantity.lte(0)) errors.push(`${label} mora imeti količino večjo od nič.`);
      if (vatRate.lt(0)) errors.push(`${label} nima veljavne DDV stopnje.`);
      if (quantity.mul(unitPrice).minus(netAmount).abs().gt("0.01")) {
        errors.push(`${label}: količina × neto cena se ne ujema z neto zneskom vrstice.`);
      }
      if (vatBase.minus(netAmount).abs().gt("0.01")) {
        errors.push(`${label}: DDV osnova se ne ujema z neto zneskom vrstice.`);
      }
      const expectedVat = vatBase.mul(vatRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (expectedVat.minus(vatAmount).abs().gt("0.01")) {
        errors.push(`${label}: DDV znesek se ne ujema z osnovo in DDV stopnjo.`);
      }
    }
    if (line.unitCode && !validUnitCodes.has(line.unitCode)) errors.push(`${label} nima veljavne UN/ECE enote mere.`);
    if (!present(line.vatCategory)) {
      errors.push(`${label} nima DDV kategorije.`);
    } else if (!validVatCategories.has(line.vatCategory!)) {
      errors.push(`${label} nima veljavne DDV kategorije.`);
    } else if (vatRate) {
      if (line.vatCategory === "S" && vatRate.lte(0)) errors.push(`${label}: kategorija S zahteva DDV stopnjo nad 0 %.`);
      if (line.vatCategory !== "S" && !vatRate.eq(0)) errors.push(`${label}: DDV kategorija ${line.vatCategory} zahteva 0 % stopnjo.`);
    }
  });
  if (netTotal && vatTotal && grossTotal) {
    if (linesNet.minus(netTotal).abs().gt("0.01")) errors.push("Seštevek neto postavk se ne ujema z davčno osnovo računa.");
    if (linesVat.minus(vatTotal).abs().gt("0.01")) errors.push("Seštevek DDV postavk se ne ujema s skupnim DDV računa.");
    if (netTotal.plus(vatTotal).minus(grossTotal).abs().gt("0.01")) errors.push("Bruto skupaj ni enak osnovi plus DDV.");
  }
  if (present(header.deliveryDate) === false) warnings.push("Datum dobave/storitve ni naveden na računu.");
  if (!present(header.paymentReference)) warnings.push("Plačilni sklic ni naveden na računu.");
  return { valid: errors.length === 0, errors, warnings };
}

function d(value: string | null): Decimal { return new Decimal(value ?? "0"); }
function money(value: Decimal): string { return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2); }
function category(line: ReceivedInvoiceLine): string { return line.vatCategory || (d(line.vatRate).gt(0) ? "S" : "Z"); }

/** Ločen generator za prejeti račun. Generator izdanih POS računov ostane nedotaknjen. */
export function generirajPrejetiEracunXml(data: ReceivedInvoiceData): string {
  const validation = validateReceivedInvoiceForEslog(data);
  if (!validation.valid) throw new Error(`Prejeti e-SLOG ni popoln: ${validation.errors.join(" ")}`);
  const { header, lines } = data;
  const currency = header.currency || "EUR";
  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele("Invoice", {
      xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
      "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
      "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    });
  doc.ele("cbc:CustomizationID").txt("urn:cen.eu:en16931:2017#compliant#urn:fdc:si.efaktura.mg:2.0");
  doc.ele("cbc:ID").txt(header.documentNumber!);
  doc.ele("cbc:IssueDate").txt(header.documentDate!);
  if (header.dueDate) doc.ele("cbc:DueDate").txt(header.dueDate);
  doc.ele("cbc:InvoiceTypeCode").txt("380");
  doc.ele("cbc:DocumentCurrencyCode").txt(currency);

  const supplier = doc.ele("cac:AccountingSupplierParty").ele("cac:Party");
  if (header.supplier.vatId) supplier.ele("cbc:EndpointID", { schemeID: "SI:VAT" }).txt(header.supplier.vatId);
  supplier.ele("cac:PartyName").ele("cbc:Name").txt(header.supplier.name!);
  const supplierAddress = supplier.ele("cac:PostalAddress");
  if (header.supplier.street) supplierAddress.ele("cbc:StreetName").txt(header.supplier.street);
  if (header.supplier.postCode) supplierAddress.ele("cbc:PostalZone").txt(header.supplier.postCode);
  if (header.supplier.city) supplierAddress.ele("cbc:CityName").txt(header.supplier.city);
  supplierAddress.ele("cac:Country").ele("cbc:IdentificationCode").txt(header.supplier.country || "SI");
  if (header.supplier.vatId) {
    supplier.ele("cac:PartyTaxScheme").ele("cbc:CompanyID").txt(header.supplier.vatId).up()
      .ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
  }
  const supplierLegal = supplier.ele("cac:PartyLegalEntity");
  supplierLegal.ele("cbc:RegistrationName").txt(header.supplier.name!);
  if (header.supplier.registrationNumber || header.supplier.taxId) {
    supplierLegal.ele("cbc:CompanyID").txt(header.supplier.registrationNumber || header.supplier.taxId!);
  }

  const customer = doc.ele("cac:AccountingCustomerParty").ele("cac:Party");
  if (header.customer.vatId) customer.ele("cbc:EndpointID", { schemeID: "SI:VAT" }).txt(header.customer.vatId);
  customer.ele("cac:PartyName").ele("cbc:Name").txt(header.customer.name!);
  const customerAddress = customer.ele("cac:PostalAddress");
  if (header.customer.address) customerAddress.ele("cbc:StreetName").txt(header.customer.address);
  customerAddress.ele("cac:Country").ele("cbc:IdentificationCode").txt(header.customer.country || "SI");
  if (header.customer.vatId) {
    customer.ele("cac:PartyTaxScheme").ele("cbc:CompanyID").txt(header.customer.vatId).up()
      .ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
  }
  const customerLegal = customer.ele("cac:PartyLegalEntity");
  customerLegal.ele("cbc:RegistrationName").txt(header.customer.name!);
  if (header.customer.taxId) customerLegal.ele("cbc:CompanyID").txt(header.customer.taxId);

  const payment = doc.ele("cac:PaymentMeans");
  payment.ele("cbc:PaymentMeansCode").txt(header.paymentMethod || "30");
  if (header.dueDate) payment.ele("cbc:PaymentDueDate").txt(header.dueDate);
  if (header.paymentReference) payment.ele("cbc:InstructionID").txt(header.paymentReference);
  if (header.supplier.iban) {
    const account = payment.ele("cac:PayeeFinancialAccount");
    account.ele("cbc:ID").txt(header.supplier.iban);
    if (header.supplier.bic) account.ele("cac:FinancialInstitutionBranch").ele("cbc:ID").txt(header.supplier.bic);
  }

  const groups = new Map<string, { rate: Decimal; base: Decimal; vat: Decimal; category: string }>();
  for (const line of lines) {
    const rate = d(line.vatRate);
    const key = `${category(line)}:${rate.toString()}`;
    const current = groups.get(key) ?? { rate, base: new Decimal(0), vat: new Decimal(0), category: category(line) };
    current.base = current.base.plus(d(line.vatBase));
    current.vat = current.vat.plus(d(line.vatAmount));
    groups.set(key, current);
  }
  const taxTotal = doc.ele("cac:TaxTotal");
  taxTotal.ele("cbc:TaxAmount", { currencyID: currency }).txt(money(d(header.vatTotal)));
  for (const group of groups.values()) {
    const subtotal = taxTotal.ele("cac:TaxSubtotal");
    subtotal.ele("cbc:TaxableAmount", { currencyID: currency }).txt(money(group.base));
    subtotal.ele("cbc:TaxAmount", { currencyID: currency }).txt(money(group.vat));
    const tax = subtotal.ele("cac:TaxCategory");
    tax.ele("cbc:ID").txt(group.category);
    tax.ele("cbc:Percent").txt(group.rate.toFixed(2));
    tax.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
  }

  const totals = doc.ele("cac:LegalMonetaryTotal");
  totals.ele("cbc:LineExtensionAmount", { currencyID: currency }).txt(money(d(header.netTotal)));
  totals.ele("cbc:TaxExclusiveAmount", { currencyID: currency }).txt(money(d(header.netTotal)));
  totals.ele("cbc:TaxInclusiveAmount", { currencyID: currency }).txt(money(d(header.grossTotal)));
  totals.ele("cbc:PayableAmount", { currencyID: currency }).txt(money(d(header.grossTotal)));

  lines.forEach((line, index) => {
    const invoiceLine = doc.ele("cac:InvoiceLine");
    invoiceLine.ele("cbc:ID").txt(String(index + 1));
    invoiceLine.ele("cbc:InvoicedQuantity", { unitCode: line.unitCode! }).txt(d(line.quantity).toString());
    invoiceLine.ele("cbc:LineExtensionAmount", { currencyID: currency }).txt(money(d(line.netAmount)));
    const item = invoiceLine.ele("cac:Item");
    item.ele("cbc:Name").txt(line.name!);
    const tax = item.ele("cac:ClassifiedTaxCategory");
    tax.ele("cbc:ID").txt(category(line));
    tax.ele("cbc:Percent").txt(d(line.vatRate).toFixed(2));
    tax.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
    invoiceLine.ele("cac:Price").ele("cbc:PriceAmount", { currencyID: currency }).txt(d(line.netUnitPrice).toFixed(6));
  });
  return doc.end({ prettyPrint: true });
}