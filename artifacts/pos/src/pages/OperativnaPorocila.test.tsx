import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OperativnaPorocila from "./OperativnaPorocila";

const { mockUseReport, mockUseFailures, mockUseClosures, mockUseDeliveries, mockUseNormativi, mockUseStocks, mockUseDevices, mockUsePreparation, mockUseFeedback, mockUseComments } = vi.hoisted(() => ({
  mockUseReport: vi.fn(),
  mockUseFailures: vi.fn(),
  mockUseClosures: vi.fn(),
  mockUseDeliveries: vi.fn(),
  mockUseNormativi: vi.fn(),
  mockUseStocks: vi.fn(),
  mockUseDevices: vi.fn(),
  mockUsePreparation: vi.fn(),
  mockUseFeedback: vi.fn(),
  mockUseComments: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as object,
    useGetOperativnaPorocilaPromet: mockUseReport,
    getGetOperativnaPorocilaPrometQueryKey: (params: unknown) => ["operativna-porocila", params],
    useGetOperativnaPorocilaNapake: mockUseFailures,
    getGetOperativnaPorocilaNapakeQueryKey: (params: unknown) => ["operativna-porocila-napake", params],
    useGetOperativnaPorocilaZakljucki: mockUseClosures,
    getGetOperativnaPorocilaZakljuckiQueryKey: (params: unknown) => ["operativna-porocila-zakljucki", params],
    useGetOperativnaPorocilaDostave: mockUseDeliveries,
    getGetOperativnaPorocilaDostaveQueryKey: (params: unknown) => ["operativna-porocila-dostave", params],
    useGetOperativnaPorocilaNormativi: mockUseNormativi,
    getGetOperativnaPorocilaNormativiQueryKey: (params: unknown) => ["operativna-porocila-normativi", params],
    useGetOperativnaPorocilaZaloge: mockUseStocks,
    getGetOperativnaPorocilaZalogeQueryKey: (params: unknown) => ["operativna-porocila-zaloge", params],
    useGetOperativnaPorocilaNaprave: mockUseDevices,
    getGetOperativnaPorocilaNapraveQueryKey: (params: unknown) => ["operativna-porocila-naprave", params],
    useGetOperativnaPorocilaPriprava: mockUsePreparation,
    getGetOperativnaPorocilaPripravaQueryKey: (params: unknown) => ["operativna-porocila-priprava", params],
    useGetOperativnaPorocilaQrFeedback: mockUseFeedback,
    useGetOperativnaPorocilaQrFeedbackComments: mockUseComments,
  };
});

const report = {
  od: "2026-09-01",
  do: "2026-09-03",
  skupajPromet: 321.5,
  skupajDdv: 29.42,
  steviloRacunov: 8,
  prometPoEnotah: [
    { enotaId: 1, enota: "Center", skupaj: 321.5, ddv: 29.42, steviloRacunov: 8 },
  ],
  prometPoKategorijah: [
    { kategorijaId: 2, kategorija: "Pijače", skupaj: 120, osnova: 109.59, ddv: 10.41, kolicina: 15, steviloRacunov: 6 },
  ],
  prometPoMizah: [
    { mizaId: 4, mizaStevilka: 4, miza: "Notranja miza A", prostorId: 2, prostor: "Terasa", enotaId: 1, enota: "Center", skupaj: 85, steviloRacunov: 3 },
  ],
  prometPoProstorih: [
    { prostorId: 2, prostor: "Terasa", enotaId: 1, enota: "Center", skupaj: 85, steviloRacunov: 3 },
  ],
  prometPoArtiklih: [
    { artikelId: 22, artikel: "Espresso", enotaId: 1, enota: "Center", skupaj: 52.5, kolicina: 15, steviloRacunov: 6 },
  ],
  prometPoNatakarjih: [
    { natakarId: 3, natakar: "Ana Novak", enotaId: 1, enota: "Center", skupaj: 210, napitnina: 18.5, steviloRacunov: 5 },
  ],
  napitninePoZaposlenih: [
    { natakarId: 3, natakar: "Ana Novak", enotaId: 1, enota: "Center", skupaj: 210, napitnina: 18.5, steviloRacunov: 5 },
  ],
  prometPoNacinihPlacila: [
    { nacin: "gotovina", skupaj: 180, steviloRacunov: 5 },
    { nacin: "kartica", skupaj: 141.5, steviloRacunov: 4 },
  ],
};

