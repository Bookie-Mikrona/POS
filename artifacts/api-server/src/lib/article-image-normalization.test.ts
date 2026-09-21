import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_IMAGE_HEIGHT,
  ARTICLE_IMAGE_WIDTH,
  ArticleImageNormalizationError,
  normalizeArticleImage,
} from "./article-image-normalization";

describe("normalizeArticleImage", () => {
  it("pretvori pokončno sliko v natančen 2,5:1 WebP izsek", async () => {
    const source = createCanvas(400, 1000);
    source.getContext("2d").fillStyle = "#e85d04";
    source.getContext("2d").fillRect(0, 0, 400, 1000);

    const normalized = await normalizeArticleImage(source.toBuffer("image/png"));
    const result = await loadImage(normalized);

    expect(normalized.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(normalized.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(result.width).toBe(ARTICLE_IMAGE_WIDTH);
    expect(result.height).toBe(ARTICLE_IMAGE_HEIGHT);
  });

  it("pri AI sliki ohrani celoten visok kader namesto sredinskega obrezovanja", async () => {
    const source = createCanvas(600, 1000);
    const sourceContext = source.getContext("2d");
    sourceContext.fillStyle = "#ef1d24";
    sourceContext.fillRect(0, 0, 600, 300);
    sourceContext.fillStyle = "#37a64a";
    sourceContext.fillRect(0, 300, 600, 400);
    sourceContext.fillStyle = "#1459e6";
    sourceContext.fillRect(0, 700, 600, 300);

    const normalized = await normalizeArticleImage(source.toBuffer("image/png"), { fit: "contain" });
    const result = await loadImage(normalized);
    const resultCanvas = createCanvas(ARTICLE_IMAGE_WIDTH, ARTICLE_IMAGE_HEIGHT);
    const resultContext = resultCanvas.getContext("2d");
    resultContext.drawImage(result, 0, 0);

    const topPixel = resultContext.getImageData(750, 20, 1, 1).data;
    const bottomPixel = resultContext.getImageData(750, 580, 1, 1).data;
    expect(topPixel[0]).toBeGreaterThan(topPixel[2]);
    expect(bottomPixel[2]).toBeGreaterThan(bottomPixel[0]);
  });

  it("zavrne sliko s prevelikim številom pik pred dekodiranjem", async () => {
    const pngHeader = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHeader);
    pngHeader.write("IHDR", 12, "ascii");
    pngHeader.writeUInt32BE(5000, 16);
    pngHeader.writeUInt32BE(5000, 20);

    await expect(normalizeArticleImage(pngHeader)).rejects.toBeInstanceOf(ArticleImageNormalizationError);
  });
});