import { describe, expect, it } from "vitest";
import { sestaviPogosto } from "./pogosti-artikli";

describe("sestaviPogosto", () => {
  it("brez ročnih popravkov vrne samodejni vrstni red (največ 24)", () => {
    const samodejno = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(sestaviPogosto(samodejno, [])).toEqual(samodejno.slice(0, 24));
  });

  it("pripeti artikli so na vrhu, skriti so izločeni, brez dvojnikov", () => {
    const rezultat = sestaviPogosto([1, 2, 3, 4], [
      { artikelId: 99, akcija: "pripni" },
      { artikelId: 2, akcija: "skrij" },
      { artikelId: 3, akcija: "pripni" },
    ]);
    expect(rezultat).toEqual([99, 3, 1, 4]);
  });

  it("omeji skupno število", () => {
    expect(sestaviPogosto([1, 2, 3], [{ artikelId: 9, akcija: "pripni" }], 2)).toEqual([9, 1]);
  });
});
