import { describe, expect, it } from "vitest";
import {
  expandCheckoutSplitPostavkaIds,
  toggleCheckoutSplitPostavka,
} from "./checkout-split-selection";

describe("checkout split modifier selection", () => {
  const postavke = [
    { id: 1, parentPostavkaId: null, skupaj: 10 },
    { id: 2, parentPostavkaId: 1, skupaj: 2.5 },
    { id: 3, parentPostavkaId: 2, skupaj: 1.25 },
    { id: 4, parentPostavkaId: null, skupaj: 8 },
  ];

  it("includes parent, nested modifier, and grandchild without unrelated order lines", () => {
    const ids = expandCheckoutSplitPostavkaIds([1], postavke);
    const selected = postavke.filter(postavka => ids.has(postavka.id));

    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(selected.reduce((total, postavka) => total + postavka.skupaj, 0)).toBe(13.75);
  });

  it("deselects the full modifier component while preserving unrelated selections", () => {
    const ids = toggleCheckoutSplitPostavka([1, 2, 3, 4], 1, false, postavke);

    expect([...ids]).toEqual([4]);
  });

  it("expands a selected nested modifier through its parent and descendants", () => {
    const ids = toggleCheckoutSplitPostavka([], 2, true, postavke);

    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});