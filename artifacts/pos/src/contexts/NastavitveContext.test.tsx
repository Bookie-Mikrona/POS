import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { NastavitveProvider, useNastavitve } from "./NastavitveContext";
import type { Nastavitve } from "@workspace/api-client-react";

const QUERY_KEY = ["/api/nastavitve"] as const;
const mockUseGetNastavitve = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { vloga: "admin", enotaId: 1 } }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetNastavitve: (opts: unknown) => mockUseGetNastavitve(opts),
  getGetNastavitveQueryKey: () => QUERY_KEY,
}));

const mockNastavitve: Nastavitve = {
  nazivRestavracije: "Test restavracija",
  naslovRestavracije: "Testna ulica 1",
  davcnaStevilka: "12345678",
  poslovniProstor: "PP001",
  elektronskaNaprava: "B001",
  testniNacin: true,
  smtpAktiven: false,
  certifikatNaložen: false,
};

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Probe() {
  const { nastavitve, nastavitveLoading } = useNastavitve();
  return <output>{nastavitveLoading ? "nalaganje" : nastavitve?.nazivRestavracije ?? "brez nastavitev"}</output>;
}

describe("NastavitveContext", () => {
  beforeEach(() => {
    mockUseGetNastavitve.mockReset();
  });

  it("posreduje podatke ponudnika potomcem", () => {
    mockUseGetNastavitve.mockReturnValue({ data: mockNastavitve, isLoading: false });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NastavitveProvider><Probe /></NastavitveProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText("Test restavracija")).toBeTruthy();
  });

  it("posreduje stanje nalaganja potomcem", () => {
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: true });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NastavitveProvider><Probe /></NastavitveProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText("nalaganje")).toBeTruthy();
  });

  it("vedno zahteva sveže nastavitve brez persistentnega cachea", () => {
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: false });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NastavitveProvider><Probe /></NastavitveProvider>
      </QueryClientProvider>
    );

    expect(mockUseGetNastavitve).toHaveBeenCalledOnce();
    expect(mockUseGetNastavitve).toHaveBeenCalledWith({
      query: {
        queryKey: QUERY_KEY,
        staleTime: 0,
        refetchOnMount: "always",
      },
    });
  });
});