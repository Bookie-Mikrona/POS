import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  costCenters: { costCenters: [] as { id: string; name: string }[] } as { costCenters: { id: string; name: string }[] } | undefined,
  projects: { projects: [] as { id: string; name: string }[] } as { projects: { id: string; name: string }[] } | undefined,
  mutate: vi.fn(),
}));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company", role: "owner" } }),
}));
vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return ({
  useListJournalEntries: () => ({ data: { entries: [] } }),
  useGetJournalEntry: () => ({}),
  useListPeriods: () => ({ data: { periods: [{ id: "period", name: "2026", status: "open", startDate: "2026-01-01", endDate: "2026-12-31" }] } }),
  useListAccounts: () => ({ data: { accounts: [
    { id: "required", code: "400", name: "Stroški", isActive: true, costCenterPolicy: "required", requiresProject: true },
    { id: "optional", code: "220", name: "Obveznosti", isActive: true },
  ] } }),
  useListCounterparties: () => ({ data: { counterparties: [] } }),
  useListCostCenters: (companyId: string, _params: unknown, options: any) => useQuery({
    queryKey: ["cost-centers", companyId],
    queryFn: () => state.costCenters ?? new Promise(() => {}),
    ...options?.query,
  }),
  useListProjects: (companyId: string, _params: unknown, options: any) => useQuery({
    queryKey: ["projects", companyId],
    queryFn: () => state.projects ?? new Promise(() => {}),
    ...options?.query,
  }),
  useListDepartments: () => ({ data: { departments: [] } }),
  useListCompanyFursVatCodes: () => ({ data: { codes: [] } }),
  useListVatCodes: () => ({ data: { vatCodes: [] } }),
  useCreateJournalEntry: () => ({ mutate: state.mutate, isPending: false }),
  usePostJournalEntry: () => ({}),
  useDeleteJournalEntry: () => ({}),
  useReverseJournalEntry: () => ({}),
  getListJournalEntriesQueryKey: () => ["entries"],
  getListInvoicesQueryKey: () => ["invoices"],
}); });
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children, disabled }: any) => <option value={value} disabled={disabled}>{children}</option>,
}));

import Temeljnice from "./temeljnice";

