import { describe, expect, it } from "vitest";
import { soNormativiEnaki } from "./artikli";

describe("primerjava normativa pred shranjevanjem", () => {
  const existing = [
    { vhodniArtikelId: 10, kolicina: "0.1200", vrstniRed: 0 },
    { vhodniArtikelId: 20, kolicina: "1.0000", vrstniRed: 1 },
  ];

  it("prepozna nespremenjene sestavine in količine", () => {
    expect(soNormativiEnaki(existing, [
      { vhodniArtikelId: 10, kolicina: 0.12 },
      { vhodniArtikelId: 20, kolicina: 1 },
    ])).toBe(true);
  });

  it("prepozna spremembo količine, sestavine ali vrstnega reda", () => {
    expect(soNormativiEnaki(existing, [
      { vhodniArtikelId: 10, kolicina: 0.13 },
      { vhodniArtikelId: 20, kolicina: 1 },
    ])).toBe(false);
    expect(soNormativiEnaki(existing, [
      { vhodniArtikelId: 10, kolicina: 0.12 },
      { vhodniArtikelId: 30, kolicina: 1 },
    ])).toBe(false);
    expect(soNormativiEnaki(existing, [
      { vhodniArtikelId: 20, kolicina: 1 },
      { vhodniArtikelId: 10, kolicina: 0.12 },
    ])).toBe(false);
  });
});