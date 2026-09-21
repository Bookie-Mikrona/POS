import type PDFKit from "pdfkit";
import { requireRuntimePackage } from "./runtime-require";

const PDFDocument = requireRuntimePackage("pdfkit") as typeof PDFKit;

export default PDFDocument;