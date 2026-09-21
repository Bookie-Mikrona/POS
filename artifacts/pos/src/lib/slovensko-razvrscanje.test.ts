import { describe, expect, it } from "vitest";
import { primerjajSlovensko } from "./slovensko-razvrscanje";

describe("slovensko razvrščanje", () => {
  it("upošteva slovenske črke v abecednem vrstnem redu", () => {
    const nazivi = ["Žito", "Sok", "Čaj", "Cedevita", "Šunka", "Domače", "Zelje"];

    expect(nazivi.sort(primerjajSlovensko)).toEqual([
      "Cedevita",
      "Čaj",
      "Domače",
      "Sok",
      "Šunka",
      "Zelje",
      "Žito",
    ]);
  });

  it("razvršča številčne dele nazivov naravno", () => {
    expect(["Pivo 10", "Pivo 2", "Pivo 1"].sort(primerjajSlovensko)).toEqual([
      "Pivo 1",
      "Pivo 2",
      "Pivo 10",
    ]);
  });
});