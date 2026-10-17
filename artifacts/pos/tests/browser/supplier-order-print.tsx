import { createRoot } from "react-dom/client";
import type { SupplierOrderDetail } from "@workspace/api-client-react";
import { SupplierOrderPrintView } from "../../src/pages/NarocilaDobaviteljem";
import "../../src/index.css";

const lineCount = 55;
const longOrderNumber = "N-2026-0948-IZREDNO-DOLGA-ŠTEVILKA-NAROČILA-Z-LOKACIJO-RESTAVRACIJA-TRG-REPUBLIKE-001234567890";
const longSupplierName = "Preizkusni dobavitelj za gostinske obrate – lokalna in sezonska živila, pijače ter oskrba več poslovnih enot z ločenimi dostavami za osrednjo kuhinjo";
const lines: SupplierOrderDetail["lines"] = Array.from({ length: lineCount }, (_, index) => {
  const number = index + 1;
  const paddedNumber = String(number).padStart(3, "0");
  const unitPrice = (number % 9) + 1.25;
  const isLongRow = number === 12;

  return {
    id: number,
    supplierMappingId: 10_000 + number,
    articleId: 20_000 + number,
    articleName: isLongRow
      ? `POSTAVKA-${paddedNumber} Izredno dolg naziv artikla za mleko polnomastno v gostinskem pakiranju z dodatno oznako kakovosti in podrobnim opisom`
      : `POSTAVKA-${paddedNumber}`,
    supplierItemName: isLongRow
      ? "Dobaviteljev artikel mleko polnomastno za profesionalne kuhinje z dodatnim opisom pakiranja in enote za večje gostinske obrate"
      : `KOLICINA-${number}`,
    supplierCode: isLongRow
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

const root = document.getElementById("test-root");
if (!root) throw new Error("Print test root is missing.");

createRoot(root).render(<SupplierOrderPrintView order={order} />);
