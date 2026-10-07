import { describe, expect, it } from "vitest";
import { slovenskiDatumZaSporocilo } from "./slovenian-date-message";

describe("slovenskiDatumZaSporocilo", () => {
  it("pretvori dan in mesec", () => {
    expect(slovenskiDatumZaSporocilo("2026-10-07")).toBe("07.10.2026");
    expect(slovenskiDatumZaSporocilo("2026-08")).toBe("08.2026");
  });
  it("ostalo pusti nespremenjeno", () => {
    expect(slovenskiDatumZaSporocilo("neznan datum")).toBe("neznan datum");
  });
});
