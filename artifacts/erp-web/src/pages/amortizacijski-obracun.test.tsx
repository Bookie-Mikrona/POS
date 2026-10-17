import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AmortizacijskiObracun from "./amortizacijski-obracun";

const mocks = vi.hoisted(() => ({
  getAmortizacija: vi.fn(),
  head: { id: "old", leto: 2005, doMeseca: 6, status: "odprt", skupajAmortizacija: "12.34", updatedAt: "2026-06-30T12:00:00Z" },
}));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: () => ({ activeCompany: { id: "company-a" } }) }));
vi.mock("@/components/os/AmortizacijaKnjizenjDialog", () => ({ AmortizacijaKnjizenjDialog: () => null }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn().mockResolvedValue([]),
  useGetOsAmortizacija: mocks.getAmortizacija,
  useGetOsAmortizacijaNastavitve: () => ({ data: { zadnjiObracunLeto: 2025 } }),
  useGetOsAmortizacijaObracuni: () => ({ data: [mocks.head], refetch: vi.fn() }),
  useOsAmortizacijaIzpis: () => ({}),
  usePostOsAmortizacijaObracun: () => ({}),
  usePostOsAmortizacijaStorno: () => ({}),
  usePutOsAmortizacijaOslabitev: () => ({}),
}));
afterEach(cleanup);

describe("archive selection on the calculation page", () => {
  it("loads the selected year, clears asset filters, selects the assets tab and sets the saved month", () => {
    mocks.getAmortizacija.mockReturnValue({ data: {
      sredstva: [], poKontih: [], poStroskovnihMestih: [],
      skupajRacunovodska: "0.00", skupajDavcna: "0.00", steviloSredstev: 0,
    } });
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><AmortizacijskiObracun /></QueryClientProvider>);
    expect(screen.getByRole("region", { name: "Izvozi shranjenih obračunov" })).toBeTruthy();
    const search = screen.getByPlaceholderText("Inv. št. ali naziv…");
    fireEvent.change(search, { target: { value: "skrito" } });
    fireEvent.click(screen.getByRole("button", { name: /Po kontih/ }));
    fireEvent.click(screen.getByRole("button", { name: "Prikaži sredstva za leto 2005" }));
    expect(mocks.getAmortizacija).toHaveBeenLastCalledWith("company-a", 2005, { query: { enabled: true } });
    expect((screen.getByPlaceholderText("Inv. št. ali naziv…") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("do 6/2005")).toBeTruthy();
    // Even an archived year outside the default year range has a matching selector value.
    expect(screen.getAllByRole("combobox")[0].textContent).toContain("2005");
    expect(screen.getByRole("button", { name: "Prikaži sredstva za leto 2005" }).getAttribute("aria-pressed")).toBe("true");
  });
});
