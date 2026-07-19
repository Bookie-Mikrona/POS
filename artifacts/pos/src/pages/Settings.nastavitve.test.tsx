/**
 * Testi za handleSaveNastavitve v resnični komponenti Settings.tsx.
 *
 * Pokritost:
 *  1. queryClient.setQueryData se pokliče z odgovorom API-ja po uspešnem shranjevanju
 *  2. localStorage dobi posodobljene podatke za medZavihkovno sinhronizacijo
 *     (prek NastavitveProvider, ki ob spremembi nastavitve zapiše v localStorage)
 *  3. Po shranjevanju se NE sproži dodatni API klic (invalidateQueries za nastavitve ni klican)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { Nastavitve } from "@workspace/api-client-react";
import Settings from "./Settings";
import { NastavitveProvider } from "@/contexts/NastavitveContext";

const QUERY_KEY = ["/api/nastavitve"] as const;

const mockApiResponse: Nastavitve = {
  nazivRestavracije: "Posodobljena restavracija",
  naslovRestavracije: "Nova ulica 5",
  davcnaStevilka: "87654321",
  poslovniProstor: "PP001",
  elektronskaNaprava: "B001",
  testniNacin: false,
  smtpAktiven: false,
  racunPozdrav1: "Hvala!",
  racunPozdrav2: "Se vidimo.",
  certifikatNaložen: false,
};

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

// vi.hoisted ensures these are available before vi.mock hoisting
const mockMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockUseGetNastavitve = vi.hoisted(() => vi.fn());

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/nastavitve", vi.fn()],
}));

vi.mock("recharts", () => ({
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReferenceLine: () => null,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListMize: () => ({ data: [] }),
  useCreateMiza: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteMiza: () => ({ mutate: vi.fn() }),
  useUpdateMiza: () => ({ mutate: vi.fn() }),
  useListProstori: () => ({ data: [] }),
  useCreateProstor: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProstor: () => ({ mutate: vi.fn() }),
  useDeleteProstor: () => ({ mutate: vi.fn() }),
  useUpdateNastavitve: () => ({ mutate: mockMutate, isPending: false }),
  useListNatakari: () => ({ data: [] }),
  useCreateNatakar: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNatakar: () => ({ mutate: vi.fn() }),
  useDeleteNatakar: () => ({ mutate: vi.fn() }),
  useListPoslovniProstori: () => ({ data: [] }),
  useCreatePoslovniProstor: () => ({ mutate: vi.fn() }),
  useUpdatePoslovniProstor: () => ({ mutate: vi.fn() }),
  useDeletePoslovniProstor: () => ({ mutate: vi.fn() }),
  useRegistrirajProstor: () => ({ mutate: vi.fn() }),
  useZapriProstor: () => ({ mutate: vi.fn() }),
  getListTestniZagoniQueryOptions: () => ({
    queryKey: ["testni-zagoni"],
    queryFn: () => Promise.resolve([]),
  }),
  getGetNastavitveQueryKey: () => QUERY_KEY,
  getListMizeQueryKey: () => ["/api/mize"],
  getListNatakariQueryKey: () => ["/api/natakari"],
  getListPoslovniProstoriQueryKey: () => ["/api/poslovni-prostori"],
  getListProstoriQueryKey: () => ["/api/prostori"],
  // NastavitveProvider-specific mock (used when NastavitveProvider is in the tree)
  useGetNastavitve: (opts: unknown) => mockUseGetNastavitve(opts),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      ime: "Admin",
      vloga: "admin",
      podjetjeDavcna: "12345678",
      moraZamenjatiGeslo: false,
    },
    loading: false,
    login: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({ nastavitve: mockNastavitve, nastavitveLoading: false }),
  NastavitveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  clearNastavitveStorage: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Wrapper({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

describe("Settings — handleSaveNastavitve integracija", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    localStorage.clear();
    mockMutate.mockReset();
    mockToast.mockReset();
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: false });
    // Odpri zavihek "nastavitve" — tam je gumb "Shrani vse nastavitve"
    sessionStorage.setItem("settings.aktivniZavihek", "nastavitve");
    // Prepreči dejanske fetch klice (za certifikat/info, testni zagoni, ipd.)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("certifikat/info")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ najden: false }),
          });
        }
        if (String(url).includes("admin/uporabniki")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      })
    );
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("queryClient.setQueryData se pokliče z odgovorom API-ja po kliku gumba 'Shrani vse nastavitve'", () => {
    mockMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: Nastavitve) => void }) => {
        callbacks?.onSuccess?.(mockApiResponse);
      }
    );

    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

    render(
      <Wrapper queryClient={queryClient}>
        <Settings />
      </Wrapper>
    );

    const button = screen.getByText("Shrani vse nastavitve");
    fireEvent.click(button);

    expect(setQueryDataSpy).toHaveBeenCalledOnce();
    expect(setQueryDataSpy).toHaveBeenCalledWith(QUERY_KEY, mockApiResponse);
  });

  it("React Query cache vsebuje sveže nastavitve takoj po uspešnem shranjevanju (brez ponovne zahteve)", () => {
    mockMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: Nastavitve) => void }) => {
        callbacks?.onSuccess?.(mockApiResponse);
      }
    );

    render(
      <Wrapper queryClient={queryClient}>
        <Settings />
      </Wrapper>
    );

    fireEvent.click(screen.getByText("Shrani vse nastavitve"));

    const cached = queryClient.getQueryData<Nastavitve>(QUERY_KEY);
    expect(cached).toEqual(mockApiResponse);
  });

  it("queryClient.invalidateQueries se NE pokliče za ključ nastavitev po uspešnem shranjevanju", () => {
    mockMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: Nastavitve) => void }) => {
        callbacks?.onSuccess?.(mockApiResponse);
      }
    );

    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <Wrapper queryClient={queryClient}>
        <Settings />
      </Wrapper>
    );

    fireEvent.click(screen.getByText("Shrani vse nastavitve"));

    const nastavitveInvalidations = invalidateQueriesSpy.mock.calls.filter(
      (call) => {
        const filters = call[0] as { queryKey?: unknown[] } | undefined;
        if (!filters?.queryKey) return false;
        const key = filters.queryKey as unknown[];
        return key.length > 0 && key[0] === QUERY_KEY[0];
      }
    );
    expect(nastavitveInvalidations).toHaveLength(0);
  });

  it("po neuspešnem shranjevanju se queryClient.setQueryData NE pokliče", () => {
    mockMutate.mockImplementation(
      (_args: unknown, callbacks: { onError?: () => void }) => {
        callbacks?.onError?.();
      }
    );

    const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

    render(
      <Wrapper queryClient={queryClient}>
        <Settings />
      </Wrapper>
    );

    fireEvent.click(screen.getByText("Shrani vse nastavitve"));

    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});

describe("Settings — localStorage sinhronizacija prek NastavitveContext", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    localStorage.clear();
    mockMutate.mockReset();
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: false });
  });

  /**
   * Uvozi pravo NastavitveContext implementacijo (brez moka) in preverja,
   * da NastavitveProvider zapiše posodobljene podatke v localStorage,
   * ko useGetNastavitve vrne nov odgovor — kar se v produkciji zgodi
   * takoj po tem, ko handleSaveNastavitve kliče setQueryData.
   */
  it("NastavitveContext zapiše posodobljene nastavitve v localStorage ko prejme sveže podatke", async () => {
    // Dinamično uvozimo pravo implementacijo (brez moka za NastavitveContext)
    const { NastavitveProvider: RealNastavitveProvider } = await vi.importActual<
      typeof import("@/contexts/NastavitveContext")
    >("@/contexts/NastavitveContext");

    mockUseGetNastavitve.mockReturnValue({ data: mockApiResponse, isLoading: false });

    render(
      <QueryClientProvider client={queryClient}>
        <RealNastavitveProvider>
          <span data-testid="child" />
        </RealNastavitveProvider>
      </QueryClientProvider>
    );

    const raw = localStorage.getItem("nastavitve");
    expect(raw).not.toBeNull();
    const entry = JSON.parse(raw!) as { data: Nastavitve; ts: number };
    expect(entry.data.nazivRestavracije).toBe(mockApiResponse.nazivRestavracije);
    expect(entry.data.davcnaStevilka).toBe(mockApiResponse.davcnaStevilka);
  });

  it("localStorage format je { data, ts } — potreben za StorageEvent sinhronizacijo med zavihki", async () => {
    const pred = Date.now();

    const { NastavitveProvider: RealNastavitveProvider } = await vi.importActual<
      typeof import("@/contexts/NastavitveContext")
    >("@/contexts/NastavitveContext");

    mockUseGetNastavitve.mockReturnValue({ data: mockApiResponse, isLoading: false });

    render(
      <QueryClientProvider client={queryClient}>
        <RealNastavitveProvider>
          <span />
        </RealNastavitveProvider>
      </QueryClientProvider>
    );

    const raw = localStorage.getItem("nastavitve");
    expect(raw).not.toBeNull();
    const entry = JSON.parse(raw!) as { data: unknown; ts: number };
    expect(entry).toHaveProperty("data");
    expect(entry).toHaveProperty("ts");
    expect(entry.ts).toBeGreaterThanOrEqual(pred);
  });
});
