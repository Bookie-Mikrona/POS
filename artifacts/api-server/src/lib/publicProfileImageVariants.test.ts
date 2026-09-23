import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  createPublicProfileImageVariant,
  type PublicProfileImagePurpose,
} from "./publicProfileImageVariants";

function sourceImage(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#1b3b36";
  context.fillRect(0, 0, width, height);
  return canvas.encodeSync("png");
}

describe("spletne različice slik javnega profila", () => {
  it.each([
    ["logo", 512, 341],
    ["cover", 1620, 1080],
    ["voucher", 960, 640],
  ] satisfies Array<[PublicProfileImagePurpose, number, number]>)(
    "%s zmanjša znotraj dovoljenih mer in ohrani razmerje",
    async (purpose, expectedWidth, expectedHeight) => {
      const variant = await createPublicProfileImageVariant(
        sourceImage(2400, 1600),
        purpose,
      );
      const decoded = await loadImage(variant.bytes);

      expect(variant.contentType).toBe("image/webp");
      expect([decoded.width, decoded.height]).toEqual([expectedWidth, expectedHeight]);
      expect(decoded.width / decoded.height).toBeCloseTo(1.5, 2);
    },
  );

  it("majhne slike ne poveča", async () => {
    const variant = await createPublicProfileImageVariant(sourceImage(120, 80), "cover");
    expect([variant.width, variant.height]).toEqual([120, 80]);
  });

  it("zavrne vsebino, ki ni slika", async () => {
    await expect(
      createPublicProfileImageVariant(Buffer.from("not an image"), "logo"),
    ).rejects.toThrow("Slike ni mogoče obdelati.");
  });
});