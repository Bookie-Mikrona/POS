import { describe, expect, it } from "vitest";
import { resolvePartialPostavkaNumbers } from "./narocila";

describe("partial PATCH postavke", () => {
  it.each([
    [{ opomba: "brez sladkorja" }, { kolicina: 2, cenaKos: 3.5, skupaj: 7 }],
    [{ gostStevilka: 2 }, { kolicina: 2, cenaKos: 3.5, skupaj: 7 }],
    [{ courseSequence: 2 }, { kolicina: 2, cenaKos: 3.5, skupaj: 7 }],
  ])("metadata-only PATCH preserves locked quantity and total", (body, expected) => {
    expect(resolvePartialPostavkaNumbers(body, 2, 3.5)).toEqual(expected);
  });

  it("rejects invalid supplied quantities rather than calculating NaN", () => {
    expect(resolvePartialPostavkaNumbers({ kolicina: undefined }, 2, 3.5)).toEqual({ kolicina: 2, cenaKos: 3.5, skupaj: 7 });
    expect(resolvePartialPostavkaNumbers({ kolicina: 0 }, 2, 3.5)).toBeNull();
    expect(resolvePartialPostavkaNumbers({ kolicina: Number.NaN }, 2, 3.5)).toBeNull();
  });
});