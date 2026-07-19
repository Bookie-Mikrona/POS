import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { NastavitveProvider } from "./NastavitveContext";
import type { Nastavitve } from "@workspace/api-client-react";

const QUERY_KEY = ["/api/nastavitve"] as const;

const mockUseGetNastavitve = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetNastavitve: (opts: unknown) => mockUseGetNastavitve(opts),
  getGetNastavitveQueryKey: () => QUERY_KEY,
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
      <NastavitveProvider>{children}</NastavitveProvider>
    </QueryClientProvider>
  );
}

function fireStorageEvent(key: string, newValue: string | null) {
  const event = new StorageEvent("storage", { key, newValue });
  act(() => {
    window.dispatchEvent(event);
  });
}

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

describe("NastavitveContext — storage event sinhronizacija", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    localStorage.clear();
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("posodobi React Query cache ob veljavnem StorageEvent", () => {
    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    const entry = { data: mockNastavitve, ts: Date.now() };
    fireStorageEvent("nastavitve", JSON.stringify(entry));

    const cached = queryClient.getQueryData<Nastavitve>(QUERY_KEY);
    expect(cached).toEqual(mockNastavitve);
  });

  it("newValue === null (brisanje) ne pobriše cache", () => {
    queryClient.setQueryData<Nastavitve>(QUERY_KEY, mockNastavitve);

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    fireStorageEvent("nastavitve", null);

    const cached = queryClient.getQueryData<Nastavitve>(QUERY_KEY);
    expect(cached).toEqual(mockNastavitve);
  });

  it("neveljaven JSON ne povzroči napake in ne spremeni cache", () => {
    queryClient.setQueryData<Nastavitve>(QUERY_KEY, mockNastavitve);

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    expect(() => {
      fireStorageEvent("nastavitve", "{ to ni veljaven json }}}");
    }).not.toThrow();

    const cached = queryClient.getQueryData<Nastavitve>(QUERY_KEY);
    expect(cached).toEqual(mockNastavitve);
  });

  it("StorageEvent z drugačnim ključem ne posodobi cache", () => {
    queryClient.setQueryData<Nastavitve>(QUERY_KEY, mockNastavitve);

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    const drugEntry = {
      data: { ...mockNastavitve, nazivRestavracije: "Drug naziv" },
      ts: Date.now(),
    };
    fireStorageEvent("drug-kljuc", JSON.stringify(drugEntry));

    const cached = queryClient.getQueryData<Nastavitve>(QUERY_KEY);
    expect(cached).toEqual(mockNastavitve);
  });
});

describe("NastavitveContext — localStorage cache warm-up ob zagonu", () => {
  const TTL_MS = 5 * 60 * 1000;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    localStorage.clear();
    mockUseGetNastavitve.mockClear();
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: false });
  });

  it("svež vnos v localStorage (znotraj TTL) — useGetNastavitve prejme initialData in initialDataUpdatedAt, ki preprečita fetch", () => {
    const ts = Date.now();
    localStorage.setItem("nastavitve", JSON.stringify({ data: mockNastavitve, ts }));

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    expect(mockUseGetNastavitve).toHaveBeenCalledOnce();
    const { query } = mockUseGetNastavitve.mock.calls[0][0] as {
      query: { initialData: Nastavitve; initialDataUpdatedAt: number; staleTime: number };
    };

    // Pravi podatki iz localStorage morajo biti posredovani kot initialData
    expect(query.initialData).toEqual(mockNastavitve);
    // Časovni žig mora biti ohranjen, da React Query pravilno presodi svežost
    expect(query.initialDataUpdatedAt).toBe(ts);
    // staleTime mora biti enak TTL_MS
    expect(query.staleTime).toBe(TTL_MS);
    // Ker je razlika manjša od staleTime, React Query ne bo sprožil fetcha
    expect(Date.now() - query.initialDataUpdatedAt).toBeLessThan(TTL_MS);
  });

  it("zastarel vnos (ts starejši od TTL_MS) — initialDataUpdatedAt kaže zastarelost, React Query sproži fetch", () => {
    const staleTs = Date.now() - TTL_MS - 1000;
    localStorage.setItem("nastavitve", JSON.stringify({ data: mockNastavitve, ts: staleTs }));

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    expect(mockUseGetNastavitve).toHaveBeenCalledOnce();
    const { query } = mockUseGetNastavitve.mock.calls[0][0] as {
      query: { initialData: Nastavitve; initialDataUpdatedAt: number; staleTime: number };
    };

    // Podatki so prisotni kot initialData
    expect(query.initialData).toEqual(mockNastavitve);
    // Ker je razlika med now() in initialDataUpdatedAt večja od staleTime,
    // React Query podatke obravnava kot zastarele in sproži fetch
    expect(Date.now() - query.initialDataUpdatedAt).toBeGreaterThan(TTL_MS);
  });

  it("ključ 'nastavitve' manjka v localStorage — initialData je undefined in initialDataUpdatedAt je 0, fetch se sproži normalno", () => {
    // localStorage je prazen (clear v beforeEach) — simuliramo prvi obisk

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    expect(mockUseGetNastavitve).toHaveBeenCalledOnce();
    const { query } = mockUseGetNastavitve.mock.calls[0][0] as {
      query: { initialData: Nastavitve | undefined; initialDataUpdatedAt: number; staleTime: number };
    };

    // Brez shranjenih podatkov mora initialData biti undefined
    expect(query.initialData).toBeUndefined();
    // initialDataUpdatedAt mora biti 0 (privzeto) — React Query nemudoma sproži fetch
    expect(query.initialDataUpdatedAt).toBe(0);
  });
});

