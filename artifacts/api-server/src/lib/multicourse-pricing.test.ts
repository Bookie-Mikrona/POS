import { describe, expect, it } from "vitest";
import { splitMulticourseGross } from "./multicourse-pricing";

describe("splitMulticourseGross", () => {
  it("razdeli bruto ceno in ohrani natančen seštevek", () => {
    expect(splitMulticourseGross(40, 75)).toEqual({ foodGross: 30, wineGross: 10 });
    expect(splitMulticourseGross(61, 75)).toEqual({ foodGross: 45.75, wineGross: 15.25 });
    const split = splitMulticourseGross(61, 70);
    expect(split).toEqual({ foodGross: 42.7, wineGross: 18.3 });
    expect(split.foodGross + split.wineGross).toBe(61);
  });

  it("podpira mejni vrednosti", () => {
    expect(splitMulticourseGross(40, 100)).toEqual({ foodGross: 40, wineGross: 0 });
    expect(splitMulticourseGross(40, 0)).toEqual({ foodGross: 0, wineGross: 40 });
  });
});