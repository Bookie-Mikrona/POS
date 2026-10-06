import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateBalanceSheetPdf, generateIncomeStatementPdf } from "./report-pdf";

function inspect(buffer: Buffer) {
  const info = spawnSync("pdfinfo", ["-"], { input: buffer, encoding: "utf8" });
  const text = spawnSync("pdftotext", ["-layout", "-", "-"], { input: buffer, encoding: "utf8" });
  expect(info.status, info.stderr).toBe(0);
  expect(text.status, text.stderr).toBe(0);
  const count = Number(info.stdout.match(/^Pages:\s+(\d+)/m)?.[1]);
  const pages = text.stdout.split("\f").filter(page => page.trim());
  expect(pages).toHaveLength(count);
  pages.forEach((page, index) => {
    expect(page).toContain(`Stran ${index + 1} / ${count}`);
    expect(page.match(/Stran \d+ \/ \d+/g)).toHaveLength(1);
  });
  return { text: pages.join("\n"), pages, count };
}
const side = { sections: [], total: "100.00" };
const warning = { code: "0400000", name: "Napačno označena sredstva",
  storedType: "revenue", effectiveType: "asset" };
const unresolved = { code: "X123", name: "Nerazvrščeni šumniki čšž", storedType: null,
  reason: "Manjka tip konta.", debit: 25, credit: 10, net: 15 };

describe("report PDF classification diagnostics", () => {
  it("includes current and comparison warnings, unresolved amounts and unchanged totals", async () => {
    const current = { aktiva: side, pasiva: side, typeWarnings: [warning,
      { ...warning, code: "0100000", storedType: null }], unclassifiedAccounts: [unresolved] };
    const before = structuredClone(current);
    const pdf = await generateBalanceSheetPdf({
      companyName: "PREIZKUS PDF", asOf: "2025-12-31", compareAsOf: "2024-12-31",
      current, compare: { aktiva: side, pasiva: side,
        typeWarnings: [{ ...warning, code: "0410000", name: "Primerjalni konto" }] },
    });
    const { text } = inspect(pdf);
    expect(text).toContain("Poročilo vsebuje opozorila");
    expect(text).toContain("Osnovno poročilo: 2025-12-31");
    expect(text).toContain("Primerjalno poročilo: 2024-12-31");
    expect(text).toContain("0400000");
    expect(text).toContain("0410000");
    expect(text).toContain("Shranjeni tip: prihodki; uvrščen kot: sredstva");
    expect(text).toContain("Shranjeni tip: manjka; uvrščen kot: sredstva");
    expect(text).toContain("X123");
    expect(text).toContain("25,00 EUR");
    expect(text).toContain("10,00 EUR");
    expect(text).toContain("15,00 EUR");
    expect(text).toContain("niso vključeni");
    expect(current).toEqual(before);
    writeFileSync("/tmp/report-diagnostics-example.pdf", pdf);
  });
  it("includes comparison-only income statement diagnostics with the correct period", async () => {
    const current = { revenue: side, expenses: side, netResult: "0.00" };
    const pdf = await generateIncomeStatementPdf({
      companyName: "PREIZKUS PDF", dateFrom: "2025-01-01", dateTo: "2025-12-31",
      compareDateFrom: "2024-01-01", compareDateTo: "2024-12-31", current,
      compare: { ...current, typeWarnings: [{ ...warning, code: "7600000", effectiveType: "revenue" }],
        unclassifiedAccounts: [unresolved] },
    });
    const { text } = inspect(pdf);
    expect(text).toContain("Poročilo vsebuje opozorila");
    expect(text).toContain("Primerjalno obdobje: 2024-01-01");
    expect(text).toContain("7600000");
    expect(text).toContain("NERAZVRŠČENI KONTI");
    expect(text).not.toContain("OPOZORILA POROČILA — Osnovno");
  });
  it("keeps every warning on multipage PDFs, with no footer-only pages", async () => {
    const typeWarnings = Array.from({ length: 75 }, (_, i) => ({
      ...warning, code: `KONTO-${String(i).padStart(3, "0")}`,
      name: "Daljši naziv konta s šumniki čšž ".repeat(7),
    }));
    const pdf = await generateBalanceSheetPdf({
      companyName: "PREIZKUS PDF", asOf: "2025-12-31",
      current: { aktiva: side, pasiva: side, typeWarnings },
    });
    const { text, pages, count } = inspect(pdf);
    expect(count).toBeGreaterThan(2);
    for (const item of typeWarnings) expect(text).toContain(item.code);
    for (const page of pages.slice(1)) expect(page).toContain("KONTO-");
    writeFileSync("/tmp/report-diagnostics-many.pdf", pdf);
  });
  it("does not invent diagnostics for clean reports", async () => {
    for (const pdf of [
      await generateBalanceSheetPdf({ companyName: "PREIZKUS PDF", asOf: "2025-12-31",
        current: { aktiva: side, pasiva: side } }),
      await generateIncomeStatementPdf({ companyName: "PREIZKUS PDF", dateFrom: "2025-01-01",
        dateTo: "2025-12-31", current: { revenue: side, expenses: side, netResult: "0.00" } }),
    ]) expect(inspect(pdf).text).not.toContain("OPOZORILA");
  });
});
