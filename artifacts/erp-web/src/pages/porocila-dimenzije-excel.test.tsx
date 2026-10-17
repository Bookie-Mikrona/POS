import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PorocilaAnalitika from "./porocila-dimenzije";

const mocks = vi.hoisted(() => ({
  exportExcel: vi.fn(),
  report: {
    rows: [{ id: "1", code: "001", name: "Kuhinja", totalDebit: "10.50", totalCredit: "0", balance: "10.50" }],
    grandTotalDebit: "10.50", grandTotalCredit: "0", grandTotalBalance: "10.50",
    untaggedDebit: "0", untaggedCredit: "0", untaggedBalance: "0",
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useListAccounts: () => ({ data: { accounts: [] } }),
  useGetDimensionReport: () => ({ data: mocks.report, isLoading: false, error: null }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-1", naziv: "Podjetje d.o.o." } }),
}));
vi.mock("@/lib/dimensionReportExcel", () => ({ exportDimensionReportExcel: mocks.exportExcel }));

beforeEach(() => {
  window.history.replaceState(null, "", "/porocila/dimenzije");
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
      dimensionLabel: "Stroškovna mesta",
      companyName: "Podjetje d.o.o.",
      dateFrom: "2025-01-01",
      dateTo: "2026-01-31",
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
