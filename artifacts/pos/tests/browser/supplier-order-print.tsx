import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import type { SupplierOrderDetail } from "@workspace/api-client-react";
import { SupplierOrderPrintView } from "../../src/pages/NarocilaDobaviteljem";
import { ReceiptPrintDocument } from "../../src/pages/Zaloge";
import "../../src/index.css";

const lineCount = 60;
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

const oversizedArticleDetails = Array.from({ length: 120 }, (_, index) =>
  `OVERSIZED-ARTICLE-DETAIL-${String(index + 1).padStart(3, "0")} Complete product specification, storage requirements, handling instructions, quality certification, and delivery preparation information.`,
).join(" ");
const oversizedSupplierDetails = Array.from({ length: 80 }, (_, index) =>
  `OVERSIZED-SUPPLIER-DETAIL-${String(index + 1).padStart(3, "0")} Supplier item reference, package description, origin, quality assurance, delivery instructions, and product traceability details.`,
).join(" ");
const oversizedSupplierCode =
  `OVERSIZED-SUPPLIER-CODE-START-${"R7Q".repeat(300)}-OVERSIZED-SUPPLIER-CODE-END`;
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

const oversizedRowLine: SupplierOrderDetail["lines"][number] = {
  ...lines[0],
  id: 90_003,
  supplierMappingId: 90_003,
  articleId: 90_003,
  articleName: `OVERSIZED-ARTICLE-START ${oversizedArticleDetails} OVERSIZED-ARTICLE-END`,
  supplierItemName: `OVERSIZED-SUPPLIER-START ${oversizedSupplierDetails} OVERSIZED-SUPPLIER-END`,
  supplierCode: oversizedSupplierCode,
  packageQuantity: 7,
  orderedBaseQuantity: 7,
  openBaseQuantity: 7,
  unitPrice: 4.25,
};
const mixedPricedLine: SupplierOrderDetail["lines"][number] = {
  ...oneRowLine,
  id: 90_004,
  supplierMappingId: 90_004,
  articleId: 90_004,
  articleName: "MIXED-PRICED-ARTICLE",
  supplierItemName: "MIXED-PRICED-SUPPLIER-ITEM",
  supplierCode: "MIXED-PRICED-SUPPLIER-CODE",
};
const mixedUnpricedLine: SupplierOrderDetail["lines"][number] = {
  ...oneRowLine,
  id: 90_005,
  supplierMappingId: 90_005,
  articleId: 90_005,
  articleName: "MIXED-UNPRICED-ARTICLE",
  supplierItemName: "MIXED-UNPRICED-SUPPLIER-ITEM",
  supplierCode: "MIXED-UNPRICED-SUPPLIER-CODE",
  packageQuantity: 4,
  orderedBaseQuantity: 4,
  openBaseQuantity: 4,
  unitPrice: null,
};
const fullyUnpricedLine: SupplierOrderDetail["lines"][number] = {
  ...mixedUnpricedLine,
  id: 90_006,
  supplierMappingId: 90_006,
  articleId: 90_006,
  articleName: "FULLY-UNPRICED-ARTICLE",
  supplierItemName: "FULLY-UNPRICED-SUPPLIER-ITEM",
  supplierCode: "FULLY-UNPRICED-SUPPLIER-CODE",
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
  {
    ...order,
    id: 952,
    number: "MIXED-PRICED-ORDER-CASE",
    supplierId: "supplier-mixed-priced-test",
    supplierName: "Dobavitelj z določenimi in manjkajočimi cenami",
    lineCount: 2,
    openQuantity: 6,
    internalNotes: null,
    supplierNotes: null,
    lines: [mixedPricedLine, mixedUnpricedLine],
  },
  {
    ...order,
    id: 953,
    number: "FULLY-UNPRICED-ORDER-CASE",
    supplierId: "supplier-fully-unpriced-test",
    supplierName: "Dobavitelj brez določenih cen",
    lineCount: 1,
    openQuantity: 4,
    internalNotes: null,
    supplierNotes: null,
    lines: [fullyUnpricedLine],
  },
  {
    ...order,
    id: 954,
    number: "OVERSIZED-ROW-ORDER-CASE",
    supplierId: "supplier-oversized-row-test",
    supplierName: "Dobavitelj postavke višje od tiskalne strani",
    lineCount: 1,
    openQuantity: 7,
    internalNotes: null,
    supplierNotes: null,
    lines: [oversizedRowLine],
  },
];

const receiptItemCount = 42;
const receiptCostCount = 28;

const receiptSummaryFields = [
  { id: "supplier", label: "Dobavitelj", value: "Mlekarna s slovenskimi ekološkimi izdelki" },
  { id: "receipt-date", label: "Datum prejema", value: "18. oktober 2026" },
  { id: "document-number", label: "Številka dokumenta", value: "DOB-2026-1007" },
];

const receiptLines = Array.from({ length: receiptItemCount }, (_, index) => {
  const number = index + 1;
  const marker = `PREJEMNICA-POSTAVKA-${String(number).padStart(3, "0")}`;
  const unitPrice = 2.35 + number / 10;
  const amount = unitPrice * 2;
  const vatRate = number % 2 === 0 ? 9.5 : 22;
  const vatAmount = amount * vatRate / 100;
  return {
    id: 70_000 + number,
    artikelIme: `${marker} Ekološko polnomastno slovensko mleko za profesionalne kuhinje, z natančno navedbo porekla, načina pridelave in ustreznega gostinskega pakiranja`,
    izvNaziv: `Dobaviteljev naziv: mleko izbrane kakovosti za gostinstvo ${String(number).padStart(3, "0")}`,
    enotaMere: "L",
    kolicina: "2",
    cenaKos: unitPrice.toFixed(2),
    skupaj: amount.toFixed(2),
    ddvStopnja: String(vatRate),
    ddvZnesek: vatAmount.toFixed(2),
  };
});

const receiptCosts = Array.from({ length: receiptCostCount }, (_, index) => {
  const number = index + 1;
  return {
    id: 80_000 + number,
    naziv: `PREJEMNICA-STROSEK-${String(number).padStart(3, "0")} Dostava in odvisni stroški manipulacije ter hlajenja`,
    ddvStopnja: "22",
    obravnava: number % 2 === 0 ? "zaloga" : "strosek",
    znesek: (3.41 + number / 10).toFixed(2),
  };
});

const confirmedReceipt = {
  id: 10_007,
  stevilka: "PREJEMNICA-DOLGA-2026-1007",
  valuta: "EUR",
  prejemnoPodjetjeNaziv: "Gostilna Pri Mostu d.o.o.",
  postavke: receiptLines,
  odvisniStroski: receiptCosts,
};

const root = document.getElementById("test-root");
if (!root) throw new Error("Print test root is missing.");

const shortOnly = new URLSearchParams(window.location.search).get("shortOnly") === "true";
createRoot(root).render(
  <>
    {(shortOnly ? shortOrders.slice(0, 3) : [order, ...shortOrders]).map(printOrder =>
      <SupplierOrderPrintView key={printOrder.id} order={printOrder} />,
    )}
    {!shortOnly && createPortal(
      <ReceiptPrintDocument
        receipt={confirmedReceipt}
        summaryFields={receiptSummaryFields}
        postavke={receiptLines}
        odvisniStroski={receiptCosts}
        currency="EUR"
      />,
      document.body,
    )}
  </>,
);
