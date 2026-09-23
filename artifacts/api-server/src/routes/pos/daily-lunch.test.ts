import { describe, expect, it } from "vitest";
import { resolveDailyLunchTotal } from "./daily-lunch";

describe("daily lunch order mutation pricing", () => {
  it("prices a three-course package from the live main-dish price", () => {
    expect(resolveDailyLunchTotal("three_course", 7.5, 2, 3)).toBe(9.5);
  });
  it("adds the starter flat amount only to a four-course package", () => {
    expect(resolveDailyLunchTotal("four_course", 7.5, 2, 3)).toBe(12.5);
  });
  it("rejects invalid negative amounts before order mutation", () => {
    expect(() => resolveDailyLunchTotal("three_course", -1, 2, 3)).toThrow();
  });
});