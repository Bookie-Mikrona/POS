/**
 * Testi za glasovni vnos in tap pice BREZ dodeljene modifikatorske skupine (modSkupine=[])
 *
 * Pričakovano vedenje:
 * - Ko ima pica prazno modSkupine, handleAddArtikel preskoči dialog
 *   in pokliče addPostavka TAKOJ (vrne "direct").
 * - Glasovni ukaz za tako pico NE odpre dialoga in prikaže toast "Dodano: ...".
 * - Tap na tako pico NE odpre dialoga in pokliče addPostavka takoj.
 *
 * To dokumentira namerno obnašanje: dialog se prikaže le kadar ima pica
 * dodeljeno modifikatorsko skupino (modSkupine.length > 0).
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Order, { selectOrderKdsNalogi } from "./Order";
import type { KdsNalog } from "@/hooks/use-kds";

// ── Vzorčni podatki ──────────────────────────────────────────────────────────

const NAROCILO_ID = 99;

/** Pica brez dodeljene modifikatorske skupine */
const mockPicaBrezDodatkov = {
  id: 11,
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
  privzetiModifikatorji: [],
  modSkupine: [],   // <-- ključno: brez modifikatorske skupine → direktno dodajanje
};
const mockArtikli = [mockPicaBrezDodatkov];

const mockNarocilo = {
  id: NAROCILO_ID,
  mizaId: 5,
  mizaStevilka: 5,
  mizaIme: "Miza 5",
  status: "odprto",
  skupaj: 0,
  ddvNeskladje: null,
  postavke: [] as Array<Record<string, unknown>>,
};

const mockKategorija = { id: 1, ime: "Pice", barva: null, vrstniRed: 1 };

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockAddPostavkaMutate = vi.hoisted(() => vi.fn());
const mockUpdatePostavkaMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockZacniGlasovni = vi.hoisted(() => vi.fn());
const mockKdsState = vi.hoisted(() => ({
  stations: [] as Array<{ id: number; ime: string; tip: string }>,
  nalogi: [] as KdsNalog[],
}));

vi.mock("@/hooks/use-kds", () => ({
  useKdsPostaje: () => ({ data: mockKdsState.stations }),
  useKdsNalogiVecPostaj: () => [{ data: mockKdsState.nalogi }],
  useFireKdsCourse: () => ({ mutate: vi.fn(), isPending: false }),
}));
// Lunch quoting is a separate flow, outside these order-line regressions.
vi.mock("@/components/DailyLunchOrderFlow", () => ({
  DailyLunchOrderFlow: () => null,
}));

vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(
    String(url).includes("/api/ai/glasovni-ukaz")
      ? { postavke: [{ artikelId: mockPicaBrezDodatkov.id, kolicina: 1, modifikatorji: [] }] }
      : {},
  ),
})));

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

vi.mock("@/contexts/HappyHourContext", () => ({
  useHappyHour: () => ({ status: null, loading: false, setRocno: vi.fn(), refresh: vi.fn() }),
  HappyHourProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
  useGetKdsNastavitve: () => ({ data: undefined }),
  getGetKdsNastavitveQueryKey: () => ["/api/kds/nastavitve"],
  useGetNarocilo: () => ({ data: mockNarocilo, isLoading: false }),
  useListArtikli: () => ({ data: mockArtikli, isLoading: false }),
  getListArtikliQueryKey: () => ["/api/artikli"],
  useGetPreparedFoodAvailability: () => ({ data: { businessDate: "2026-08-28", items: [] }, isLoading: false }),
  getGetPreparedFoodAvailabilityQueryKey: () => ["/prepared-food/availability"],
  useListKategorije: () => ({ data: [mockKategorija], isLoading: false }),
  getListKategorijeQueryKey: () => ["/api/kategorije"],
  useListDnevniMeni: () => ({ data: [], isLoading: false }),
  useListProstori: () => ({ data: [], isLoading: false }),
  useListMize: () => ({ data: [{ id: 5, stevilka: 5, ime: "Miza 5", status: "odprto", narocila: [] }] }),
  useListNarocila: () => ({ data: [] }),
  useListRacuni: () => ({ data: [] }),
  useGetRacunPostavke: () => ({ data: undefined, isLoading: false }),
  useAddPostavka: () => ({ mutate: mockAddPostavkaMutate, isPending: false }),
  useAddMulticourseMenu: () => ({ mutate: vi.fn(), isPending: false }),
  customFetch: vi.fn(() => Promise.resolve([])),
  useAddPostavkaModifikatorji: () => ({ mutate: vi.fn(), isPending: false }),
  useRemovePostavka: () => ({ mutate: vi.fn() }),
  useUpdatePostavkaKolicina: () => ({ mutate: mockUpdatePostavkaMutate, mutateAsync: vi.fn() }),
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
  mockZacniGlasovni.mockImplementation((_callbacks: { onResult: (t: string) => void }) => true);

  const micButton = screen.getAllByTitle("Glasovni ukaz — naroči s prostim govorom")[0];
  await act(async () => {
    fireEvent.click(micButton);
  });

  expect(mockZacniGlasovni).toHaveBeenCalled();
  const lastCall = mockZacniGlasovni.mock.calls[mockZacniGlasovni.mock.calls.length - 1] as [
    { onResult: (t: string) => void },
    ...unknown[]
  ];
  return (tekst: string) => {
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 4500 && typeof fn === "function") {
        return originalSetTimeout(fn, 0, ...args);
      }
      return originalSetTimeout(fn, delay, ...args);
    }) as typeof setTimeout;
    lastCall[0].onResult(tekst);
    globalThis.setTimeout = originalSetTimeout;
  };
}

