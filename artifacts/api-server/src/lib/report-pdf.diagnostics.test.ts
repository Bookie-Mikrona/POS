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

function inspectGeometry(buffer: Buffer, count: number) {
  const bbox = spawnSync("pdftotext", ["-bbox", "-", "-"], { input: buffer, encoding: "utf8" });
  expect(bbox.status, bbox.stderr).toBe(0);
  const pages = [...bbox.stdout.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)];
  expect(pages).toHaveLength(count);
  return pages.map((page, index) => {
    const width = Number(page[1]);
    const height = Number(page[2]);
    const words = [...page[3]!.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
      .map(word => ({
        x: Number(word[1]), y: Number(word[2]), right: Number(word[3]),
        bottom: Number(word[4]), text: word[5]!,
      }));
    const footer = words.find(word => word.text === "Generirano:");
    const pageNumber = words.find(word => word.text === "Stran");
    expect(footer).toBeDefined();
    expect(pageNumber).toBeDefined();
    expect(footer!.y).toBeCloseTo(height - 45, 1);
    expect(pageNumber!.y).toBeCloseTo(footer!.y, 1);
    const footerWords = words.filter(word => Math.abs(word.y - footer!.y) <= 0.1);
    expect(footerWords.map(word => word.text).join(" ")).toMatch(
      new RegExp(`^Generirano: \\d{1,2}\\.\\s*\\d{1,2}\\.\\s*\\d{4} Stran ${index + 1} / ${count}$`),
    );
    // Include stray body words in the footer zone: filtering them out here
    // would hide exactly the overflow this test is meant to catch.
    const body = words.filter(word =>
      word.y >= (index === 0 ? 95 : 60) && Math.abs(word.y - footer!.y) > 0.1);
    expect(body.length, `page ${index + 1} must not contain only a header/footer`).toBeGreaterThan(0);
    for (const word of body) {
      expect(word.x, word.text).toBeGreaterThanOrEqual(40 - 0.1);
      expect(word.right, word.text).toBeLessThanOrEqual(width - 40 + 0.1);
      expect(word.bottom, word.text).toBeLessThanOrEqual(height - 60);
      expect(word.bottom, word.text).toBeLessThan(footer!.y - 15);
    }
    return { body, height };
  });
}