const failures = {
  od: "2026-09-01",
  do: "2026-09-03",
  karticna: {
    skupaj: 1,
    neuspesne: 0,
    nejasne: 1,
    zapisi: [
      {
        id: "card-1",
        enotaId: 1,
        enota: "Center",
        provider: "sumup",
        purpose: "receipt",
        status: "unknown",
        znesek: 42.5,
        napaka: "Timeout pri preverjanju plačila",
        cas: "2026-09-03T10:15:00.000Z",
      },
    ],
  },
  furs: {
    skupaj: 1,
    neuspesne: 1,
    nejasne: 0,
    zapisi: [
      {
        id: "furs-1",
        racunId: 7,
        stevilkaRacuna: "PP001-B001-7",
        enotaId: 1,
        enota: "Center",
        outcome: "failed",
        napaka: "S003: Napaka podpisa",
        cas: "2026-09-03T10:16:00.000Z",
      },
    ],
  },
};

const closures = {
  od: "2026-09-01",
  do: "2026-09-03",
  skupaj: 2,
  zaklenjene: 1,
  blokirane: 1,
  odklenjene: 0,
  nezakljucene: 0,
  odstopanjaGotovine: 1,
  manjkajoceUskladitve: 1,
  zakljucki: [
    {
      enotaId: 1,
      enota: "Center",
      blagajnaId: 2,
      blagajna: "Glavna blagajna",
      poslovniDatum: "2026-09-03",
      status: "blokirano",
      zPorociloId: null,
      zStevilka: null,
      zakljucenOb: null,
      odklenjenOb: null,
      prometDneva: null,
      grandTotalPrej: null,
      grandTotalNov: null,
      cashStatus: "manjka_uskladitev",
      pricakovanaGotovina: null,
      prestetaGotovina: null,
      razlikaGotovine: null,
      razlogOdstopanja: null,
      blokade: [
        { type: "OPEN_SHIFTS", count: 1, message: "Zaprite odprto izmeno: Ana Novak.", items: [{ id: 12, label: "Ana Novak" }] },
      ],
    },
    {
      enotaId: 1,
      enota: "Center",
      blagajnaId: 2,
      blagajna: "Glavna blagajna",
      poslovniDatum: "2026-09-02",
      status: "zaklenjeno",
      zPorociloId: 9,
      zStevilka: 44,
      zakljucenOb: "2026-09-03T02:10:00.000Z",
      odklenjenOb: null,
      prometDneva: 280,
      grandTotalPrej: 1000,
      grandTotalNov: 1280,
      cashStatus: "odstopanje",
      pricakovanaGotovina: 180,
      prestetaGotovina: 175,
      razlikaGotovine: -5,
      razlogOdstopanja: "Manjko ob zaključku izmene",
      blokade: [],
    },
  ],
};

const deliveries = {
  od: "2026-09-01",
  do: "2026-09-03",
  skupaj: 3,
  aktivne: 1,
  zamujene: 1,
  dostavljene: 1,
  preklicane: 1,
  brezRoka: 0,
  poStatusih: {
    prejeto: 0,
    potrjeno: 0,
    v_pripravi: 1,
    pripravljeno: 0,
    prevzel_kurir: 0,
    dostavljeno: 1,
    preklicano: 1,
  },
  dostave: [
    {
      id: 31,
      enotaId: 1,
      enota: "Center",
      stevilkaNarocila: 87,
      strankaIme: "Janez Novak",
      strankaTelefon: "040000000",
      naslov: "Dunajska 10 Ljubljana",
      ustvarjeno: "2026-09-03T10:00:00.000Z",
      predvidenaDostava: "2026-09-03T10:45:00.000Z",
      dostavaStatus: "v_pripravi",
      dostavljenoOb: null,
      preklicanoOb: null,
      zamujeno: true,
      brezRoka: false,
    },
    {
      id: 30,
      enotaId: 1,
      enota: "Center",
      stevilkaNarocila: 86,
      strankaIme: "Maja Kovač",
      strankaTelefon: null,
      naslov: "Celovška 20 Ljubljana",
      ustvarjeno: "2026-09-02T11:00:00.000Z",
      predvidenaDostava: "2026-09-02T12:00:00.000Z",
      dostavaStatus: "dostavljeno",
      dostavljenoOb: "2026-09-02T11:55:00.000Z",
      preklicanoOb: null,
      zamujeno: false,
      brezRoka: false,
    },
    {
      id: 29,
      enotaId: 1,
      enota: "Center",
      stevilkaNarocila: 85,
      strankaIme: null,
      strankaTelefon: null,
      naslov: null,
      ustvarjeno: "2026-09-01T09:00:00.000Z",
      predvidenaDostava: "2026-09-01T09:45:00.000Z",
      dostavaStatus: "preklicano",
      dostavljenoOb: null,
      preklicanoOb: "2026-09-01T09:10:00.000Z",
      zamujeno: false,
      brezRoka: false,
    },
  ],
};

