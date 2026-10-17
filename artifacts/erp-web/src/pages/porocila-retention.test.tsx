import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Porocila from "./porocila";

vi.mock("@workspace/api-client-react", () => ({
  useGetBalanceSheet: () => ({ data: undefined }),
  useGetIncomeStatement: () => ({ data: undefined }),
  useGetTrialBalance: () => ({ data: undefined }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-retention", naziv: "Test", role: "admin" } }),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => "test-token" }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Vidnost politike hrambe izvozov", () => {
  it("prikaže dejansko nastavitev strežnika tudi ob prazni zgodovini", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ exports: [], retentionDays: 30 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Porocila />);
    const tab = screen.getByRole("tab", { name: "Zgodovina izvozov" });
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(tab);
    expect(await screen.findByText("Doba hrambe izvozov: 30 dni")).toBeInTheDocument();
    expect(screen.getByText(/Starejši izvozi in shranjeni PDF-ji se samodejno trajno izbrišejo/)).toBeInTheDocument();
    expect(screen.getByText("Ni še nobenih izvozov za to podjetje.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/companies/company-retention/reports/export/history"),
      expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }),
    );
  });
});