// ── Testi ─────────────────────────────────────────────────────────────────────

describe("Order — pica BREZ modifikatorske skupine (modSkupine=[])", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockToast.mockClear();
    mockAddPostavkaMutate.mockClear();
    mockUpdatePostavkaMutate.mockClear();
    mockSetLocation.mockClear();
    mockZacniGlasovni.mockClear();
    mockZacniGlasovni.mockReturnValue(true);
    mockArtikli.splice(0, mockArtikli.length, mockPicaBrezDodatkov);
    mockNarocilo.postavke = [];
    mockKdsState.stations = [];
    mockKdsState.nalogi = [];
  });

  it("colors the actual order row by its KDS ticket and updates it when prepared", async () => {
    mockNarocilo.postavke = [{
      id: 7, artikelId: 11, ime: "Margherita", kolicina: 1, cenaKos: 8.5,
      skupaj: 8.5, davek: 9.5, parentPostavkaId: null, racunId: null,
    }];
    mockKdsState.stations = [{ id: 1, ime: "Pica", tip: "pizza" }];
    mockKdsState.nalogi = [{
      id: 1, enotaId: 1, postajaId: 1, narociloId: NAROCILO_ID, postavkaId: 7,
      stanje: "aktivno", uporabljenFallback: false,
      ustvarjeno: new Date(Date.now() - 21 * 60_000).toISOString(),
    }];
    const view = render(<Wrapper qc={qc}><Order /></Wrapper>);
    expect(await screen.findByTestId("order-item-7")).toHaveClass("bg-transparent", "border", "border-red-400");
    expect(screen.getByTestId("order-item-7")).not.toHaveClass("bg-red-100", "text-slate-900");
    expect(screen.getByTestId("order-item-kds-status-7").firstElementChild).toHaveClass("bg-red-500");
    expect(screen.getByTestId("order-item-kds-status-7")).toHaveTextContent("Pica: V pripravi");
    expect(screen.getByTestId("order-item-quantity-7"))
      .toContainElement(screen.getByTestId("order-item-kds-status-7"));
    mockKdsState.nalogi = [{ ...mockKdsState.nalogi[0], stanje: "bumped" }];
    view.rerender(<Wrapper qc={qc}><Order /></Wrapper>);
    expect(screen.getByTestId("order-item-7")).toHaveClass("bg-transparent", "border", "border-blue-500");
    expect(screen.getByTestId("order-item-7")).not.toHaveClass("bg-blue-100");
    expect(screen.getByTestId("order-item-kds-status-7").firstElementChild).toHaveClass("bg-blue-600");
    expect(screen.getByTestId("order-item-kds-status-7")).toHaveTextContent("Pripravljeno");
  });

  // ── 1. Glasovni vnos → direct add, brez dialoga ───────────────────────────

  it("glasovni ukaz 'dodaj margherita' pokliče addPostavka takoj — dialog se NE odpre", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    await screen.findByRole("button", { name: /Margherita/i });

    const onResult = await klikniMikInPridobionResult();

    await act(async () => {
      onResult("dodaj margherita");
    });

    // addPostavka.mutate mora biti poklicana takoj (direktna pot)
    await waitFor(() => {
      expect(mockAddPostavkaMutate).toHaveBeenCalledTimes(1);
    });

    // ModifikatorjiDialog se NE sme odpreti
    expect(screen.queryByText(/Izberi možnosti pred potrditvijo/i)).not.toBeInTheDocument();

    // Klic mora vsebovati pravilni artikelId
    type MutateArgs = { id: number; data: Record<string, unknown> };
    const klic = (mockAddPostavkaMutate.mock.calls[0] as [MutateArgs, ...unknown[]])[0];
    expect(klic.id).toBe(NAROCILO_ID);
    expect(klic.data.artikelId).toBe(mockPicaBrezDodatkov.id);
    // izbranModifikatorji se NE pošlje pri direktni poti (brez dialoga)
    expect(klic.data.izbranModifikatorji).toBeUndefined();
  });

  // ── 2. Glasovni vnos → toast "Dodano" se prikaže (direktna pot) ──────────

  it("glasovni ukaz za pico brez dodatkev prikaže toast 'Dodano: Margherita'", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    await screen.findByRole("button", { name: /Margherita/i });

    const onResult = await klikniMikInPridobionResult();

    await act(async () => {
      onResult("dodaj margherita");
    });

    // Toast "Dodano: Margherita" se mora prikazati (glasovni onResult to naredi za direktno pot)
    await waitFor(() => {
      const dodanoToasti = mockToast.mock.calls.filter((args: unknown[]) => {
        const opts = args[0] as { title?: string } | undefined;
        return typeof opts?.title === "string" && opts.title.startsWith("Dodano");
      });
      expect(dodanoToasti).toHaveLength(1);
    });
  });

  // ── 3. Tap → direct add, brez dialoga ────────────────────────────────────

  it("tap na pico brez privzetih dodatkev pokliče addPostavka takoj — dialog se NE odpre", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const picaButton = await screen.findByRole("button", { name: /Margherita/i });

    await act(async () => {
      fireEvent.click(picaButton);
    });

    // addPostavka.mutate mora biti poklicana takoj
    await waitFor(() => {
      expect(mockAddPostavkaMutate).toHaveBeenCalledTimes(1);
    });

    // ModifikatorjiDialog se NE sme odpreti
    expect(screen.queryByText(/Izberi možnosti pred potrditvijo/i)).not.toBeInTheDocument();

    type MutateArgs = { id: number; data: Record<string, unknown> };
    const klic = (mockAddPostavkaMutate.mock.calls[0] as [MutateArgs, ...unknown[]])[0];
    expect(klic.id).toBe(NAROCILO_ID);
    expect(klic.data.artikelId).toBe(mockPicaBrezDodatkov.id);
  });

  it("po vklopu To Go pri vroči pijači prikaže opozorilo, ki ga je mogoče opustiti", async () => {
    const caj = {
      id: 12,
      ime: "Čaj",
      cena: 3,
      davek: 22,
      aktiven: true,
      kategorijaId: 1,
      kategorijaIme: "Pijače",
      barva: null,
      vrstniRed: 2,
      prodajniArtikel: true,
      nabavniArtikel: false,
      jePica: false,
      jeDodatekZaPico: false,
      privzetiDodatki: [],
      privzetiModifikatorji: [],
      toGo: true,
      taxCategory: "hot_beverage",
      modSkupine: [],
    };
    mockArtikli.push(caj);
    mockNarocilo.postavke = [{
      id: 21,
      artikelId: caj.id,
      ime: caj.ime,
      cenaKos: caj.cena,
      kolicina: 1,
      skupaj: caj.cena,
      davek: caj.davek,
      toGo: false,
      racunId: null,
      parentPostavkaId: null,
      modifikatorId: null,
    }];
    mockUpdatePostavkaMutate.mockImplementation((_args: unknown, options?: { onSuccess?: (value: typeof mockNarocilo) => void }) => {
      options?.onSuccess?.(mockNarocilo);
    });

    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const toGoButton = await screen.findByTitle("Dodaj To Go embalažo");
    await act(async () => {
      fireEvent.click(toGoButton);
    });

    expect(await screen.findByTestId("to-go-ddv-warning")).toHaveTextContent(
      "Nekatere postavke imajo starejšo DDV stopnjo — odstranite in znova dodajte, da se DDV posodobi",
    );

    fireEvent.click(screen.getByRole("button", { name: "Opusti opozorilo o DDV pri To Go" }));
    expect(screen.queryByTestId("to-go-ddv-warning")).not.toBeInTheDocument();
  });

  it("selects held gateway KDS courses by opaque local order ID", () => {
    const selected = selectOrderKdsNalogi([
      { narociloId: "opaque-uuid", stanje: "zadrzano", courseNumber: 2 },
      { narociloId: "other-order", stanje: "zadrzano", courseNumber: 2 },
    ], true, "opaque-uuid", undefined);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.narociloId).toBe("opaque-uuid");
    expect(selected[0]?.courseNumber).toBe(2);
  });
});
