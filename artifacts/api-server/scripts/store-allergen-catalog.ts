/**
 * Store a supplied PDF privately using the application's existing storage service.
 * Does not register accounting documents or modify business data.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ObjectStorageService } from "../src/lib/objectStorage.js";

if (!process.argv.includes("--development-only") || process.env.REPLIT_DEPLOYMENT === "1"
  || process.env.NODE_ENV === "production") {
  throw new Error("This helper is restricted to development.");
}
const inputPath = process.argv[2];
const resultPath = process.argv[3];
if (!inputPath || !resultPath) throw new Error("Supply PDF input and result JSON paths.");
const contents = await readFile(inputPath);
if (contents.subarray(0, 5).toString() !== "%PDF-") throw new Error("Input is not a PDF.");
const storage = new ObjectStorageService();
const uploadURL = await storage.getObjectEntityUploadURL("allergen-catalogs");
const uploaded = await fetch(uploadURL, {
  method: "PUT",
  headers: { "Content-Type": "application/pdf" },
  body: contents,
});
if (!uploaded.ok) throw new Error(`PDF upload failed with HTTP ${uploaded.status}.`);
const objectPath = storage.normalizeObjectEntityPath(uploadURL);
const size = await storage.getObjectEntitySizeBytes(objectPath);
if (size !== contents.length) throw new Error("Uploaded size does not match the source PDF.");
const result = {
  objectPath,
  sizeBytes: size,
  sha256: createHash("sha256").update(contents).digest("hex"),
};
await writeFile(resultPath, JSON.stringify(result));
console.log("PDF stored privately; source size verified.");