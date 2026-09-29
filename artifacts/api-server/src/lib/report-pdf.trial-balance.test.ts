import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { generateTrialBalancePdf } from "./report-pdf";

function inspectPdf(buffer: Buffer) {
  const info = spawnSync("pdfinfo", ["-"], { input: buffer, encoding: "utf8" });
  const text = spawnSync("pdftotext", ["-layout", "-", "-"], { input: buffer, encoding: "utf8" });
  expect(info.status, info.stderr).toBe(0);
  expect(text.status, text.stderr).toBe(0);
  return {
    pages: Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]),
    textPages: text.stdout.split("\f").filter((page) => page.trim()),
  };
}

describe("PDF bruto bilance", () => {
  it("puts 65 accounts, totals and correctly numbered footers on two nonempty pages", async () => {
    const rows = Array.from({ length: 65 }, (_, i) => ({
      accountId: String(i),
      accountCode: String(i).padStart(7, "0"),
      accountName: i === 18
        ? `Konto ${i} – naziv, ki je predolg za stolpec in mora ostati na eni vrstici brez prekrivanja drugih kontov`
        : `Konto ${i} – daljši naziv preizkusne vrstice`,
      accountType: "asset",
      openingBalanceDebit: "87.00",
      openingBalanceCredit: "87.00",
      turnoverDebit: "105.00",
      turnoverCredit: "105.00",
      balanceDebit: "192.00",
      balanceCredit: "192.00",
    }));
    const pdf = await generateTrialBalancePdf({
      companyName: "Mikrona d.o.o.", dateFrom: "2025-01-01", dateTo: "2025-12-31",
      rows,
      totalOpeningBalanceDebit: "5655.00", totalOpeningBalanceCredit: "5655.00",
      totalTurnoverDebit: "6825.00", totalTurnoverCredit: "6825.00",
      totalBalanceDebit: "12480.00", totalBalanceCredit: "12480.00",
    });
    const { pages, textPages } = inspectPdf(pdf);
    expect(pages).toBe(2);
    expect(textPages).toHaveLength(pages);
    textPages.forEach((page, index) => {
      expect(page).toContain(`Stran ${index + 1} / ${pages}`);
      expect(page).toContain("Šifra");
      expect(page).toMatch(/^\s*\d{7}\s+Konto \d+/m);
    });
    const accountCodes = textPages.join("\n").match(/^\s*\d{7}\s+Konto \d+/gm) ?? [];
    expect(accountCodes).toHaveLength(65);
    expect(textPages[1]).toContain("SKUPAJ");
    expect(textPages[1]).toContain("Bilanca uravnotežena");
  });

  it("does not add an empty page for a report without postings", async () => {
    const pdf = await generateTrialBalancePdf({
      companyName: "Mikrona d.o.o.", dateFrom: "2025-01-01", dateTo: "2025-12-31",
      rows: [],
      totalOpeningBalanceDebit: "0", totalOpeningBalanceCredit: "0",
      totalTurnoverDebit: "0", totalTurnoverCredit: "0",
      totalBalanceDebit: "0", totalBalanceCredit: "0",
    });
    const { pages, textPages } = inspectPdf(pdf);
    expect(pages).toBe(1);
    expect(textPages[0]).toContain("Stran 1 / 1");
    expect(textPages[0]).toContain("SKUPAJ");
  });
});