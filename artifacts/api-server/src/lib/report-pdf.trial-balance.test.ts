import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateTrialBalancePdf } from "./report-pdf";

const fixture = JSON.parse(readFileSync(new URL("../../../../tests/fixtures/trial-balance-export.json", import.meta.url), "utf8")) as {
  rows: Parameters<typeof generateTrialBalancePdf>[0]["rows"];
  totals: number[];
};
const fields = ["openingBalanceDebit", "openingBalanceCredit", "turnoverDebit",
  "turnoverCredit", "balanceDebit", "balanceCredit"] as const;
const localized = (value: number) => value.toLocaleString("sl-SI", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

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
  it("keeps opening balances, all numeric columns and repeated headers aligned across 150 accounts", async () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({
      ...fixture.rows[index % 3]!,
      accountId: String(index),
      accountCode: String(1000000 + index),
    }));
    const pdf = await generateTrialBalancePdf({
      companyName: "Preizkus d.o.o.", dateFrom: "2026-01-01", dateTo: "2026-12-31", rows,
      totalOpeningBalanceDebit: (fixture.totals[0]! * 50).toFixed(2),
      totalOpeningBalanceCredit: (fixture.totals[1]! * 50).toFixed(2),
      totalTurnoverDebit: (fixture.totals[2]! * 50).toFixed(2),
      totalTurnoverCredit: (fixture.totals[3]! * 50).toFixed(2),
      totalBalanceDebit: (fixture.totals[4]! * 50).toFixed(2),
      totalBalanceCredit: (fixture.totals[5]! * 50).toFixed(2),
    });
    const { pages, textPages } = inspectPdf(pdf);
    expect(pages).toBe(5);
    const bbox = spawnSync("pdftotext", ["-bbox", "-", "-"], { input: pdf, encoding: "utf8" });
    expect(bbox.status, bbox.stderr).toBe(0);
    const pageXml = [...bbox.stdout.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)];
    expect(pageXml).toHaveLength(pages);
    let accountCount = 0;
    // Right edges of the six gross amounts and the additional net saldo.
    const rightEdges = [345.89, 421.89, 497.89, 573.89, 649.89, 725.89, 801.89];
    pageXml.forEach((page, pageIndex) => {
      expect(Number(page[1])).toBeCloseTo(841.89, 1);
      expect(Number(page[2])).toBeCloseTo(595.28, 1);
      for (const header of ["Šifra", "Naziv konta", "Začetni saldo", "Promet v obdobju", "Skupaj — breme/dobro", "Neto saldo"]) {
        expect(textPages[pageIndex]).toContain(header);
      }
      expect(textPages[pageIndex]).toContain(`Stran ${pageIndex + 1} / ${pages}`);
      const words = [...page[3]!.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
        .map(word => ({ x: Number(word[1]), y: Number(word[2]), right: Number(word[3]), bottom: Number(word[4]), text: word[5]! }));
      const accounts = words.filter(word => /^1000\d{3}$/.test(word.text));
      expect(accounts.length).toBeGreaterThan(0);
      accountCount += accounts.length;
      for (const account of accounts) {
        const row = rows[Number(account.text) - 1000000]!;
        const rowWords = words.filter(word => Math.abs(word.y - account.y) < 1);
        // Account names (including the deliberately long one) stay outside
        // the opening debit cell and never wrap into the next account.
        const nameWords = rowWords.filter(word => word.x >= 97 && word.x < rightEdges[0]! - 72);
        expect(nameWords.length).toBeGreaterThan(0);
        for (const word of nameWords) {
          expect(word.right).toBeLessThan(rightEdges[0]! - 72);
          expect(word.bottom - account.y).toBeLessThan(12);
        }
        const amounts = fields.map(field => Number(row[field]));
        amounts.push(Math.round((amounts[4]! - amounts[5]!) * 100) / 100);
        amounts.forEach((amount, column) => {
          const cell = rowWords.filter(word => Math.abs(word.right - rightEdges[column]!) < 0.1);
          if (column < 6 && amount === 0) {
            expect(cell).toHaveLength(0);
          } else {
            expect(cell).toHaveLength(1);
            expect(cell[0]!.text).toBe(`${column === 6 && amount > 0 ? "+" : ""}${localized(amount)}`);
            expect(cell[0]!.x).toBeGreaterThanOrEqual(rightEdges[column]! - 72);
          }
        });
        expect(account.bottom).toBeLessThan(528.28);
      }
    });
    expect(accountCount).toBe(150);
    const totalsLine = textPages.at(-1)!.split("\n").find(line => line.includes("SKUPAJ"))!;
    expect(totalsLine.trim().split(/\s{2,}/).slice(1)).toEqual(fixture.totals.map(total => localized(total * 50)));
  });

  it.each([
    [30, 1], [31, 2], [34, 2], [35, 2],
    [67, 2], [68, 3], [70, 3], [71, 3],
  ])("keeps totals and balance control together at the %i-account page boundary", async (count, expectedPages) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      ...fixture.rows[2]!, accountId: String(index), accountCode: String(1000000 + index),
    }));
    const pdf = await generateTrialBalancePdf({
      companyName: "Prelom d.o.o.", dateFrom: "2026-01-01", dateTo: "2026-12-31", rows,
      totalOpeningBalanceDebit: (12.34 * count).toFixed(2),
      totalOpeningBalanceCredit: (12.34 * count).toFixed(2),
      totalTurnoverDebit: (56.78 * count).toFixed(2),
      totalTurnoverCredit: (56.78 * count).toFixed(2),
      totalBalanceDebit: (69.12 * count).toFixed(2),
      totalBalanceCredit: (69.12 * count).toFixed(2),
    });
    const { pages, textPages } = inspectPdf(pdf);
    expect(pages).toBe(expectedPages);
    textPages.forEach((page, index) => {
      expect(page).toContain("Začetni saldo");
      expect(page).toContain("Promet v obdobju");
      expect(page).toContain(`Stran ${index + 1} / ${pages}`);
      expect(page).toMatch(/1000\d{3}|SKUPAJ/);
    });
    expect(textPages.join("\n").match(/1000\d{3}/g)).toHaveLength(count);
    expect(textPages.join("\n").match(/SKUPAJ/g)).toHaveLength(1);
    expect(textPages.at(-1)).toContain("SKUPAJ");
    expect(textPages.at(-1)).toContain("Bilanca uravnotežena");
  });

  it.each([undefined, "bilanca", "zakljucni"] as const)(
    "identifies the active class in the %s report heading, even with no matching rows",
    async (statementView) => {
    const pdf = await generateTrialBalancePdf({
      companyName: "Mikrona d.o.o.", dateFrom: "2025-01-01", dateTo: "2025-12-31",
      statementView, accountClass: "0", rows: [],
      totalOpeningBalanceDebit: "0", totalOpeningBalanceCredit: "0",
      totalTurnoverDebit: "0", totalTurnoverCredit: "0",
      totalBalanceDebit: "0", totalBalanceCredit: "0",
    });
    const { pages, textPages } = inspectPdf(pdf);
      expect(pages).toBe(1);
      expect(textPages[0]).toContain("Razred 0");
      expect(textPages[0]).toContain("SKUPAJ");
    },
  );

  it("shows the signed net saldo while preserving the gross closing debit and credit", async () => {
    const rows = [
      {
        accountId: "1", accountCode: "1100000", accountName: "Transakcijski račun", accountType: "asset",
        openingBalanceDebit: "0", openingBalanceCredit: "0", turnoverDebit: "0", turnoverCredit: "0",
        balanceDebit: "23948.52", balanceCredit: "21081.77",
      },
      {
        accountId: "2", accountCode: "1100001", accountName: "Kreditni saldo", accountType: "asset",
        openingBalanceDebit: "0", openingBalanceCredit: "0", turnoverDebit: "0", turnoverCredit: "0",
        balanceDebit: "0", balanceCredit: "125.00",
      },
      {
        accountId: "3", accountCode: "1100002", accountName: "Uravnotežen saldo", accountType: "asset",
        openingBalanceDebit: "0", openingBalanceCredit: "0", turnoverDebit: "0", turnoverCredit: "0",
        balanceDebit: "50.00", balanceCredit: "50.00",
      },
    ];
    const pdf = await generateTrialBalancePdf({
      companyName: "Mikrona d.o.o.", dateFrom: "2025-01-01", dateTo: "2025-12-31",
      rows,
      totalOpeningBalanceDebit: "0", totalOpeningBalanceCredit: "0",
      totalTurnoverDebit: "0", totalTurnoverCredit: "0",
      totalBalanceDebit: "23998.52", totalBalanceCredit: "21256.77",
    });
    const { textPages } = inspectPdf(pdf);
    const text = textPages.join("\n");

    const totals = text.split("\n").find(line => line.includes("SKUPAJ"))!;
    expect(totals).toContain("+2741,75");
    expect(text).toContain("+ breme / − dobro");
    expect(text).toContain("Skupaj — breme/dobro");
    expect(text).toContain("Neto saldo");
    expect(text).toContain("1100000");
    expect(text).toContain("23.948,52");
    expect(text).toContain("21.081,77");
    expect(text).toContain("+2866,75");
    expect(text).toContain("−125,00");
    expect(text).toContain("0,00");
    expect(text).toContain("+2741,75");
    expect(text).not.toContain("-0,00");
    expect(text).not.toContain("Zaključni saldo");
  });

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
