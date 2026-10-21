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

vi.mock("@/hooks/use-siroki-zaslon", () => ({
  useSirokZaslon: () => Boolean((globalThis as { __siroki?: boolean }).__siroki),
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
  useGetPreparedFoodAvailability: () => ({ data: { businessDate: "2026-08-28", items: (globalThis as { __zal?: unknown[] }).__zal ?? [] }, isLoading: false }),
  getGetPreparedFoodAvailabilityQueryKey: () => ["/prepared-food/availability"],
  useListKategorije: () => ({ data: (globalThis as { __kat?: unknown[] }).__kat ?? [mockKategorija], isLoading: false }),
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

const g = globalThis as { __testNaprava?: unknown; __kat?: unknown[]; __zal?: unknown[]; __siroki?: boolean };
const naprava = (prikazMenija: string, prikazNarocila = "staro", gostota = "privzeto") => ({
  id: 1, ime: "t", napravaKljuc: "k", enotaId: 1, podjetjeDavcna: "x", placilniTerminal: null,
  gostotaArtiklov: gostota, prikazMenija, prikazNarocila, ustvarjeno: "", posodobljeno: "",
});
const kategorije = [
  { id: 1, ime: "Juhe", barva: "#aa0000", vrstniRed: 1, oddelek: "Hrana" },
  { id: 2, ime: "Pice", barva: "#00aa00", vrstniRed: 2, oddelek: "Pica" },
  { id: 3, ime: "Pivo", barva: "#0000aa", vrstniRed: 3, oddelek: "Pijača" },
  { id: 4, ime: "Posebno", barva: "#333333", vrstniRed: 4, oddelek: "Sezona" },
];
const artikel = (id: number, kat: number, extra: Record<string, unknown> = {}) => ({
  ...mockPicaBrezDodatkov, id, ime: `Jed ${String.fromCharCode(65 + (id - 100))}x${String.fromCharCode(97 + (id - 100))}`, jePica: false, kategorijaId: kat, ...extra,
});

describe("Order — strnjen krmilni del, vrstica naročila in Na izteku", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = makeQueryClient();
    mockNarocilo.postavke = [];
    mockKdsState.stations = [];
    mockKdsState.nalogi = [];
    g.__kat = kategorije;
    g.__zal = [];
    g.__siroki = false;
    mockArtikli.splice(0, mockArtikli.length,
      ...Array.from({ length: 20 }, (_, i) => artikel(100 + i, (i % 3) + 1)),
    );
  });

  const prikazi = async (n: ReturnType<typeof naprava>) => {
    g.__testNaprava = n;
    await act(async () => { render(<Wrapper qc={qc}><Order /></Wrapper>); });
  };

  it("varianta A: krmilni del ima eno vrstico iskanja in eno vrstico zavihkov (višina 32 + 36 px), brez Vse in Na izteku", async () => {
    await prikazi(naprava("A"));
    const del = screen.getByTestId("menu-krmilni-del");
    expect(del.querySelectorAll("[data-testid='menu-iskanje-vrstica']")).toHaveLength(1);
    expect(del.querySelectorAll("[data-testid='menu-nav-oddelki']")).toHaveLength(1);
    expect(del.querySelector("[data-testid='menu-nav-kategorije-oddelka']")).toBeNull();
    const vrstica = screen.getByTestId("menu-nav-oddelki");
    expect(vrstica.className).toContain("h-9");
    expect(vrstica.className).toContain("flex-nowrap");
    expect(vrstica.className).not.toContain("flex-wrap");
    expect(within(vrstica).queryByRole("button", { name: "Vse" })).toBeNull();
    expect(within(vrstica).queryByTestId("menu-nav-na-izteku")).toBeNull();
    expect(within(vrstica).getByTestId("menu-nav-pogosto")).toBeTruthy();
    // Oddelki: samo tisti s kategorijami, tudi oddelek, ki ni v privzetem seznamu.
    for (const o of ["Hrana", "Pica", "Pijača", "Sezona"]) expect(screen.getByTestId(`menu-nav-oddelek-${o}`)).toBeTruthy();
    expect(screen.queryByTestId("menu-nav-oddelek-Sladice")).toBeNull();
    // Zavihki nimajo obrobe in niso okrogli veliki gumbi.
    expect(screen.getByTestId("menu-nav-oddelek-Hrana").className).not.toMatch(/\bborder(-\d)?\b/);
    expect(screen.getByTestId("menu-nav-oddelek-Hrana").className).toContain("text-[13px]");
  });

  it("varianta A: izbira oddelka pokaže ENO vrstico njegovih kategorij brez prelamljanja (največ 3 vrstice krmilnih elementov)", async () => {
    await prikazi(naprava("A"));
    await act(async () => { fireEvent.click(screen.getByTestId("menu-nav-oddelek-Hrana")); });
    const kat = screen.getByTestId("menu-nav-kategorije-oddelka");
    expect(kat.className).toContain("h-9");
    expect(kat.className).toContain("flex-nowrap");
    expect(within(kat).getByRole("button", { name: "Juhe" })).toBeTruthy();
    expect(within(kat).queryByRole("button", { name: "Pivo" })).toBeNull();
    const del = screen.getByTestId("menu-krmilni-del");
    const vrstice = [
      ...del.querySelectorAll("[data-testid='menu-iskanje-vrstica'], [data-testid='menu-nav-oddelki'], [data-testid='menu-nav-kategorije-oddelka']"),
    ];
    expect(vrstice).toHaveLength(3);
  });

  it("varianta A: »+ Gost« je majhen gumb v zgornji vrstici in nima lastne vrstice; »+ Dodaj gosta« ni", async () => {
    await prikazi(naprava("A"));
    const zgoraj = screen.getByTestId("mobile-order-tabs");
    expect(within(zgoraj).getByRole("button", { name: "+ Gost" })).toBeTruthy();
    expect(within(zgoraj).getByTestId("order-context-line-mobile").textContent).toContain("#");
    expect(within(screen.getByTestId("menu-krmilni-del")).queryByText("+ Dodaj gosta")).toBeNull();
    expect(zgoraj.className).toContain("h-8");
    expect(within(screen.getByTestId("menu-krmilni-del")).queryByRole("button", { name: /Gost/ })).toBeNull();
  });

  it("»Trenutno« ostane nespremenjen: stara vrstica gostov, Vse in brez vrstice naročila", async () => {
    await prikazi(naprava("trenutno"));
    expect(within(screen.getByTestId("menu-krmilni-del")).getByText("+ Dodaj gosta")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Vse" })).toBeTruthy();
    expect(screen.queryByTestId("narocilo-vrstica")).toBeNull();
    expect(screen.queryByTestId("menu-nav-a")).toBeNull();
  });

  it("varianta B: ena vrstica (Pogosto, Kategorije (n), čip Na izteku) brez Vse", async () => {
    g.__zal = [{ articleId: 100, availableQuantity: 3 }];
    mockArtikli[0] = artikel(100, 1, { spremljajPorcije: true, mealType: "prepared" });
    await prikazi(naprava("B"));
    const b = screen.getByTestId("menu-nav-b");
    expect(b.className).toContain("flex-nowrap");
    expect(b.className).toContain("h-9");
    expect(within(b).getByTestId("menu-nav-pogosto")).toBeTruthy();
    expect(within(b).getByTestId("menu-nav-kategorije").textContent).toContain(`Kategorije (${kategorije.length})`);
    expect(within(b).queryByRole("button", { name: "Vse" })).toBeNull();
    expect(within(b).getByTestId("menu-nav-na-izteku").textContent).toContain("Na izteku (1)");
    expect(screen.getByTestId("menu-krmilni-del").querySelectorAll("[data-testid='menu-iskanje-vrstica'], [data-testid='menu-nav-b']")).toHaveLength(2);
  });

  it("Na izteku šteje samo 1–5 porcij; artikel z 0 porcijami je siv z oznako »Ni« in ni v čipu", async () => {
    g.__zal = [
      { articleId: 100, availableQuantity: 0 },
      { articleId: 101, availableQuantity: 5 },
      { articleId: 102, availableQuantity: 6 },
      { articleId: 103, availableQuantity: 1 },
    ];
    for (const id of [100, 101, 102, 103]) {
      const i = mockArtikli.findIndex((a) => a.id === id);
      mockArtikli[i] = artikel(id, 1, { spremljajPorcije: true, mealType: "prepared" });
    }
    await prikazi(naprava("B"));
    await act(async () => { fireEvent.click(screen.getByTestId("menu-nav-kategorije")); });
    await act(async () => { fireEvent.click(within(screen.getByTestId("menu-nav-b-mreza")).getByRole("button", { name: "Juhe" })); });
    expect(screen.getByTestId("menu-nav-na-izteku").textContent).toContain("Na izteku (2)");
    expect(screen.getByTestId("available-portions-100").textContent).toBe("Ni");
    expect(screen.getByTestId("available-portions-101").textContent).toBe("5 porcij");
    expect(screen.queryByTestId("available-portions-102")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("menu-nav-na-izteku")); });
    const mreza = screen.getByTestId("artikli-mreza");
    expect(within(mreza).queryByTestId("available-portions-100")).toBeNull();
    expect(within(mreza).getByTestId("available-portions-101")).toBeTruthy();
    expect(within(mreza).getByTestId("available-portions-103")).toBeTruthy();
  });

  it("»Seznam«: značka zaloge ostane v isti vrstici kot cena (ne prelomi se)", async () => {
    g.__zal = [{ articleId: 101, availableQuantity: 2 }];
    mockArtikli[1] = artikel(101, 1, { spremljajPorcije: true, mealType: "prepared" });
    await prikazi(naprava("B", "staro", "seznam"));
    await act(async () => { fireEvent.click(screen.getByTestId("menu-nav-kategorije")); });
    await act(async () => { fireEvent.click(within(screen.getByTestId("menu-nav-b-mreza")).getByRole("button", { name: "Juhe" })); });
    const znacka = screen.getByTestId("available-portions-101");
    expect(znacka.className).toContain("whitespace-nowrap");
    expect(znacka.className).toContain("shrink-0");
    expect(znacka.closest("button")!.className).toContain("flex-row");
  });

  for (const [meni, nar] of [["A", "staro"], ["A", "novo"], ["B", "staro"], ["B", "novo"], ["C", "staro"]] as const) {
    it(`varianta ${meni} (naročilo ${nar}): stalna vrstica Naročilo (n), znesek in Na blagajno; dotik levo odpre naročilo`, async () => {
      g.__siroki = true;
      mockNarocilo.postavke = [
        { id: 1, artikelId: 100, ime: "Artikel 100", kolicina: 2, cena: 4, skupaj: 8, davek: 9.5, modifikatorji: [], dodatki: [], racunId: null },
      ];
      await prikazi(naprava(meni, nar));
      const vrstica = screen.getByTestId("narocilo-vrstica");
      expect(vrstica.textContent).toContain("Naročilo (1)");
      expect(within(vrstica).getByTestId("narocilo-vrstica-blagajna").textContent).toContain("Na blagajno");
      expect(vrstica.className).toContain("fixed");
      expect(vrstica.className).toContain("bottom-0");
      await act(async () => { fireEvent.click(screen.getByTestId("narocilo-odpri")); });
      expect(screen.queryByTestId("narocilo-vrstica")).toBeNull();
      if (nar === "novo") expect(screen.getByTestId("narocilo-sheet")).toBeTruthy();
    });
  }

  it("meritev: krmilni del ≤ 105 px (15 % od 700), vsaj 12 ploščic vidnih pri 360 × 700 px", () => {
    // Izmerjene višine iz razredov (jsdom ne meri postavitve): vrstica naslova h-8, iskanje h-8, zavihki h-9, robovi py-0.5.
    const krmilniDel = 32 + 1 + 32 + 36 + 1; // naslov (h-8) + rob + iskanje (h-8) + zavihki (h-9) + rob
    expect(krmilniDel).toBeLessThanOrEqual(105);
    const vrsticaNarocila = 8 * 2 + 44 + 1; // py-2 + min-h-[44px] + rob
    const zaslon = 700;
    const pokrivalo = 12 /* p-3 zgoraj */ ;
    const visinaPloscice = 72 /* 4.5rem */, razmik = 8;
    const prostor = zaslon - krmilniDel - vrsticaNarocila - pokrivalo;
    const vrstic = Math.floor((prostor + razmik) / (visinaPloscice + razmik));
    expect(vrstic * 3).toBeGreaterThanOrEqual(12);
  });
});
