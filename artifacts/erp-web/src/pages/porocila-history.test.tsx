import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Porocila from "./porocila";

vi.mock("@workspace/api-client-react", () => ({
  useGetBalanceSheet: () => ({}),
  useGetIncomeStatement: () => ({}),
  useGetTrialBalance: () => ({}),
  useListPeriods: () => ({}),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-a", naziv: "Test", role: "accountant" } }),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows the exporter name or unknown-user label beside the date in export history", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ exports: [
      { id: "1", exportedBy: "user-private-id", exportedByName: "Ana Novak" },
      { id: "2", exportedBy: "user-deleted", exportedByName: "Neznan uporabnik" },
    ].map((record) => ({
      ...record, reportType: "balance-sheet", params: { asOf: "2026-01-01" },
      filename: "report.pdf", exportedAt: "2026-01-01T12:00:00Z", emailSentTo: null,
    })) }),
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Porocila />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: /Zgodovina/ }), { button: 0, ctrlKey: false });
  const name = await screen.findByText("Ana Novak");
  const row = name.closest("tr")!;
  expect(within(row).getAllByRole("cell")[1]).toHaveTextContent("Ana Novak");
  expect(screen.getByRole("columnheader", { name: "Izvozil/a" })).toBeInTheDocument();
  expect(screen.getByText("Neznan uporabnik")).toBeInTheDocument();
  expect(screen.queryByText("user-private-id")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/companies/company-a/reports/export/history", {
    headers: { Authorization: "Bearer test-token" },
  });
});
