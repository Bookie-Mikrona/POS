import { describe, expect, it } from "vitest";
import { assertPackagingVatMatchesParent, projectPackagingDisplayPrices, type PrintPostavka } from "../pos-escpos";
import { generirajEracunXml } from "../eracun/generator";

const line = (overrides: Partial<PrintPostavka> = {}): PrintPostavka => ({
  ime: "Postavka",
  kolicina: 1,
  cenaKos: 0,
  skupaj: 0,
  davek: 22,
  ...overrides,
});

describe("projectPackagingDisplayPrices", () => {
  it("generates a balanced e-SLOG with the box on its pizza and another paid child intact", () => {
    const projected = projectPackagingDisplayPrices([
      line({ postavkaId: 1, ime: "Bolonjska", cenaKos: 13.5, skupaj: 13.5, davek: 9.5 }),
      line({ postavkaId: 2, parentPostavkaId: 1, ime: "Škatla za pico", cenaKos: 0.7, skupaj: 0.7, davek: 9.5, jeEmbalaza: true }),
      line({ postavkaId: 3, parentPostavkaId: 1, ime: "Plačljiv dodatek", cenaKos: 1.2, skupaj: 1.2, davek: 9.5 }),
    ]);
    const xml = generirajEracunXml({
      stevilkaRacuna: "TEST-1",
      datumCas: new Date("2026-09-28T12:00:00.000Z"),
      skupaj: 15.4,
      osnova: 14.07,
      ddv: 1.33,
      postavke: projected.map(p => ({
        ime: p.ime, kolicina: p.kolicina, cenaBrutoKos: p.cenaKos, davek: p.davek,
      })),
      izdajatelj: { naziv: "Test izdajatelj", podjetjeDavcna: "12345678" },
      prejemnik: { naziv: "Test kupec" },
    });
    expect(projected.map(p => p.cenaKos)).toEqual([14.2, 0, 1.2]);
    expect(xml).toContain("<cbc:PayableAmount currencyID=\"EUR\">15.40</cbc:PayableAmount>");
    expect(xml).toContain("<cbc:Name>Škatla za pico</cbc:Name>");
    expect(xml).toContain("<cbc:Name>Plačljiv dodatek</cbc:Name>");
  });

  it("folds direct packaging into its parent, leaves modifiers priced, and zeros packaging", () => {
    const input = [
      line({ ime: "Jed", postavkaId: 10, kolicina: 3, cenaKos: 3.34, skupaj: 10.01 }),
      line({ ime: "Embalaža", postavkaId: 11, parentPostavkaId: 10, kolicina: 3, cenaKos: 0.33, skupaj: 0.99, jeEmbalaza: true }),
      line({ ime: "Plačljiv dodatek", postavkaId: 12, parentPostavkaId: 10, kolicina: 1, cenaKos: 2.5, skupaj: 2.5 }),
    ];

    const projected = projectPackagingDisplayPrices(input);

    expect(projected[0]).toMatchObject({ skupaj: 11, cenaKos: 3.67 });
    expect(projected[1]).toMatchObject({ ime: "Embalaža", skupaj: 0, cenaKos: 0 });
    expect(projected[2]).toMatchObject({ ime: "Plačljiv dodatek", skupaj: 2.5, cenaKos: 2.5 });
    expect(projected.reduce((sum, item) => sum + item.skupaj, 0)).toBe(13.5);
    expect(input[0].skupaj).toBe(10.01);
    expect(input[1].skupaj).toBe(0.99);
  });

  it("handles a zero-quantity parent without dividing by zero", () => {
    const projected = projectPackagingDisplayPrices([
      line({ postavkaId: 20, kolicina: 0, cenaKos: 4, skupaj: 0 }),
      line({ parentPostavkaId: 20, kolicina: 1, cenaKos: 1, skupaj: 1, jeEmbalaza: true }),
    ]);

    expect(projected[0]).toMatchObject({ cenaKos: 4, skupaj: 1 });
    expect(projected[1]).toMatchObject({ cenaKos: 0, skupaj: 0 });
  });

  it("retains an ordinary discount after adding the packaging unit allocation", () => {
    const projected = projectPackagingDisplayPrices([
      line({ postavkaId: 30, kolicina: 2, cenaKos: 8, cenaKosOriginalna: 10, skupaj: 16 }),
      line({ parentPostavkaId: 30, kolicina: 2, cenaKos: 1, skupaj: 2, jeEmbalaza: true }),
    ]);

    expect(projected[0]).toMatchObject({ cenaKos: 9, cenaKosOriginalna: 11, skupaj: 18 });
    expect(projected[0].cenaKosOriginalna! - projected[0].cenaKos).toBe(2);
  });

  it("does not turn a fully bon-covered parent into an apparent discount", () => {
    const projected = projectPackagingDisplayPrices([
      line({ postavkaId: 40, kolicina: 2, cenaKos: 0, cenaKosOriginalna: 10, skupaj: 0 }),
      line({ parentPostavkaId: 40, kolicina: 2, cenaKos: 1, skupaj: 2, jeEmbalaza: true }),
    ]);

    expect(projected[0]).toMatchObject({ cenaKos: 1, cenaKosOriginalna: null, skupaj: 2 });
  });

  it("rejects legacy packaging with a different VAT rate from its parent", () => {
    expect(() => assertPackagingVatMatchesParent([
      line({ postavkaId: 50, davek: 9.5 }),
      line({ parentPostavkaId: 50, jeEmbalaza: true, davek: 22 }),
    ])).toThrow(/different|but parent|22%/i);
  });

  it("keeps orphan packaging monetary and visible rather than suppressing it", () => {
    const input = [
      line({ ime: "Embalaža brez starša", postavkaId: 60, parentPostavkaId: 999, jeEmbalaza: true, kolicina: 2, cenaKos: 0.5, skupaj: 1 }),
    ];

    const [projected] = projectPackagingDisplayPrices(input);

    expect(projected).toMatchObject({ jeEmbalaza: false, cenaKos: 0.5, skupaj: 1 });
    expect(projected.skupaj).toBe(input[0].skupaj);
  });

  it("keeps differently taxed packaging monetary and conserves displayed totals", () => {
    const input = [
      line({ postavkaId: 70, cenaKos: 10, skupaj: 10, davek: 9.5 }),
      line({ postavkaId: 71, parentPostavkaId: 70, jeEmbalaza: true, cenaKos: 2, skupaj: 2, davek: 22 }),
    ];

    const projected = projectPackagingDisplayPrices(input);

    expect(projected[0]).toMatchObject({ cenaKos: 10, skupaj: 10 });
    expect(projected[1]).toMatchObject({ jeEmbalaza: false, cenaKos: 2, skupaj: 2 });
    expect(projected.reduce((sum, item) => sum + item.skupaj, 0)).toBe(12);
    expect(() => assertPackagingVatMatchesParent(input)).toThrow(/VAT 22%/);
  });
});