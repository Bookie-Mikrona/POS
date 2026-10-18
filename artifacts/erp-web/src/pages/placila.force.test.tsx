import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPayment: vi.fn(),
  periods: { periods: [{ id: "period-2026", name: "2026", status: "open", startDate: "2026-01-01", endDate: "2026-12-31" }] },
}));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-test" } }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/placila", vi.fn()],
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/payment-batches-panel", () => ({ PaymentBatchesPanel: () => null }));
vi.mock("@/components/bank-account-metadata-dialog", () => ({ BankAccountMetadataDialog: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>
      <option value="">Izberite</option>{children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
vi.mock("@workspace/api-client-react", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useListPayments: () => ({ data: { payments: [] }, isLoading: false }),
    useListPeriods: () => ({ data: mocks.periods }),
    useListCounterparties: () => ({ data: { counterparties: [{ id: "customer", name: "Testni kupec" }] } }),
    useListAccounts: () => ({ data: { accounts: [
      { id: "bank", code: "1100000", name: "TRR", type: "asset", isActive: true },
      { id: "receivable", code: "1200000", name: "Terjatve", type: "asset", isActive: true },
    ] } }),
    useListInvoices: () => ({ data: { invoices: [] } }),
    useGetOpenItems: () => ({ data: { items: [] }, isLoading: false }),
    useGetBankBalance: () => ({ data: { accounts: [] } }),
    useCreatePayment: () => useMutation({ mutationFn: mocks.createPayment }),
    useCreatePaymentBatch: () => ({ isPending: false }),
    usePostPayment: () => ({}),
    useVoidPayment: () => ({}),
    useGetPayment: () => ({}),
    getListPaymentsQueryKey: (companyId: string) => ["payments", companyId],
    getGetPaymentQueryKey: () => ["payment"],
    getListPaymentBatchesQueryKey: () => ["batches"],
  };
});
import Placila from "./placila";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("potrditev podvojenega plačila", () => {
  it("po 409 pošlje iste podatke s force=true, prepreči ponovni klik in po uspehu zapre oba dialoga ter osveži seznam", async function confirmsForcedPayment() {
    let resolveSave!: (value: unknown) => void;
    const pendingSave = new Promise(resolve => { resolveSave = resolve; });
    mocks.createPayment
      .mockRejectedValueOnce({
        status: 409,
        data: { duplicateOf: { paymentId: "existing-payment" }, error: "Plačilo že obstaja." },
      })
      .mockReturnValueOnce(pendingSave);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<QueryClientProvider client={client}><Placila /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Novo plačilo/ }));
    const sheet = screen.getByRole("dialog", { name: "Novo plačilo" });
    const selects = within(sheet).getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "customer" } });
    fireEvent.change(selects[2], { target: { value: "period-2026" } });
    fireEvent.change(selects[3], { target: { value: "bank" } });
    fireEvent.change(selects[4], { target: { value: "receivable" } });
    fireEvent.change(sheet.querySelector('input[type="date"]')!, { target: { value: "2026-10-15" } });
    fireEvent.change(sheet.querySelector('input[type="number"]')!, { target: { value: "123.45" } });
    fireEvent.change(within(sheet).getByPlaceholderText("Npr. SI00 12345"), { target: { value: "SI00 12345" } });
    fireEvent.change(within(sheet).getByPlaceholderText("Dodatna pojasnila..."), { target: { value: "Ločeno plačilo" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Shrani plačilo" }));
    const warning = await screen.findByRole("dialog", { name: "Možno podvojeno plačilo" });
    expect(within(warning).getByText("existing-payment")).toBeVisible();
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    const originalPayload = mocks.createPayment.mock.calls[0][0];
    expect(originalPayload).toEqual({
      companyId: "company-test",
      data: {
        direction: "inbound", counterpartyId: "customer", periodId: "period-2026",
        paymentDate: "2026-10-15", amount: 123.45, reference: "SI00 12345",
        bankAccountId: "bank", arApAccountId: "receivable", notes: "Ločeno plačilo",
        allocations: undefined, ledgerAllocations: undefined,
      },
    });
    expect(originalPayload.data).not.toHaveProperty("force");
    expect(invalidate).not.toHaveBeenCalled();
    const forceButton = within(warning).getByRole("button", { name: "Vseeno shrani" });
    fireEvent.click(forceButton);
    await waitFor(() => expect(forceButton).toBeDisabled());
    expect(forceButton.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Možno podvojeno plačilo" })).toBeVisible();
    expect(sheet).toBeInTheDocument();
    expect(mocks.createPayment).toHaveBeenCalledTimes(2);
    expect(mocks.createPayment.mock.calls[1][0]).toEqual({
      ...originalPayload, data: { ...originalPayload.data, force: true },
    });
    fireEvent.click(forceButton);
    expect(mocks.createPayment).toHaveBeenCalledTimes(2);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => { resolveSave({ id: "new-payment" }); });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Možno podvojeno plačilo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Novo plačilo" })).not.toBeInTheDocument();
    });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ["payments", "company-test"] });
    client.clear();
  });
});
