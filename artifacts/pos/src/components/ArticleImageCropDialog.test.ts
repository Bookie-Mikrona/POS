import { describe, expect, it } from "vitest";
import { calculateCropRect } from "./ArticleImageCropDialog";

describe("calculateCropRect", () => {
  it("za široko sliko vrne sredinski izsek v razmerju 2,5 : 1", () => {
    expect(calculateCropRect({ width: 2400, height: 600 }, 1, { x: 0, y: 0 })).toEqual({
      x: 450,
      y: 0,
      width: 1500,
      height: 600,
    });
  });

  it("pri povečavi dovoli premik izseka znotraj slike", () => {
    expect(calculateCropRect({ width: 1200, height: 1200 }, 2, { x: 1, y: -1 })).toEqual({
      x: 600,
      y: 0,
      width: 600,
      height: 240,
    });
  });
});