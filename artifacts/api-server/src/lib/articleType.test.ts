import { describe, expect, it } from "vitest";

import { resolveArticleType } from "./articleType";

describe("resolveArticleType", () => {
  it("nov prodajni artikel brez izrecne vrste obravnava kot storitev", () => {
    expect(resolveArticleType(undefined, {
      nabavniArtikel: false,
      prodajniArtikel: true,
    })).toBe("storitev");
  });

  it("samo nabavni artikel brez izrecne vrste obravnava kot material", () => {
    expect(resolveArticleType(undefined, {
      nabavniArtikel: true,
      prodajniArtikel: false,
    })).toBe("material");
  });

  it("ne prepiše izrecno izbrane vrste", () => {
    expect(resolveArticleType("blago", {
      nabavniArtikel: true,
      prodajniArtikel: true,
    })).toBe("blago");
  });

  it("polizdelku ne pripiše računovodske vrste niti ob stari shranjeni vrednosti", () => {
    expect(resolveArticleType("storitev", {
      nabavniArtikel: false,
      prodajniArtikel: false,
      povratnaEmbalaza: false,
    })).toBeNull();
    expect(resolveArticleType(undefined, {
      nabavniArtikel: false,
      prodajniArtikel: false,
    })).toBeNull();
    expect(resolveArticleType("material", {
      nabavniArtikel: false,
      prodajniArtikel: false,
      povratnaEmbalaza: true,
    })).toBe("material");
  });
});