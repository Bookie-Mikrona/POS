import { describe, expect, it } from "vitest";
import { cenaToGoEmbalazeVKosarici } from "./cart-context";

describe("cenaToGoEmbalazeVKosarici", () => {
  it("ceno embalaže pomnoži s količino artikla", () => {
    const artikel = {
      toGoEmbalaza: [{ id: 1, naziv: "Škatla", cena: 0.3 }],
    } as any;

    expect(cenaToGoEmbalazeVKosarici({
      artikel,
      toGo: true,
      kolicina: 2,
    })).toBe(0.6);
  });

  it("pri navadnem naročilu embalaže ne prišteje", () => {
    const artikel = {
      toGoEmbalaza: [{ id: 1, naziv: "Škatla", cena: 0.3 }],
    } as any;

    expect(cenaToGoEmbalazeVKosarici({
      artikel,
      toGo: false,
      kolicina: 2,
    })).toBe(0);
  });
});