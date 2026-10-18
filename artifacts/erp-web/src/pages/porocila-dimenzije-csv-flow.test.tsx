import "@testing-library/jest-dom";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PorocilaAnalitika from "./porocila-dimenzije";

const mocks = vi.hoisted(() => ({ report: vi.fn() }));

vi.mock("@workspace/api-client-react", () => ({
  useGetDimensionReport: mocks.report,
  useListAccounts: () => ({
    data: { accounts: [
      { id: "acc-1", code: "400", name: "Material" },
      { id: "acc-2", code: "401", name: "Popravki" },
    ] },
  }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-1", naziv: "Podjetje" } }),
  useSharedCompanyAccess: () => ({
    company: { id: "company-1", naziv: "Podjetje" }, checking: false, failed: false,
  }),
}));
// Keep the real filter hook and page handlers; only replace Radix's pointer UI.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

const report = {
  rows: [
    {
      id: "dim-1", code: "SM01", name: "Kuhinja",
      totalDebit: "150.50", totalCredit: "20.25", balance: "130.25",
      accounts: [
        { accountId: "acc-1", code: "400", name: 'Material; "živila"',
          totalDebit: "150.50", totalCredit: "0.00", balance: "150.50" },
        { accountId: "acc-2", code: "401", name: "Popravki",
          totalDebit: "0.00", totalCredit: "20.25", balance: "-20.25" },
      ],
    },
    {
      id: "dim-2", code: "SM02", name: "Bar",
      totalDebit: "50.00", totalCredit: "0.00", balance: "50.00",
      accounts: [{ accountId: "acc-1", code: "400", name: "Material za bar",
        totalDebit: "50.00", totalCredit: "0.00", balance: "50.00" }],
    },
  ],
  grandTotalDebit: "200.50", grandTotalCredit: "20.25", grandTotalBalance: "180.25",
  untaggedDebit: "0", untaggedCredit: "0", untaggedBalance: "0", untaggedLines: [],
};

const expectedRows = [
  '"SM01";"Kuhinja";150,50;20,25;130,25',
  '"  > Konto 400";"Material; ""živila""";150,50;0,00;150,50',
  '"  > Konto 401";"Popravki";0,00;20,25;-20,25',
  '"SM02";"Bar";50,00;0,00;50,00',
  '"  > Konto 400";"Material za bar";50,00;0,00;50,00',
  '"SKUPAJ";"";200,50;20,25;180,25',
];

let downloaded: { blob: Blob; filename: string; href: string } | undefined;
const createUrl = vi.fn();
const revokeUrl = vi.fn();

beforeEach(() => {
  window.history.replaceState(null, "", "/porocila/dimenzije");
  downloaded = undefined;
  mocks.report.mockImplementation((_company, filters, options) => {
    const ready = options.query.enabled && filters.dimensionType === "costCenter"
      && filters.dateFrom === "2026-01-01" && filters.dateTo === "2026-01-31"
      && filters.accountId === "acc-1";
    return { data: ready ? report : undefined, isLoading: options.query.enabled && !ready, error: null };
  });
  createUrl.mockImplementation((blob: Blob) => {
    downloaded = { blob, filename: "", href: "" };
    return "blob:dimension-csv";
  });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloaded!.filename = this.download;
    downloaded!.href = this.href;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function generateReport() {
  const page = render(<PorocilaAnalitika />);
  expect(screen.queryByTitle("Izvozi v CSV")).not.toBeInTheDocument();
  const dates = page.container.querySelectorAll("input");
  fireEvent.change(dates[0], { target: { value: "2026-01-01" } });
  fireEvent.change(dates[1], { target: { value: "2026-01-31" } });
  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "acc-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
  expect(mocks.report).toHaveBeenLastCalledWith("company-1", {
    dimensionType: "costCenter", dateFrom: "2026-01-01", dateTo: "2026-01-31",
    accountId: "acc-1", groupBy: "account",
  }, { query: { enabled: true } });
  expect(screen.getByRole("button", { name: "Razširi vse" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("Kuhinja")).toBeInTheDocument();
  for (const name of ['Material; "živila"', "Popravki", "Material za bar"]) {
    expect(screen.queryByText(name)).not.toBeInTheDocument();
  }
  return dates;
}

async function expectDownloadedReport() {
  fireEvent.click(screen.getByTitle("Izvozi v CSV"));
  expect(createUrl).toHaveBeenCalledOnce();
  expect(downloaded!.filename).toBe("porocilo_dimenzije_Stroškovna_mesta_2026-01-01_2026-01-31.csv");
  expect(downloaded!.href).toBe("blob:dimension-csv");
  expect(downloaded!.blob.type).toBe("text/csv;charset=utf-8;");
  // Read the actual Blob handed to the download, not an exportCsv mock.
  const csv = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(downloaded!.blob);
  });
  // FileReader strips the UTF-8 BOM.
  expect(csv.replace(/^\uFEFF/, "").split("\r\n")).toEqual([
    '"Analitično računovodstvo — Stroškovna mesta"',
    '"Obdobje: 01.01.2026 – 31.01.2026 | Konto: 400"',
    "",
    '"Koda";"Naziv";"Debet (EUR)";"Kredit (EUR)";"Saldo (EUR)"',
    ...expectedRows,
  ]);
  expect(revokeUrl).toHaveBeenCalledWith("blob:dimension-csv");
}

describe("CSV download from the dimension report page", () => {
  it("downloads every account under its collapsed dimension, with SKUPAJ last", async () => {
    generateReport();
    await expectDownloadedReport();
    expect(screen.getByRole("button", { name: "Razširi vse" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Material za bar")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps the last displayed data and metadata while edited filters await a new report (placeholder: %s)", async (placeholder) => {
    const dates = generateReport();
    if (placeholder) {
      mocks.report.mockReturnValue({
        data: report, isLoading: false, isPlaceholderData: true, error: null,
      });
    }
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "project" } });
    fireEvent.change(dates[0], { target: { value: "2025-02-01" } });
    fireEvent.change(dates[1], { target: { value: "2025-02-28" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "acc-2" } });
    expect(mocks.report).toHaveBeenLastCalledWith("company-1", {
      dimensionType: "project", dateFrom: "2025-02-01", dateTo: "2025-02-28",
      accountId: "acc-2", groupBy: "account",
    }, { query: { enabled: true } });
    // No second click on "Prikaži poročilo", and no response for the new filters.
    await expectDownloadedReport();
  });

  it("replaces both CSV data and metadata when the next report arrives", async () => {
    const dates = generateReport();
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "project" } });
    fireEvent.change(dates[0], { target: { value: "2025-02-01" } });
    fireEvent.change(dates[1], { target: { value: "2025-02-28" } });
    const nextReport = {
      ...report,
      rows: [{
        id: "project-1", code: "P01", name: "Novi projekt",
        totalDebit: "7.25", totalCredit: "0.00", balance: "7.25",
        accounts: [{ accountId: "acc-2", code: "401", name: "Projektni stroški",
          totalDebit: "7.25", totalCredit: "0.00", balance: "7.25" }],
      }],
      grandTotalDebit: "7.25", grandTotalCredit: "0.00", grandTotalBalance: "7.25",
    };
    mocks.report.mockReturnValue({ data: nextReport, isLoading: false, error: null });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "acc-2" } });
    expect(screen.getByText("Novi projekt")).toBeInTheDocument();
    expect(screen.queryByText("Projektni stroški")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Izvozi v CSV"));
    expect(downloaded!.filename).toBe("porocilo_dimenzije_Projekti_2025-02-01_2025-02-28.csv");
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(downloaded!.blob);
    });
    expect(csv.replace(/^\uFEFF/, "").split("\r\n")).toEqual([
      '"Analitično računovodstvo — Projekti"',
      '"Obdobje: 01.02.2025 – 28.02.2025 | Konto: 401"',
      "",
      '"Koda";"Naziv";"Debet (EUR)";"Kredit (EUR)";"Saldo (EUR)"',
      '"P01";"Novi projekt";7,25;0,00;7,25',
      '"  > Konto 401";"Projektni stroški";7,25;0,00;7,25',
      '"SKUPAJ";"";7,25;0,00;7,25',
    ]);
  });
});
