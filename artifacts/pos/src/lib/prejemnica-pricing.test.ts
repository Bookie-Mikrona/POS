import { describe, expect, it } from "vitest";
import {
  buildReceiptPricePayload,
  restoreImportedPrice,
  sourceDiscountFactor,
  type OriginalReceiptPriceSnapshot,
} from "./prejemnica-pricing";

describe("obnova cen uvožene prejete postavke", () => {
  it("ohrani neto izvornik, bruto način, vgrajen 10 % popust in shranjeni znesek na no-op", () => {
    const restored = restoreImportedPrice({
      sourcePrice: 5,
      sourcePriceBasis: "neto",
      receiptPriceBasis: "bruto",
      discountIncluded: true,
      discount1: 10,
      taxRate: 22,
    });
    expect(restored).toEqual({ price: "6.1", discount: "", editable: true });
    expect(sourceDiscountFactor(10, 0, true)).toBe(1);
    expect(sourceDiscountFactor(10, 0, false)).toBe(0.9);

    const originalPriceSnapshot: OriginalReceiptPriceSnapshot = {
      artikelId: 73,
      price: restored.price,
      discount: restored.discount,
      quantity: "10",
      packageCount: "",
      sourceQuantity: "10",
      taxRate: "22",
      receiptPriceBasis: "bruto",
      sourcePrice: 5,
      sourcePriceBasis: "neto",
      discountIncluded: true,
      discount1: 10,
      discount2: 0,
      netAmount: 50,
      vatAmount: 11,
      stockAmount: 50,
      stockQuantity: 10,
      stockUnitPrice: 5,
      sourceUnit: null,
      brutoTezaG: "",
      netoTezaG: "",
      netoDelezOdst: "",
    };

    const payload = buildReceiptPricePayload({
      artikelId: 73,
      cenaKos: restored.price,
      popust: restored.discount,
      kolicina: "10",
      enotVPaketu: "",
      izvKolicina: "10",
      ddvStopnja: "22",
      izvCena: 5,
      izvCenaVrsta: "neto",
      rabatVkljucenVCeni: true,
      originalPriceSnapshot,
      izvEnota: null,
      brutoTezaG: "",
      netoTezaG: "",
      netoDelezOdst: "",
    }, "bruto", {
      netAmount: 50,
      vatAmount: 11,
      stockQuantity: 10,
      stockUnitPrice: 5,
      sourcePrice: 6.1,
      discount1: 0,
      discount2: 0,
    });

    expect(payload).toMatchObject({
      unchanged: true,
      ddvOsnova: 50,
      ddvZnesek: 11,
      skupaj: 61,
      kolicina: 10,
      cenaKos: 5,
      izvCena: 5,
      izvCenaVrsta: "neto",
      rabatVkljucenVCeni: true,
      rabat1Odst: 10,
    });
  });

  it("uporabi preračunano bruto vrednost po spremembi cene in ne znova odbije vgrajenega popusta", () => {
    expect(sourceDiscountFactor(10, 0, true)).toBe(1);
    const snapshot: OriginalReceiptPriceSnapshot = {
      artikelId: 73,
      price: "6.1",
      discount: "",
      quantity: "10",
      packageCount: "",
      sourceQuantity: "10",
      taxRate: "22",
      receiptPriceBasis: "bruto",
      sourcePrice: 5,
      sourcePriceBasis: "neto",
      discountIncluded: true,
      discount1: 10,
      discount2: 0,
      netAmount: 50,
      vatAmount: 11,
      stockAmount: 50,
      stockQuantity: 10,
      stockUnitPrice: 5,
      sourceUnit: null,
      brutoTezaG: "",
      netoTezaG: "",
      netoDelezOdst: "",
    };
    const payload = buildReceiptPricePayload({
      artikelId: 73,
      cenaKos: "6.2",
      popust: "",
      kolicina: "10",
      enotVPaketu: "",
      izvKolicina: "10",
      ddvStopnja: "22",
      izvCena: 5,
      izvCenaVrsta: "neto",
      rabatVkljucenVCeni: true,
      originalPriceSnapshot: snapshot,
      izvEnota: null,
      brutoTezaG: "",
      netoTezaG: "",
      netoDelezOdst: "",
    }, "bruto", {
      netAmount: 50.82,
      vatAmount: 11.18,
      stockQuantity: 10,
      stockUnitPrice: 5.082,
      sourcePrice: 6.2,
      discount1: 0,
      discount2: 0,
    });

    expect(payload).toMatchObject({
      unchanged: false,
      ddvOsnova: 50.82,
      ddvZnesek: 11.18,
      skupaj: 62,
      kolicina: 10,
      cenaKos: 5.082,
      izvCena: 6.2,
      izvCenaVrsta: "bruto",
      rabatVkljucenVCeni: true,
      rabat1Odst: 10,
    });
  });
});