import { describe, expect, it } from "vitest";
import { dailyLunchPrice, requiredDailyLunchRoles } from "./dailyLunchHelpers";

describe("daily lunch helpers", () => {
  it("requires soup, main and dessert for a three-course lunch", () => {
    expect(requiredDailyLunchRoles("three_course")).toEqual(["soup", "main", "dessert"]);
  });
  it("adds the starter role only for four courses", () => {
    expect(requiredDailyLunchRoles("four_course")).toEqual(["starter", "soup", "main", "dessert"]);
  });
  it("formats authoritative prices without changing their numeric value", () => {
    expect(dailyLunchPrice("10.50")).toBe("10,50 €");
  });
});