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
});