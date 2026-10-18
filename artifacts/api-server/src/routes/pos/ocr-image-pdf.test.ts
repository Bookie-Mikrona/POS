import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { registerPdfFonts } from "../../lib/pdf-fonts";

// Run the actual route-local functions without importing their database, storage
// and AI clients. AST extraction deliberately fails if a helper moves or changes
// its dependencies; PDFKit and font registration are not mocked.
function routeHelper<T>(file: string, name: string): T {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  if (!declaration) throw new Error(`Missing OCR helper ${name} in ${file}`);
  const { outputText } = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  });
  return new Function("PDFDocument", "registerPdfFonts", "Buffer",
    `${outputText}\nreturn ${name};`)(PDFDocument, registerPdfFonts, Buffer) as T;
}

const imageToPdf = routeHelper<(image: Buffer) => Promise<Buffer>>(
  "./inventure.ts", "imageToPdf",
);
const slikaVPdfBase64 = routeHelper<(image: string, mime: string) => Promise<string>>(
  "./uvoz-prejemnic.ts", "slikaVPdfBase64",
);
const converters = [
  { name: "inventure.imageToPdf", convert: (image: Buffer, _mime: string) => imageToPdf(image) },
  {
    name: "uvoz-prejemnic.slikaVPdfBase64",
    convert: async (image: Buffer, mime: string) =>
      Buffer.from(await slikaVPdfBase64(image.toString("base64"), mime), "base64"),
  },
];

function fixture(width: number, height: number, format: "png" | "jpeg"): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // Distinct corners and asymmetric inner marks expose clipping, rotation,
  // stretching, offsets, blank output and misplaced images.
  for (const [color, x, y] of [
    ["#e62536", 0, 0], ["#27bc45", width / 2, 0],
    ["#264ae6", 0, height / 2], ["#f5ca28", width / 2, height / 2],
  ] as const) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width / 2 + 1, height / 2 + 1);
  }
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, width - 4, height - 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(13, 17, 7, height - 39);
  ctx.fillRect(29, 31, width - 47, 5);
  return format === "png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg", 95);
}

async function pixels(image: Buffer) {
  const decoded = await loadImage(image);
  const canvas = createCanvas(decoded.width, decoded.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(decoded, 0, 0);
  return {
    width: decoded.width,
    height: decoded.height,
    rgba: ctx.getImageData(0, 0, decoded.width, decoded.height).data,
  };
}

describe.each(converters)("$name OCR image wrapper", ({ convert }) => {
  for (const format of ["png", "jpeg"] as const) {
    it.each([
      { width: 137, height: 311 },
      { width: 311, height: 137 },
    ])(`preserves the complete ${format} page at $width × $height`, async ({ width, height }) => {
      const image = fixture(width, height, format);
      const pdf = await convert(image, `image/${format}`);
      expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      const info = execFileSync("pdfinfo", ["-"], { input: pdf, encoding: "utf8" });
      expect(info).toMatch(/^Pages:\s+1\s*$/m);
      const size = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
      expect(size, info).not.toBeNull();
      const pageWidth = Number(size![1]);
      const pageHeight = Number(size![2]);
      expect(pageWidth).toBe(width);
      expect(pageHeight).toBe(height);
      expect(pageWidth / pageHeight).toBe(width / height);

      // 72 DPI maps a PDF point to one pixel. Unlike metadata assertions this
      // proves the image really occupies the full page, including every edge.
      const rendered = execFileSync("pdftocairo", ["-singlefile", "-r", "72", "-png", "-", "-"], {
        input: pdf,
        maxBuffer: 4 * 1024 * 1024,
      });
      const actual = await pixels(rendered);
      const expected = await pixels(image);
      expect([actual.width, actual.height]).toEqual([width, height]);
      expect(actual.rgba.length).toBe(expected.rgba.length);
      let maxDifference = 0;
      let totalDifference = 0;
      for (let i = 0; i < expected.rgba.length; i++) {
        const difference = Math.abs(actual.rgba[i]! - expected.rgba[i]!);
        maxDifference = Math.max(maxDifference, difference);
        totalDifference += difference;
      }
      // JPEG decoders can differ slightly in rounding; do not compare JPEG
      // output to the pre-encoding canvas (which would test JPEG loss instead).
      expect(maxDifference).toBeLessThanOrEqual(format === "png" ? 0 : 5);
      expect(totalDifference / expected.rgba.length).toBeLessThanOrEqual(format === "png" ? 0 : 1);
    });

    it(`rejects a damaged ${format} instead of returning a blank PDF`, async () => {
      const damaged = fixture(137, 311, format).subarray(0, 24);
      await expect(convert(damaged, `image/${format}`)).rejects.toThrow(
        format === "png" ? /incomplete or corrupt PNG/i : /invalid JPEG/i,
      );
    });
  }

  it("clearly rejects bytes that are not an image", async () => {
    await expect(convert(Buffer.from("not an image"), "image/png"))
      .rejects.toThrow(/unknown image format/i);
  });
});
