import JSZip from "jszip";
import { validateEslogForExport } from "./external-export-adapters";

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function buildEslogInvoicePackage(input: {
  invoiceNumber: string;
  xml: string;
  pdf: Buffer;
}): Promise<Buffer> {
  const validation = validateEslogForExport(input.xml);
  if (!validation.valid) {
    throw new Error("e-SLOG XML ne prestane strukturne validacije in ga ni mogoče izvoziti");
  }
  const name = safeFilename(input.invoiceNumber);
  const zip = new JSZip();
  zip.file(`eracun-${name}.xml`, input.xml);
  zip.file(`racun-${name}.pdf`, input.pdf);
  zip.file("VALIDACIJA.txt", [
    "e-SLOG izvozna validacija",
    `Rezultat: ${validation.valid ? "USPEŠNO" : "NEUSPEŠNO"}`,
    ...validation.warnings,
  ].join("\n"));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function buildReceivedInvoicePackage(input: {
  invoiceNumber: string;
  xml?: string;
  pdf?: Buffer;
  warnings: string[];
  original?: { filename: string; content: Buffer };
}): Promise<Buffer> {
  const name = safeFilename(input.invoiceNumber);
  const zip = new JSZip();
  if (input.xml && input.pdf) {
    const validation = validateEslogForExport(input.xml);
    if (!validation.valid) throw new Error("Prejeti e-SLOG XML ne prestane strukturne validacije.");
    zip.file(`prejeti-racun-${name}.xml`, input.xml);
    zip.file(`prejeti-racun-${name}.pdf`, input.pdf);
    input.warnings = [...input.warnings, ...validation.warnings];
  }
  if (input.original) zip.file(`izvirnik-${safeFilename(input.original.filename)}`, input.original.content);
  zip.file("VALIDACIJA.txt", [
    input.xml ? "e-SLOG prejeti račun: strukturno pripravljen; uradna XSD validacija ni na voljo." : "e-SLOG prejeti račun: ni ustvarjen.",
    ...input.warnings,
  ].join("\n"));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}