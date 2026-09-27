import { describe, expect, it } from "vitest";
import { formatMenuPrice } from "./menu-price-list-pdf";

describe("formatMenuPrice", () => {
  it("uporabi slovensko decimalno vejico, združevanje tisočic in evre", () => {
    expect(formatMenuPrice("12.5")).toBe("12,50 €");
    expect(formatMenuPrice("1234.50")).toBe("1.234,50 €");
    expect(formatMenuPrice(0)).toBe("0,00 €");
  });

  it("ne izpiše neveljavnih cen", () => {
    expect(formatMenuPrice(null)).toBeNull();
    expect(() => formatMenuPrice("ni število")).toThrow("Neveljavna cena artikla v ceniku.");
  });
});