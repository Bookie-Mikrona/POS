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
import Order from "./Order";

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

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockAddPostavkaMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());
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
  useListArtikli: () => ({ data: [mockPicaBrezDodatkov], isLoading: false }),
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
  mockZacniGlasovni.mockImplementation((_callbacks: { onResult: (t: string) => void }) => true);

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

describe("Order — pica BREZ modifikatorske skupine (modSkupine=[])", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockToast.mockClear();
    mockAddPostavkaMutate.mockClear();
    mockSetLocation.mockClear();
    mockZacniGlasovni.mockClear();
    mockZacniGlasovni.mockReturnValue(true);
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
});
