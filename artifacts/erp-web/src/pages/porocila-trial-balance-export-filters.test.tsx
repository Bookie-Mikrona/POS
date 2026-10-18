import "@testing-library/jest-dom";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Porocila from "./porocila";

const state = vi.hoisted(() => ({
  getToken: vi.fn(),
  company: { id: "company-export-filters", naziv: "Filtri d.o.o.", role: "accountant" },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetBalanceSheet: () => ({ data: undefined }),
  useGetIncomeStatement: () => ({ data: undefined }),
  useGetTrialBalance: () => ({
    data: {
      rows: [{
        accountId: "bank", accountCode: "1100000", accountName: "Banka",
        accountType: "asset", openingBalanceDebit: "0", openingBalanceCredit: "0",
        turnoverDebit: "100", turnoverCredit: "0", balanceDebit: "100", balanceCredit: "0",
      }],
      totalTurnoverDebit: "100", totalTurnoverCredit: "0",
    },
    isFetching: false, isError: false, error: null,
  }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.company }),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: state.getToken, userId: "export-filters-user" }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

describe.each(["PDF", "E-pošta"] as const)("Bruto bilanca – filtri gumba %s", (action) => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

  beforeEach(() => {
    localStorage.clear();
    // A stale global selection must not override the active company.
    localStorage.setItem("activeCompanyId", "another-company");
    state.getToken.mockResolvedValue("export-filters-token");
    // All requests, including email delivery, stop here; no external service is used.
    fetchMock = vi.fn(async () => new Response(
      action === "PDF" ? "%PDF-1.4\n%%EOF" : JSON.stringify({ success: true }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:export-filters");
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true, value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (scrollDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    localStorage.clear();
  });

  async function selectClass(label: string) {
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: label }));
  }

  async function exportReport() {
    fireEvent.click(screen.getByRole("button", { name: action }));
    if (action === "E-pošta") {
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("E-poštni naslov prejemnika"), {
        target: { value: "reports@example.test" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Pošlji" }));
      await within(dialog).findByText("E-pošta je bila uspešno poslana!");
      fireEvent.click(within(dialog).getByRole("button", { name: "Zapri" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    } else {
      await waitFor(() => expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled());
    }
  }

  function expectRequest(number: number, params: Record<string, string>) {
    expect(fetchMock).toHaveBeenCalledTimes(number);
    const [url, init] = fetchMock.mock.calls[number - 1] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/companies/${state.company.id}/reports/export`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer export-filters-token",
      ...(action === "E-pošta" ? {
        "Idempotency-Key": expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      } : {}),
    });
    expect(JSON.parse(init.body as string)).toEqual({
      reportType: "trial-balance",
      ...(action === "E-pošta" ? { email: "reports@example.test" } : {}),
      ...params,
    });
  }

  it.each(["2026-02-01", ""])(
    "pošlje uporabljeno obdobje (od: '%s'), trenutne filtre in odstrani opuščene filtre",
    async (dateFrom) => {
      render(<Porocila />);
      const tab = screen.getByRole("tab", { name: "Bilanca kontov / zaključni račun" });
      fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
      fireEvent.click(tab);
      fireEvent.change(screen.getByLabelText("Datum od"), { target: { value: dateFrom } });
      fireEvent.change(screen.getByLabelText("Datum do"), { target: { value: "2026-06-30" } });
      fireEvent.click(screen.getByRole("button", { name: "Prikaži" }));

      // Unsubmitted dates must not replace the period of the displayed report.
      fireEvent.change(screen.getByLabelText("Datum od"), { target: { value: "2025-01-01" } });
      fireEvent.change(screen.getByLabelText("Datum do"), { target: { value: "2025-12-31" } });
      await selectClass("Razred 1");
      fireEvent.change(screen.getByLabelText("Iskanje konta"), { target: { value: "  Banka  " } });
      await exportReport();
      const period = { dateFrom, dateTo: "2026-06-30" };
      expectRequest(1, { ...period, accountClass: "1", searchTerm: "Banka" });

      // Resetting only the class preserves the independent search filter.
      await selectClass("Vsi razredi");
      await exportReport();
      expectRequest(2, { ...period, searchTerm: "Banka" });

      fireEvent.change(screen.getByLabelText("Iskanje konta"), { target: { value: "   " } });
      await exportReport();
      expectRequest(3, period);
      expect(state.getToken).toHaveBeenCalledTimes(3);
    },
  );
});
