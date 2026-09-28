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
import { render, fireEvent, screen, waitFor, act, within } from "@testing-library/react";
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

const mockRazrezTrikotni = {
  id: 101,
  skupinaId: 2,
  ime: "Trikotni razrez (New York style)",
  cenaDodatek: 0,
  aktiven: true,
  vrstniRed: 1,
};

const mockRazrezStirikotni = {
  id: 102,
  skupinaId: 2,
  ime: "Kvadratni razrez (Party cut)",
  cenaDodatek: 0,
  aktiven: true,
  vrstniRed: 2,
};

const mockRazrezPolovica = {
  id: 103,
  skupinaId: 2,
  ime: "Razrez na polovico",
  cenaDodatek: 0,
  aktiven: true,
  vrstniRed: 3,
};

const mockBrezCebule = {
  id: 104,
  skupinaId: 1,
  ime: "Brez čebule",
  cenaDodatek: 0,
  aktiven: true,
  vrstniRed: 4,
};

const mockBrezRazreza = {
  id: 105,
  skupinaId: 2,
  ime: "Brez razreza",
  cenaDodatek: 0,
  aktiven: true,
  vrstniRed: 0,
};

const mockRazrezCetrtina = {
  id: 106,
  skupinaId: 2,
  ime: "Razrez na četrtino",
  cenaDodatek: 0,
  aktiven: true,
  vrstniRed: 4,
};

const mockModSkupina = {
  id: 1,
  ime: "Dodatki za pico",
  obvezna: false,
  minIzbir: 0,
  maxIzbir: 99,
  vrstniRed: 0,
  modifikatorji: [
    mockModifikator,
    mockBrezCebule,
  ],
};

const mockRazrezSkupina = {
  id: 2,
  ime: "Razrez",
  obvezna: true,
  minIzbir: 1,
  maxIzbir: 1,
  vrstniRed: 1,
  modifikatorji: [
    mockBrezRazreza,
    mockRazrezTrikotni,
    mockRazrezStirikotni,
    mockRazrezPolovica,
    mockRazrezCetrtina,
  ],
};

const mockPica = {
  id: 10,
  ime: "Margherita",
  cena: 8.50,
  cenaMala: 7.00,
  cenaDruzinska: 12.00,
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
  privzetiModifikatorji: [100, 105],
  modSkupine: [mockModSkupina, mockRazrezSkupina],
};

