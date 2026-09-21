import { describe, expect, it } from "vitest";
import { artikelJeKandidatZaOcrVrstico } from "./ocrKandidati";

const embalazaOpozorilo = [{ koda: "EMB001" }];

describe("OCR kandidati za uparjanje", () => {
  it("za embalažno vrstico predlaga samo povratno embalažo", () => {
    expect(artikelJeKandidatZaOcrVrstico(
      { ime: "Steklenica Union 0,5 l", povratnaEmbalaza: true },
      embalazaOpozorilo,
      "union",
    )).toBe(true);
    expect(artikelJeKandidatZaOcrVrstico(
      { ime: "Union pivo 0,5 l", povratnaEmbalaza: false },
      embalazaOpozorilo,
      "union",
    )).toBe(false);
  });

  it("za običajno vrstico ne predlaga povratne embalaže", () => {
    expect(artikelJeKandidatZaOcrVrstico(
      { ime: "Steklenica Union 0,5 l", povratnaEmbalaza: true },
      [],
      "union",
    )).toBe(false);
    expect(artikelJeKandidatZaOcrVrstico(
      { ime: "Union pivo 0,5 l", povratnaEmbalaza: false },
      [],
      "union",
    )).toBe(true);
  });
});