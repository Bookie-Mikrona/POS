import { describe, expect, it } from "vitest";
import {
  INVENTORY_OCR_MAX_UPLOAD_BYTES,
  inventoryEditLineSchema,
  inventoryPriceSchema,
  inventoryOcrSchema,
  inventoryUploadRequestSchema,
  matchInventoryOcr,
  resolveInventoryUnitPrice,
  type InventoryArticle,
} from "./inventure-ocr";

const articles: InventoryArticle[] = [
  { id: 11, ime: "Moka", imeZaNabavo: "Kava moka", enotaMere: "kg", drobniInventar: false },
  { id: 12, ime: "Moka", imeZaNabavo: null, enotaMere: "kg", drobniInventar: false },
  { id: 13, ime: "Krožnik", imeZaNabavo: null, enotaMere: "kos", drobniInventar: true },
];

describe("inventory OCR matching", () => {
  it("validates the unit-bound upload URL metadata contract", () => {
    expect(inventoryUploadRequestSchema.safeParse({
      name: "inventory.pdf",
      size: INVENTORY_OCR_MAX_UPLOAD_BYTES,
      contentType: "application/pdf",
    }).success).toBe(true);
    expect(inventoryUploadRequestSchema.safeParse({
      name: "inventory.pdf",
      size: INVENTORY_OCR_MAX_UPLOAD_BYTES + 1,
      contentType: "application/pdf",
    }).success).toBe(false);
    expect(inventoryUploadRequestSchema.safeParse({
      name: "inventory.webp",
      size: 100,
      contentType: "image/webp",
    }).success).toBe(false);
  });

  it("matches only exact unique labels/printed IDs in the requested scope and unit", () => {
    const extracted = inventoryOcrSchema.parse({
      datum: "2025-02-03",
      rows: [
        { naziv: "Kava moka", idNatisnjen: null, enota: "kg", steviloNajdeno: 2, cenaKos: 4.5 },
        { naziv: "Moka", idNatisnjen: null, enota: "kg", steviloNajdeno: 1, cenaKos: 5 },
        { naziv: "Krožnik", idNatisnjen: null, enota: "kos", steviloNajdeno: 5, cenaKos: 2 },
      ],
    });
    expect(matchInventoryOcr(extracted, articles, "material")).toEqual({
      rows: [{ artikelId: 11, steviloNajdeno: 2, cenaKos: 4.5 }],
      unmatched: ["Moka", "Krožnik"],
      datum: "2025-02-03",
    });
  });

  it("rejects malformed or unsafe numerical OCR values", () => {
    expect(inventoryOcrSchema.safeParse({
      datum: null,
      rows: [{ naziv: "Moka", idNatisnjen: 11, enota: "kg", steviloNajdeno: -1, cenaKos: 0 }],
    }).success).toBe(false);
  });

  it("marks repeated OCR matches for the same article as unmatched", () => {
    const extracted = inventoryOcrSchema.parse({
      datum: null,
      rows: [
        { naziv: "Moka", idNatisnjen: 11, enota: "kg", steviloNajdeno: 2, cenaKos: 4 },
        { naziv: "Moka", idNatisnjen: 11, enota: "kg", steviloNajdeno: 3, cenaKos: 4 },
      ],
    });
    expect(matchInventoryOcr(extracted, articles, "material")).toEqual({
      rows: [],
      unmatched: ["Moka", "Moka"],
      datum: null,
    });
  });

  it("validates explicit prices and preserves previous price until explicitly changed", () => {
    expect(inventoryEditLineSchema.safeParse({
      artikelId: 11,
      steviloNajdeno: 3,
      cenaKos: 2.5,
    }).success).toBe(true);
    expect(inventoryEditLineSchema.safeParse({
      artikelId: 11,
      steviloNajdeno: 3,
      cenaKos: 0,
    }).success).toBe(false);
    expect(inventoryPriceSchema.safeParse(0).success).toBe(false);
    expect(inventoryPriceSchema.safeParse(2.12345).success).toBe(false);
    expect(inventoryPriceSchema.safeParse(2.1234).success).toBe(true);
    expect(resolveInventoryUnitPrice({
      drobniInventar: false,
      previousPrice: 4,
      inventoryPrice: 8,
      lastPurchasePrice: 9,
    })).toBe(4);
    expect(resolveInventoryUnitPrice({
      drobniInventar: false,
      explicitPrice: 6,
      previousPrice: 4,
      inventoryPrice: 8,
    })).toBe(6);
    expect(resolveInventoryUnitPrice({
      drobniInventar: true,
      explicitPrice: 6,
      previousPrice: 4,
    })).toBe(0);
  });

  it("requires exact unit match and never imports price for small inventory", () => {
    const extracted = inventoryOcrSchema.parse({
      datum: null,
      rows: [
        { naziv: "Krožnik", idNatisnjen: null, enota: "kg", steviloNajdeno: 5, cenaKos: 2 },
        { naziv: "Whatever", idNatisnjen: 13, enota: "kos", steviloNajdeno: 5, cenaKos: 2 },
      ],
    });
    expect(matchInventoryOcr(extracted, articles, "drobni")).toEqual({
      rows: [{ artikelId: 13, steviloNajdeno: 5, cenaKos: null }],
      unmatched: ["Krožnik"],
      datum: null,
    });
  });
});