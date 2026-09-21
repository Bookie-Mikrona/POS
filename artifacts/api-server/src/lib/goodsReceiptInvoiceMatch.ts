import Decimal from "decimal.js";

export interface InvoiceAmountRow {
  quantity: string;
  unitPrice: string;
  vatRate: string;
  vatAmount: string | null;
}

export function calculateGoodsReceiptInvoiceMatch(rows: InvoiceAmountRow[]) {
  const net = rows.reduce(
    (sum, row) => sum.plus(new Decimal(row.quantity).mul(row.unitPrice)),
    new Decimal(0),
  ).toDecimalPlaces(2);
  const vat = rows.reduce(
    (sum, row) => {
      const calculated = new Decimal(row.quantity)
        .mul(row.unitPrice)
        .mul(row.vatRate)
        .div(100)
        .toDecimalPlaces(2);
      return sum.plus(row.vatAmount ?? calculated);
    },
    new Decimal(0),
  ).toDecimalPlaces(2);
  return {
    net,
    vat,
    gross: net.plus(vat).toDecimalPlaces(2),
  };
}

export function resolveGoodsReceiptInvoiceSource(
  goodsReceiptSourceId: string | null,
  invoiceSourceId: string | null,
): string | null {
  if (!goodsReceiptSourceId || !invoiceSourceId) {
    throw new Error("MATCH_SOURCE_IDENTITY_MISSING");
  }
  if (goodsReceiptSourceId !== invoiceSourceId) {
    throw new Error("MATCH_SOURCE_MISMATCH");
  }
  return goodsReceiptSourceId;
}