// Ignore only whitespace introduced by wrapping/chunking, not characters,
// punctuation, order, or repetition. Unique numbered tokens catch lost chunks.
const compact = (text: string) => text.replace(/\s/gu, "");
function longText(prefix: string, spaced: boolean) {
  return Array.from({ length: 190 }, (_, i) => `${prefix}Čšž${String(i).padStart(3, "0")}`)
    .join(spaced ? " " : "");
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
    expect(text.indexOf("OPOZORILA POROČILA")).toBeGreaterThan(text.indexOf("SKUPAJ PASIVA"));
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
  it("prints current income statement warnings after the result, including unknown and empty stored types", async () => {
    const current = {
      revenue: side, expenses: side, netResult: "0.00",
      typeWarnings: [
        { ...warning, code: "4000000", storedType: "legacy", effectiveType: "expense" },
        { ...warning, code: "7000000", storedType: "", effectiveType: "revenue" },
      ],
    };
    const before = structuredClone(current);
    const pdf = await generateIncomeStatementPdf({
      companyName: "PREIZKUS PDF", dateFrom: "2025-01-01", dateTo: "2025-12-31", current,
    });
    const { text } = inspect(pdf);
    expect(text).toContain("Osnovno obdobje: 2025-01-01");
    expect(text).toContain("4000000");
    expect(text).toContain("7000000");
    expect(text).toContain("Shranjeni tip: legacy; uvrščen kot: odhodki");
    expect(text).toContain("Shranjeni tip: manjka; uvrščen kot: prihodki");
    expect(text.indexOf("OPOZORILA POROČILA")).toBeGreaterThan(text.indexOf("POSLOVNI IZID"));
    expect(text).not.toContain("Primerjalno obdobje");
    expect(current).toEqual(before);
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
  it.each([true, false])(
    "preserves >600-character names and reasons across a near-footer chunk break (spaces: %s)",
    async (spaced) => {
      const first = { ...warning, code: "DOLGI-PRVI", name: longText("Prvi", spaced) };
      const last = { ...warning, code: "DOLGI-ZADNJI", name: longText("Zadnji", spaced),
        storedType: "expense", effectiveType: "liability" };
      const account = { ...unresolved, code: "DOLGI-NERAZVRSCEN",
        name: longText("Naziv", spaced), reason: longText("Razlog", spaced), storedType: "equity" };
      for (const value of [first.name, last.name, account.name, account.reason]) {
        expect(value.length).toBeGreaterThan(1800);
        if (!spaced) expect(value).not.toMatch(/\s/u);
      }
      // Eleven short warnings position the first 600-character paragraph block
      // near the bottom of page 1; its continuation must start on page 2.
      const fillers = Array.from({ length: 11 }, (_, i) => ({
        ...warning, code: `PRED-${String(i).padStart(2, "0")}`, name: "Kratek naziv",
      }));
      const pdf = await generateBalanceSheetPdf({
        companyName: "PREIZKUS PDF", asOf: "2025-12-31",
        current: { aktiva: side, pasiva: side,
          typeWarnings: [...fillers, first, last], unclassifiedAccounts: [account] },
      });
      writeFileSync(`/tmp/report-diagnostics-long-${spaced ? "spaced" : "unbroken"}.pdf`, pdf);
      const { text, pages, count } = inspect(pdf);
      const geometry = inspectGeometry(pdf, count);
      expect(count).toBeGreaterThan(2);
      const bodyText = compact(geometry.flatMap(page => page.body.map(word => word.text)).join(""));
      const expectedWarnings = [...fillers, first].map(item =>
        `${item.code} — ${item.name}\nShranjeni tip: prihodki; uvrščen kot: sredstva.`);
      const lastWarning = `${last.code} — ${last.name}\nShranjeni tip: odhodki; uvrščen kot: obveznosti.`;
      for (const paragraph of [...expectedWarnings, lastWarning]) {
        const expected = compact(paragraph);
        expect(bodyText).toContain(expected);
        expect(bodyText.split(expected)).toHaveLength(2);
      }
      const expectedAccount = `${account.code} — ${account.name}\nShranjeni tip: kapital. ${account.reason}\nDebet: 25,00 EUR; kredit: 10,00 EUR; neto (debet − kredit): 15,00 EUR.`;
      expect(bodyText).toContain(compact(expectedAccount));
      expect(bodyText.split(compact(expectedAccount))).toHaveLength(2);
      expect(bodyText.indexOf(compact(lastWarning))).toBeLessThan(bodyText.indexOf(account.code));
      expect(compact(pages.at(-1)!)).toContain(compact("neto (debet − kredit): 15,00 EUR."));
      expect(text.match(/DOLGI-/g)).toHaveLength(3);

      // Assert the boundary from actual glyph positions, not a guessed page
      // count: the name starts in the final block-sized slot and continues
      // immediately below the next page's header.
      expect(pages[0]).toContain(first.code);
      expect(pages[1]).not.toContain(first.code);
      const firstPageEnd = Math.max(...geometry[0]!.body.map(word => word.bottom));
      expect(firstPageEnd).toBeGreaterThan(geometry[0]!.height - 145);
      expect(geometry[1]!.body[0]!.y).toBeCloseTo(60, 1);
      const tailToken = "PrviČšž189";
      expect(compact(pages[0]!)).not.toContain(tailToken);
      expect(bodyText).toContain(tailToken);
    },
  );
  it("does not invent diagnostics for clean reports", async () => {
    for (const pdf of [
      await generateBalanceSheetPdf({ companyName: "PREIZKUS PDF", asOf: "2025-12-31",
        current: { aktiva: side, pasiva: side } }),
      await generateIncomeStatementPdf({ companyName: "PREIZKUS PDF", dateFrom: "2025-01-01",
        dateTo: "2025-12-31", current: { revenue: side, expenses: side, netResult: "0.00" } }),
    ]) expect(inspect(pdf).text).not.toContain("OPOZORILA");
  });
});
