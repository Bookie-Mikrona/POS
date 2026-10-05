import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CounterpartyRecord } from "@workspace/api-client-react";
import { PartnerSheet } from "./partnerji";

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn() }));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "registry-company", role: "owner" } }),
}));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => "test-token" }) }));
vi.mock("@workspace/api-client-react", () => ({
  useCreateCounterparty: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateCounterparty: () => ({ mutate: mocks.update, isPending: false }),
  useListCounterparties: () => ({ data: { counterparties: [] } }),
  getListCounterpartiesQueryKey: (id: string) => ["partners", id],
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const profile = {
  found: true, source: "inetis", taxId: "11223344", name: "Registry Supplier s.p.",
  registrationNumber: "1234567", address: "Testna 1", postCode: "1000", city: "Ljubljana",
  country: "SI", vatPayer: null, iban: null,
};
function openSheet() {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><PartnerSheet open onOpenChange={() => {}} partner={{
    id: "existing-partner", name: "Stored Supplier", type: "supplier", taxId: "11223344", vatPayer: true, isActive: true,
  } as CounterpartyRecord} /></QueryClientProvider>);
}

describe("partner refresh from Inetis", () => {
  it("previews real registry data and saves only after applying and confirming", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(profile)));
    vi.stubGlobal("fetch", fetch);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Osveži iz Inetisa" }));
    await screen.findByText("Podatki iz registra Inetis");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/companies/registry-company/counterparties/ajpes-lookup"), expect.objectContaining({
      headers: expect.objectContaining({ "X-Company-Id": "registry-company" }), body: JSON.stringify({ taxId: "11223344" }),
    }));
    expect(screen.getByDisplayValue("Stored Supplier")).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Uporabi te podatke" }));
    expect(screen.getByDisplayValue("Registry Supplier s.p.")).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Shrani/ }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "registry-company", id: "existing-partner",
      data: expect.objectContaining({ name: "Registry Supplier s.p.", vatPayer: true }),
    }), expect.anything()));
  });
  it("preserves the original partner when the registry has no match", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...profile, found: false }))));
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Osveži iz Inetisa" }));
    await screen.findByText(/Partner s to davčno številko ni bil najden/);
    expect(screen.getByDisplayValue("Stored Supplier")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Uporabi te podatke" })).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
