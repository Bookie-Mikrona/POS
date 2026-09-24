import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { voucherPdf } from "./voucher-pdf";

describe("PDF darilnega bona", () => {
  it("ohrani slovenske znake v gostilni in imenu prejemnika", async () => {
    const pdf = await voucherPdf("Križišče", "Špela Černe Žagar", [
      { code: "DEMO12345", amount: 5000 },
    ]);
    const text = execFileSync("pdftotext", ["-layout", "-", "-"], { input: pdf, encoding: "utf8" });

    expect(text).toContain("Križišče");
    expect(text).toContain("Za: Špela Černe Žagar");
    expect(text).toContain("DEMO12345");
    expect(text).toContain("50,00 €");
  });

  it("doda QR-kodo za vsako posamezno kodo bona in loči bone po straneh", async () => {
    const pdf = await voucherPdf("Križišče", "Špela Černe Žagar", [
      { code: "BON-PRVI-123", amount: 5000 },
      { code: "BON-DRUGI-456", amount: 2750 },
    ]);
    const text = execFileSync("pdftotext", ["-layout", "-", "-"], { input: pdf, encoding: "utf8" });
    const pages = text.split("\f").filter(page => page.trim().length > 0);
    const embeddedImages = pdf.toString("latin1").match(/\/Subtype\s*\/Image\b/g) ?? [];

    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("BON-PRVI-123");
    expect(pages[0]).toContain("50,00 €");
    expect(pages[0]).not.toContain("BON-DRUGI-456");
    expect(pages[1]).toContain("BON-DRUGI-456");
    expect(pages[1]).toContain("27,50 €");
    expect(pages[1]).not.toContain("BON-PRVI-123");
    expect(embeddedImages.length).toBeGreaterThanOrEqual(2);
  });
});