import { describe, expect, it } from "vitest";
import { consumesMalicaQuantity, encodeMalicaPairingGroup, isAllowedGroupPriceDate, isFutureBusinessDate, parseMalicaPairingGroup, remainingQuantity, requiresHigherGroupConfirmation } from "./malice-rules";

describe("Malice price rules", () => {
  it("requires the higher group before increasing a lower group", () => {
    expect(requiresHigherGroupConfirmation(3, 850, 950, null)).toBe(true);
    expect(requiresHigherGroupConfirmation(3, 850, 950, 1050)).toBe(false);
    expect(requiresHigherGroupConfirmation(4, 900, 1050, null)).toBe(false);
  });

  it("does not block decreases but requires an order for first lower-group prices", () => {
    expect(requiresHigherGroupConfirmation(2, 900, 850, null)).toBe(false);
    expect(requiresHigherGroupConfirmation(2, null, 850, null)).toBe(true);
    expect(requiresHigherGroupConfirmation(2, null, 850, 900)).toBe(false);
  });

  it("accepts only a future business date", () => {
    expect(isFutureBusinessDate("2026-04-02", "2026-04-01")).toBe(true);
    expect(isFutureBusinessDate("2026-04-01", "2026-04-01")).toBe(false);
    expect(isFutureBusinessDate("2026-03-31", "2026-04-01")).toBe(false);
  });
  it("allows a historical first price but not a retroactive change", () => {
    expect(isAllowedGroupPriceDate("2026-01-01", "2026-09-26", false)).toBe(true);
    expect(isAllowedGroupPriceDate("2026-09-26", "2026-09-26", false)).toBe(true);
    expect(isAllowedGroupPriceDate("2026-01-01", "2026-09-26", true)).toBe(false);
    expect(isAllowedGroupPriceDate("2026-09-26", "2026-09-26", true)).toBe(false);
    expect(isAllowedGroupPriceDate("2026-09-27", "2026-09-26", true)).toBe(true);
  });

  it("calculates live remaining portions without changing unlimited configuration", () => {
    expect(remainingQuantity(null, 999)).toBeNull();
    expect(remainingQuantity(10, 3)).toBe(7);
    expect(remainingQuantity(10, 15)).toBe(0);
  });

  it("does not count cancelled orders toward Malica quantities", () => {
    expect(consumesMalicaQuantity("odprto")).toBe(true);
    expect(consumesMalicaQuantity("zakljuceno")).toBe(true);
    expect(consumesMalicaQuantity("preklicano")).toBe(false);
  });

  it("encodes and parses immutable Malica KDS composition", () => {
    const pairing = encodeMalicaPairingGroup({ soup: true, main: true, dessert: false }, "uuid");
    expect(pairing).toBe("malica:s1m1d0:uuid");
    expect(parseMalicaPairingGroup(pairing)).toEqual({ soup: true, main: true, dessert: false });
    expect(parseMalicaPairingGroup("malica:legacy-uuid")).toBeNull();
  });
});