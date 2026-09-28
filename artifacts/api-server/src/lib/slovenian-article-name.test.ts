import { describe, expect, it } from "vitest";
import {
  normalizeOptionalSlovenianArticleName,
  normalizeSlovenianArticleName,
} from "./slovenian-article-name";

describe("Slovenian article-name normalization", () => {
  it("trims whitespace and uppercases only the first Unicode letter", () => {
    expect(normalizeSlovenianArticleName("  čokoladni KRUH  ")).toBe("Čokoladni KRUH");
    expect(normalizeSlovenianArticleName("  žganje ŠTRUKLJI")).toBe("Žganje ŠTRUKLJI");
    expect(normalizeSlovenianArticleName("  (šifra) ABC")).toBe("(Šifra) ABC");
  });

  it("preserves casing after the initial letter and handles blank optional names", () => {
    expect(normalizeSlovenianArticleName(" pIZZA mARGHERITA ")).toBe("PIZZA mARGHERITA");
    expect(normalizeSlovenianArticleName(" \t\n ")).toBe("");
    expect(normalizeOptionalSlovenianArticleName("  čebula rdeča  ")).toBe("Čebula rdeča");
    expect(normalizeOptionalSlovenianArticleName(" \t\n ")).toBeNull();
    expect(normalizeOptionalSlovenianArticleName(null)).toBeNull();
  });
});