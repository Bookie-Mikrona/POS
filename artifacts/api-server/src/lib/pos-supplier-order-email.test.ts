import { describe, expect, it } from "vitest";
import { buildSupplierOrderEmail } from "./pos-supplier-order-email";

describe("buildSupplierOrderEmail", () => {
  it("escapes HTML, formats the date and includes only supplier-facing text", () => {
    const { subject, text, html } = buildSupplierOrderEmail({
      number: "N-1",
      supplierName: "D",
      expectedDeliveryDate: "2026-10-20",
      supplierNotes: "Dostava <zjutraj>",
      lines: [{ articleName: "<b>Moka</b>", supplierItemName: null, supplierCode: "A1", packageQuantity: 2, packageName: "vreča", unitPrice: 10 }],
    }, "Gostilna & co");
    expect(subject).toBe("Naročilo N-1 — Gostilna & co");
    expect(text).toContain("20.10.2026");
    expect(html).toContain("&lt;b&gt;Moka&lt;/b&gt;");
    expect(html).toContain("Dostava &lt;zjutraj&gt;");
    expect(html).not.toContain("<b>Moka</b>");
  });

  it("shows the supplier's item name, code and EAN when known", () => {
    const { text, html } = buildSupplierOrderEmail({
      number: "N-2", supplierName: "D", expectedDeliveryDate: null, supplierNotes: null,
      lines: [{ articleName: "Jušna zelenjava", supplierItemName: "Por", supplierCode: "P-1", supplierGtin: "3850123456789", packageQuantity: 3, packageName: "vreča 5 kg", unitPrice: 8 }],
    }, "Gostilna");
    expect(text).toContain("Por [P-1] (EAN 3850123456789)");
    expect(html).toContain("EAN 3850123456789");
  });
});
