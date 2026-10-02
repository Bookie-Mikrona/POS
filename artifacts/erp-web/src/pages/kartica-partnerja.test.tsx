import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ledger: vi.fn(), pdf: vi.fn(), refetch: vi.fn(), detail: vi.fn(),
  company: { id: "company-a", role: "owner" },
}));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: () => ({ activeCompany: mocks.company }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetPartnerLedger: mocks.ledger,
  getPartnerLedgerPdf: mocks.pdf,
  useListCounterparties: () => ({ data: { counterparties: [{ id: "partner-a", name: "Partner A" }] } }),
  useListAccounts: () => ({ data: { accounts: [
    { id: "account-a", code: "1200", name: "Terjatve", isOpenItem: true },
    { id: "account-cost", code: "4000", name: "Stroški", isOpenItem: false },
    { id: "account-group", code: "120", name: "Skupinski", isOpenItem: true, allowsPosting: false },
    { id: "account-inactive", code: "2200", name: "Neaktiven", isOpenItem: true, isActive: false },
  ] } }),
}));
vi.mock("@/components/partner-ledger-dialogs", () => ({
  DetailDialog: mocks.detail, SettleDialog: () => null, errMsg: (error: Error) => error.message,
}));

import KarticaPartnerja from "./kartica-partnerja";

beforeEach(() => {
  mocks.company = { id: "company-a", role: "owner" };
  mocks.ledger.mockReset();
  mocks.refetch.mockReset();
  mocks.pdf.mockReset();
  mocks.detail.mockReset().mockReturnValue(null);
  mocks.ledger.mockReturnValue({
    data: { lines: [], openingBalances: [] }, isLoading: false, isFetching: false,
    error: null, refetch: mocks.refetch,
  });
  window.history.replaceState(null, "", "/kartica-partnerja");
});
afterEach(cleanup);

function enabled() {
  return mocks.ledger.mock.lastCall?.[2]?.query.enabled;
}

