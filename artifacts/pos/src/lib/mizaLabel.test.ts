import { describe, expect, it } from "vitest";
import { formatMizaLabel } from "./mizaLabel";

describe("formatMizaLabel", () => {
  it("ne podvoji predpone Miza", () => {
    expect(formatMizaLabel("Miza 7", 7)).toBe("Miza 7");
    expect(formatMizaLabel("MIZA 7", 7)).toBe("MIZA 7");
    expect(formatMizaLabel("Terasa 3", 3)).toBe("Miza Terasa 3");
    expect(formatMizaLabel(null, 4)).toBe("Miza 4");
    expect(formatMizaLabel("Mizarska", 1)).toBe("Miza Mizarska");
  });
});
