import { describe, expect, it } from "vitest";
import { calculateBatchNormative } from "./batch-normative";

describe("recept za pekač", () => {
  it("pretvori pekač osmih kosov v per-portion normativ in ohrani ID", () => {
    const input = [
      { vhodniArtikelId: 1, ime: "Jabolka", kolicina: "0,96", yieldPercent: "80" },
      { vhodniArtikelId: 2, ime: "Moka", kolicina: "0.24", yieldPercent: "100" },
      { vhodniArtikelId: 3, ime: "Maslo", kolicina: "0,08", yieldPercent: "100" },
    ];
    expect(calculateBatchNormative(input, "8")).toEqual([
      { vhodniArtikelId: 1, ime: "Jabolka", kolicina: "0.15" },
      { vhodniArtikelId: 2, ime: "Moka", kolicina: "0.03" },
      { vhodniArtikelId: 3, ime: "Maslo", kolicina: "0.01" },
    ]);
    expect(input[0].kolicina).toBe("0,96");
  });
  it("ne poveča bruto količine pri 100 % izkoristku", () => {
    expect(calculateBatchNormative([{ vhodniArtikelId: 1, kolicina: "1.2", yieldPercent: "100" }], "8")[0].kolicina).toBe("0.15");
  });
  it.each(["", "0", "-1", "8.5", "abc", "10001", "Infinity"])("zavrne neveljavno število kosov %s", value => {
    expect(() => calculateBatchNormative([{ vhodniArtikelId: 1, kolicina: "1", yieldPercent: "100" }], value)).toThrow();
  });
  it.each(["0", "-1", "", "101", "Infinity"])("zavrne izkoristek %s", value => {
    expect(() => calculateBatchNormative([{ vhodniArtikelId: 1, kolicina: "1", yieldPercent: value }], "8")).toThrow();
  });
  it("zavrne prazne, neizbrane in premajhne količine brez tihega izpusta", () => {
    expect(() => calculateBatchNormative([], "8")).toThrow();
    expect(() => calculateBatchNormative([{ vhodniArtikelId: -1, kolicina: "1", yieldPercent: "100" }], "8")).toThrow();
    expect(() => calculateBatchNormative([{ vhodniArtikelId: 1, kolicina: "0.00001", yieldPercent: "100" }], "8")).toThrow();
  });
});