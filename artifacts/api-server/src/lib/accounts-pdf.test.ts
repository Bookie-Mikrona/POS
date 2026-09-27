import { describe, expect, it } from "vitest";
import { generateAccountsPdf } from "./accounts-pdf";

describe("generateAccountsPdf", () => {
  it("creates a DejaVu PDF with account rows and pagination", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      code: String(index + 1).padStart(3, "0"),
      name: index === 0 ? "Čisti dobiček in izguba" : `Konto ${index + 1}`,
      type: "asset",
      isActive: index !== 1,
    }));

    const pdf = await generateAccountsPdf(rows);
    const content = pdf.toString("latin1");
    expect(content.startsWith("%PDF-")).toBe(true);
    expect(Number(content.match(/\/Count (\d+)/)?.[1])).toBeGreaterThan(1);
    expect(pdf.length).toBeGreaterThan(5000);
  });
});