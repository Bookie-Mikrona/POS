import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company" } }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListAccounts: () => ({ data: { accounts: [] } }),
  useListPeriods: () => ({ data: { periods: [] } }),
  useGetLedger: () => ({
    data: {
      totalDebit: "100.00", totalCredit: "100.00",
      lines: [
        { entryId: "original", entryDate: "2026-01-01", description: "Izvorna knjižba",
          accountCode: "1100", accountName: "TRR", debit: "100.00", credit: "0.00",
          runningBalance: "100.00", isReversal: false, reversalOf: null, isReversed: true, reversedBy: "reversal" },
        { entryId: "reversal", entryDate: "2026-02-01", description: "Razveljavitev",
          accountCode: "1100", accountName: "TRR", debit: "0.00", credit: "100.00",
          runningBalance: "0.00", isReversal: true, reversalOf: "original", isReversed: false, reversedBy: null },
      ],
    },
    isLoading: false,
  }),
}));

import GlavnaKnjiga from "./glavna-knjiga";

afterEach(cleanup);

describe("glavna knjiga storno", () => {
  it("distinguishes reversed originals from reversals and preserves amounts and balance", () => {
    const { container } = render(<GlavnaKnjiga />);
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Išči" }));

    const original = within(screen.getByText("Izvorna knjižba").closest("tr")!);
    expect(original.getByText("01.01.2026")).toBeVisible();
    expect(screen.getAllByPlaceholderText("dd.mm.yyyy")[0]).toHaveValue("01.01.2026");
    expect(original.queryByText("STORNO")).not.toBeInTheDocument();
    expect(original.getByText("STORNIRANO")).toBeVisible();
    expect(original.getByRole("link", { name: "Storno" })).toHaveAttribute("href", "/temeljnice?id=reversal");
    const reversal = within(screen.getByText("Razveljavitev").closest("tr")!);
    expect(reversal.getByText("01.02.2026")).toBeVisible();
    expect(reversal.getByText("STORNO")).toBeVisible();
    expect(reversal.getByRole("link", { name: "Original" })).toHaveAttribute("href", "/temeljnice?id=original");
    expect(reversal.getByText("100.00")).toBeVisible();
    expect(reversal.getByText("0.00")).toBeVisible();
  });
});