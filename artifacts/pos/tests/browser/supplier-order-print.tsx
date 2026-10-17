import { createRoot } from "react-dom/client";
import type { SupplierOrderDetail } from "@workspace/api-client-react";
import { SupplierOrderPrintView } from "../../src/pages/NarocilaDobaviteljem";
import "../../src/index.css";

const lineCount = 55;
const lines: SupplierOrderDetail["lines"] = Array.from({ length: lineCount }, (_, index) => {
  const number = index + 1;
  const paddedNumber = String(number).padStart(3, "0");
  const unitPrice = (number % 9) + 1.25;

  return {
    id: number,
    supplierMappingId: 10_000 + number,
    articleId: 20_000 + number,
    articleName: `POSTAVKA-${paddedNumber}`,
    supplierItemName: `KOLICINA-${number}`,
    supplierCode: `REF-${paddedNumber}`,
    packageQuantity: number,
    packageFactor: 1,
    packageName: "zaboj",
    baseUnit: "KOS",
    orderedBaseQuantity: number,
    receivedBaseQuantity: 0,
    openBaseQuantity: number,
    unitPrice,
  };
});

const noteParagraphs = Array.from({ length: 100 }, (_, index) => {
  const number = String(index + 1).padStart(3, "0");
  return `NAVODILO-${number} Dobavitelj naj vsako postavko pripravi ločeno, označi paket s številko naročila in ob dostavi preveri količino. V primeru odstopanja naj pred razkladanjem pokliče odgovorno osebo in počaka na potrditev.`;
});

const order: SupplierOrderDetail = {
  id: 948,
  number: "N-2026-0948",
  supplierId: "supplier-print-test",
  supplierName: "Preizkusni dobavitelj",
  status: "draft",
  createdAt: "2026-10-17T10:00:00.000Z",
  expectedDeliveryDate: "2026-10-22",
  sentAt: null,
  lineCount: lines.length,
  openQuantity: lines.reduce((total, line) => total + line.openBaseQuantity, 0),
  internalNotes: "INTERNAL-NOTE-MUST-NOT-PRINT",
  supplierNotes: `${noteParagraphs.join("\n\n")}\n\nKONEC-NAVODILA-100`,
  closedReason: null,
  lines,
};

const root = document.getElementById("test-root");
if (!root) throw new Error("Print test root is missing.");

createRoot(root).render(<SupplierOrderPrintView order={order} />);
