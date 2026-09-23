import { createCanvas, loadImage } from "@napi-rs/canvas";

export type PublicProfileImagePurpose = "logo" | "cover" | "voucher";

const VARIANT_SPECS: Record<PublicProfileImagePurpose, {
  maxWidth: number;
  maxHeight: number;
  quality: number;
}> = {
  logo: { maxWidth: 512, maxHeight: 512, quality: 82 },
  cover: { maxWidth: 1920, maxHeight: 1080, quality: 82 },
  voucher: { maxWidth: 960, maxHeight: 720, quality: 82 },
};

const MAX_SOURCE_PIXELS = 40_000_000;

export async function createPublicProfileImageVariant(
  source: Buffer,
  purpose: PublicProfileImagePurpose,
): Promise<{ bytes: Buffer; width: number; height: number; contentType: "image/webp" }> {
  let image;
  try {
    image = await loadImage(source);
  } catch {
    throw new Error("Slike ni mogoče obdelati.");
  }

  const sourceWidth = image.width;
  const sourceHeight = image.height;
  if (
    !Number.isInteger(sourceWidth) ||
    !Number.isInteger(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceWidth * sourceHeight > MAX_SOURCE_PIXELS
  ) {
    throw new Error("Slika ima neveljavne ali prevelike mere.");
  }

  const spec = VARIANT_SPECS[purpose];
  const scale = Math.min(1, spec.maxWidth / sourceWidth, spec.maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  return {
    bytes: await canvas.encode("webp", spec.quality),
    width,
    height,
    contentType: "image/webp",
  };
}