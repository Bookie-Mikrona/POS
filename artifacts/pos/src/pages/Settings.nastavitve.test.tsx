declare global {
  var mockResetProstorTloris: any;
}
globalThis.mockResetProstorTloris = vi.fn();
/**
 * Testi za handleSaveNastavitve v resnični komponenti Settings.tsx.
 *
 * Pokritost:
 *  1. queryClient.setQueryData se pokliče z odgovorom API-ja po uspešnem shranjevanju
 *  2. Po shranjevanju se no-store poizvedba invalidira za svež strežniški zajem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { Nastavitve } from "@workspace/api-client-react";
import Settings from "./Settings";

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
const mockBulkPozicijaMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockUseGetNastavitve = vi.hoisted(() => vi.fn());
const mockUseListMize = vi.hoisted(() => vi.fn());
const mockUseListProstori = vi.hoisted(() => vi.fn());

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
  useListMize: () => mockUseListMize(),
  useCreateMiza: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteMiza: () => ({ mutate: vi.fn() }),
  useUpdateMiza: () => ({ mutate: vi.fn() }),
  useBulkPozicijaMize: () => ({ mutate: mockBulkPozicijaMutate, isPending: false }),
  useGetProstorTloris: () => ({ data: undefined, isFetching: false }),
  useUpdateProstorTloris: () => ({ mutate: vi.fn(), isPending: false }),
  useResetProstorTloris: () => ({ mutate: globalThis.mockResetProstorTloris, isPending: false }),
  useListProstori: () => mockUseListProstori(),
  useCreateProstor: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProstor: () => ({ mutate: vi.fn() }),
  useDeleteProstor: () => ({ mutate: vi.fn() }),
  useUpdateNapraveTerminali: () => ({ mutate: vi.fn(), isPending: false }),
  useEnrollPaytenAndroidBridge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useListNaprave: () => ({ data: [], isLoading: false }),
  useUpdateNaprava: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteNaprava: () => ({ mutate: vi.fn(), isPending: false }),
  useListBlagajne: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useCreateBlagajna: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBlagajna: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteBlagajna: () => ({ mutate: vi.fn(), isPending: false }),
  useListEnote: () => ({ data: [], isLoading: false }),
  useCreateEnota: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateEnota: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEnota: () => ({ mutate: vi.fn(), isPending: false }),
  useGetCurrentPublicIp: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
  useListCostCenters: () => ({ data: [], isLoading: false }),
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
  getListEnoteQueryKey: () => ["/api/enote"],
  getListBlagajneQueryKey: () => ["/api/blagajne"],
  getListNapraveQueryKey: () => ["/api/naprave"],
  customFetch: vi.fn(),
  getAuthToken: () => null,
  getEnotaId: () => 1,
  useGetNastavitve: (opts: unknown) => mockUseGetNastavitve(opts),
}));

vi.mock("@/contexts/AuthContext", () => {
  const auth = {
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
  };

  return { useAuth: () => auth };
});

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({ nastavitve: mockNastavitve, nastavitveLoading: false }),
  NastavitveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/NapravaContext", () => ({
  useNaprava: () => ({
    naprava: null,
    napravaKljuc: "test-naprava-kljuc",
    napravaLoading: false,
    refreshNaprava: vi.fn(),
    useUpdateNaprava: () => ({ mutate: vi.fn(), isPending: false }),
    updateTerminalConfig: vi.fn(),
  }),
  NapravaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
    mockMutate.mockReset();
    mockBulkPozicijaMutate.mockReset();
    mockToast.mockReset();
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: false });
    mockUseListMize.mockReturnValue({ data: [] });
    mockUseListProstori.mockReturnValue({ data: [] });
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

  it("shrani vklop AI asistenta javnega QR menija", () => {
    render(
      <Wrapper queryClient={queryClient}>
        <Settings />
      </Wrapper>
    );

    fireEvent.click(screen.getByTestId("qr-ai-asistent-aktiven"));
    fireEvent.click(screen.getByText("Shrani vse nastavitve"));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ qrAiAsistentAktiven: true }),
      }),
      expect.any(Object),
    );
  });

  it("shrani izklop toastov iz točilnice", () => {
    render(
      <Wrapper queryClient={queryClient}>
        <Settings />
      </Wrapper>
    );

    fireEvent.click(screen.getByTestId("toast-tocilnica-aktiven"));
    fireEvent.click(screen.getByText("Shrani vse nastavitve"));

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toastTocilnicaAktiven: false }),
      }),
      expect.any(Object),
    );
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

  it("po uspešnem shranjevanju invalidira no-store ključ nastavitev", () => {
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
    expect(nastavitveInvalidations).toHaveLength(1);
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

  it("po potrditvi ponastavi tloris samo izbranega prostora", async () => {
    sessionStorage.setItem("settings.aktivniZavihek", "mize");
    mockUseListProstori.mockReturnValue({
      data: [{ id: 42, ime: "Terasa", vrstniRed: 1 }],
    });
    mockUseListMize.mockReturnValue({
      data: [{
        id: 7,
        stevilka: 1,
        ime: "Miza 1",
        kapaciteta: 4,
        status: "prosta",
        prostorId: 42,
        posX: 100,
        posY: 50,
        oblika: "pravokotnik_h",
      }],
    });

    render(
      <Wrapper queryClient={queryClient}>
        <Settings />
      </Wrapper>
    );

    // Expand the tloris row first
    const expandButton = await screen.findByRole("button", { name: /Tloris/i });
    fireEvent.click(expandButton);

    const button = await screen.findByRole("button", { name: "Ponastavi tloris" });
    fireEvent.click(button);
    expect(screen.getByText("Ponastavim tloris prostora?")).toBeTruthy();
    const confirmationButtons = screen.getAllByRole("button", { name: "Ponastavi tloris" });
    fireEvent.click(confirmationButtons.at(-1)!);

    expect(globalThis.mockResetProstorTloris).toHaveBeenCalledWith(
      { id: 42, data: { version: expect.any(Number) } },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });
});
