import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PorocilaAnalitika from "./porocila-dimenzije";
import type { UntaggedDimensionLine } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  exportExcel: vi.fn(),
  report: {
    rows: [{ id: "1", code: "001", name: "Kuhinja", totalDebit: "10.50", totalCredit: "0", balance: "10.50" }],
    grandTotalDebit: "10.50", grandTotalCredit: "0", grandTotalBalance: "10.50",
    untaggedDebit: "0", untaggedCredit: "0", untaggedBalance: "0", untaggedLines: [] as UntaggedDimensionLine[],
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListAccounts: () => ({ data: { accounts: [] } }),
  useGetDimensionReport: () => ({ data: mocks.report, isLoading: false, error: null }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-1", naziv: "Podjetje d.o.o." } }),
  useSharedCompanyAccess: () => ({ company: { id: "company-1", naziv: "Podjetje d.o.o." }, checking: false, failed: false }),
}));
vi.mock("@/lib/dimensionReportExcel", () => ({ exportDimensionReportExcel: mocks.exportExcel }));

beforeEach(() => {
  window.history.replaceState(null, "", "/porocila/dimenzije");
  Object.assign(mocks.report, {
    untaggedDebit: "0", untaggedCredit: "0", untaggedBalance: "0", untaggedLines: [],
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Gumb Excel analitičnega poročila", () => {
  it("se prikaže ob CSV po prikazu poročila in izvozi trenutne URL filtre poročila", async () => {
    mocks.exportExcel.mockResolvedValue(undefined);
    const { container } = render(<PorocilaAnalitika />);
    expect(screen.queryByRole("button", { name: "Izvozi v Excel" })).not.toBeInTheDocument();
    const dates = container.querySelectorAll('input[type="text"]');
    fireEvent.change(dates[0], { target: { value: "2026-01-01" } });
    fireEvent.change(dates[1], { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
    expect(screen.getByTitle("Izvozi v CSV")).toBeInTheDocument();
    fireEvent.change(dates[0], { target: { value: "2025-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Izvozi v Excel" }));
    await waitFor(() => expect(mocks.exportExcel).toHaveBeenCalledWith(expect.objectContaining({
      rows: mocks.report.rows,
      grandTotalDebit: "10.50",
      grandTotalCredit: "0",
      grandTotalBalance: "10.50",
      untagged: undefined,
      dimensionLabel: "Stroškovna mesta",
      companyName: "Podjetje d.o.o.",
      dateFrom: "2025-01-01",
      dateTo: "2026-01-31",
    })));
  });

  it("posreduje neoznačene vsote ločeno tudi pri ničelnem saldu", async () => {
    Object.assign(mocks.report, {
      untaggedDebit: "30.25", untaggedCredit: "30.25", untaggedBalance: "0",
      untaggedLines: [{
        lineId: "line-1", entryId: "entry-1", entryDate: "2026-01-02",
        reference: "T-1", entryDescription: "Knjižba", accountCode: "4000",
        accountName: "Stroški", description: "", side: "debit", amount: "30.25",
      }],
    });
    mocks.exportExcel.mockResolvedValue(undefined);
    render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
    fireEvent.click(screen.getByRole("button", { name: "Izvozi v Excel" }));
    await waitFor(() => expect(mocks.exportExcel).toHaveBeenCalledWith(expect.objectContaining({
      rows: mocks.report.rows,
      grandTotalDebit: "10.50", grandTotalCredit: "0", grandTotalBalance: "10.50",
      untagged: { debit: "30.25", credit: "30.25", balance: "0" },
    })));
  });

  it("pokaže napako in omogoči ponoven poskus po neuspehu izvoza", async () => {
    mocks.exportExcel.mockRejectedValueOnce(new Error("Izvoz ni na voljo"));
    render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
    fireEvent.click(screen.getByRole("button", { name: "Izvozi v Excel" }));
    expect(await screen.findByText("Izvoz v Excel ni uspel. Poskusite znova.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Izvozi v Excel" })).toBeEnabled();
  });
});
