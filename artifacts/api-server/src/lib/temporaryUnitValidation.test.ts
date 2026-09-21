import { describe, expect, it } from "vitest";
import { parseStrictDateTime, validateTemporaryPeriod } from "./temporaryUnitValidation";

describe("stroga validacija obdobja začasne enote", () => {
  it("zavrne koledarsko neobstoječ datum", () => {
    expect(parseStrictDateTime("2026-02-30T10:00:00Z")).toBeNull();
  });

  it("zahteva oba konca obdobja in strogo poznejši konec", () => {
    expect(validateTemporaryPeriod("2026-06-01T10:00:00Z", null, true).error)
      .toBe("Začetek in konec obdobja sta obvezna.");
    expect(validateTemporaryPeriod("2026-06-01T10:00:00Z", "2026-06-01T10:00:00Z", true).error)
      .toBe("Konec obdobja mora biti po začetku.");
  });
});