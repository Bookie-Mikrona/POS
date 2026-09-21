import { describe, expect, it } from "vitest";
import { resolveCompositeEtas } from "./composite-eta";

describe("composite ETA", () => {
  it("uses max component ETA and stops cycles", () => {
    const etas = resolveCompositeEtas(
      [{ id: 1, mealType: "composite", casPripraveMin: 99 }, { id: 2, mealType: "prepared", casPripraveMin: 4 }, { id: 3, mealType: "ala_carte", casPripraveMin: 9 }, { id: 4, mealType: "composite", casPripraveMin: 0 }],
      [{ artikelId: 1, vhodniArtikelId: 2 }, { artikelId: 1, vhodniArtikelId: 4 }, { artikelId: 4, vhodniArtikelId: 3 }, { artikelId: 4, vhodniArtikelId: 1 }],
    );
    expect(etas.get(1)).toBe(9);
    expect(etas.get(2)).toBe(4);
  });
});