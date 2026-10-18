import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  company: { id: "test-company", role: "owner" },
  accounts: undefined as { accounts: any[] } | undefined,
  periods: { periods: [] },
  counterparties: { counterparties: [] },
  payments: { payments: [] },
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.company }),
}));
vi.mock("@clerk/react", () => ({ useUser: () => ({ isLoaded: true, user: { id: "test-user" } }) }));
vi.mock("@workspace/api-client-react", async () => ({
  ...await vi.importActual("@workspace/api-client-react"),
  useListAccounts: () => ({ data: state.accounts }),
  useListPeriods: () => ({ data: state.periods }),
  useListCounterparties: () => ({ data: state.counterparties }),
  useListPayments: () => ({ data: state.payments }),
  useListInvoices: () => ({ data: { invoices: [] } }),
}));
// Preserve the controlled value even before options arrive, without driving
// unrelated Radix popovers. The real page still owns loading and validation.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select data-value={value} value={value} onChange={e => onValueChange(e.target.value)}>
      <option value="">Izberite</option>{children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
import BancniIzpis from "./bancni-izpis";

const activeAccounts = [
  { id: "bank", code: "1100001", name: "Banka", isActive: true, isGroup: false },
  { id: "ar", code: "1200001", name: "Terjatve", isActive: true, isGroup: false },
  { id: "ap", code: "2200001", name: "Dobavitelji", isActive: true, isGroup: false },
];
const warning = /Nekateri shranjeni konti niso več aktivni in so bili počiščeni/;
const configKeys = ["bankAccountId", "arAccountId", "apAccountId"] as const;

beforeEach(() => { state.accounts = undefined; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function start(config: Record<string, string | null>, accountsFirst: boolean, accounts = activeAccounts) {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url: string) =>
    url.endsWith("/import-config")
      ? new Promise<Response>(r => { resolve = r; })
      : Promise.resolve(new Response(JSON.stringify({ statements: [] }), { status: 200 })),
  ));
  if (accountsFirst) state.accounts = { accounts };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => <QueryClientProvider client={client}><BancniIzpis /></QueryClientProvider>;
  const view = render(page());
  return {
    async finish() {
      await act(async () => {
        resolve(new Response(JSON.stringify(config), { status: 200 }));
      });
      if (!accountsFirst) {
        expect(screen.queryByText(warning)).toBeNull();
        const controls = screen.getAllByRole("combobox");
        configKeys.forEach((key, index) => {
          expect(controls[index + 1]!.getAttribute("data-value")).toBe(config[key] ?? "");
        });
        state.accounts = { accounts };
        view.rerender(page());
      }
    },
    view,
    page,
  };
}

describe.each([true, false])("validacija shranjenih kontov; konti prispejo prvi: %s", accountsFirst => {
  it.each(configKeys)("počisti neveljaven %s in pokaže opozorilo, druge konte pa ohrani", async key => {
    const config = { bankAccountId: "bank", arAccountId: "ar", apAccountId: "ap", [key]: "inactive-account" };
    await start(config, accountsFirst).finish();
    await waitFor(() => expect(screen.getByText(warning)).toBeTruthy());
    const controls = screen.getAllByRole("combobox");
    configKeys.forEach((field, index) => {
      expect(controls[index + 1]!.getAttribute("data-value")).toBe(field === key ? "" : config[field]);
    });
  });

  it("ohrani vse veljavne shranjene konte brez opozorila", async () => {
    const config = { bankAccountId: "bank", arAccountId: "ar", apAccountId: "ap" };
    await start(config, accountsFirst).finish();
    await waitFor(() => expect(screen.getAllByRole("combobox")[1]!.getAttribute("data-value")).toBe("bank"));
    expect(screen.queryByText(warning)).toBeNull();
    configKeys.forEach((key, index) => {
      expect(screen.getAllByRole("combobox")[index + 1]!.getAttribute("data-value")).toBe(config[key]);
    });
  });

  it("prazen, a že naložen seznam počisti vse shranjene konte", async () => {
    await start({ bankAccountId: "bank", arAccountId: "ar", apAccountId: "ap" }, accountsFirst, []).finish();
    await waitFor(() => expect(screen.getByText(warning)).toBeTruthy());
    screen.getAllByRole("combobox").slice(1, 4).forEach(control => {
      expect(control.getAttribute("data-value")).toBe("");
    });
  });
});