const mockNarocilo = {
  id: NAROCILO_ID,
  mizaId: 5,
  mizaStevilka: 5,
  mizaIme: "Miza 5",
  nacin: "miza",
  vir: "qr_gost",
  predvidenPrevzem: "2026-08-28T12:30:00.000Z",
  predvidenPrevzemRocen: false,
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
const mockAddPostavkaModifikatorjiMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockListArtikliData = vi.hoisted(() => vi.fn());
const mockZacniGlasovni = vi.hoisted(() => vi.fn());
const mockModifierNormatives = vi.hoisted(() => ({ current: {} as Record<number, unknown[]> }));
const mockOrderForOptions = vi.hoisted(() => ({ current: null as unknown }));
const mockPizzaAvailability = vi.hoisted(() => ({
  current: [] as Array<{
    articleId: number;
    availableQuantity: number | null;
    availableBySize: Partial<Record<"mala" | "normalna" | "druzinska", number | null>>;
  }>,
}));

vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => Promise.resolve({
  ok: true,
  json: () => {
    const artikli = mockListArtikliData();
    const body = options?.body ? JSON.parse(String(options.body)) as { transkript?: string } : {};
    const jeMalaZRazrezom = body.transkript?.includes("mala") && body.transkript.includes("razrez");
    return Promise.resolve(
      String(url).includes("/api/ai/glasovni-ukaz")
        ? {
            postavke: artikli.length === 1
              ? [{
                  artikelId: artikli[0].id,
                  kolicina: 1,
                  modifikatorji: jeMalaZRazrezom ? [mockRazrezTrikotni.id] : [],
                  ...(jeMalaZRazrezom ? { velikostPice: "mala" } : {}),
                }]
              : [],
          }
        : {},
    );
  },
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
  useGetNarocilo: () => ({ data: mockOrderForOptions.current ?? mockNarocilo, isLoading: false }),
  useListArtikli: () => ({ data: mockListArtikliData(), isLoading: false }),
  getListArtikliQueryKey: () => ["/api/artikli"],
  getGetModifikatorNormativiQueryKey: (id: number) => [`/api/modifikatorji/${id}/normativi`],
  getGetModifikatorNormativiQueryOptions: (id: number, options?: { query?: Record<string, unknown> }) => ({
    queryKey: options?.query?.queryKey ?? [`/api/modifikatorji/${id}/normativi`],
    queryFn: () => Promise.resolve(mockModifierNormatives.current[id] ?? []),
    ...options?.query,
  }),
  useGetPreparedFoodAvailability: () => ({ data: {
    businessDate: "2026-08-28", items: mockPizzaAvailability.current,
    modifierItems: [{ modifierId: 100, availableQuantity: 3 }],
  }, isLoading: false }),
  getGetPreparedFoodAvailabilityQueryKey: () => ["/prepared-food/availability"],
  useGetKdsNastavitve: () => ({ data: undefined, isLoading: false }),
  getGetKdsNastavitveQueryKey: () => ["/api/kds/nastavitve"],
  useListKategorije: () => ({ data: [mockKategorija], isLoading: false }),
  getListKategorijeQueryKey: () => ["/api/kategorije"],
  useListDnevniMeni: () => ({ data: [], isLoading: false }),
  useListProstori: () => ({
    data: [
      { id: 1, ime: "Terasa" },
      { id: 2, ime: "Salon" },
    ],
    isLoading: false,
  }),
  useListMize: () => ({
    data: [
      { id: 5, stevilka: 5, ime: "Miza 5", prostorId: 1, status: "zasedena", narocila: [] },
      { id: 8, stevilka: 8, ime: "Miza 8", prostorId: 2, status: "prosta", kapaciteta: 4, narocila: [] },
    ],
  }),
  useListNarocila: () => ({ data: [] }),
  useListRacuni: () => ({ data: [] }),
  useGetRacunPostavke: () => ({ data: undefined, isLoading: false }),
  useAddPostavka: () => ({ mutate: mockAddPostavkaMutate, isPending: false }),
  ApiError: class ApiError extends Error {},
  useAddMulticourseMenu: () => ({ mutate: vi.fn(), isPending: false }),
  useListDailyLunchOffers: () => ({ data: [], isLoading: false }),
  useQuoteDailyLunch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddDailyLunchToOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  customFetch: vi.fn(() => Promise.resolve([])),
  useAddPostavkaModifikatorji: () => ({ mutate: mockAddPostavkaModifikatorjiMutate, isPending: false }),
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
      picaPremerMala: 26,
      picaPremerNormalna: 32,
      picaPremerDruzinska: 40,
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
    // Prepoznava obravnava ukaz po 4,5 s tišine. V testu sprožimo samo ta
    // zaključek takoj, ne pa tudi zaščitnega 60-sekundnega časovnika.
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

function prepareExistingNestedModifierEdit() {
  const garlicOption = { id: 201, skupinaId: 20, ime: "Brez česna", cenaDodatek: 0, aktiven: true, vrstniRed: 0 };
  const lessGarlicOption = { id: 202, skupinaId: 20, ime: "Manj česna", cenaDodatek: 0, aktiven: true, vrstniRed: 1 };
  const saltOption = { id: 203, skupinaId: 21, ime: "Brez soli", cenaDodatek: 0, aktiven: true, vrstniRed: 0 };
  const makeSource = (id: number, ime: string, groupId: number, groupName: string, options: Array<typeof garlicOption>) => ({
    ...mockPicaMargherita,
    id,
    ime,
    jePica: false,
    modSkupine: [{
      id: groupId,
      ime: groupName,
      obvezna: true,
      minIzbir: 1,
      maxIzbir: 1,
      vrstniRed: 0,
      modifikatorji: options,
    }],
  });
  const sourceA = makeSource(200, "Zelena solata – mala", 20, "Zelena solata", [garlicOption, lessGarlicOption]);
  const sourceB = makeSource(202, "Juha – mala", 21, "Dodatki juhe", [saltOption]);
  mockListArtikliData.mockReturnValue([mockPica, sourceA, sourceB]);
  mockModifierNormatives.current = {
    100: [
      { id: 1, vhodniArtikelId: sourceA.id, artikelIme: sourceA.ime, kolicina: 1 },
      { id: 2, vhodniArtikelId: sourceB.id, artikelIme: sourceB.ime, kolicina: 1 },
    ],
  };
  mockOrderForOptions.current = {
    ...mockNarocilo,
    postavke: [
      { id: 501, artikelId: mockPica.id, ime: mockPica.ime, kolicina: 1, cenaKos: 8.5, skupaj: 8.5, racunId: null, parentPostavkaId: null },
      { id: 502, artikelId: null, modifikatorId: 100, ime: "Sir", kolicina: 1, cenaKos: 0.5, skupaj: 0.5, racunId: null, parentPostavkaId: 501 },
      { id: 505, artikelId: null, modifikatorId: 105, ime: "Brez razreza", kolicina: 1, cenaKos: 0, skupaj: 0, racunId: null, parentPostavkaId: 501 },
      { id: 503, artikelId: null, modifikatorId: garlicOption.id, modifierSourceArticleId: sourceA.id, ime: garlicOption.ime, kolicina: 1, cenaKos: 0, skupaj: 0, racunId: null, parentPostavkaId: 502 },
      { id: 504, artikelId: null, modifikatorId: saltOption.id, modifierSourceArticleId: sourceB.id, ime: saltOption.ime, kolicina: 1, cenaKos: 0, skupaj: 0, racunId: null, parentPostavkaId: 502 },
    ],
  };
  return { sourceA, sourceB, garlicOption, lessGarlicOption, saltOption };
}

// ── Testi ─────────────────────────────────────────────────────────────────────

describe("Order — splošni ModifikatorjiDialog za pico z modSkupine", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockToast.mockClear();
    mockAddPostavkaMutate.mockClear();
    mockAddPostavkaModifikatorjiMutate.mockClear();
    mockSetLocation.mockClear();
    mockZacniGlasovni.mockClear();
    mockZacniGlasovni.mockReturnValue(true);
    mockListArtikliData.mockReturnValue([mockPica]);
    mockModifierNormatives.current = {};
    mockOrderForOptions.current = null;
    mockPizzaAvailability.current = [];
  });

  it("v kartici ne prikaže izpuščene velikosti kot neskončno zalogo", async () => {
    mockPizzaAvailability.current = [{
      articleId: mockPica.id,
      availableQuantity: null,
      availableBySize: { mala: 7, normalna: 4 },
    }];
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });
    const badge = await screen.findByTestId(`available-portions-${mockPica.id}`);
    expect(badge.textContent).toContain("Mala: 7");
    expect(badge.textContent).toContain("Norm.: 4");
    expect(within(badge).getAllByText(/^(Mala|Norm\.):/)).toHaveLength(2);
    expect(within(badge).getByText("Mala: 7")).toHaveClass("whitespace-nowrap");
    expect(badge).toHaveClass("flex-col");
    expect(badge.textContent).not.toContain("Družinska");
    expect(badge.textContent).not.toContain("∞");
  });

  it("mobilna glava prikaže čas priprave samo enkrat in ga ne ponavlja v preklopniku ali QR opozorilu", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const mobileTabs = await screen.findByTestId("mobile-order-tabs");
    const mobileSummary = screen.getByTestId("mobile-order-summary");

    expect(screen.getAllByTestId("order-context-line")).toHaveLength(2);
    expect(within(mobileTabs).queryByText(/Pripravljeno ob/i)).not.toBeInTheDocument();
    expect(within(mobileSummary).queryByText(/Dostava ob/i)).not.toBeInTheDocument();
    const contextLine = within(mobileSummary).getByTestId("order-context-line");
    expect(contextLine).toHaveTextContent(/Miza 5.*Terasa.*#99.*QR.*14:30/);
    expect(within(contextLine).getByLabelText("Dostava ob 14:30")).toBeInTheDocument();
  });

  it("na desktopu prikaže isto kontekstno vrstico tudi v desnem oknu naročila", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const rightContextLine = await screen.findByTestId("right-order-context-line");

    expect(rightContextLine).toHaveTextContent(/Miza 5.*Terasa.*#99.*QR.*14:30/);
    expect(within(rightContextLine).getByLabelText("Dostava ob 14:30")).toBeInTheDocument();
    expect(rightContextLine).toHaveClass("hidden", "md:flex");
    expect(screen.queryByTestId("kds-type-label")).not.toBeInTheDocument();
    expect(screen.queryByTestId("qr-gost-staff-info")).not.toBeInTheDocument();
    expect(screen.queryByTestId("uredi-predviden-cas")).not.toBeInTheDocument();

    const guestActions = screen.getByTestId("right-order-guest-actions");
    expect(guestActions).toHaveClass("flex", "items-center", "gap-1");
    expect(within(guestActions).getByTitle("Uvozi iz računa")).toBeInTheDocument();
    expect(within(guestActions).getByTitle("Glasovni ukaz — naroči s prostim govorom")).toBeInTheDocument();
  });

  it("v dialogu za prenos prikaže ciljno mizo skupaj s prostorom", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    fireEvent.click(await screen.findByTitle("Prestavi na mizo"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Miza 8 · Salon")).toBeInTheDocument();
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

  it("AI glasovni ukaz izbere malo Margherito in trikotni razrez brez dodatnega dialoga", async () => {
    mockAddPostavkaMutate.mockImplementation(
      (_args: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
        options?.onSuccess?.({ ...mockNarocilo, postavke: [] });
      },
    );

    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const onResult = await klikniMikInPridobionResult();
    await act(async () => {
      onResult("dodaj pica margherita mala trikotni razrez");
    });

    await waitFor(() => {
      expect(mockAddPostavkaMutate).toHaveBeenCalledTimes(1);
    });

    type MutateArgs = { id: number; data: Record<string, unknown> };
    const klic = (mockAddPostavkaMutate.mock.calls[0] as [MutateArgs, ...unknown[]])[0];
    expect(klic.data.artikelId).toBe(mockPica.id);
    expect(klic.data.velikostPice).toBe("mala");
    expect(klic.data.izbranModifikatorji).toEqual([{
      modifikatorId: mockRazrezTrikotni.id,
      ime: mockRazrezTrikotni.ime,
      cenaDodatek: 0,
    }]);
    expect(screen.queryByText(/Izberi možnosti pred potrditvijo/i)).not.toBeInTheDocument();
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

  it("v meniju in pri izbiri modifikatorja pokaže porcije pripravljene sestavine", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });
    const badge = await screen.findByTestId("modifier-portions-10");
    expect(badge).toHaveTextContent("Sir: 3 porcij");
    await act(async () => {
      fireEvent.click(badge.closest("button")!);
    });
    expect(screen.getByRole("button", { name: /Sir.*3 porcij/ })).toBeInTheDocument();
  });

  it("prikaže naziv, premer in ceno vsake aktivne velikosti znotraj gumba", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const picaButton = await screen.findByRole("button", { name: /Margherita/i });
    await act(async () => {
      fireEvent.click(picaButton);
    });

    const mala = await screen.findByRole("button", { name: /Mala.*26 cm.*7\.00 €/i });
    const normalna = screen.getByRole("button", { name: /Normalna.*32 cm.*8\.50 €/i });
    const druzinska = screen.getByRole("button", { name: /Družinska.*40 cm.*12\.00 €/i });

    expect(mala).toHaveAttribute("aria-pressed", "false");
    expect(normalna).toHaveAttribute("aria-pressed", "true");
    expect(druzinska).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(druzinska);
    });

    expect(druzinska).toHaveAttribute("aria-pressed", "true");
    expect(normalna).toHaveAttribute("aria-pressed", "false");
    expect(within(druzinska).getByText("12.00 €")).toBeInTheDocument();
    expect(screen.getByText("12.50 €")).toBeInTheDocument();
  });

  it("v skupino Razrez razporedi vsak aktivni modifikator z besedo razrez", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    const picaButton = await screen.findByRole("button", { name: /Margherita/i });
    await act(async () => {
      fireEvent.click(picaButton);
    });

    const razrez = await screen.findByTestId("pizza-mod-group-razrez");
    const dodatki = screen.getByTestId("pizza-mod-group-dodatki");
    const brez = screen.getByTestId("pizza-mod-group-brez");

    expect(within(razrez).getByRole("button", { name: "Brez razreza" })).toHaveAttribute("aria-pressed", "true");
    expect(within(razrez).getByRole("button", { name: "Trikotni razrez (New York style)" })).toBeInTheDocument();
    expect(within(razrez).getByRole("button", { name: "Kvadratni razrez (Party cut)" })).toBeInTheDocument();
    expect(within(razrez).getByRole("button", { name: "Razrez na polovico" })).toBeInTheDocument();
    expect(within(razrez).getByRole("button", { name: "Razrez na četrtino" })).toBeInTheDocument();
    expect(within(dodatki).getByRole("button", { name: /Sir/ })).toBeInTheDocument();
    expect(within(dodatki).queryByRole("button", { name: /razrez/i })).not.toBeInTheDocument();
    expect(within(brez).getByRole("button", { name: "Brez čebule" })).toBeInTheDocument();
  });

  it("pri pici dovoli samo en razrez in brez izbire onemogoči potrditev", async () => {
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Margherita/i }));
    });

    const razrez = await screen.findByTestId("pizza-mod-group-razrez");
    const brezRazreza = within(razrez).getByRole("button", { name: "Brez razreza" });
    const trikotni = within(razrez).getByRole("button", { name: "Trikotni razrez (New York style)" });
    const stirikotni = within(razrez).getByRole("button", { name: "Kvadratni razrez (Party cut)" });
    const potrdi = screen.getByRole("button", { name: "Potrdi" });

    expect(brezRazreza).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(trikotni);
    expect(brezRazreza).toHaveAttribute("aria-pressed", "false");
    expect(trikotni).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(stirikotni);
    expect(trikotni).toHaveAttribute("aria-pressed", "false");
    expect(stirikotni).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(stirikotni);
    expect(stirikotni).toHaveAttribute("aria-pressed", "false");
    expect(potrdi).toBeDisabled();

    fireEvent.click(brezRazreza);
    expect(brezRazreza).toHaveAttribute("aria-pressed", "true");
    expect(potrdi).not.toBeDisabled();
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

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Družinska.*40 cm.*12\.00 €/i }));
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
    expect(prviKlic[0].data.velikostPice).toBe("druzinska");
    expect(Array.isArray(prviKlic[0].data.izbranModifikatorji)).toBe(true);
    const modifikatorji = prviKlic[0].data.izbranModifikatorji as Array<{ modifikatorId: number; ime: string; cenaDodatek: number }>;
    expect(modifikatorji).toEqual([
      { modifikatorId: 100, ime: "Sir", cenaDodatek: 0.5 },
      { modifikatorId: 105, ime: "Brez razreza", cenaDodatek: 0 },
    ]);
  });

  it("izbire nested skupin veže na izvorni prodajni artikel, jih počisti ob odznačitvi in ne doda drugega artikla", async () => {
    const nestedOption = {
      id: 201,
      skupinaId: 20,
      ime: "Brez česna",
      cenaDodatek: 0,
      aktiven: true,
      vrstniRed: 0,
    };
    const secondNestedOption = {
      id: 203,
      skupinaId: 21,
      ime: "Brez soli",
      cenaDodatek: 0,
      aktiven: true,
      vrstniRed: 0,
    };
    const sourceArticle = {
      ...mockPicaMargherita,
      id: 200,
      ime: "Zelena solata – mala",
      jePica: false,
      modSkupine: [{
        id: 20,
        ime: "Dodatki solate",
        obvezna: true,
        minIzbir: 1,
        maxIzbir: 1,
        vrstniRed: 0,
        modifikatorji: [nestedOption],
      }],
    };
    const secondSourceArticle = {
      ...sourceArticle,
      id: 202,
      ime: "Juha – mala",
      modSkupine: [{
        id: 21,
        ime: "Dodatki juhe",
        obvezna: true,
        minIzbir: 1,
        maxIzbir: 1,
        vrstniRed: 0,
        modifikatorji: [secondNestedOption],
      }],
    };
    mockListArtikliData.mockReturnValue([mockPica, sourceArticle, secondSourceArticle]);
    mockModifierNormatives.current = {
      100: [
        { id: 1, vhodniArtikelId: sourceArticle.id, artikelIme: sourceArticle.ime, kolicina: 1 },
        { id: 2, vhodniArtikelId: secondSourceArticle.id, artikelIme: secondSourceArticle.ime, kolicina: 1 },
      ],
    };
    mockAddPostavkaMutate.mockImplementation(
      (_args: unknown, options?: { onSuccess?: (data: unknown) => void }) => options?.onSuccess?.(mockNarocilo),
    );

    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Margherita/i }));
    });

    await screen.findByTestId("button-nested-modifier-100-200-201");
    await screen.findByTestId("button-nested-modifier-100-202-203");
    const modifierDialog = screen.getByRole("dialog");
    expect(modifierDialog).toHaveClass("top-8", "md:top-8", "translate-y-0");
    expect(modifierDialog).not.toHaveClass("md:top-[50%]", "translate-y-[-50%]");
    expect(modifierDialog.querySelector('[style*="overflow-anchor: none"]')).not.toBeNull();
    const saladChoices = screen.getByTestId("nested-modifier-source-100-200");
    expect(saladChoices).not.toHaveTextContent("Zelena solata – mala");
    expect(saladChoices).not.toHaveTextContent("Dodatki solate");
    expect(saladChoices).toHaveTextContent("Brez česna");
    expect(screen.getByTestId("button-nested-modifier-100-200-201")).toHaveAttribute("role", "checkbox");
    const confirm = screen.getByRole("button", { name: /Potrdi/i });
    expect(confirm).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-modifier-100"));
    });
    expect(screen.queryByTestId("nested-modifier-source-100-200")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-modifier-100"));
    });
    expect(screen.getByTestId("button-nested-modifier-100-200-201")).toHaveAttribute("aria-checked", "false");
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-nested-modifier-100-200-201"));
      fireEvent.click(screen.getByTestId("button-nested-modifier-100-202-203"));
    });
    expect(confirm).toBeEnabled();

    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(mockAddPostavkaMutate).toHaveBeenCalledTimes(1));
    const [[call]] = mockAddPostavkaMutate.mock.calls as [{ data: Record<string, unknown> }][];
    expect(call.data.artikelId).toBe(mockPica.id);
    expect(call.data.izbranModifikatorji).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modifikatorId: 100,
        podIzbire: [
          { artikelId: sourceArticle.id, modifikatorIds: [nestedOption.id] },
          { artikelId: secondSourceArticle.id, modifikatorIds: [secondNestedOption.id] },
        ],
      }),
    ]));
  });

  it("pri že naročenem zrezku omogoči spremembo obvezne priloge brez izgube solate", async () => {
    const skupine = [
      { id: 4938, ime: "Dunajski zrezek", options: [{ id: 601, ime: "Dunajski" }, { id: 602, ime: "Piščančji" }] },
      { id: 4947, ime: "Priloge", options: [{ id: 603, ime: "Krompir" }, { id: 604, ime: "Riž" }] },
      { id: 4954, ime: "Solate", options: [{ id: 605, ime: "Zelena solata" }, { id: 606, ime: "Mešana solata" }] },
    ].map(group => ({
      id: group.id,
      ime: group.ime,
      obvezna: true,
      minIzbir: 0,
      maxIzbir: 0,
      vrstniRed: 0,
      modifikatorji: group.options.map(option => ({
        ...option, skupinaId: group.id, cenaDodatek: 0, aktiven: true, vrstniRed: 0,
      })),
    }));
    const zrezek = { ...mockPica, id: 27886, ime: "Dunajski zrezek s prilogo in solato", jePica: false, modSkupine: skupine };
    const brezOpcij = { ...mockPica, id: 27887, ime: "Voda", jePica: false, modSkupine: [] };
    mockListArtikliData.mockReturnValue([zrezek, brezOpcij]);
    mockOrderForOptions.current = {
      ...mockNarocilo,
      postavke: [
        { id: 501, artikelId: zrezek.id, ime: zrezek.ime, kolicina: 1, cenaKos: 12, skupaj: 12, racunId: null, parentPostavkaId: null },
        ...[601, 603, 605].map((modifikatorId, index) => ({
          id: 502 + index, artikelId: null, modifikatorId, ime: "Izbira", kolicina: 1,
          cenaKos: 0, skupaj: 0, racunId: null, parentPostavkaId: 501,
        })),
        { id: 506, artikelId: brezOpcij.id, ime: brezOpcij.ime, kolicina: 1, cenaKos: 2, skupaj: 2, racunId: null, parentPostavkaId: null },
      ],
    };
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });
    expect(screen.getAllByRole("button", { name: "Opcije" })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Opcije" }));
    });
    expect(screen.getByText("Priloge")).toBeInTheDocument();
    expect(screen.getByText("Solate")).toBeInTheDocument();
    expect(screen.getByTestId("button-edit-modifier-603")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("button-edit-modifier-605")).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-edit-modifier-603"));
    });
    expect(screen.getByTestId("edit-modifier-group-error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Potrdi/i })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-edit-modifier-604"));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /Potrdi/i })).toBeEnabled());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Potrdi/i }));
    });
    expect(mockAddPostavkaModifikatorjiMutate).toHaveBeenCalledWith(expect.objectContaining({
      postavkaId: 501,
      data: {
        skupineIds: [4938, 4947, 4954],
        modifikatorji: [
          { modifikatorId: 601, podIzbire: [] },
          { modifikatorId: 605, podIzbire: [] },
          { modifikatorId: 604, podIzbire: [] },
        ],
      },
    }), expect.anything());
  });

  it("urejanje opcij predizbere več shranjenih virov, ohrani nespremenjeno izbiro in pošlje poln scoped payload", async () => {
    const { lessGarlicOption, sourceA, sourceB, saltOption } = prepareExistingNestedModifierEdit();
    mockAddPostavkaModifikatorjiMutate.mockImplementation(
      (_args: unknown, options?: { onSuccess?: (data: unknown) => void }) => options?.onSuccess?.(mockNarocilo),
    );
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Opcije/i }));
    });

    const changedChoice = await screen.findByTestId("button-edit-nested-100-200-202");
    const saladChoices = screen.getByTestId("edit-nested-source-100-200");
    expect(saladChoices).not.toHaveTextContent("Zelena solata – mala");
    expect(saladChoices).not.toHaveTextContent("Zelena solata");
    expect(saladChoices).toHaveTextContent("Brez česna");
    expect(screen.getByTestId("edit-nested-group-100-200-20")).toHaveAttribute("aria-label", "Zelena solata – mala – Zelena solata");
    expect(screen.getByTestId("button-edit-nested-100-200-201")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("button-edit-nested-100-202-203")).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-edit-nested-100-200-201"));
      fireEvent.click(changedChoice);
    });
    expect(screen.getByTestId("button-edit-nested-100-202-203")).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Potrdi/i }));
    });
    await waitFor(() => expect(mockAddPostavkaModifikatorjiMutate).toHaveBeenCalledTimes(1));
    const [[args]] = mockAddPostavkaModifikatorjiMutate.mock.calls as [{ postavkaId: number; data: Record<string, unknown> }][];
    expect(args.postavkaId).toBe(501);
    expect(args.data).toEqual({
      modifikatorji: [{
        modifikatorId: 100,
        podIzbire: [
          { artikelId: sourceA.id, modifikatorIds: [lessGarlicOption.id] },
          { artikelId: sourceB.id, modifikatorIds: [saltOption.id] },
        ],
      }, { modifikatorId: 105, podIzbire: [] }],
      skupineIds: [1, 2],
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ob napaki pri urejanju ohrani dialog in nested izbor za ponovni poskus", async () => {
    prepareExistingNestedModifierEdit();
    mockAddPostavkaModifikatorjiMutate.mockImplementation(
      (_args: unknown, options?: { onError?: (error: unknown) => void }) => options?.onError?.(new Error("failed")),
    );
    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Opcije/i }));
    });
    await screen.findByTestId("button-edit-nested-100-202-203");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Potrdi/i }));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("button-edit-nested-100-200-201")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("button-edit-nested-100-202-203")).toHaveAttribute("aria-pressed", "true");
  });

  it("ob zavrnitvi pokaže razlog strežnika in ohrani izbor za ponovni poskus", async () => {
    mockAddPostavkaMutate.mockImplementation(
      (_args: unknown, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.({
          status: 409,
          data: { error: "Artikel »Pražen krompir« nima dovolj razpoložljivih porcij." },
        });
      },
    );

    await act(async () => {
      render(<Wrapper qc={qc}><Order /></Wrapper>);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Margherita/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Družinska.*40 cm.*12\.00 €/i }));
      fireEvent.click(await screen.findByRole("button", { name: /Potrdi/i }));
    });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Artikel »Pražen krompir« nima dovolj razpoložljivih porcij.",
    }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Družinska.*40 cm.*12\.00 €/i })).toHaveAttribute("aria-pressed", "true");
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
