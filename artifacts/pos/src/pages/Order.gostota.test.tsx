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
const mockUpdatePostavkaAsync = vi.hoisted(() => vi.fn());
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
  useListDailyLunchOffers: () => ({ data: { offers: [] }, isLoading: false }),
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
  useUpdatePostavkaKolicina: () => ({ mutate: mockUpdatePostavkaMutate, mutateAsync: mockUpdatePostavkaAsync }),
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
    naprava: (globalThis as { __testNaprava?: unknown }).__testNaprava ?? null,
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

describe("Order — gostota artiklov (nastavitev naprave)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockToast.mockClear();
    mockAddPostavkaMutate.mockClear();
    mockUpdatePostavkaMutate.mockClear();
    mockUpdatePostavkaAsync.mockReset();
    mockSetLocation.mockClear();
    mockZacniGlasovni.mockClear();
    mockZacniGlasovni.mockReturnValue(true);
    mockArtikli.splice(0, mockArtikli.length, mockPicaBrezDodatkov);
    mockNarocilo.postavke = [];
    mockKdsState.stations = [];
    mockKdsState.nalogi = [];
  });


  const naprava = (gostota: string) => ({ id: 1, ime: "t", napravaKljuc: "k", enotaId: 1, podjetjeDavcna: "x", placilniTerminal: null, gostotaArtiklov: gostota, prikazMenija: "trenutno", prikazNarocila: "staro", ustvarjeno: "", posodobljeno: "" });

  for (const g of ["privzeto", "kompaktno", "seznam", "velika"]) {
    it(`gostota '${g}': mreža se prilagodi, artikel ostane dosegljiv in dodajanje deluje enako`, async () => {
      (globalThis as { __testNaprava?: unknown }).__testNaprava = naprava(g);
      await act(async () => { render(<Wrapper qc={qc}><Order /></Wrapper>); });
      const gumb = await screen.findByRole("button", { name: /Margherita/i });
      const mreza = screen.getByTestId("artikli-mreza");
      expect(mreza.getAttribute("data-gostota")).toBe(g);
      if (g === "seznam") expect(mreza.className).toContain("grid-cols-1");
      if (g === "privzeto") expect(mreza.className).toBe("grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 pb-20 md:pb-4");
      await act(async () => { fireEvent.click(gumb); });
      await waitFor(() => expect(mockAddPostavkaMutate).toHaveBeenCalledTimes(1));
      type MutateArgs = { id: number; data: Record<string, unknown> };
      const klic = (mockAddPostavkaMutate.mock.calls[0] as [MutateArgs, ...unknown[]])[0];
      expect(klic.id).toBe(NAROCILO_ID);
      expect(klic.data.artikelId).toBe(mockPicaBrezDodatkov.id);
    });
  }
});
