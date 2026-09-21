import { describe, expect, it } from "vitest";
import {
  calculateGoodsReceiptInvoiceMatch,
  resolveGoodsReceiptInvoiceSource,
} from "./goodsReceiptInvoiceMatch";

describe("calculateGoodsReceiptInvoiceMatch", () => {
  it("izračuna vhodni DDV tudi ko ročni račun nima shranjenega vatAmount", () => {
    const result = calculateGoodsReceiptInvoiceMatch([
      { quantity: "2.000", unitPrice: "50.0000", vatRate: "22.00", vatAmount: null },
      { quantity: "1.000", unitPrice: "20.0000", vatRate: "9.50", vatAmount: null },
    ]);
    expect(result.net.toFixed(2)).toBe("120.00");
    expect(result.vat.toFixed(2)).toBe("23.90");
    expect(result.gross.toFixed(2)).toBe("143.90");
  });

  it("uporabi kanonični shranjeni DDV, kadar obstaja", () => {
    const result = calculateGoodsReceiptInvoiceMatch([
      { quantity: "3.000", unitPrice: "0.3333", vatRate: "22.00", vatAmount: "0.21" },
    ]);
    expect(result.vat.toFixed(2)).toBe("0.21");
  });

  it("dovoli le enak identificiran vir", () => {
    expect(resolveGoodsReceiptInvoiceSource("source-1", "source-1")).toBe("source-1");
    expect(() => resolveGoodsReceiptInvoiceSource(null, null))
      .toThrow("MATCH_SOURCE_IDENTITY_MISSING");
    expect(() => resolveGoodsReceiptInvoiceSource("source-1", "source-2"))
      .toThrow("MATCH_SOURCE_MISMATCH");
    expect(() => resolveGoodsReceiptInvoiceSource("source-1", null))
      .toThrow("MATCH_SOURCE_IDENTITY_MISSING");
  });
});