const normativeConsumption = {
  od: "2026-09-01",
  do: "2026-09-03",
  skupajVrednost: 54.5,
  skupajGibov: 12,
  poEnotah: [
    { enotaId: 1, enota: "Center", vrednost: 54.5, steviloGibov: 12 },
  ],
  artikli: [
    {
      artikelId: 101,
      artikel: "Kavna zrna",
      enotaMere: "kg",
      enotaId: 1,
      enota: "Center",
      kolicina: 2.45,
      vrednost: 54.5,
      steviloGibov: 12,
    },
  ],
};

const stockReport = {
  od: "2026-09-01",
  do: "2026-09-03",
  skupajVrednost: 825.4,
  kriticne: 1,
  prazne: 1,
  inventurnaOdstopanja: 1,
  inventurnaVrednost: 12,
  steviloOdpisov: 1,
  vrednostOdpisov: 8.4,
  poEnotah: [
    { enotaId: 1, enota: "Center", vrednost: 825.4, kriticne: 1, prazne: 1, inventurnaOdstopanja: 1 },
  ],
  zaloge: [
    {
      artikelId: 102,
      artikel: "Mleko",
      enotaMere: "l",
      enotaId: 1,
      enota: "Center",
      kolicina: -3,
      povprecnaCena: null,
      vrednost: 0,
      status: "kriticna",
    },
    {
      artikelId: 103,
      artikel: "Sladkor",
      enotaMere: "kg",
      enotaId: 1,
      enota: "Center",
      kolicina: 0,
      povprecnaCena: null,
      vrednost: 0,
      status: "prazna",
    },
  ],
  odstopanja: [
    {
      id: 11,
      inventuraId: 4,
      inventuraStevilka: "26000004",
      datum: "2026-09-02T23:59:59.000Z",
      artikelId: 102,
      artikel: "Mleko",
      enotaMere: "l",
      enotaId: 1,
      enota: "Center",
      razlika: -3,
      cenaKos: 4,
      vrednost: 12,
    },
  ],
  odpisi: [
    {
      id: 14,
      zapisnikId: 8,
      stevilkaZapisnika: 17,
      datum: "2026-09-02",
      artikelId: 105,
      artikel: "Dnevna juha",
      enotaMere: "l",
      enotaId: 1,
      enota: "Center",
      kolicina: 2,
      vrednost: 8.4,
      razlog: "Pretečen rok varne uporabe",
    },
  ],
};

const deviceReport = {
  od: "2026-09-01",
  do: "2026-09-03",
  skupaj: 2,
  vRedu: 1,
  opozorila: 0,
  napake: 1,
  naprave: [
    {
      id: 7,
      enotaId: 1,
      enota: "Center",
      ime: "Blagajna pri šanku",
      posodobljeno: "2026-09-03T09:00:00.000Z",
      status: "napaka",
      konfiguracija: {
        terminal: "aktiven",
        tiskalnik: "nastavljen",
      },
      tiskalnik: {
        status: "ni_dosegljiv",
        ime: "EPSON Bar",
        zadnjiSignal: "2026-09-03T08:00:00.000Z",
        neuspesneNaloge: 2,
        cakajoceNaloge: 1,
      },
      opozorila: [
        "agent tiskalnika se ni javil zadnjih 10 minut",
        "2 tiskalnih nalog zahteva preverjanje",
      ],
    },
    {
      id: 8,
      enotaId: 1,
      enota: "Center",
      ime: "Tablica terasa",
      posodobljeno: "2026-09-03T09:30:00.000Z",
      status: "v_redu",
      konfiguracija: {
        terminal: "neaktiven",
        tiskalnik: "ni_nastavljen",
      },
      tiskalnik: {
        status: "ni_nastavljen",
        ime: null,
        zadnjiSignal: null,
        neuspesneNaloge: 0,
        cakajoceNaloge: 0,
      },
      opozorila: [],
    },
  ],
};

