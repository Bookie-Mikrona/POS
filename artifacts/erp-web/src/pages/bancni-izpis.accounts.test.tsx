import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { TransactionReviewRow } from "./bancni-izpis";
afterEach(cleanup);

const accounts = [
  { id: "supplier", code: "2200000", name: "Dobavitelji" },
  { id: "wages", code: "2500000", name: "Plače" },
  { id: "vat", code: "2600000", name: "DDV" },
  { id: "fee", code: "4150000", name: "Provizije" },
];
function Harness({ matched = false }: { matched?: boolean }) {
  const [decision, setDecision] = useState<any>(matched
    ? { kind: "matched", invoiceId: "invoice", invoiceNumber: "1", counterpartyId: "partner", counterpartyName: "Prejemnik", allocatedAmount: "25.00" }
    : { kind: "pending" });
  return <>
    <TransactionReviewRow
      item={{ transaction: { id: "tx", date: "2026-10-05", amount: -25, currency: "EUR",
        reference: "TEST", description: "Plačilo", counterpartyName: "Prejemnik", counterpartyIban: null },
        suggestions: [] }}
      decision={decision} onDecision={setDecision}
      counterparties={[{ id: "partner", name: "Prejemnik" }]}
      existingPayments={[]} accounts={accounts} defaultAccountId="supplier" invoiceAccountId="vat"
    />
    <output data-testid="decision">{JSON.stringify(decision)}</output>
  </>;
}

describe("accounting controls on bank statement rows", () => {
  it("lets the accountant choose a wage, VAT or expense account without an invoice", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Brez računa/ }));
    const controls = screen.getAllByRole("combobox").filter(control => !control.closest("fieldset"));
    for (const accountId of ["wages", "vat", "fee"]) {
      fireEvent.change(controls[0], { target: { value: accountId } });
      fireEvent.change(controls[1], { target: { value: "partner" } });
      expect(JSON.parse(screen.getByTestId("decision").textContent!)).toEqual({
        kind: "standalone", arApAccountId: accountId, counterpartyId: "partner",
      });
    }
    expect(screen.getByText(/ne ustvarja računa/)).toBeTruthy();
  });
  it("shows the invoice account rather than the import's default account", () => {
    render(<Harness matched />);
    expect(screen.getByText("Protikonto računa: 2600000 — DDV")).toBeTruthy();
  });
  it("allows the standalone choice to be cancelled", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Brez računa/ }));
    fireEvent.click(screen.getByRole("button", { name: "Prekliči izbiro" }));
    expect(JSON.parse(screen.getByTestId("decision").textContent!)).toEqual({ kind: "pending" });
  });
});
