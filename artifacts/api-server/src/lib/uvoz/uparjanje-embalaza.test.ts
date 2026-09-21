import { describe, expect, it } from "vitest";
import { opozorilaVsebujejoKodo } from "./uparjanje";

describe("prepoznavanje vrste OCR vrstice pri uparjanju", () => {
  it("prepozna EMB001 v JSON nizu, kot ga vrne db.execute", () => {
    expect(opozorilaVsebujejoKodo(
      '[{"koda":"EMB001","resnost":"I","sporocilo":"OCR vrstica povratne embalaže."}]',
      "EMB001",
    )).toBe(true);
  });

  it("prepozna EMB001 tudi v že razčlenjenem polju", () => {
    expect(opozorilaVsebujejoKodo([{ koda: "EMB001" }], "EMB001")).toBe(true);
  });

  it("ne označi poškodovanega ali običajnega opozorila kot embalažo", () => {
    expect(opozorilaVsebujejoKodo("ni-json", "EMB001")).toBe(false);
    expect(opozorilaVsebujejoKodo([{ koda: "DDV021" }], "EMB001")).toBe(false);
  });
});