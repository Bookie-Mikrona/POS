import { describe, expect, it } from "vitest";
import { validateGroupSourceLine } from "./skupinski-nabavni-artikel";

describe("validacija dobaviteljeve postavke za skupinski nabavni artikel", () => {
  it("zahteva naziv in izvorno e-SLOG enoto", () => {
    expect(validateGroupSourceLine(true, "KGM", "", "KG"))
      .toBe("Vnesite dobaviteljev naziv postavke.");
    expect(validateGroupSourceLine(true, "KGM", "Moka", ""))
      .toBe("Vnesite e-SLOG enoto dobaviteljeve postavke.");
  });

  it("sprejme enake kanonične enote in njihove znane zapise", () => {
    expect(validateGroupSourceLine(true, "KGM", "Moka", "KG")).toBeNull();
    expect(validateGroupSourceLine(true, "H87", "Jabolko", "KOM")).toBeNull();
  });

  it("jasno zavrne nepodprto ali neujemajočo se enoto", () => {
    expect(validateGroupSourceLine(true, "KGM", "Moka", "pak"))
      .toBe("Enota dobavitelja »pak« ni podprta e-SLOG enota.");
    expect(validateGroupSourceLine(true, "LTR", "Moka", "KGM"))
      .toBe("Enota dobavitelja (KGM) ne ustreza enoti skupinskega artikla (LTR).");
  });

  it("ne zahteva izvorne identitete za običajen artikel", () => {
    expect(validateGroupSourceLine(false, "KGM", "", "")).toBeNull();
  });
});