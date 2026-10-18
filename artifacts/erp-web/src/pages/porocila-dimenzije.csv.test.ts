import { afterEach, describe, expect, it, vi } from "vitest";
import type { DimensionReportRow } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({}));
vi.mock("@/contexts/CompanyContext", () => ({}));

import { exportCsv } from "./porocila-dimenzije";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function downloadCsv(rows: DimensionReportRow[], totals = ["150.50", "20.25", "130.25"]) {
  let csv = "";
  vi.stubGlobal("Blob", class {
    constructor(parts: string[]) {
      csv = parts.join("");
    }
  });
  const createUrl = vi.fn(() => "blob:report");
  const revokeUrl = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  exportCsv(rows, totals[0], totals[1], totals[2], "Stroškovna mesta",
    "2026-01-01", "2026-10-17", "400");

  expect(createUrl).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(revokeUrl).toHaveBeenCalledWith("blob:report");
  return csv;
}

const dimension: DimensionReportRow = {
  id: "dim-1",
  code: "SM01",
  name: "Kuhinja",
  totalDebit: "150.50",
  totalCredit: "20.25",
  balance: "130.25",
};

describe("CSV analitičnega poročila", () => {
  it.each([
    "=1+1",
    "+SUM(1,2)",
    "-1+2",
    "@SUM(1,2)",
    '=HYPERLINK("https://example.invalid";"Klik")',
    " =1+1",
    "\t+1+1",
    "\r-1+1",
    "\n@SUM(1,2)",
    "\r\n\t =1+1",
    "\u00a0=1+1",
    "\u0000=1+1",
    "\uFEFF=1+1",
    '=1;";=2',
  ])("nevtralizira formulo v kodi in nazivih dimenzije ter konta: %j", (payload) => {
    const csv = downloadCsv([{
      ...dimension, code: payload, name: payload,
      accounts: [{
        accountId: "acc-1", code: payload, name: payload,
        totalDebit: "0.00", totalCredit: "20.25", balance: "-20.25",
      }],
    }]);
    const safe = `"'${payload.replace(/"/g, '""')}"`;
    expect(csv).toContain(`${safe};${safe};150,50;20,25;130,25`);
    // The account code has a fixed textual prefix and cannot start a formula.
    expect(csv).toContain(`"  > Konto ${payload.replace(/"/g, '""')}";${safe};0,00;20,25;-20,25`);
  });

  it.each(["Čebelica", 'Kuhinja; "živila"', "Več\nvrstic", "SM-01", "a@b.si", "'=1+1", "0012", ""])(
    "ohrani nenevarno besedilo brez dodatnega predznaka: %j", (name) => {
      const csv = downloadCsv([{ ...dimension, name }]);
      expect(csv).toContain(`"SM01";"${name.replace(/"/g, '""')}";150,50;20,25;130,25`);
    },
  );

  it("ohrani negativne zneske dimenzij, kontov in skupnega salda kot neobdane številke", () => {
    const csv = downloadCsv([{
      ...dimension, name: "-20.25", totalDebit: "-150.50", totalCredit: "-20.25", balance: "-130.25",
      accounts: [{
        accountId: "acc-1", code: "400", name: "=1+1",
        totalDebit: "-150.50", totalCredit: "-20.25", balance: "-130.25",
      }],
    }], ["-150.50", "-20.25", "-130.25"]);
    expect(csv.split("\r\n").slice(4)).toEqual([
      `"SM01";"'-20.25";-150,50;-20,25;-130,25`,
      `"  > Konto 400";"'=1+1";-150,50;-20,25;-130,25`,
      '"SKUPAJ";"";-150,50;-20,25;-130,25',
    ]);
  });

  it("izvozi vse konte pod njihovo dimenzijo in ohrani skupni seštevek na koncu", () => {
    const csv = downloadCsv([
      {
        ...dimension,
        accounts: [
          { accountId: "acc-1", code: "400", name: 'Material; "živila"',
            totalDebit: "150.50", totalCredit: "0.00", balance: "150.50" },
          { accountId: "acc-2", code: "401", name: "Popravki",
            totalDebit: "0.00", totalCredit: "20.25", balance: "-20.25" },
        ],
      },
      {
        ...dimension, id: "dim-2", code: "SM02", name: "Bar",
        totalDebit: "0.00", totalCredit: "0.00", balance: "0.00",
        accounts: [{ accountId: "acc-1", code: "400", name: "Material",
          totalDebit: "0.00", totalCredit: "0.00", balance: "0.00" }],
      },
    ]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Konto: 400");
    expect(csv.split("\r\n").slice(4)).toEqual([
      '"SM01";"Kuhinja";150,50;20,25;130,25',
      '"  > Konto 400";"Material; ""živila""";150,50;0,00;150,50',
      '"  > Konto 401";"Popravki";0,00;20,25;-20,25',
      '"SM02";"Bar";0,00;0,00;0,00',
      '"  > Konto 400";"Material";0,00;0,00;0,00',
      '"SKUPAJ";"";150,50;20,25;130,25',
    ]);
  });

  it("podpira manjkajočo ali prazno razčlenitev po kontih", () => {
    const csv = downloadCsv([dimension, { ...dimension, id: "dim-2", accounts: [] }]);
    expect(csv).not.toContain("> Konto");
    expect(csv.split("\r\n").slice(4)).toEqual([
      '"SM01";"Kuhinja";150,50;20,25;130,25',
      '"SM01";"Kuhinja";150,50;20,25;130,25',
      '"SKUPAJ";"";150,50;20,25;130,25',
    ]);
  });

  it("pri praznem poročilu ohrani glavo in zadnjo vrstico SKUPAJ", () => {
    const csv = downloadCsv([]);
    expect(csv.split("\r\n").slice(3)).toEqual([
      '"Koda";"Naziv";"Debet (EUR)";"Kredit (EUR)";"Saldo (EUR)"',
      '"SKUPAJ";"";150,50;20,25;130,25',
    ]);
  });

  // Optional real spreadsheet check; run with LIBREOFFICE_BIN=/path/to/soffice.
  it.skipIf(!process.env.LIBREOFFICE_BIN)(
    "LibreOffice uvozi CSV brez formul in ohrani negativni saldo kot številko tudi v XLSX",
    async () => {
      const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const { pathToFileURL } = await import("node:url");
      const { execFileSync } = await import("node:child_process");
      const { default: ExcelJS } = await import("exceljs");
      const payloads = ["=1+1", "+1+1", "-1+1", "@SUM(1,2)", " \t=1+1",
        '\r\n=1;";=2', 'Čebelica; "živila"\nDruga vrstica'];
      const csv = downloadCsv(payloads.map((name, i) => ({
        ...dimension, id: `dim-${i}`, code: name, name,
        totalDebit: "0.00", totalCredit: "20.25", balance: "-20.25",
        accounts: [{
          accountId: "acc-1", code: "400", name,
          totalDebit: "0.00", totalCredit: "20.25", balance: "-20.25",
        }],
      })), ["0.00", "141.75", "-141.75"]);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      const dir = await mkdtemp(join(tmpdir(), "dimension-csv-"));
      try {
        const source = join(dir, "report.csv");
        await writeFile(source, csv, "utf8");
        execFileSync(process.env.LIBREOFFICE_BIN!, [
          `-env:UserInstallation=${pathToFileURL(join(dir, "profile")).href}`,
          "--headless",
          // UTF-8, semicolon, Slovenian decimal comma; allow formula evaluation
          // and do NOT force quoted cells to text, so escaping itself is tested.
          "--infilter=Text - txt - csv (StarCalc):59,34,76,1,,1060,false,true,false,false,false,0,true",
          "--convert-to", "xlsx", "--outdir", dir, source,
        ], { timeout: 30_000 });
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(join(dir, "report.xlsx"));
        const sheet = workbook.worksheets[0];
        sheet.eachRow(row => row.eachCell(cell => {
          expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
        }));
        for (let i = 0; i < payloads.length; i++) {
          for (const rowNumber of [5 + i * 2, 6 + i * 2]) {
            const row = sheet.getRow(rowNumber);
            expect(row.getCell(2).type).toBe(ExcelJS.ValueType.String);
            // Calc normalizes embedded CRLF and may consume the apostrophe.
            const normalized = payloads[i].replace(/\r\n/g, "\n");
            expect([normalized, `'${normalized}`]).toContain(row.getCell(2).value);
            expect(row.getCell(3).value).toBe(0);
            expect(row.getCell(4).value).toBe(20.25);
            expect(row.getCell(5).value).toBe(-20.25);
          }
        }
        expect(sheet.getRow(19).getCell(5).value).toBe(-141.75);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    40_000,
  );
});
