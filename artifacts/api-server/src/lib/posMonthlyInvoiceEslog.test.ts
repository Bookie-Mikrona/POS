import { describe, expect, it } from "vitest";
import { create } from "xmlbuilder2";
import { writeFileSync } from "node:fs";
import { monthlyInvoiceEslog } from "./posMonthlyInvoiceEslog";
import type { posMonthlyInvoicesTable } from "@workspace/db";
type Invoice = typeof posMonthlyInvoicesTable.$inferSelect;
const invoice = (): Invoice => ({
  id: "11111111-1111-4111-8111-111111111111", year: 2026, sequence: 1,
  invoiceNumber: "M-POS-2026-000001", invoiceDate: "2026-10-03", dueDate: "2026-10-23",
  month: "2026-09", grossAmount: "705.50",
  snapshot: {
    issuer: { name: "TEST Čičerika & juha", address: "Testna 1, 1000 Ljubljana", taxId: "SI12345678", vatId: "SI12345678", iban: "", bic: "" },
    recipient: { name: "TEST Kupec", address: "Testna 2, 2000 Maribor", taxId: "87654321" },
    unitName: "Test", isTest: true, totalGross: "705.50", totalNet: "643.51", totalVat: "61.99",
    receipts: [{ id: 1, number: "DNEVNI-1", date: "2026-09-01", gross: "705.50" }],
    vatBuckets: [{ rate: "9.5", gross: "700.00", net: "639.00", vat: "61.00" }, { rate: "22", gross: "5.50", net: "4.51", vat: "0.99" }],
    lines: [{ label: "Malica & priloga", rate: "9.5", quantity: "100", gross: "700.00" }, { label: "Pijača", rate: "22", quantity: "1", gross: "5.50" }],
  },
} as Invoice);
describe("Native monthly e-SLOG 2.0", () => {
  it("preserves daily rounding within each rate, exact line totals, real number, dates and receipt references", () => {
    const xml = monthlyInvoiceEslog(invoice());
    const doc = create(xml).end({ format: "object" }) as any;
    const m = doc.Invoice.M_INVOIC;
    expect(m.S_UNH.D_0062.length).toBeLessThanOrEqual(14);
    expect(m.S_BGM.C_C106.D_1004).toBe("M-POS-2026-000001");
    expect(m.G_SG26[0].G_SG27.S_MOA.C_C516.D_5004).toBe("639.00");
    expect(m.G_SG26[1].G_SG27.S_MOA.C_C516.D_5004).toBe("4.51");
    expect(m.G_SG52[0].S_MOA[1].C_C516.D_5004).toBe("61.00");
    expect(m.G_SG8.S_DTM.C_C507.D_2380).toBe("2026-10-23");
    expect(xml).toContain("DNEVNI-1");
    expect(xml).toContain("Čičerika &amp; juha");
    expect(xml).toContain("TESTNI DOKUMENT");
    writeFileSync("/tmp/monthly-eslog-mixed.xml", xml);
  });
  it("supports a non-VAT issuer without inventing a VAT registration", () => {
    const i = invoice();
    i.snapshot.issuer.vatId = null; i.snapshot.issuer.taxId = "12345678";
    i.snapshot.totalNet = i.grossAmount; i.snapshot.totalVat = "0.00";
    i.snapshot.lines = [{ label: "Malice", quantity: "100", rate: "0", gross: "705.50" }];
    i.snapshot.vatBuckets = [{ rate: "0", net: "705.50", gross: "705.50", vat: "0.00" }];
    const xml = monthlyInvoiceEslog(i);
    expect(xml).toContain("<D_5305>O</D_5305>");
    expect(xml).not.toContain("<D_1153>VA</D_1153>");
    writeFileSync("/tmp/monthly-eslog-nonvat.xml", xml);
  });
  it("rejects inconsistent totals instead of silently recalculating an issued document", () => {
    const i = invoice(); i.snapshot.totalNet = "643.50";
    expect(() => monthlyInvoiceEslog(i)).toThrow("niso usklajeni");
  });
});