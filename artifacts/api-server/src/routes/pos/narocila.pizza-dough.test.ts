import { describe, expect, it } from "vitest";
import { resolveConfiguredPizzaDoughArticleId } from "./narocila";

describe("pizza dough article selection", () => {
  const mapping = {
    normal_dough_article_id: 410,
    small_dough_article_id: 411,
    family_dough_article_id: 412,
  };

  it("selects the size-specific dough article", () => {
    expect(resolveConfiguredPizzaDoughArticleId(mapping, "mala")).toBe(411);
    expect(resolveConfiguredPizzaDoughArticleId(mapping, "normalna")).toBe(410);
    expect(resolveConfiguredPizzaDoughArticleId(mapping, "druzinska")).toBe(412);
  });

  it("does not enable dough consumption for units without a mapping", () => {
    expect(resolveConfiguredPizzaDoughArticleId(null, "mala")).toBeNull();
  });

  it("rejects an enabled mapping without the selected size article", () => {
    expect(() => resolveConfiguredPizzaDoughArticleId({
      normal_dough_article_id: 410,
      small_dough_article_id: null,
      family_dough_article_id: 412,
    }, "mala")).toThrow("Za izbrano velikost pice ni nastavljen ustrezen artikel testa.");
  });
});