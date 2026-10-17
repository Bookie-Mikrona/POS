import { existsSync } from "node:fs";
import path from "node:path";
import type PDFDocument from "pdfkit";

/** Register both bundled Unicode fonts and replace PDFKit's WinAnsi default. */
export function registerPdfFonts(doc: InstanceType<typeof PDFDocument>): void {
  const fontDir = [
    path.join(import.meta.dirname, "..", "assets", "fonts"),
    path.join(import.meta.dirname, "assets", "fonts"),
  ].find((dir) => ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"]
    .every((file) => existsSync(path.join(dir, file))));
  if (!fontDir) throw new Error("Manjkata PDF pisavi DejaVu Sans (navadna in krepka).");
  doc.registerFont("DejaVuSans", path.join(fontDir, "DejaVuSans.ttf"));
  doc.registerFont("DejaVuSans-Bold", path.join(fontDir, "DejaVuSans-Bold.ttf"));
  doc.font("DejaVuSans");
}
