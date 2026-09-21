import { describe, expect, it } from "vitest";
import { odvisniStroskiVnos, valutaAliEur } from "./prejemnice";

describe("prejemnica manual input normalization", () => {
  it("privzeto nastavi EUR in zavrne neveljavno oznako valute", () => {
    expect(valutaAliEur(undefined)).toBe("EUR");
    expect(valutaAliEur("usd")).toBe("USD");
    expect(valutaAliEur("EU")).toBe("EUR");
  });

  it("shrani samo veljavne odvisne stroške z varno privzeto obravnavo", () => {
    expect(odvisniStroskiVnos([
      { naziv: " Prevoz ", znesek: "12.50", ddvStopnja: "22", obravnava: "zaloga" },
      { naziv: " Zavarovanje ", znesek: 3, obravnava: "strosek" },
      { naziv: "", znesek: 5 },
      { naziv: "Brez zneska" },
    ])).toEqual([
      { naziv: "Prevoz", znesek: "12.5", ddvStopnja: "22", obravnava: "zaloga" },
      { naziv: "Zavarovanje", znesek: "3", ddvStopnja: null, obravnava: "strosek" },
    ]);
  });
});