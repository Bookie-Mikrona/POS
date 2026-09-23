import { test, expect, describe } from "vitest";
import { isMalicaChoiceUnavailable } from "../malicaHelpers";

describe("isMalicaChoiceUnavailable", () => {
  test("returns false when enabled and unlimited (remainingQuantity is null)", () => {
    expect(isMalicaChoiceUnavailable({ enabled: true, remainingQuantity: null })).toBe(false);
  });

  test("returns false when enabled and remainingQuantity is positive", () => {
    expect(isMalicaChoiceUnavailable({ enabled: true, remainingQuantity: 5 })).toBe(false);
  });

  test("returns true when explicitly disabled", () => {
    expect(isMalicaChoiceUnavailable({ enabled: false, remainingQuantity: 10 })).toBe(true);
    expect(isMalicaChoiceUnavailable({ enabled: false, remainingQuantity: null })).toBe(true);
  });

  test("returns true when remainingQuantity is zero", () => {
    expect(isMalicaChoiceUnavailable({ enabled: true, remainingQuantity: 0 })).toBe(true);
    // Even if enabled is undefined, zero quantity should mean unavailable
    expect(isMalicaChoiceUnavailable({ remainingQuantity: 0 })).toBe(true);
  });
});

import { isQuantityControlDisabledForPackage } from "../malicaHelpers";

describe("isQuantityControlDisabledForPackage", () => {
  test("returns true for malica pairing parent (isMulticourseBundle set from groupMulticourseOrderRows)", () => {
    expect(isQuantityControlDisabledForPackage({ isMulticourseBundle: true })).toBe(true);
  });

  test("returns true for generic multicourse bundle", () => {
    // Both generic and malica bundles can have isMulticourseBundle: true depending on how they are grouped
    expect(isQuantityControlDisabledForPackage({ isMulticourseBundle: true })).toBe(true);
  });

  test("returns true for malica child row with pairingGroupId starting with malica:", () => {
    expect(isQuantityControlDisabledForPackage({ pairingGroupId: "malica:s1m1d0:123" })).toBe(true);
  });

  test("returns true for every daily lunch course row", () => {
    expect(isQuantityControlDisabledForPackage({ pairingGroupId: "daily-lunch:42:abc" })).toBe(true);
  });

  test("returns false for generic pairingGroupId without malica: prefix", () => {
    expect(isQuantityControlDisabledForPackage({ pairingGroupId: "generic:group1" })).toBe(false);
  });

  test("returns false for ordinary row", () => {
    expect(isQuantityControlDisabledForPackage({})).toBe(false);
  });
});
