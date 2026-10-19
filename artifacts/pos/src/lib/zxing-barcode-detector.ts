/**
 * Nadomestek za BarcodeDetector, ki ga Android WebView (npr. aplikacija mostu na ZCS terminalu)
 * nima. Ima enak vmesnik: detect(video) vrne najdene kode (QR in črtne kode).
 */
export type DetectedCode = { rawValue: string };

export class ZxingBarcodeDetector {
  private canvas = document.createElement("canvas");
  private reader: import("@zxing/library").MultiFormatReader | null = null;
  private zxing: typeof import("@zxing/library") | null = null;

  async detect(video: HTMLVideoElement): Promise<DetectedCode[]> {
    if (!this.zxing) {
      this.zxing = await import("@zxing/library");
      this.reader = new this.zxing.MultiFormatReader();
      const hints = new Map();
      hints.set(this.zxing.DecodeHintType.TRY_HARDER, true);
      this.reader.setHints(hints);
    }
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) return [];
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Platno ni na voljo.");
    context.drawImage(video, 0, 0, width, height);
    const { HTMLCanvasElementLuminanceSource, BinaryBitmap, HybridBinarizer, NotFoundException } = this.zxing;
    try {
      const bitmap = new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(this.canvas)));
      const result = this.reader!.decodeWithState(bitmap);
      return [{ rawValue: result.getText() }];
    } catch (cause) {
      if (cause instanceof NotFoundException || (cause as { name?: string })?.name === "NotFoundException") return [];
      throw cause;
    }
  }
}
