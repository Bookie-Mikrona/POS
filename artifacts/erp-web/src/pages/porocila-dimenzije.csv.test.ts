import { afterEach, describe, expect, it, vi } from "vitest";
import type { DimensionReportRow } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({}));
vi.mock("@/contexts/CompanyContext", () => ({}));

import { exportCsv } from "./porocila-dimenzije";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function downloadCsv(rows: DimensionReportRow[]) {
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

  exportCsv(rows, "150.50", "20.25", "130.25", "Stroškovna mesta",
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
});