describe("obvezni filtri kartice partnerja", () => {
  it("ne dovoli prikaza s predizbranim kontom, ki ni saldakontni ali izbiren", () => {
    for (const account of ["account-cost", "account-group", "account-inactive"]) {
      window.history.replaceState(null, "", `/kartica-partnerja?partnerId=partner-a&accountId=${account}`);
      const view = render(<KarticaPartnerja />);
      expect(enabled()).toBe(false);
      expect(screen.getByRole("button", { name: "Prikaži kartico" })).toBeDisabled();
      expect(screen.getByLabelText("Konto")).toHaveTextContent("Izberite konto");
      view.unmount();
    }
  });
  it.each(["", "?partnerId=partner-a", "?accountId=account-a"])(
    "brez obeh filtrov ne naloži kartice niti ne omogoči PDF: %s",
    query => {
      window.history.replaceState(null, "", `/kartica-partnerja${query}`);
      render(<KarticaPartnerja />);
      expect(enabled()).toBe(false);
      expect(screen.getByText("Najprej določite filtre")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Prikaži kartico" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
      expect(screen.queryByText("Ni postavk")).not.toBeInTheDocument();
      expect(mocks.refetch).not.toHaveBeenCalled();
      expect(mocks.pdf).not.toHaveBeenCalled();
    },
  );

  it("tudi s predizbranima filtroma počaka na Prikaži kartico in pošlje točen obseg", () => {
    window.history.replaceState(null, "", "/kartica-partnerja?partnerId=partner-a&accountId=account-a");
    render(<KarticaPartnerja />);
    expect(enabled()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži kartico" }));
    expect(enabled()).toBe(true);
    expect(mocks.ledger.mock.lastCall?.[0]).toBe("company-a");
    expect(mocks.ledger.mock.lastCall?.[1]).toMatchObject({ partnerId: "partner-a", accountId: "account-a" });
    expect(mocks.ledger.mock.lastCall?.[2].query).toMatchObject({ retry: false, refetchOnWindowFocus: false });
    expect(screen.getByText("Ni postavk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled();
  });

  it("sprememba obdobja skrije prejšnji prikaz do ponovne potrditve", () => {
    window.history.replaceState(null, "", "/kartica-partnerja?partnerId=partner-a&accountId=account-a");
    const { container } = render(<KarticaPartnerja />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži kartico" }));
    const dates = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dates[0], { target: { value: "2025-01-01" } });
    expect(enabled()).toBe(false);
    expect(screen.queryByText("Ni postavk")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Prikaži kartico" }));
    expect(enabled()).toBe(true);
    expect(mocks.ledger.mock.lastCall?.[1].dateFrom).toBe("2025-01-01");
  });

  it("menjava podjetja ponastavi oba filtra in ne poizveduje s starima ID-jema", () => {
    window.history.replaceState(null, "", "/kartica-partnerja?partnerId=partner-a&accountId=account-a");
    const { rerender } = render(<KarticaPartnerja />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži kartico" }));
    mocks.company = { id: "company-b", role: "owner" };
    rerender(<KarticaPartnerja />);
    expect(enabled()).toBe(false);
    expect(screen.getByRole("button", { name: "Prikaži kartico" })).toBeDisabled();
    const newCompanyCalls = mocks.ledger.mock.calls.filter(call => call[0] === "company-b");
    expect(newCompanyCalls.every(call => call[2].query.enabled === false)).toBe(true);
    expect(mocks.ledger.mock.lastCall?.[1]).toMatchObject({ partnerId: "", accountId: "" });
  });

  it("napaka ostane na kartici z možnostjo ponovnega poskusa", () => {
    window.history.replaceState(null, "", "/kartica-partnerja?partnerId=partner-a&accountId=account-a");
    mocks.ledger.mockReturnValue({
      data: undefined, isLoading: false, isFetching: false,
      error: new Error("Začasna napaka nalaganja"), refetch: mocks.refetch,
    });
    render(<KarticaPartnerja />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži kartico" }));
    expect(screen.getByText("Začasna napaka nalaganja")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/kartica-partnerja");
  });

  it("kaže kompaktno kartico brez ponavljanja partnerja, konta in tehničnega opisa", () => {
    const line = {
      lineId: "line-a", entryId: "entry-a", partnerName: "Partner A", accountCode: "1200",
      documentType: "issued", documentNumber: "000002",
      reference: "BOOKIE-OLD/K2/2020/60/000002",
      description: "Dolgi izvirni opis [Bookie Old GLAVNA #12846, konto 1200000, partner 140171]",
      documentDate: "2020-01-31", postingDate: "2020-02-03", dueDate: "2020-02-08",
      debit: "48.80", credit: "0.00", runningBalance: "386.40", openDebit: "48.80", openCredit: "0.00",
      closings: [],
    };
    mocks.ledger.mockReturnValue({
      data: { lines: [line], openingBalances: [], closingBalance: "386.40" },
      isLoading: false, isFetching: false, error: null, refetch: mocks.refetch,
    });
    window.history.replaceState(null, "", "/kartica-partnerja?partnerId=partner-a&accountId=account-a");
    render(<KarticaPartnerja />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži kartico" }));
    expect(screen.getByTestId("ledger-header")).toHaveTextContent("Partner A");
    expect(screen.getByTestId("ledger-header")).toHaveTextContent("1200 Terjatve");
    const table = screen.getByRole("table");
    expect(within(table).queryByText("Partner A")).not.toBeInTheDocument();
    expect(within(table).queryByText("1200")).not.toBeInTheDocument();
    expect(within(table).queryByText(line.description)).not.toBeInTheDocument();
    expect(within(table).queryByText(line.reference)).not.toBeInTheDocument();
    expect(within(table).queryByText("issued")).not.toBeInTheDocument();
    const row = screen.getByText("000002").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(12);
    for (const cell of cells.slice(4, 11)) expect(cell).toHaveClass("whitespace-nowrap");
    for (const cell of cells.slice(6, 11)) expect(cell).toHaveClass("tabular-nums");
    expect(within(row).getByRole("link", { name: "Odpri" })).toHaveAttribute("href", "/temeljnice?id=entry-a");
    fireEvent.click(within(row).getByRole("button", { name: /Podrobnosti/ }));
    expect(mocks.detail.mock.lastCall?.[0].line).toEqual(line);
    expect(mocks.detail.mock.lastCall?.[0].canEdit).toBe(true);
  });
});