beforeEach(() => {
  focusManager.setFocused(true);
  state.costCenters = { costCenters: [] };
  state.projects = { projects: [] };
  state.mutate.mockReset();
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

async function openEntry() {
  // Match the app's global focus setting; the sheet must override it.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={client}><Temeljnice /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Nova temeljnica" }));
  await waitFor(() => {
    if (state.costCenters) expect(client.getQueryData(["cost-centers", "company"])).toBeDefined();
    if (state.projects) expect(client.getQueryData(["projects", "company"])).toBeDefined();
  });
}
function chooseAccount(index: number, value: string) {
  const accounts = screen.getAllByRole("combobox").filter(el =>
    Array.from((el as HTMLSelectElement).options).some(option => option.value === "required"));
  fireEvent.change(accounts[index]!, { target: { value } });
}
function fillEntry() {
  fireEvent.change(screen.getByPlaceholderText("Npr. Prejeti račun 2024-001"), { target: { value: "Test" } });
  chooseAccount(0, "required");
  chooseAccount(1, "optional");
  screen.getAllByPlaceholderText("0.00").forEach(el => fireEvent.change(el, { target: { value: "100" } }));
}

describe("Manjkajoči šifranti obveznih dimenzij", () => {
  it("takoj razloži prazna seznama in odpre pravilne nastavitve brez zapiranja vnosa", async () => {
    await openEntry();
    chooseAccount(0, "required");
    expect(screen.getByText(/Najprej dodajte stroškovno mesto v nastavitvah/)).toBeTruthy();
    expect(screen.getByText(/Najprej dodajte projekt v nastavitvah/)).toBeTruthy();
    for (const [name, path] of [
      ["Nastavitve stroškovnih mest", "/stroskovana-mesta"],
      ["Nastavitve projektov", "/dimenzije"],
    ]) {
      const link = screen.getByRole("link", { name: new RegExp(name!) });
      expect(link.getAttribute("href")).toBe(`${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
    chooseAccount(0, "optional");
    expect(screen.queryByText(/Najprej dodajte/)).toBeNull();
  });

  it("ne dovoli shranjevanja z gumbom ali F2 niti pri izravnani temeljnici", async () => {
    await openEntry();
    fillEntry();
    const save = screen.getByRole("button", { name: /Shrani temeljnico/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    fireEvent.keyDown(window, { key: "F2" });
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("med nalaganjem ne trdi, da sta seznama prazna", async () => {
    state.costCenters = undefined;
    state.projects = undefined;
    await openEntry();
    chooseAccount(0, "required");
    expect(screen.queryByText(/Najprej dodajte/)).toBeNull();
  });

  it("ob obstoječih dimenzijah zahteva izbiro in nato omogoči shranjevanje", async () => {
    state.costCenters = { costCenters: [{ id: "cc", name: "Uprava" }] };
    state.projects = { projects: [{ id: "pr", name: "Projekt A" }] };
    await openEntry();
    fillEntry();
    expect(screen.queryByText(/Najprej dodajte/)).toBeNull();
    expect(screen.getByText("Za ta konto je stroškovno mesto obvezno.")).toBeTruthy();
    expect(screen.getByText("Za ta konto je projekt obvezen.")).toBeTruthy();
    const save = screen.getByRole("button", { name: /Shrani temeljnico/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    for (const value of ["cc", "pr"]) {
      const select = screen.getAllByRole("combobox").find(el =>
        Array.from((el as HTMLSelectElement).options).some(option => option.value === value));
      fireEvent.change(select!, { target: { value } });
    }
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lines: expect.arrayContaining([
        expect.objectContaining({ costCenterId: "cc", projectId: "pr" }),
      ]) }),
    }), expect.anything());
  });

  it("po vrnitvi iz nastavitev osveži oba seznama in ohrani odprti vnos", async () => {
    await openEntry();
    fillEntry();
    state.costCenters = { costCenters: [{ id: "cc", name: "Uprava" }] };
    state.projects = { projects: [{ id: "pr", name: "Projekt A" }] };
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(screen.queryByText(/Najprej dodajte/)).toBeNull());
    expect((screen.getByPlaceholderText("Npr. Prejeti račun 2024-001") as HTMLInputElement).value).toBe("Test");
    expect(screen.getAllByPlaceholderText("0.00").map(el => (el as HTMLInputElement).value)).toEqual(["100", "100"]);
    for (const value of ["cc", "pr"]) {
      const select = screen.getAllByRole("combobox").find(el =>
        Array.from((el as HTMLSelectElement).options).some(option => option.value === value));
      fireEvent.change(select!, { target: { value } });
    }
    expect((screen.getByRole("button", { name: /Shrani temeljnico/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(["costCenter", "project"])("blokira prej veljaven vnos, ko izgine izbrana dimenzija %s", async kind => {
    state.costCenters = { costCenters: [{ id: "cc", name: "Uprava" }] };
    state.projects = { projects: [{ id: "pr", name: "Projekt A" }] };
    await openEntry();
    fillEntry();
    for (const value of ["cc", "pr"]) {
      const select = screen.getAllByRole("combobox").find(el =>
        Array.from((el as HTMLSelectElement).options).some(option => option.value === value));
      fireEvent.change(select!, { target: { value } });
    }
    const save = screen.getByRole("button", { name: /Shrani temeljnico/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    if (kind === "costCenter") state.costCenters = { costCenters: [] };
    else state.projects = { projects: [] };
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(screen.getByText(/Najprej dodajte/)).toBeTruthy();
    fireEvent.click(save);
    fireEvent.keyDown(window, { key: "F2" });
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
