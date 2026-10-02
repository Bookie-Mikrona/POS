import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Saldakonti from "./saldakonti";

const state = vi.hoisted(() => ({
  useGetOpenItems: vi.fn(),
  useGetAgedAnalysis: vi.fn(),
  useListCounterparties: vi.fn(),
  useListEnote: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetOpenItems: state.useGetOpenItems,
  useGetAgedAnalysis: state.useGetAgedAnalysis,
  useListCounterparties: state.useListCounterparties,
  useListEnote: state.useListEnote,
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-1", role: "accountant" } }),
}));

vi.mock("wouter", async (importOriginal) => ({
  ...await importOriginal<typeof import("wouter")>(),
  useLocation: () => ["/saldakonti", vi.fn()],
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  return {
    Select: ({ children }: any) => <div>{children}</div>,
    SelectTrigger: ({ children }: any) => <button type="button">{children}</button>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children }: any) => <div>{children}</div>,
    SelectValue: () => <span />,
  };
});

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext({ value: "open", onValueChange: (_value: string) => {} });
  return {
    Tabs: ({ value, onValueChange, children }: any) => (
      <TabsContext.Provider value={{ value, onValueChange }}>{children}</TabsContext.Provider>
    ),
    TabsList: ({ children }: any) => <div role="tablist">{children}</div>,
    TabsTrigger: ({ value, children }: any) => {
      const context = React.useContext(TabsContext);
      return <button role="tab" aria-selected={context.value === value} onClick={() => context.onValueChange(value)}>{children}</button>;
    },
    TabsContent: ({ value, children }: any) => {
      const context = React.useContext(TabsContext);
      return context.value === value ? <div role="tabpanel">{children}</div> : null;
    },
  };
});

const openItemsResponse = {
  items: [
    {
      id: "invoice-1",
      invoiceId: "invoice-1",
      sourceKind: "invoice",
      invoiceNumber: "R-100",
      invoiceDate: "2025-01-10",
      dueDate: "2025-02-10",
      counterpartyId: "partner-1",
      counterpartyName: "Partner d.o.o.",
      arApAccountId: "account-1",
      invoiceType: "issued",
      totalGross: "120.00",
      allocatedAmount: "20.00",
      remainingAmount: "100.00",
      daysOverdue: 0,
    },
    {
      id: "ledger:debit-line",
      invoiceId: null,
      sourceKind: "ledger",
      journalLineId: "debit-line",
      entryId: "entry-1",
      side: "debit",
      paymentDirection: "inbound",
      reference: "GK-2025-01",
      description: "Odprta terjatev iz knjižbe",
      accountCode: "1200",
      invoiceNumber: "GK-2025-01",
      invoiceDate: "2025-01-15",
      dueDate: null,
      counterpartyId: "partner-1",
      counterpartyName: "Partner d.o.o.",
      arApAccountId: "account-1",
      invoiceType: "issued",
      totalGross: "60.00",
      allocatedAmount: "0.00",
      remainingAmount: "60.00",
      daysOverdue: 0,
    },
    {
      id: "ledger:credit-line",
      invoiceId: null,
      sourceKind: "ledger",
      journalLineId: "credit-line",
      side: "credit",
      paymentDirection: null,
      reference: "GK-KREDIT",
      accountCode: "1200",
      invoiceNumber: "GK-KREDIT",
      invoiceDate: "2025-01-20",
      dueDate: null,
      counterpartyId: "partner-1",
      counterpartyName: "Partner d.o.o.",
      arApAccountId: "account-1",
      invoiceType: "issued",
      totalGross: "25.00",
      allocatedAmount: "0.00",
      remainingAmount: "25.00",
      daysOverdue: 0,
    },
  ],
  totalRemaining: "185.00",
  totalOpenDebit: "160.00",
  totalOpenCredit: "25.00",
};

describe("Saldakonti mixed open items", () => {
  beforeEach(() => {
    state.useGetOpenItems.mockImplementation((_companyId, params) => ({
      data: params?.sspOnly ? { items: [], totalRemaining: "0" } : openItemsResponse,
      isLoading: false,
      error: null,
    }));
    state.useGetAgedAnalysis.mockReturnValue({
      data: {
        rows: [{
          counterpartyId: "partner-1",
          counterpartyName: "Partner d.o.o.",
          current: "10.00",
          undated: "25.00",
          bucket1to30: "0.00",
          bucket31to60: "0.00",
          bucket61to90: "0.00",
          bucketOver90: "0.00",
          total: "35.00",
        }],
        totals: {
          counterpartyId: "all",
          counterpartyName: "SKUPAJ",
          current: "10.00",
          undated: "25.00",
          bucket1to30: "0.00",
          bucket31to60: "0.00",
          bucket61to90: "0.00",
          bucketOver90: "0.00",
          total: "35.00",
        },
      },
      isLoading: false,
      error: null,
    });
    state.useListCounterparties.mockReturnValue({ data: { counterparties: [] } });
    state.useListEnote.mockReturnValue({ data: [] });
  });

  it("renders invoice and native source labels/links and separates gross, debit, and credit totals", () => {
    render(<Saldakonti />);

    expect(screen.getByText("Odprto bruto").parentElement).toHaveTextContent("185.00");
    expect(screen.getByText("Odprti debet").parentElement).toHaveTextContent("160.00");
    expect(screen.getByText("Odprti kredit").parentElement).toHaveTextContent("25.00");
    expect(screen.getByText("Neto saldo (debet − kredit)").parentElement).toHaveTextContent("135.00");

    const invoiceRow = screen.getByText("R-100").closest("tr")!;
    expect(within(invoiceRow).getByText("Račun")).toBeInTheDocument();
    const nativeRow = screen.getByText("GK-2025-01").closest("tr")!;
    expect(within(nativeRow).getByText("Postavka GK")).toBeInTheDocument();
    expect(within(nativeRow).getByText("Debet")).toBeInTheDocument();
    expect(within(nativeRow).getByRole("link", { name: "Odpri temeljnico / kartico" }))
      .toHaveAttribute("href", "/temeljnice?id=entry-1");
    const oppositeRow = screen.getByText("GK-KREDIT").closest("tr")!;
    expect(within(oppositeRow).getByText("Kredit")).toBeInTheDocument();
    expect(within(oppositeRow).getAllByText("Brez zapadlosti")).toHaveLength(2);
    expect(within(oppositeRow).getByRole("link", { name: "Odpri temeljnico / kartico" }))
      .toHaveAttribute("href", "/kartica-partnerja?partnerId=partner-1&accountId=account-1");
  });

  it("shows the undated ageing column and value separately", () => {
    render(<Saldakonti />);
    fireEvent.click(screen.getByRole("tab", { name: "Starostna analiza" }));

    expect(screen.getByRole("columnheader", { name: "Brez zapadlosti" })).toBeInTheDocument();
    const row = screen.getByText("Partner d.o.o.").closest("tr")!;
    expect(within(row).getByText("25.00")).toBeInTheDocument();
  });
});