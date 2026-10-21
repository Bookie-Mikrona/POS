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
import { render, fireEvent, screen, waitFor, act, within } from "@testing-library/react";
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
const mockRemoveMutate = vi.hoisted(() => vi.fn());
const mockRemoveAsync = vi.hoisted(() => vi.fn());
const mockFireCourse = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockZacniGlasovni = vi.hoisted(() => vi.fn());
const mockKdsState = vi.hoisted(() => ({
  stations: [] as Array<{ id: number; ime: string; tip: string }>,
  nalogi: [] as KdsNalog[],
}));

vi.mock("@/hooks/use-kds", () => ({
  useKdsPostaje: () => ({ data: mockKdsState.stations }),
  useKdsNalogiVecPostaj: () => [{ data: mockKdsState.nalogi }],
  useFireKdsCourse: () => ({ mutate: mockFireCourse, isPending: false }),
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
  useGetPreparedFoodAvailability: () => ({ data: { businessDate: "2026-08-28", items: [{ articleId: 11, articleName: "Margherita", mealType: "composite", availableQuantity: 9, freshQuantity: null }] }, isLoading: false }),
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
  useRemovePostavka: () => ({ mutate: mockRemoveMutate, mutateAsync: mockRemoveAsync }),
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
      vloga: (globalThis as { __vloga?: string }).__vloga ?? "natakar",
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

vi.mock("@/components/OpombaDialog", () => ({
  default: ({ onPotrdi }: { onPotrdi: (n: string) => void }) => (
    <button type="button" data-testid="opomba-dialog-potrdi" onClick={() => onPotrdi("brez sira")}>potrdi opombo</button>
  ),
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

describe("Order — spodnji list naročila (nastavitev naprave)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockToast.mockClear();
    mockAddPostavkaMutate.mockClear();
    mockUpdatePostavkaMutate.mockClear();
    mockUpdatePostavkaAsync.mockReset();
    mockRemoveMutate.mockClear();
    mockRemoveAsync.mockReset();
    mockFireCourse.mockClear();
    mockSetLocation.mockClear();
    mockZacniGlasovni.mockClear();
    mockZacniGlasovni.mockReturnValue(true);
    mockArtikli.splice(0, mockArtikli.length, mockPicaBrezDodatkov);
    mockNarocilo.postavke = [];
    mockKdsState.stations = [];
    mockKdsState.nalogi = [];
  });


  const nastavi = (prikazNarocila: string) => {
    (globalThis as { __testNaprava?: unknown }).__testNaprava = { id: 1, ime: "t", napravaKljuc: "k", enotaId: 1, podjetjeDavcna: "x", placilniTerminal: null, gostotaArtiklov: "privzeto", prikazMenija: "trenutno", prikazNarocila, ustvarjeno: "", posodobljeno: "" };
    mockNarocilo.postavke = [{ id: 1, artikelId: 11, artikelIme: "Margherita", kolicina: 2, cenaKos: 8.5, skupaj: 17, ime: "Margherita", racunId: null, parentPostavkaId: null }];
    mockNarocilo.skupaj = 17;
  };
  const odpri = async () => { await act(async () => { render(<Wrapper qc={qc}><Order /></Wrapper>); }); await screen.findByTestId("artikli-mreza"); };

  it("staro: brez spodnjega lista, zavihka Meni/Naročilo ostaneta", async () => {
    nastavi("staro");
    await odpri();
    expect(screen.queryByTestId("narocilo-vrstica")).not.toBeInTheDocument();
    expect(screen.queryByTestId("narocilo-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("mobile-order-tabs")).toHaveTextContent("Meni");
  });

  it("novo: spodnja vrstica kaže skupaj, tap odpre list z vsemi dejanji, zapri ga skrije", async () => {
    nastavi("novo");
    await odpri();
    expect(screen.getByTestId("narocilo-vrstica")).toHaveTextContent("17");
    expect(screen.getByTestId("mobile-order-tabs")).not.toHaveTextContent("Meni");
    await act(async () => { fireEvent.click(screen.getByTestId("narocilo-odpri")); });
    expect(screen.getByTestId("narocilo-sheet").className).toContain("max-md:fixed");
    expect(screen.getByTestId("narocilo-sheet")).toHaveTextContent("Na blagajno");
    expect(screen.queryByTestId("narocilo-vrstica")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId("narocilo-sheet-zapri")); });
    expect(screen.getByTestId("narocilo-sheet").className).toContain("hidden");
    expect(screen.getByTestId("narocilo-vrstica")).toBeInTheDocument();
  });

  it("novo: »Na blagajno« v vrstici vodi na isti naslov kot staro", async () => {
    nastavi("novo");
    await odpri();
    await act(async () => { fireEvent.click(screen.getByTestId("narocilo-vrstica-blagajna")); });
    expect(mockSetLocation).toHaveBeenCalledWith(`/blagajna?narocilo=${NAROCILO_ID}`);
  });

  it("staro: »Na blagajno« vodi na isti naslov", async () => {
    nastavi("staro");
    await odpri();
    const gumbi = screen.getAllByRole("button", { name: /Na blagajno/i });
    await act(async () => { fireEvent.click(gumbi[gumbi.length - 1]); });
    expect(mockSetLocation).toHaveBeenCalledWith(`/blagajna?narocilo=${NAROCILO_ID}`);
  });

  it("KDS skupine: postavke so razvrščene po dejanskem stanju (na čakanju, v pripravi, pripravljeno)", async () => {
    nastavi("novo");
    const p = (id: number, ime: string) => ({ id, artikelId: 11, ime, kolicina: 1, cenaKos: 1, skupaj: 1, racunId: null, parentPostavkaId: null });
    mockNarocilo.postavke = [p(1, "A"), p(2, "B"), p(3, "C"), p(4, "D")];
    mockKdsState.stations = [{ id: 1, ime: "Kuhinja", tip: "kuhinja" }];
    const nalog = (id: number, postavkaId: number, stanje: string) => ({ id, postavkaId, postajaId: 1, narociloId: NAROCILO_ID, stanje, ustvarjeno: new Date().toISOString(), aktiviranoAt: null }) as unknown as KdsNalog;
    mockKdsState.nalogi = [nalog(1, 1, "bumped"), nalog(2, 2, "zadrzano"), nalog(3, 3, "novo")];
    await odpri();
    const glave = screen.getAllByTestId(/^kds-skupina-/).map(e => e.textContent);
    expect(glave).toEqual(["Na čakanju1", "V pripravi1", "Pripravljeno1", "Brez stanja KDS1"]);
    // »V pripravi« in »Pripravljeno« sta privzeto zloženi: vrstici 3 in 1 nista vidni.
    expect(screen.getAllByTestId(/^order-item-\d+$/).map(e => e.getAttribute("data-testid"))).toEqual(["order-item-2", "order-item-4"]);
    await act(async () => { fireEvent.click(screen.getByTestId("kds-skupina-V pripravi")); });
    await act(async () => { fireEvent.click(screen.getByTestId("kds-skupina-Pripravljeno")); });
    const vrstni = screen.getAllByTestId(/^order-item-\d+$/).map(e => e.getAttribute("data-testid"));
    expect(vrstni).toEqual(["order-item-2", "order-item-3", "order-item-1", "order-item-4"]);
  });

  it("staro: brez KDS skupin", async () => {
    nastavi("staro");
    await odpri();
    expect(screen.queryAllByTestId(/^kds-skupina-/)).toHaveLength(0);
  });

  it("enak račun pri vseh 32 kombinacijah menija, gostote in prikaza naročila", async () => {
    type Args = { id: number; data: Record<string, unknown> };
    const rezultati: string[] = [];
    for (const meni of ["trenutno", "A", "B", "C"]) {
      for (const gostota of ["privzeto", "kompaktno", "seznam", "velika"]) {
        for (const prikazNarocila of ["staro", "novo"]) {
          mockAddPostavkaMutate.mockClear();
          mockSetLocation.mockClear();
          nastavi(prikazNarocila);
          (globalThis as { __testNaprava?: Record<string, unknown> }).__testNaprava = { ...(globalThis as { __testNaprava?: Record<string, unknown> }).__testNaprava, prikazMenija: meni, gostotaArtiklov: gostota };
          const { unmount } = render(<Wrapper qc={makeQueryClient()}><Order /></Wrapper>);
          await screen.findAllByRole("button", { name: /Margherita/i });
          const gumb = screen.getAllByRole("button", { name: /Margherita/i }).find(b => !b.getAttribute("data-testid"))!;
          await act(async () => { fireEvent.click(gumb); });
          const dodaj = (mockAddPostavkaMutate.mock.calls[0] as [Args, ...unknown[]])[0];
          const gumbi = screen.getAllByRole("button", { name: /Na blagajno/i });
          await act(async () => { fireEvent.click(gumbi[gumbi.length - 1]); });
          rezultati.push(JSON.stringify({
            dodaj,
            blagajna: mockSetLocation.mock.calls.at(-1)?.[0],
            postavke: mockNarocilo.postavke.map(x => [x.id, x.kolicina, x.skupaj]),
            skupaj: mockNarocilo.skupaj,
          }));
          unmount();
        }
      }
    }
    expect(rezultati).toHaveLength(32);
    expect(new Set(rezultati).size).toBe(1);
  });

  // ── Dejanja novega lista kličejo iste funkcije kot stari prikaz ──────────────
  type Zajem = { posodobi: unknown[]; posodobiAsync: unknown[]; odstrani: unknown[]; hod: unknown[]; glas: number; dialogi: string[] };
  const zajem = (): Zajem => ({
    posodobi: mockUpdatePostavkaMutate.mock.calls.map(c => c[0]),
    posodobiAsync: mockUpdatePostavkaAsync.mock.calls.map(c => c[0]),
    odstrani: mockRemoveMutate.mock.calls.map(c => c[0]),
    hod: mockFireCourse.mock.calls.map(c => c[0]),
    glas: mockZacniGlasovni.mock.calls.length,
    dialogi: [
      screen.queryByTestId("opomba-dialog-potrdi") ? "opomba" : "",
      screen.queryByText(/^Opcije — /) ? "opcije" : "",
    ].filter(Boolean),
  });
  const pripravi = (prikaz: "staro" | "novo", dodatno: { gost?: boolean; hod?: boolean; opcije?: boolean } = {}) => {
    nastavi(prikaz);
    mockArtikli.splice(0, mockArtikli.length, {
      ...mockPicaBrezDodatkov,
      toGo: true,
      modSkupine: dodatno.opcije ? [{ id: 1, ime: "Dodatki", modifikatorji: [{ id: 5, ime: "Sir", aktiven: true, privzet: false, cenaDodatek: 0 }] }] : [],
    } as unknown as (typeof mockArtikli)[number]);
    mockNarocilo.postavke = [{
      id: 1, artikelId: 11, artikelIme: "Margherita", ime: "Margherita", kolicina: 2, cenaKos: 8.5, skupaj: 17,
      racunId: null, parentPostavkaId: null, opomba: "brez soli", gostStevilka: dodatno.gost ? 1 : null,
    }];
    if (dodatno.hod) {
      mockKdsState.stations = [{ id: 1, ime: "Kuhinja", tip: "kuhinja" }];
      mockKdsState.nalogi = [
        { id: 1, postavkaId: 1, postajaId: 1, narociloId: NAROCILO_ID, stanje: "bumped", pairingGroupId: "g1", courseSequence: 1, courseNumber: 1, ustvarjeno: new Date().toISOString(), aktiviranoAt: null },
        { id: 2, postavkaId: 1, postajaId: 1, narociloId: NAROCILO_ID, stanje: "zadrzano", pairingGroupId: "g1", courseSequence: 2, courseNumber: 2, ustvarjeno: new Date().toISOString(), aktiviranoAt: null },
      ] as unknown as KdsNalog[];
    }
  };
  const poPrikazu = async (
    dodatno: { gost?: boolean; hod?: boolean; opcije?: boolean },
    staro: () => Promise<void> | void,
    novo: () => Promise<void> | void,
  ) => {
    const izidi: Zajem[] = [];
    for (const prikaz of ["staro", "novo"] as const) {
      mockUpdatePostavkaMutate.mockClear(); mockUpdatePostavkaAsync.mockReset(); mockRemoveMutate.mockClear();
      mockFireCourse.mockClear(); mockZacniGlasovni.mockClear(); mockZacniGlasovni.mockReturnValue(true);
      pripravi(prikaz, dodatno);
      const { unmount } = render(<Wrapper qc={makeQueryClient()}><Order /></Wrapper>);
      await screen.findByTestId("artikli-mreza");
      await act(async () => { await (prikaz === "staro" ? staro() : novo()); });
      izidi.push(zajem());
      unmount();
    }
    expect(izidi[1]).toEqual(izidi[0]);
    return izidi[1];
  };
  const izberiVrstico = async () => { await act(async () => { fireEvent.click(screen.getByTestId("row-izberi-1")); }); };
  const klikni = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

  it("sprememba količine (−, +) kliče iste funkcije kot staro", async () => {
    const gumbiStaro = () => within(screen.getByTestId("order-item-quantity-1")).getAllByRole("button");
    const minus = await poPrikazu({},
      async () => { await klikni(gumbiStaro()[0]); },
      async () => { await klikni(screen.getByTestId("row-minus-1")); },
    );
    expect(minus.posodobi).toEqual([{ id: NAROCILO_ID, postavkaId: 1, data: { kolicina: 1 } }]);
    const plus = await poPrikazu({},
      async () => { const g = gumbiStaro(); await klikni(g[g.length - 1]); },
      async () => { await klikni(screen.getByTestId("row-plus-1")); },
    );
    expect(plus.posodobi).toEqual([{ id: NAROCILO_ID, postavkaId: 1, data: { kolicina: 3 } }]);
  });

  it("dodaj gosta kliče iste funkcije kot staro", async () => {
    const izid = await poPrikazu({},
      async () => { const g = screen.getAllByText("+ Dodaj gosta"); await klikni(g[g.length - 1]); },
      async () => { const g = screen.getAllByText("+ Dodaj gosta"); await klikni(g[g.length - 1]); },
    );
    expect(izid.posodobiAsync).toEqual([{ id: NAROCILO_ID, postavkaId: 1, data: { kolicina: 2, gostStevilka: 1 } }]);
  });

  it("sprememba gosta v vrstici kliče iste funkcije kot staro", async () => {
    const izid = await poPrikazu({ gost: true },
      async () => { await klikni(screen.getByTitle("Klikni za spremembo gosta")); },
      async () => { await izberiVrstico(); await klikni(screen.getByTestId("row-akcija-gost")); },
    );
    expect(izid.posodobi).toHaveLength(1);
  });

  it("glasovni vnos (naročilo in zapis na vrstici) kliče iste funkcije kot staro", async () => {
    const izid = await poPrikazu({},
      async () => {
        await klikni(screen.getAllByTitle("Glasovni ukaz — naroči s prostim govorom")[0]);
        await klikni(screen.getByTitle("Dodaj zvočno opombo"));
      },
      async () => {
        await klikni(screen.getAllByTitle("Glasovni ukaz — naroči s prostim govorom")[0]);
        await izberiVrstico(); await klikni(screen.getByTestId("row-akcija-glas"));
      },
    );
    expect(izid.glas).toBe(2);
  });

  it("popust kliče iste funkcije kot staro", async () => {
    const vnesi = async () => {
      const vnos = within(screen.getByTestId("order-item-1")).getByRole("textbox") as HTMLInputElement;
      await act(async () => { fireEvent.change(vnos, { target: { value: "10" } }); });
      await act(async () => { fireEvent.keyDown(vnos, { key: "Enter" }); });
    };
    const izid = await poPrikazu({},
      async () => { await klikni(screen.getByTitle("Dodaj popust")); await vnesi(); },
      async () => { await izberiVrstico(); await klikni(screen.getByTestId("row-akcija-popust")); await vnesi(); },
    );
    expect(izid.posodobi).toEqual([{ id: NAROCILO_ID, postavkaId: 1, data: { kolicina: 2, cenaKos: 7.65 } }]);
  });

  it("opcije odprejo isti pogovor kot staro", async () => {
    const izid = await poPrikazu({ opcije: true },
      async () => { await klikni(screen.getByRole("button", { name: /Opcije/ })); },
      async () => { await izberiVrstico(); await klikni(screen.getByTestId("row-akcija-opcije")); },
    );
    expect(izid.dialogi).toContain("opcije");
  });

  it("zapis kliče iste funkcije kot staro", async () => {
    const izid = await poPrikazu({},
      async () => { await klikni(screen.getByTitle("Vnesi opombo s tipkovnico")); await klikni(screen.getByTestId("opomba-dialog-potrdi")); },
      async () => { await izberiVrstico(); await klikni(screen.getByTestId("row-akcija-zapis")); await klikni(screen.getByTestId("opomba-dialog-potrdi")); },
    );
    expect(izid.posodobi).toEqual([{ id: NAROCILO_ID, postavkaId: 1, data: { kolicina: 2, opomba: "brez sira" } }]);
  });

  it("brisanje zapisa kliče iste funkcije kot staro", async () => {
    const izid = await poPrikazu({},
      async () => { await klikni(screen.getByTitle("Zbriši opombo")); },
      async () => { await izberiVrstico(); await klikni(screen.getByTestId("row-akcija-zbrisi-zapis")); },
    );
    expect(izid.posodobi).toEqual([{ id: NAROCILO_ID, postavkaId: 1, data: { kolicina: 2, opomba: null } }]);
  });

  it("To Go kliče iste funkcije kot staro", async () => {
    const izid = await poPrikazu({},
      async () => { await klikni(screen.getByTitle("Dodaj To Go embalažo")); },
      async () => { await izberiVrstico(); await klikni(screen.getByTestId("row-akcija-togo")); },
    );
    expect(izid.posodobi).toEqual([{ id: NAROCILO_ID, postavkaId: 1, data: { kolicina: 2, toGo: true } }]);
  });

  it("»Sprosti 2. hod« je dosegljiv in kliče iste funkcije kot staro", async () => {
    const klikHod = async () => { await klikni(await screen.findByRole("button", { name: /Sprosti 2\. hod/ })); };
    const izid = await poPrikazu({ hod: true }, klikHod, klikHod);
    expect(izid.hod).toHaveLength(1);
  });

  it("brisanje: staro takoj, novo po 4 s z isto funkcijo in snackbarom »Razveljavi«", async () => {
    // staro
    pripravi("staro");
    const staro = render(<Wrapper qc={makeQueryClient()}><Order /></Wrapper>);
    await screen.findByTestId("artikli-mreza");
    await klikni(screen.getByTitle("Odstrani artikel"));
    const starPoziv = mockRemoveMutate.mock.calls.map(c => c[0]);
    staro.unmount();
    mockRemoveMutate.mockClear(); mockToast.mockClear();
    // novo
    pripravi("novo");
    render(<Wrapper qc={makeQueryClient()}><Order /></Wrapper>);
    await screen.findByTestId("artikli-mreza");
    await izberiVrstico();
    await klikni(screen.getByTestId("row-akcija-brisi"));
    expect(screen.queryByTestId("order-item-1")).not.toBeInTheDocument();
    const toastArg = mockToast.mock.calls.at(-1)![0] as { duration: number; action: React.ReactElement<{ altText: string }> };
    expect(toastArg.duration).toBe(4000);
    expect(toastArg.action.props.altText).toBe("Razveljavi");
    expect(mockRemoveMutate).not.toHaveBeenCalled();
    await act(async () => { await new Promise(r => setTimeout(r, 4200)); });
    expect(mockRemoveMutate.mock.calls.map(c => c[0])).toEqual(starPoziv);
  });

  it("razveljavitev brisanja vrne vrstico in ničesar ne izbriše", async () => {
    pripravi("novo");
    render(<Wrapper qc={makeQueryClient()}><Order /></Wrapper>);
    await screen.findByTestId("artikli-mreza");
    await izberiVrstico();
    await klikni(screen.getByTestId("row-akcija-brisi"));
    const toastArg = mockToast.mock.calls.at(-1)![0] as { action: React.ReactElement<{ onClick: () => void }> };
    await act(async () => { toastArg.action.props.onClick(); });
    expect(screen.getByTestId("order-item-1")).toBeInTheDocument();
    await act(async () => { await new Promise(r => setTimeout(r, 4200)); });
    expect(mockRemoveMutate).not.toHaveBeenCalled();
  });

  it("»Na blagajno« najprej opravi čakajoče brisanje, nato odpre blagajno", async () => {
    mockRemoveAsync.mockResolvedValue(mockNarocilo);
    pripravi("novo");
    render(<Wrapper qc={makeQueryClient()}><Order /></Wrapper>);
    await screen.findByTestId("artikli-mreza");
    await izberiVrstico();
    await klikni(screen.getByTestId("row-akcija-brisi"));
    await klikni(screen.getByTestId("narocilo-vrstica-blagajna"));
    expect(mockRemoveAsync).toHaveBeenCalledWith({ id: NAROCILO_ID, postavkaId: 1 });
    expect(mockSetLocation).toHaveBeenCalledWith(`/blagajna?narocilo=${NAROCILO_ID}`);
  });

  it("dejanja so samo pri izbrani vrstici, ne v vsaki", async () => {
    pripravi("novo");
    render(<Wrapper qc={makeQueryClient()}><Order /></Wrapper>);
    await screen.findByTestId("artikli-mreza");
    expect(screen.queryByTestId("row-actions-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-akcija-popust")).not.toBeInTheDocument();
    await izberiVrstico();
    expect(screen.getByTestId("row-actions-1")).toBeInTheDocument();
  });
});