const preparationReport = {
  od: "2026-09-01",
  do: "2026-09-03",
  skupajNalogov: 20,
  zakljucenihNalogov: 18,
  aktivnihNalogov: 2,
  povprecjeMinut: 6.25,
  poPostajah: [
    {
      postajaId: 1,
      postaja: "Kuhinja",
      enotaId: 1,
      enota: "Center",
      skupajNalogov: 20,
      zakljucenihNalogov: 18,
      aktivnihNalogov: 2,
      povprecjeMinut: 6.25,
      najkrajsiCasMinut: 2.5,
      najdaljsiCasMinut: 14,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OperativnaPorocila />
    </QueryClientProvider>,
  );
}

describe("OperativnaPorocila", () => {
  beforeEach(() => {
    mockUseReport.mockReset();
    mockUseFailures.mockReset();
    mockUseClosures.mockReset();
    mockUseDeliveries.mockReset();
    mockUseNormativi.mockReset();
    mockUseStocks.mockReset();
    mockUseDevices.mockReset();
    mockUsePreparation.mockReset();
    mockUseFeedback.mockReset();
    mockUseComments.mockReset();
    mockUseFeedback.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, isError: false, error: null });
    mockUseComments.mockReturnValue({ data: undefined, isLoading: true, isFetching: true, isError: false, error: null });
    mockUseReport.mockReturnValue({
      data: report,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUseFailures.mockReturnValue({
      data: failures,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUseClosures.mockReturnValue({
      data: closures,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUseDeliveries.mockReturnValue({
      data: deliveries,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUseNormativi.mockReturnValue({
      data: normativeConsumption,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUseStocks.mockReturnValue({
      data: stockReport,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUseDevices.mockReturnValue({
      data: deviceReport,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUsePreparation.mockReturnValue({
      data: preparationReport,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
  });

  it("prikaže promet po kategoriji, poslovni enoti in mizi", () => {
    renderPage();

    expect(screen.getByText("Pijače")).not.toBeNull();
    expect(screen.getAllByText("Center").length).toBeGreaterThan(0);
    expect(screen.getByText("Notranja miza A")).not.toBeNull();
    expect(screen.getAllByText("Terasa")).toHaveLength(2);
    expect(screen.getByText("Po prostorih")).not.toBeNull();
    expect(screen.getAllByText("321.50 €")).toHaveLength(2);
  });

  it("loči nejasno kartično plačilo od zavrnjenega FURS poskusa", () => {
    renderPage();

    expect(screen.getByText("Težave pri kartičnih plačilih")).not.toBeNull();
    expect(screen.getByText("Težave pri davčnem potrjevanju (FURS)")).not.toBeNull();
    expect(screen.getByText("Nejasno (preveri)")).not.toBeNull();
    expect(screen.getByText("Neuspešno")).not.toBeNull();
    expect(screen.getByText("SumUp")).not.toBeNull();
    expect(screen.getByText("Račun: PP001-B001-7")).not.toBeNull();
    expect(screen.getByText("Timeout pri preverjanju plačila")).not.toBeNull();
    expect(screen.getByText("S003: Napaka podpisa")).not.toBeNull();
  });

  it("prikaže blokado zaključka in odstopanje gotovine", () => {
    renderPage();

    expect(screen.getByText("Zaključki blagajn")).not.toBeNull();
    expect(screen.getAllByText("Glavna blagajna")).toHaveLength(2);
    expect(screen.getByText("Zaprite odprto izmeno: Ana Novak.")).not.toBeNull();
    expect(screen.getByText("Uskladitev manjka")).not.toBeNull();
    expect(screen.getByText("Razlika -5.00 €")).not.toBeNull();
    expect(screen.getByText("Manjko ob zaključku izmene")).not.toBeNull();
    expect(screen.getByText("Z-44")).not.toBeNull();
  });

  it("prikaže aktivno zamudo ter zaključene in preklicane dostave", () => {
    renderPage();

    expect(screen.getByText("Dostave in zamude")).not.toBeNull();
    expect(screen.getByText("Naročilo #87")).not.toBeNull();
    expect(screen.getByText("Janez Novak")).not.toBeNull();
    expect(screen.getByText("Dunajska 10 Ljubljana")).not.toBeNull();
    expect(screen.getByText("Zamuda")).not.toBeNull();
    expect(screen.getAllByText("Dostavljeno").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Preklicano").length).toBeGreaterThan(0);
  });

  it("prikaže normativno porabo vhodnih artiklov", () => {
    renderPage();

    expect(screen.getByText("Normativna poraba")).not.toBeNull();
    expect(screen.getByText("Kavna zrna")).not.toBeNull();
    expect(screen.getByText("2,45 kg")).not.toBeNull();
    expect(screen.getAllByText("54.50 €").length).toBeGreaterThan(0);
    expect(screen.getByText("12 gibov")).not.toBeNull();
  });

  it("prikaže kritične zaloge, inventurna odstopanja in odpise", () => {
    renderPage();

    expect(screen.getByText("Zaloge in inventurna odstopanja")).not.toBeNull();
    expect(screen.getAllByText("Mleko")).toHaveLength(2);
    const negativnoCell = screen.getByText("Negativno").closest("td");
    expect(negativnoCell?.textContent).toContain("3 l");
    expect(screen.getByText("Sladkor")).not.toBeNull();
    expect(screen.getByText("Prazno")).not.toBeNull();
    expect(screen.getByText("26000004")).not.toBeNull();
    expect(screen.getAllByText("12.00 €").length).toBeGreaterThan(0);
    expect(screen.getByText("Potrjeni odpisi pripravljene hrane")).not.toBeNull();
    expect(screen.getByText("Dnevna juha")).not.toBeNull();
    expect(screen.getByText("Pretečen rok varne uporabe")).not.toBeNull();
    expect(screen.getByText("#17")).not.toBeNull();
    expect(screen.getAllByText("8.40 €").length).toBeGreaterThan(0);
  });

  it("prikaže nedosegljive naprave in neuspešne tiskalne naloge", () => {
    renderPage();

    expect(screen.getByText("POS naprave")).not.toBeNull();
    expect(screen.getByText("Blagajna pri šanku")).not.toBeNull();
    expect(screen.getByText("EPSON Bar")).not.toBeNull();
    expect(screen.getByText(/Ni dosegljiv · zadnji signal/)).not.toBeNull();
    expect(screen.getByText("2 neuspešnih")).not.toBeNull();
    expect(screen.getByText("1 čakajočih")).not.toBeNull();
    expect(screen.getByText("agent tiskalnika se ni javil zadnjih 10 minut")).not.toBeNull();
    expect(screen.getByText("Tablica terasa")).not.toBeNull();
    expect(screen.getByText("Brez zaznanih težav")).not.toBeNull();
  });

  it("prikaže promet po artiklu, natakarju, plačilu in napitninah", () => {
    renderPage();

    expect(screen.getByText("Promet po artiklih")).not.toBeNull();
    expect(screen.getByText("Espresso")).not.toBeNull();
    expect(screen.getByText("Promet in napitnine po zaposlenem")).not.toBeNull();
    expect(screen.getAllByText("Ana Novak").length).toBeGreaterThan(0);
    expect(screen.getByText("18.50 €")).not.toBeNull();
    expect(screen.getByText("Promet po načinu plačila")).not.toBeNull();
    expect(screen.getAllByText("Gotovina").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kartica").length).toBeGreaterThan(0);
  });

  it("prikaže dejanski čas priprave po KDS postaji", () => {
    renderPage();

    expect(screen.getByText("Čas priprave po kuhinji in točilnici")).not.toBeNull();
    expect(screen.getByText("Kuhinja")).not.toBeNull();
    expect(screen.getAllByText("6.3 min").length).toBeGreaterThan(0);
    expect(screen.getByText("18/20")).not.toBeNull();
    expect(screen.getByText("14.0 min")).not.toBeNull();
  });

  it("po spremembi obdobja pošlje nova datuma v hook", () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("Od datuma"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Do datuma"), { target: { value: "2026-08-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Prikaži" }));

    expect(mockUseReport).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
    expect(mockUseFailures).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
    expect(mockUseClosures).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
    expect(mockUseDeliveries).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
    expect(mockUseNormativi).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
    expect(mockUseStocks).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
    expect(mockUseDevices).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
    expect(mockUsePreparation).toHaveBeenLastCalledWith(
      { od: "2026-08-01", do: "2026-08-31" },
      expect.any(Object),
    );
  });

  it("prikaže prazno stanje brez izdanih računov", () => {
    mockUseReport.mockReturnValue({
      data: {
        ...report,
        skupajPromet: 0,
        skupajDdv: 0,
        steviloRacunov: 0,
        prometPoEnotah: [],
        prometPoKategorijah: [],
        prometPoMizah: [],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    mockUseFailures.mockReturnValue({
      data: {
        ...failures,
        karticna: { skupaj: 0, neuspesne: 0, nejasne: 0, zapisi: [] },
        furs: { skupaj: 0, neuspesne: 0, nejasne: 0, zapisi: [] },
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    });
    renderPage();
    expect(screen.getByText("Za izbrano obdobje ni izdanih računov.")).not.toBeNull();
  });

  it("med začetnim nalaganjem ne prikazuje starih KPI vrednosti", () => {
    mockUseReport.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    mockUseFailures.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    mockUseClosures.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    mockUseDeliveries.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    mockUseNormativi.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    mockUseStocks.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    mockUseDevices.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });
    mockUsePreparation.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });

    renderPage();
    expect(screen.queryByText("321.50 €")).toBeNull();
    expect(screen.getByText("Operativna poročila")).not.toBeNull();
  });
});