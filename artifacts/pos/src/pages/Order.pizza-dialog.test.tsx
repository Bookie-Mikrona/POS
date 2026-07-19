/**
 * Testi za splošni ModifikatorjiDialog tok pri pizzi z modSkupine
 *
 * Pokritost:
 * 1. Glasovni vnos "dodaj margherita" → dialog se odpre, addPostavka se NE pokliče takoj
 * 2. Toast "Dodano" se NE prikaže ob glasovnem vnosu pizze — šele po potrditvi dialoga
 * 3. Tap na pizza artikel → dialog se odpre (enako kot glasovni vnos)
 * 4. Zaprtje dialoga (Escape) → addPostavka se NE pokliče, dialog izgine
 * 5. "Prekliči" zapre dialog brez klicanja addPostavka
 * 6. Potrditev dialoga pokliče addPostavka ENKRAT z izbranModifikatorji (API ustvari child postavke)
 * 7. Glasovni vnos z več zadetki → razjasnitveni toast, brez addPostavka
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Order from "./Order";

// ── Vzorčni podatki ──────────────────────────────────────────────────────────

const NAROCILO_ID = 99;

const mockModifikator = {
  id: 100,
  skupinaId: 1,
  ime: "Sir",
  cenaDodatek: 0.50,
  aktiven: true,
  vrstniRed: 0,
};

const mockModSkupina = {
  id: 1,
  ime: "Dodatki za pico",
  obvezna: false,
  minIzbir: 0,
  maxIzbir: 99,
  vrstniRed: 0,
  modifikatorji: [mockModifikator],
};

const mockPica = {
  id: 10,
  ime: "Margherita",
  cena: 8.50,
  davek: 9.5,
  aktiven: true,
  kategorijaId: 1,
  kategorijaIme: "Pice",
  barva: null,
  vrstniRed: 1,
  prodajniArtikel: true,
  nabavniArtikel: false,
  jePica: true,
  jeDodatekZaPico: false,
  privzetiDodatki: [],
  privzetiModifikatorji: [100],
  modSkupine: [mockModSkupina],
};

const mockNarocilo = {
  id: NAROCILO_ID,
  mizaId: 5,
  mizaStevilka: 5,
  mizaIme: "Miza 5",
  status: "odprto",
  skupaj: 0,
  ddvNeskladje: null,
  postavke: [],
};

const mockKategorija = { id: 1, ime: "Pice", barva: null, vrstniRed: 1 };

const mockPicaMargherita = {
  id: 11,
  ime: "Pizza Margherita",
  cena: 8.50,
  davek: 9.5,
  aktiven: true,
  kategorijaId: 1,
  kategorijaIme: "Pice",
  barva: null,
  vrstniRed: 1,
  prodajniArtikel: true,
  nabavniArtikel: false,
  jePica: true,
  jeDodatekZaPico: false,
  privzetiDodatki: [],
  privzetiModifikatorji: [],
  modSkupine: [],
};

const mockPicaCapricciosa = {
  id: 12,
  ime: "Pizza Capricciosa",
  cena: 9.50,
  davek: 9.5,
  aktiven: true,
  kategorijaId: 1,
  kategorijaIme: "Pice",
  barva: null,
  vrstniRed: 2,
  prodajniArtikel: true,
  nabavniArtikel: false,
  jePica: true,
  jeDodatekZaPico: false,
  privzetiDodatki: [],
  privzetiModifikatorji: [],
  modSkupine: [],
};

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockAddPostavkaMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockListArtikliData = vi.hoisted(() => vi.fn());
const mockZacniGlasovni = vi.hoisted(() => vi.fn());

vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useParams: () => ({ id: String(NAROCILO_ID) }),
  useLocation: () => ["/narocilo/99", mockSetLocation],
  useSearch: () => "",
}));

vi.mock("@/lib/autoStartGuard", () => ({
  setSkipAutoStart: vi.fn(),
  clearSkipAutoStart: vi.fn(),
}));

vi.mock("@/contexts/AutoStartContext", () => ({
  useAutoStartRef: () => ({ current: { blocked: false, block: vi.fn(), unblock: vi.fn() } }),
  AutoStartProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-glasovni-ukaz", () => ({
  useGlasovniUkaz: () => ({
    zacni: mockZacniGlasovni,
    ustavi: vi.fn(),
    poslusam: false,
  }),
}));

vi.mock("@/hooks/use-glasovni-sinonimi", () => ({
  useGlasovniSinonimi: () => ({ sinonimi: [] }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: class {},
  TouchSensor: class {},
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  rectSortingStrategy: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: vi.fn(() => undefined) } },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetNarocilo: () => ({ data: mockNarocilo, isLoading: false }),
  useListArtikli: () => ({ data: mockListArtikliData(), isLoading: false }),
  useListKategorije: () => ({ data: [mockKategorija], isLoading: false }),
  useListMize: () => ({ data: [{ id: 5, stevilka: 5, ime: "Miza 5", status: "odprto", narocila: [] }] }),
  useListNarocila: () => ({ data: [] }),
  useListRacuni: () => ({ data: [] }),
  useGetRacunPostavke: () => ({ data: undefined, isLoading: false }),
  useAddPostavka: () => ({ mutate: mockAddPostavkaMutate, isPending: false }),
  useAddPostavkaModifikatorji: () => ({ mutate: vi.fn(), isPending: false }),
  useRemovePostavka: () => ({ mutate: vi.fn() }),
  useUpdatePostavkaKolicina: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useSpojiNarocili: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateNarocilo: () => ({ mutate: vi.fn(), isPending: false }),
  getGetNarociloQueryKey: (id: number) => ["/api/narocila", id],
  getListAktivnaNarocilaQueryKey: () => ["/api/narocila/aktivna"],
  getListNarocilaQueryKey: () => ["/api/narocila"],
  getListRacuniQueryKey: () => ["/api/racuni"],
  getGetRacunPostavkeQueryKey: (id: number) => ["/api/racuni", id, "postavke"],
}));

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({
    nastavitve: {
      nazivRestavracije: "Test",
      naslovRestavracije: "Testna 1",
      davcnaStevilka: "12345678",
      poslovniProstor: "PP001",
      elektronskaNaprava: "B001",
      testniNacin: true,
      grupiranjeNacin: "novo",
    },
    nastavitveLoading: false,
  }),
  NastavitveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/NapravaContext", () => ({
  useNaprava: () => ({
    naprava: null,
    napravaKljuc: "test-kljuc",
    napravaLoading: false,
    refreshNaprava: vi.fn(),
  }),
  NapravaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "natakar",
      ime: "Natakar",
      vloga: "natakar",
      podjetjeDavcna: "12345678",
      moraZamenjatiGeslo: false,
    },
    loading: false,
    login: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/DdvNeskladjeAlert", () => ({
  DdvNeskladjeAlert: () => null,
}));

// ── Pomožne funkcije ─────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children, qc }: { children: React.ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function klikniMikInPridobionResult(): Promise<(tekst: string) => void> {
  mockZacniGlasovni.mockClear();
  mockZacniGlasovni.mockImplementation((callbacks: { onResult: (t: string) => void }) => {
    return true;
  });

  const micButton = screen.getByTitle("Glasovni ukaz (npr. »dodaj pica«)");
  await act(async () => {
    fireEvent.click(micButton);
  });

  expect(mockZacniGlasovni).toHaveBeenCalled();
  const lastCall = mockZacniGlasovni.mock.calls[mockZacniGlasovni.mock.calls.length - 1] as [
    { onResult: (t: string) => void },
    ...unknown[]
  ];
  return lastCall[0].onResult;
}

// ── Testi ─────────────────────────────────────────────────────────────────────

describe("Order — splošni ModifikatorjiDialog za pico z modSkupine", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockToast.mockClear();
    mockAddPostavkaMutate.mockClear();
    mockSetLocation.mockClear();
    mockZacniGlasovni.mockClear();
    mockZacniGlasovni.mockReturnValue(true);
    mockListArtikliData.mockReturnValue([mockPica]);
  });

  // ── 1. Glasovni vnos → dialog (ne direct add) ──────────────────────────────

  it("glasovni ukaz 'dodaj margherita' odpre dialog — addPostavka se NE pokliče takoj", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    await screen.findByRole("button", { name: /Margherita/i });

    const onResult = await klikniMikInPridobionResult();

    await act(async () => {
      onResult("dodaj margherita");
    });

    await waitFor(() => {
      expect(screen.getByText(/Izberi možnosti pred potrditvijo/i)).toBeInTheDocument();
    });

    expect(mockAddPostavkaMutate).not.toHaveBeenCalled();
  });

  // ── 2. Glasovni vnos → brez "Dodano" toasta ────────────────────────────────

  it("glasovni vnos pizze NE sproži toast 'Dodano' — ko dialog čaka na potrditev", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    await screen.findByRole("button", { name: /Margherita/i });

    const onResult = await klikniMikInPridobionResult();

    await act(async () => {
      onResult("dodaj margherita");
    });

    await waitFor(() => {
      expect(screen.getByText(/Izberi možnosti pred potrditvijo/i)).toBeInTheDocument();
    });

    const dodanoToasti = mockToast.mock.calls.filter(
      (args: unknown[]) => {
        const opts = args[0] as { title?: string } | undefined;
        return typeof opts?.title === "string" && opts.title.startsWith("Dodano");
      },
    );
    expect(dodanoToasti).toHaveLength(0);
  });

  // ── 3. Tap → dialog (enako kot glasovni vnos) ─────────────────────────────

  it("tap na pico z modSkupine odpre dialog — NE pokliče addPostavka takoj", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const picaButton = await screen.findByRole("button", { name: /Margherita/i });

    await act(async () => {
      fireEvent.click(picaButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Izberi možnosti pred potrditvijo/i)).toBeInTheDocument();
    });

    expect(mockAddPostavkaMutate).not.toHaveBeenCalled();
  });

  // ── 4. Zaprtje dialoga → addPostavka se NE pokliče, stanje se ponastavi ────

  it("zaprtje dialoga (Escape) NE pokliče addPostavka, dialog izgine, brez 'Dodano' toasta", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const picaButton = await screen.findByRole("button", { name: /Margherita/i });

    await act(async () => {
      fireEvent.click(picaButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Izberi možnosti pred potrditvijo/i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape", code: "Escape", keyCode: 27 });
    });

    await waitFor(() => {
      expect(screen.queryByText(/Izberi možnosti pred potrditvijo/i)).not.toBeInTheDocument();
    });

    expect(mockAddPostavkaMutate).not.toHaveBeenCalled();

    const dodanoToasti = mockToast.mock.calls.filter((args: unknown[]) => {
      const opts = args[0] as { title?: string } | undefined;
      return typeof opts?.title === "string" && opts.title.startsWith("Dodano");
    });
    expect(dodanoToasti).toHaveLength(0);
  });

  // ── 5. "Prekliči" → dialog se zapre brez dodajanja ─────────────────────────

  it("'Prekliči' zapre dialog brez klicanja addPostavka", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const picaButton = await screen.findByRole("button", { name: /Margherita/i });

    await act(async () => {
      fireEvent.click(picaButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Izberi možnosti pred potrditvijo/i)).toBeInTheDocument();
    });

    const prekliciButton = screen.getByRole("button", { name: /Prekliči/i });
    await act(async () => {
      fireEvent.click(prekliciButton);
    });

    await waitFor(() => {
      expect(screen.queryByText(/Izberi možnosti pred potrditvijo/i)).not.toBeInTheDocument();
    });

    expect(mockAddPostavkaMutate).not.toHaveBeenCalled();
  });

  // ── 6. Potrditev dialoga → addPostavka enkrat z izbranModifikatorji ──────────

  it("potrditev dialoga pokliče addPostavka enkrat z izbranModifikatorji (API ustvari child postavke)", async () => {
    mockAddPostavkaMutate.mockImplementation(
      (
        _args: unknown,
        options?: { onSuccess?: (data: unknown) => void },
      ) => {
        options?.onSuccess?.({ ...mockNarocilo, postavke: [] });
      },
    );

    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const picaButton = await screen.findByRole("button", { name: /Margherita/i });

    await act(async () => {
      fireEvent.click(picaButton);
    });

    const potrdiButton = await screen.findByRole("button", { name: /Potrdi/i });

    await act(async () => {
      fireEvent.click(potrdiButton);
    });

    await waitFor(() => {
      expect(mockAddPostavkaMutate).toHaveBeenCalledTimes(1);
    });

    type MutateArgs = { id: number; data: Record<string, unknown> };
    const [prviKlic] = mockAddPostavkaMutate.mock.calls as [MutateArgs, ...unknown[]][];

    expect(prviKlic[0].id).toBe(NAROCILO_ID);
    expect(prviKlic[0].data.artikelId).toBe(mockPica.id);
    expect(Array.isArray(prviKlic[0].data.izbranModifikatorji)).toBe(true);
    const modifikatorji = prviKlic[0].data.izbranModifikatorji as Array<{ modifikatorId: number; ime: string; cenaDodatek: number }>;
    expect(modifikatorji).toEqual([{ modifikatorId: 100, ime: "Sir", cenaDodatek: 0.5 }]);
  });

  // ── 7. Glasovni vnos z več zadetki → razjasnitveni toast, brez addPostavka ──

  it("glasovni ukaz 'dodaj pizza' z dvema pizzama NE pokliče addPostavka in prikaže razjasnitveni toast", async () => {
    mockListArtikliData.mockReturnValue([mockPicaMargherita, mockPicaCapricciosa]);

    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    await screen.findByRole("button", { name: /Pizza Margherita/i });

    const onResult = await klikniMikInPridobionResult();

    await act(async () => {
      onResult("dodaj pizza");
    });

    await waitFor(() => {
      const toastKlici = mockToast.mock.calls as Array<[{ title?: string; description?: string }]>;
      const razjasnitveni = toastKlici.find(([opts]) =>
        typeof opts?.title === "string" && opts.title.includes("zadetkov") && opts.title.includes("pizza"),
      );
      expect(razjasnitveni).toBeDefined();
      expect(razjasnitveni![0].description).toMatch(/Izberi artikel/i);
    });

    expect(mockAddPostavkaMutate).not.toHaveBeenCalled();

    expect(screen.queryByText(/Izberi možnosti pred potrditvijo/i)).not.toBeInTheDocument();
  });
});
