import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { PaymentBatchConflict } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  create: vi.fn(),
  getPayment: vi.fn(),
  alert: vi.fn(),
}));

vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company", role: "admin" } }),
}));
vi.mock("@/components/payment-batches-panel", () => ({
  PaymentBatchesPanel: () => <p>Pripravljeni paketi</p>,
}));
vi.mock("@/components/bank-account-metadata-dialog", () => ({
  BankAccountMetadataDialog: () => null,
}));
// Native selects keep this test focused on payment handling, not Radix pointer events.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={event => onValueChange(event.target.value)}>
      <option value="">Izberite</option>{children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
vi.mock("@workspace/api-client-react", () => ({
  useListPayments: () => ({ data: { payments: [] }, isLoading: false }),
  useListPeriods: () => ({ data: { periods: [{
    id: "period", name: "2026", status: "open", startDate: "2026-01-01", endDate: "2026-12-31",
  }] } }),
  useListCounterparties: () => ({ data: { counterparties: [] } }),
  useListAccounts: () => ({ data: { accounts: [{
    id: "bank", code: "1100000", name: "TRR", type: "asset", isActive: true,
  }] } }),
  useListInvoices: () => ({ data: { invoices: [] } }),
  useGetOpenItems: () => ({ data: { items: [
    { invoiceId: "invoice-a", invoiceType: "received", invoiceNumber: "A-1",
      counterpartyId: "supplier-a", counterpartyName: "Dobavitelj A", arApAccountId: "payables",
      invoiceDate: "2020-01-01", dueDate: "2020-01-31", remainingAmount: "100.00" },
    { invoiceId: "invoice-b", invoiceType: "received", invoiceNumber: "B-2",
      counterpartyId: "supplier-b", counterpartyName: "Dobavitelj B", arApAccountId: "payables",
      invoiceDate: "2020-01-02", dueDate: "2020-02-01", remainingAmount: "250.00" },
  ] }, isLoading: false }),
  useGetBankBalance: () => ({ data: { accounts: [{
    accountId: "bank", hasStatementBalance: true, balance: "1000.00",
  }] } }),
  useCreatePayment: () => ({ mutate: mocks.create, isPending: false }),
  useCreatePaymentBatch: () => ({ mutateAsync: mocks.batch, isPending: false }),
  useGetPayment: (...args: unknown[]) => mocks.getPayment(...args),
  usePostPayment: () => ({ mutate: vi.fn(), isPending: false }),
  useVoidPayment: () => ({ mutate: vi.fn(), isPending: false }),
  getListPaymentsQueryKey: (company: string) => ["payments", company],
  getListPaymentBatchesQueryKey: (company: string) => ["batches", company],
  getGetPaymentQueryKey: (company: string, id: string) => ["payment", company, id],
}));

import Placila from "./placila";

const existingPayment = {
  id: "existing-payment-for-supplier-b",
  direction: "outbound", status: "posted", counterpartyId: "supplier-b",
  counterpartyName: "Obstoječi dobavitelj B", paymentDate: "2026-04-17",
  amount: "250.00", reference: "SI00 987654", bankAccountCode: "1100000",
  bankAccountName: "TRR", allocations: [],
};
const duplicateError = {
  status: 409,
  data: { error: "Izplačilo dobavitelju B že obstaja.", duplicateOf: { paymentId: existingPayment.id } },
} satisfies { status: number; data: PaymentBatchConflict };

function prepareSupplierBatch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["payments", "company"], { payments: [] });
  client.setQueryData(["batches", "company"], { batches: [] });
  render(<QueryClientProvider client={client}><Placila /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Novo plačilo" }));
  const sheet = screen.getByRole("dialog", { name: "Novo plačilo" });
  fireEvent.change(within(sheet).getAllByRole("combobox")[0], { target: { value: "outbound" } });
  // Direction, period and bank account, in the actual new-payment form.
  const selects = within(sheet).getAllByRole("combobox");
  fireEvent.change(selects[1], { target: { value: "period" } });
  fireEvent.change(selects[2], { target: { value: "bank" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Izberi vse dovoljene postavke" }));
  expect(within(sheet).getByRole("spinbutton", { name: "Znesek plačila za račun A-1" })).toHaveValue(100);
  expect(within(sheet).getByRole("spinbutton", { name: "Znesek plačila za račun B-2" })).toHaveValue(250);
  const save = within(sheet).getByRole("button", { name: "Shrani plačilo" });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batch.mockReset();
  mocks.getPayment.mockImplementation((_company, id) => ({
    data: id === existingPayment.id ? existingPayment : undefined,
    isLoading: false,
  }));
  vi.stubGlobal("alert", mocks.alert);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("podvojeno plačilo pri paketnem izplačilu dobaviteljem", () => {
  it("keeps the 409 warning and the correct existing payment through unrelated successful refreshes", async () => {
    mocks.batch.mockRejectedValueOnce(duplicateError);
    const client = prepareSupplierBatch();
    const warning = await screen.findByRole("dialog", { name: "Možno podvojeno plačilo" });

    // The obsolete Promise.all flow must not return: suppliers travel in ONE atomic request.
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company",
      data: expect.objectContaining({
        bankAccountId: "bank", periodId: "period",
        proposedPayments: [
          { counterpartyId: "supplier-a", arApAccountId: "payables",
            allocations: [{ invoiceId: "invoice-a", amount: 100 }] },
          { counterpartyId: "supplier-b", arApAccountId: "payables",
            allocations: [{ invoiceId: "invoice-b", amount: 250 }] },
        ],
      }),
    }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(within(warning).getByText(duplicateError.data.error)).toBeVisible();
    expect(within(warning).getByText(existingPayment.id)).toBeVisible();
    expect(within(warning).getByText(existingPayment.counterpartyName)).toBeVisible();
    expect(within(warning).getByText("17.04.2026")).toBeVisible();
    expect(within(warning).getByText("250.00")).toBeVisible();
    expect(within(warning).getByText(existingPayment.reference)).toBeVisible();
    expect(within(warning).queryByText("Dobavitelj A")).not.toBeInTheDocument();
    expect(within(warning).queryByRole("button", { name: "Vseeno shrani" })).not.toBeInTheDocument();

    await act(async () => {
      client.setQueryData(["payments", "company"], { payments: [{ id: "unrelated-success" }] });
      await client.invalidateQueries({ queryKey: ["payments", "company"] });
    });
    expect(warning).toBeVisible();
    expect(within(warning).getByText(existingPayment.reference)).toBeVisible();
    expect(screen.queryByText("Pripravljeni paketi")).not.toBeInTheDocument();
  });

  it("opens details using duplicateOf.paymentId, even when the payment is absent from the list", async () => {
    mocks.batch.mockRejectedValueOnce(duplicateError);
    prepareSupplierBatch();
    const warning = await screen.findByRole("dialog", { name: "Možno podvojeno plačilo" });
    fireEvent.click(within(warning).getByRole("button", { name: "Odpri obstoječe plačilo" }));

    const detail = await screen.findByRole("dialog", { name: "Plačilo" });
    expect(within(detail).getByText(existingPayment.counterpartyName)).toBeVisible();
    expect(within(detail).getByText(existingPayment.reference)).toBeVisible();
    expect(within(detail).getByText("250.00")).toBeVisible();
    expect(mocks.getPayment).toHaveBeenLastCalledWith("company", existingPayment.id, expect.anything());
    expect(screen.queryByRole("dialog", { name: "Možno podvojeno plačilo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Novo plačilo" })).not.toBeInTheDocument();
  });

  it("closes the form and shows batches only after atomic success", async () => {
    mocks.batch.mockResolvedValueOnce({ id: "new-batch" });
    const client = prepareSupplierBatch();
    await screen.findByText("Pripravljeni paketi");
    expect(screen.queryByRole("dialog", { name: "Novo plačilo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Možno podvojeno plačilo" })).not.toBeInTheDocument();
    expect(client.getQueryState(["payments", "company"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["batches", "company"])?.isInvalidated).toBe(true);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not mistake another batch conflict for a duplicate payment", async () => {
    mocks.batch.mockRejectedValueOnce({ status: 409, data: { error: "Postavka je že rezervirana." } });
    prepareSupplierBatch();
    await waitFor(() => expect(mocks.alert).toHaveBeenCalledWith(
      "Paket ni bil ustvarjen, noben osnutek ni shranjen. Postavka je že rezervirana.",
    ));
    expect(screen.getByRole("dialog", { name: "Novo plačilo" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Možno podvojeno plačilo" })).not.toBeInTheDocument();
  });

  it.each(["failed lookup", "wrong payment"] as const)("retains the conflict without opening unrelated details after a %s", async scenario => {
    mocks.batch.mockRejectedValueOnce(duplicateError);
    mocks.getPayment.mockReturnValue(scenario === "failed lookup"
      ? { error: new Error("Unavailable"), isLoading: false }
      : { data: { ...existingPayment, id: "wrong-payment", counterpartyName: "Napačni partner" }, isLoading: false });
    prepareSupplierBatch();
    const warning = await screen.findByRole("dialog", { name: "Možno podvojeno plačilo" });
    expect(within(warning).getByText(existingPayment.id)).toBeVisible();
    expect(within(warning).getByText("Podatkov obstoječega plačila ni bilo mogoče naložiti.")).toBeVisible();
    expect(within(warning).queryByText("Napačni partner")).not.toBeInTheDocument();
    expect(within(warning).queryByRole("button", { name: "Odpri obstoječe plačilo" })).not.toBeInTheDocument();
  });
});
