import { createRoot } from "react-dom/client";
import type { SupplierOrderDetail } from "@workspace/api-client-react";
import { SupplierOrderPrintView } from "../../src/pages/NarocilaDobaviteljem";
import "../../src/index.css";

const lineCount = 55;
const longOrderNumber = "N-2026-0948-IZREDNO-DOLGA-ŠTEVILKA-NAROČILA-Z-LOKACIJO-RESTAVRACIJA-TRG-REPUBLIKE-001234567890";
const longSupplierName = "Preizkusni dobavitelj za gostinske obrate – lokalna in sezonska živila, pijače ter oskrba več poslovnih enot z ločenimi dostavami za osrednjo kuhinjo";
const tallRowNumber = 44;
const tallArticleDetails = Array.from({ length: 8 }, (_, index) =>
  `TALL-ARTICLE-DETAIL-${String(index + 1).padStart(3, "0")} Complete specification and handling notes for this exceptionally large printed supplier-order item.`,
).join(" ");
const tallSupplierDetails = Array.from({ length: 6 }, (_, index) =>
  `TALL-SUPPLIER-DETAIL-${String(index + 1).padStart(3, "0")} Supplier reference, packaging, origin, and delivery information for this exceptionally large ordered item.`,
).join(" ");
const tallSupplierCode = `TALL-SUPPLIER-CODE-START-${"R7Q".repeat(36)}-TALL-SUPPLIER-CODE-END`;
const lines: SupplierOrderDetail["lines"] = Array.from({ length: lineCount }, (_, index) => {
  const number = index + 1;
  const paddedNumber = String(number).padStart(3, "0");
  const unitPrice = (number % 9) + 1.25;
  const isLongRow = number === 12;
  const isTallRow = number === tallRowNumber;

  return {
    id: number,
    supplierMappingId: 10_000 + number,
    articleId: 20_000 + number,
    articleName: isTallRow
      ? `POSTAVKA-${paddedNumber} TALL-ARTICLE-START ${tallArticleDetails} TALL-ARTICLE-END`
      : isLongRow
      ? `POSTAVKA-${paddedNumber} Izredno dolg naziv artikla za mleko polnomastno v gostinskem pakiranju z dodatno oznako kakovosti in podrobnim opisom`
      : `POSTAVKA-${paddedNumber}`,
    supplierItemName: isTallRow
      ? `TALL-SUPPLIER-START ${tallSupplierDetails} TALL-SUPPLIER-END`
      : isLongRow
      ? "Dobaviteljev artikel mleko polnomastno za profesionalne kuhinje z dodatnim opisom pakiranja in enote za večje gostinske obrate"
      : `KOLICINA-${number}`,
    supplierCode: isTallRow
      ? tallSupplierCode
      : isLongRow
      ? `REF-${paddedNumber}-${"X7Q".repeat(30)}`
      : `REF-${paddedNumber}`,
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
  number: longOrderNumber,
  supplierId: "supplier-print-test",
  supplierName: longSupplierName,
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

const oneRowLine: SupplierOrderDetail["lines"][number] = {
  ...lines[0],
  id: 90_001,
  supplierMappingId: 90_001,
  articleId: 90_001,
  articleName: "ONE-ROW-ARTICLE",
  supplierItemName: "ONE-ROW-SUPPLIER-ITEM",
  supplierCode: "ONE-ROW-SUPPLIER-CODE",
  packageQuantity: 2,
  orderedBaseQuantity: 2,
  openBaseQuantity: 2,
  unitPrice: 3.5,
};
const noInstructionsLine: SupplierOrderDetail["lines"][number] = {
  ...lines[0],
  id: 90_002,
  supplierMappingId: 90_002,
  articleId: 90_002,
  articleName: "NO-INSTRUCTIONS-ARTICLE",
  supplierItemName: "NO-INSTRUCTIONS-SUPPLIER-ITEM",
  supplierCode: "NO-INSTRUCTIONS-SUPPLIER-CODE",
  packageQuantity: 3,
  orderedBaseQuantity: 3,
  openBaseQuantity: 3,
  unitPrice: 1.2,
};
const shortOrders: SupplierOrderDetail[] = [
  {
    ...order,
    id: 949,
    number: "ONE-ROW-ORDER-CASE",
    supplierId: "supplier-one-row-test",
    supplierName: "Enovrstični preizkusni dobavitelj",
    lineCount: 1,
    openQuantity: 2,
    internalNotes: null,
    supplierNotes: "ONE-ROW-SUPPLIER-INSTRUCTION",
    lines: [oneRowLine],
  },
  {
    ...order,
    id: 950,
    number: "EMPTY-ORDER-CASE",
    supplierId: "supplier-empty-test",
    supplierName: "Dobavitelj praznega osnutka",
    lineCount: 0,
    openQuantity: 0,
    internalNotes: null,
    supplierNotes: null,
    lines: [],
  },
  {
    ...order,
    id: 951,
    number: "NO-INSTRUCTIONS-ORDER-CASE",
    supplierId: "supplier-no-instructions-test",
    supplierName: "Dobavitelj brez navodil",
    lineCount: 1,
    openQuantity: 3,
    internalNotes: "INTERNAL-NOTE-MUST-NOT-PRINT",
    supplierNotes: null,
    lines: [noInstructionsLine],
  },
];

const root = document.getElementById("test-root");
if (!root) throw new Error("Print test root is missing.");

createRoot(root).render(
  [order, ...shortOrders].map(printOrder =>
    <SupplierOrderPrintView key={printOrder.id} order={printOrder} />,
  ),
);
