import { describe, expect, it } from "vitest";
import { izberiNatancenInetisZadetek } from "./inetis";

describe("izberiNatancenInetisZadetek", () => {
  const zadetki = [
    {
      Naziv: "Tobačna Grosist",
      DavcnaStevilka: "SI31627528",
      DavcnaStevilkaKratka: "31627528",
      MaticnaStevilka: "5462959000",
    },
  ];

  it("sprejme samo zadetek z natančno isto davčno", () => {
    expect(izberiNatancenInetisZadetek(zadetki, "31627528")?.Naziv)
      .toBe("Tobačna Grosist");
  });

  it("ne zamenja skrajšane matične za davčno", () => {
    expect(izberiNatancenInetisZadetek(zadetki, "54629590")).toBeNull();
  });
});