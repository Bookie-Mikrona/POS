import { describe, expect, it } from "vitest";
import { casZaPosDatetimeLocal, formatPosCas, formatPosDatum, poslovniDatumZaCas, posDatetimeLocalToIso } from "./posCas";

describe("POS čas telefonskega naročila", () => {
  it("prikaže dejanski časovni žig v časovnem pasu Ljubljana", () => {
    expect(formatPosCas("2026-08-24T10:02:00.000Z")).toBe("12:02");
  });

  it("prikaže datum rezervacije v časovnem pasu Ljubljana", () => {
    expect(formatPosDatum("2026-08-24T22:02:00.000Z")).toBe("25. 8. 2026");
  });

  it("ročno vneseno lokalno uro pretvori v pravilen UTC časovni žig", () => {
    expect(casZaPosDatetimeLocal("2026-08-24T10:02:00.000Z")).toBe("2026-08-24T12:02");
    expect(posDatetimeLocalToIso("2026-08-24T12:02")).toBe("2026-08-24T10:02:00.000Z");
  });
});

describe("POS poslovni datum", () => {
  it("preklopi natanko ob 04:00 po času Europe/Ljubljana", () => {
    expect(poslovniDatumZaCas("2026-08-29T01:59:00.000Z")).toBe("2026-08-28");
    expect(poslovniDatumZaCas("2026-08-29T02:00:00.000Z")).toBe("2026-08-29");
    expect(poslovniDatumZaCas("2026-08-29T02:01:00.000Z")).toBe("2026-08-29");
  });

  it("upošteva konfiguriran začetek poslovnega dne", () => {
    expect(poslovniDatumZaCas("2026-08-29T03:29:00.000Z", "05:30")).toBe("2026-08-28");
    expect(poslovniDatumZaCas("2026-08-29T03:30:00.000Z", "05:30")).toBe("2026-08-29");
  });
});