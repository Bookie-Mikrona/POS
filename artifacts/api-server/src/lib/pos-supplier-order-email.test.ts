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
});