describe("NastavitveContext — localStorage zapisovanje", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
    localStorage.clear();
  });

  it("zapiše nastavitve v localStorage, ko useGetNastavitve vrne podatke", () => {
    mockUseGetNastavitve.mockReturnValue({ data: mockNastavitve, isLoading: false });

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    const raw = localStorage.getItem("nastavitve");
    expect(raw).not.toBeNull();
    const entry = JSON.parse(raw!) as { data: Nastavitve; ts: number };
    expect(entry.data).toEqual(mockNastavitve);
    expect(typeof entry.ts).toBe("number");
  });

  it("zapisani objekt vsebuje polje ts s časovnim žigom", () => {
    const pred = Date.now();
    mockUseGetNastavitve.mockReturnValue({ data: mockNastavitve, isLoading: false });

    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    const raw = localStorage.getItem("nastavitve");
    const entry = JSON.parse(raw!) as { data: Nastavitve; ts: number };
    expect(entry.ts).toBeGreaterThanOrEqual(pred);
    expect(entry.ts).toBeLessThanOrEqual(Date.now());
  });

  it("posodobljene nastavitve prepiše obstoječe v localStorage", () => {
    const stareNastavitve: Nastavitve = { ...mockNastavitve, nazivRestavracije: "Stara restavracija" };
    const noveNastavitve: Nastavitve = { ...mockNastavitve, nazivRestavracije: "Nova restavracija" };

    mockUseGetNastavitve.mockReturnValue({ data: stareNastavitve, isLoading: false });
    const { rerender } = render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    let raw = localStorage.getItem("nastavitve");
    expect(JSON.parse(raw!).data.nazivRestavracije).toBe("Stara restavracija");

    mockUseGetNastavitve.mockReturnValue({ data: noveNastavitve, isLoading: false });
    rerender(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    raw = localStorage.getItem("nastavitve");
    expect(JSON.parse(raw!).data.nazivRestavracije).toBe("Nova restavracija");
  });

  it("StorageEvent posodobi cache in se nastavitve ne zapišejo nazaj v localStorage iz tega zavihka", () => {
    mockUseGetNastavitve.mockReturnValue({ data: undefined, isLoading: false });
    render(<Wrapper queryClient={queryClient}><span /></Wrapper>);

    const noveNastavitve: Nastavitve = { ...mockNastavitve, nazivRestavracije: "Iz drugega zavihka" };
    const entry = { data: noveNastavitve, ts: Date.now() };
    fireStorageEvent("nastavitve", JSON.stringify(entry));

    const cached = queryClient.getQueryData<Nastavitve>(QUERY_KEY);
    expect(cached).toEqual(noveNastavitve);
  });
});
