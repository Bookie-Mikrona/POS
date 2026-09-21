import { describe, expect, it } from "vitest";
import { efektivnaDdvStopnja, konvertirajCeno } from "./Zaloge";

describe("ročne finančne postavke prejemnice", () => {
  it("pri nezavezancu iz vnesene 9,5 % stopnje izračuna neto DDV osnovo", () => {
    const rate = efektivnaDdvStopnja("9.5", 22);
    const storedGross = konvertirajCeno(100, rate, "neto", false);
    const netBase = storedGross / (1 + rate / 100);

    expect(rate).toBe(9.5);
    expect(storedGross).toBe(109.5);
    expect(netBase).toBeCloseTo(100, 8);
  });

  it("ne prepiše računovodjeve stopnje s privzeto stopnjo artikla", () => {
    expect(efektivnaDdvStopnja("5", 22)).toBe(5);
    expect(konvertirajCeno(105, 5, "bruto", true)).toBe(100);
  });
});