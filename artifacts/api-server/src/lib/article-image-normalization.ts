import { createCanvas, loadImage } from "@napi-rs/canvas";

export const ARTICLE_IMAGE_WIDTH = 1500;
export const ARTICLE_IMAGE_HEIGHT = 600;
export const ARTICLE_IMAGE_ASPECT_RATIO = ARTICLE_IMAGE_WIDTH / ARTICLE_IMAGE_HEIGHT;
export const MAX_ARTICLE_IMAGE_SOURCE_DIMENSION = 6000;
export const MAX_ARTICLE_IMAGE_SOURCE_PIXELS = 12_000_000;

type ImageDimensions = { width: number; height: number };
type ImageFit = "cover" | "contain";

export type NormalizeArticleImageOptions = {
  /**
   * `cover` sredinsko obreže sliko in je namenjen ročnemu uploadu, kjer je
   * uporabnik izrez že izbral. `contain` ohrani cel AI-generirani kader.
   */
  fit?: ImageFit;
};

export class ArticleImageNormalizationError extends Error {}

function readPngDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegDimensions(bytes: Buffer): ImageDimensions | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (segmentLength < 7) return null;
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): ImageDimensions | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > bytes.length) return null;
    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        width: bytes.readUIntLE(dataOffset + 4, 3) + 1,
        height: bytes.readUIntLE(dataOffset + 7, 3) + 1,
      };
    }
    if (chunkType === "VP8 " && chunkSize >= 10 && bytes.subarray(dataOffset + 3, dataOffset + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return {
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (chunkType === "VP8L" && chunkSize >= 5 && bytes[dataOffset] === 0x2f) {
      return {
        width: 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8),
        height: 1 + (bytes[dataOffset + 2] >> 6) + (bytes[dataOffset + 3] << 2) + ((bytes[dataOffset + 4] & 0x0f) << 10),
      };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function sourceDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return readPngDimensions(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegDimensions(bytes);
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return readWebpDimensions(bytes);
  }
  return null;
}

function validateSourceDimensions(bytes: Buffer): ImageDimensions {
  const dimensions = sourceDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new ArticleImageNormalizationError("Slika nima veljavnih dimenzij.");
  }
  if (
    dimensions.width > MAX_ARTICLE_IMAGE_SOURCE_DIMENSION
    || dimensions.height > MAX_ARTICLE_IMAGE_SOURCE_DIMENSION
    || dimensions.width * dimensions.height > MAX_ARTICLE_IMAGE_SOURCE_PIXELS
  ) {
    throw new ArticleImageNormalizationError("Slika ima prevelike dimenzije. Največ je 6.000 px na stranici oziroma 12 milijonov pik.");
  }
  return dimensions;
}

/**
 * Pripravi enoten širok format za vse slike artiklov ne glede na njihov izvor.
 * Motiv je sredinsko izrezan; generator zato dobi navodilo za varen prostor okoli izdelka.
 */
export async function normalizeArticleImage(
  bytes: Buffer,
  { fit = "cover" }: NormalizeArticleImageOptions = {},
): Promise<Buffer> {
  const dimensions = validateSourceDimensions(bytes);
  let image;
  try {
    image = await loadImage(bytes);
  } catch {
    throw new ArticleImageNormalizationError("Slike ni mogoče prebrati.");
  }
  if (!image.width || !image.height || image.width !== dimensions.width || image.height !== dimensions.height) {
    throw new ArticleImageNormalizationError("Slika nima veljavnih dimenzij.");
  }

  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const sourceAspectRatio = sourceWidth / sourceHeight;
  const cropWidth = sourceAspectRatio > ARTICLE_IMAGE_ASPECT_RATIO
    ? sourceHeight * ARTICLE_IMAGE_ASPECT_RATIO
    : sourceWidth;
  const cropHeight = cropWidth / ARTICLE_IMAGE_ASPECT_RATIO;
  const cropX = (sourceWidth - cropWidth) / 2;
  const cropY = (sourceHeight - cropHeight) / 2;

  const canvas = createCanvas(ARTICLE_IMAGE_WIDTH, ARTICLE_IMAGE_HEIGHT);
  const context = canvas.getContext("2d");
  if (fit === "contain") {
    // Gemini ne zagotavlja vedno zahtevanega širokega kadra. Najprej narišemo
    // diskretno polno ozadje, nato pa celoten kader, da se jed nikoli ne
    // odreže samodejno.
    context.fillStyle = "#f3f0eb";
    context.fillRect(0, 0, ARTICLE_IMAGE_WIDTH, ARTICLE_IMAGE_HEIGHT);
    context.save();
    context.globalAlpha = 0.14;
    context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, ARTICLE_IMAGE_WIDTH, ARTICLE_IMAGE_HEIGHT);
    context.restore();

    const scale = Math.min(ARTICLE_IMAGE_WIDTH / sourceWidth, ARTICLE_IMAGE_HEIGHT / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    context.drawImage(
      image,
      (ARTICLE_IMAGE_WIDTH - width) / 2,
      (ARTICLE_IMAGE_HEIGHT - height) / 2,
      width,
      height,
    );
  } else {
    context.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, ARTICLE_IMAGE_WIDTH, ARTICLE_IMAGE_HEIGHT);
  }
  return canvas.toBuffer("image/webp", 92);
}