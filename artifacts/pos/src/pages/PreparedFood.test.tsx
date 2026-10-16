import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PreparedFoodPage from "./PreparedFood";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mocks
const { mockPosFetch } = vi.hoisted(() => ({ mockPosFetch: vi.fn() }));
vi.mock("@/lib/pos-auth-headers", () => ({ posFetch: mockPosFetch }));
const mockSave = vi.fn();
const mockClose = vi.fn();
const mockSaveStocks = vi.fn();
const mockConsumption = vi.fn();
let mockEditable = true;
let mockClosedAt: string | null = null;
let mockFrozenQuantity = 20;
let mockUnitOfMeasure = "porcija";
const testDate = "2026-08-28";
const makeDailyRow = (artikelId: number, articleName: string, thawedQuantity = 0) => ({
  id: artikelId,
  enotaId: 1,
  businessDate: testDate,
  artikelId,
  thawedQuantity,
  preparedQuantity: 0,
  preparationBatches: null,
  normativeBatchPieces: null,
  defaultRecipeBatchPieces: null,
  correctionQuantity: 0,
  soldQuantity: 0,
  frozenAtEndQuantity: 0,
  wasteQuantity: 0,
  wasteDeliveredQuantity: 0,
  wasteValue: null,
  closedAt: null,
  articleName,
  unitOfMeasure: mockUnitOfMeasure,
  editable: mockEditable,
});
let mockDailyRows: any[] = [];
let mockMalicaOffers: any[] = [];
let mockPizzaArticle: any = null;
let mockAdditionalStocks: any[] = [];

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as any,
    useListPreparedFoodDaily: () => ({
      data: mockDailyRows.map(row => ({
        ...row,
        closedAt: mockClosedAt ?? row.closedAt,
        editable: mockEditable,
      })),
      isLoading: false
    }),
    useListMalicaDailyOffers: () => ({ data: mockMalicaOffers, isLoading: false }),
    useListPreparedFoodStocks: (year: number) => ({
      data: [{
        id: 5,
        enotaId: 1,
        artikelId: 10,
        articleName: "Goveja juha",
        year,
        openingQuantity: 20,
        openingCostPerPortion: 1.5,
        frozenQuantity: mockFrozenQuantity,
        frozenCostPerPortion: 1.75,
        unitOfMeasure: mockUnitOfMeasure,
      }, ...mockAdditionalStocks],
      isLoading: false,
    }),
    useListArtikli: () => ({
      data: [{ id: 10, ime: "Goveja juha" }, ...(mockPizzaArticle ? [mockPizzaArticle] : [])],
      isLoading: false,
    }),
    useListPreparedFoodDailyHistory: () => ({
      data: [{
        id: 1,
        artikelId: 10,
        businessDate: testDate,
        articleName: "Goveja juha",
        closedAt: mockClosedAt,
      }],
      isLoading: false,
    }),
    useSavePreparedFoodDaily: () => ({ mutateAsync: mockSave, isPending: false }),
    useGetPreparedFoodConsumption: (...args: unknown[]) => mockConsumption(...args),
    useClosePreparedFoodDaily: () => ({ mutateAsync: mockClose, isPending: false }),
    useUpdatePreparedFoodStocks: () => ({ mutate: mockSaveStocks, isPending: false }),
    getListPreparedFoodDailyQueryKey: vi.fn(),
    getListPreparedFoodStocksQueryKey: vi.fn(),
    getListPreparedFoodDailyHistoryQueryKey: vi.fn(),
  };
});

describe("PreparedFoodPage - Daily Ledger", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockSave.mockClear();
    mockClose.mockClear();
    mockSaveStocks.mockClear();
    mockConsumption.mockReset();
    mockConsumption.mockImplementation((_date, _articleId, params) => ({
      data: {
        articleId: 10, articleName: "Goveja juha",
        preparedQuantity: params?.quantity ?? 5, unitOfMeasure: mockUnitOfMeasure,
        source: mockClosedAt ? "actual" : "normative",
        items: [{ ingredientId: 50, ingredientName: "Goveje meso", unitOfMeasure: "KGM",
          quantity: mockClosedAt ? 1.25 : (params?.quantity ?? 5) * 0.25, quantityPerUnit: 0.25 }],
      }, isLoading: false, isError: false, refetch: vi.fn(),
    }));
    mockEditable = true;
    mockClosedAt = null;
    mockFrozenQuantity = 20;
    mockUnitOfMeasure = "porcija";
    mockPizzaArticle = null;
    mockAdditionalStocks = [];
    mockPosFetch.mockReset();
    mockPosFetch.mockResolvedValue({ ok: true, json: async () => [] });
    mockDailyRows = [{
      id: 1,
      artikelId: 10,
      thawedQuantity: 10,
      preparedQuantity: 5,
      correctionQuantity: 0,
      soldQuantity: 12,
      frozenAtEndQuantity: 2,
      wasteQuantity: 1,
      wasteValue: 2.50,
      businessDate: testDate,
      articleName: "Goveja juha",
      unitOfMeasure: mockUnitOfMeasure,
      closedAt: mockClosedAt,
      editable: mockEditable,
    }];
    mockMalicaOffers = [];
    mockSave.mockResolvedValue({});
    mockClose.mockResolvedValue({});
  });

  async function openTestDate() {
    fireEvent.click(await screen.findByText("28.08.2026"));
    await screen.findByText("Goveja juha");
  }

  it("klik na pripravljeno pokaže porabo; sprememba količine osveži predogled brez shranjevanja", async () => {
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();
    fireEvent.click(screen.getByLabelText("Pripravljeno"));
    expect(await screen.findByRole("dialog")).not.toBeNull();
    expect(screen.getByText("Goveje meso")).not.toBeNull();
    expect(screen.getByText("1,25")).not.toBeNull();
    expect(screen.getByText(/Poraba se razknjiži šele ob zaključku/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Količina pripravljeno za izračun porabe"), { target: { value: "8" } });
    await waitFor(() => expect(screen.getByText("Neshranjena količina")).not.toBeNull());
    expect(mockConsumption.mock.lastCall?.[2]).toEqual({ quantity: 8 });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Zapri" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Pripravljeno").getAttribute("value")).toBe("8");
  });

  it("na zaključeni evidenci pokaže dejansko porabo brez možnosti spremembe količine", async () => {
    mockEditable = false;
    mockClosedAt = "2026-08-28T18:00:00Z";
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();
    fireEvent.click(screen.getByRole("button", { name: "Poraba artiklov: Goveja juha" }));
    expect(await screen.findByText("Dejanska knjižena poraba ob zaključku dnevne evidence.")).not.toBeNull();
    expect(screen.getByText("1,25")).not.toBeNull();
    expect(screen.queryByLabelText("Količina pripravljeno za izračun porabe")).toBeNull();
    expect(mockConsumption.mock.lastCall?.[2]).toBeUndefined();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("napako pridobivanja porabe jasno prikaže in ponudi ponovni poskus", async () => {
    mockConsumption.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();
    fireEvent.click(screen.getByLabelText("Pripravljeno"));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Poskusi znova" })).not.toBeNull();
  });

  it("razširi in ponovno skrči izbrani datum", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("28.08.2026")).not.toBeNull();
    expect(screen.queryByText("Goveja juha")).toBeNull();

    await openTestDate();
    expect(screen.getByText("15")).not.toBeNull();
    expect(screen.getByText("12")).not.toBeNull();
    expect(screen.getByText("Na voljo za odtajanje: 20 porcija")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /28.08.2026/i }));
    expect(await screen.findByText("28.08.2026")).not.toBeNull();
    expect(screen.queryByText("Goveja juha")).toBeNull();
  });

  it("z zvezdico postavi objavljene malice na vrh, nato odtajljive in preostale jedi po abecedi", async () => {
    mockDailyRows = [
      makeDailyRow(10, "Goveja juha", 1),
      makeDailyRow(11, "Zrezek"),
      makeDailyRow(12, "Puding"),
      makeDailyRow(13, "Bograč"),
      makeDailyRow(14, "Rižota"),
    ];
    mockAdditionalStocks = [{
      id: 6,
      enotaId: 1,
      artikelId: 13,
      articleName: "Bograč",
      year: Number(testDate.slice(0, 4)),
      openingQuantity: 2,
      openingCostPerPortion: 1,
      frozenQuantity: 2,
      frozenCostPerPortion: 1,
      unitOfMeasure: mockUnitOfMeasure,
    }];
    mockMalicaOffers = [{
      businessDate: testDate,
      status: "published",
      mainItems: [{ artikelId: 11, enabled: true }],
      includedCourses: [{ artikelId: 12, enabled: true }],
    }];
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();

    const table = screen.getByRole("table", { name: "Dnevna evidenca pripravljene hrane" });
    const rowNames = Array.from(table.querySelectorAll("tbody tr"))
      .map(row => row.querySelector("td")?.textContent ?? "");
    expect(rowNames).toEqual([
      expect.stringContaining("Puding"),
      expect.stringContaining("Zrezek"),
      expect.stringContaining("Bograč"),
      expect.stringContaining("Goveja juha"),
      expect.stringContaining("Rižota"),
    ]);
    expect(screen.getAllByLabelText("Objavljeno v malicah")).toHaveLength(2);
  });

  it("takoj za objavljeno malico razvrsti hlebčke po velikosti, tudi družinskega", async () => {
    mockPizzaArticle = { id: 99, ime: "Pica", jePica: true };
    mockDailyRows = [
      makeDailyRow(11, "Malica pica"),
      makeDailyRow(21, "Testo normalno"),
      makeDailyRow(22, "Testo malo"),
      makeDailyRow(23, "Testo družinsko"),
      makeDailyRow(10, "Goveja juha", 1),
    ];
    mockMalicaOffers = [{
      businessDate: testDate,
      status: "published",
      mainItems: [{ artikelId: 11, enabled: true }],
      includedCourses: [],
    }];
    mockPosFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { size: "normalna", ingredient: { id: 21, name: "Testo normalno" }, quantity: 1 },
        { size: "mala", ingredient: { id: 22, name: "Testo malo" }, quantity: 1 },
        { size: "druzinska", ingredient: { id: 23, name: "Testo družinsko" }, quantity: 1 },
      ],
    });
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();

    const table = screen.getByRole("table", { name: "Dnevna evidenca pripravljene hrane" });
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const rowNames = rows.map(row => row.querySelector("td")?.textContent ?? "");
    expect(rowNames).toEqual([
      expect.stringContaining("Malica pica"),
      expect.stringContaining("Testo normalno"),
      expect.stringContaining("Testo malo"),
      expect.stringContaining("Testo družinsko"),
      expect.stringContaining("Goveja juha"),
    ]);
    expect(rowNames[1]).toContain("Hlebček za pico: normalno");
    expect(rowNames[2]).toContain("Hlebček za pico: malo");
    expect(rowNames[3]).toContain("Hlebček za pico: družinsko");
  });

  it("shrani vse spremembe z enim skupnim gumbom", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );

    await openTestDate();

    // Editable controls need reserved column width, with scrolling on narrow desktops.
    expect(screen.getByRole("table", { name: "Dnevna evidenca pripravljene hrane" }).className)
      .toContain("lg:min-w-[1040px]");

    // Inputs for thawed, prepared, correction, frozen
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: povečaj za eno" }));
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: povečaj za eno" }));
    fireEvent.click(screen.getByRole("button", { name: "Pripravljeno: povečaj za eno" }));
    
    const saveBtn = screen.getByRole("button", { name: "Shrani vse" });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0].data).toEqual({
      thawedQuantity: 12,
      preparedQuantity: 6,
      correctionQuantity: 0,
      preparationBatches: null,
      frozenAtEndQuantity: 2 // unchanged
    });
  });

  it("odtajanje omeji na razpoložljivo količino in na nič, tudi pri korakih po deset", async () => {
    mockFrozenQuantity = 13;
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();
    const thawed = screen.getByRole("textbox", { name: "Odtajano" }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: povečaj za deset" }));
    expect(thawed.value).toBe("13");
    expect((screen.getByRole("button", { name: "Odtajano: povečaj za eno" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: zmanjšaj za deset" }));
    expect(thawed.value).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: zmanjšaj za deset" }));
    expect(thawed.value).toBe("0");
    expect((screen.getByRole("button", { name: "Odtajano: zmanjšaj za eno" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: povečaj za deset" }));
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: povečaj za deset" }));
    fireEvent.click(screen.getByRole("button", { name: "Shrani vse" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0].data.thawedQuantity).toBe(13);
  });

  it("ne shrani že vpisane odtajane količine nad zalogo, dokler ni popravljena", async () => {
    mockFrozenQuantity = 8;
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();
    expect(screen.getByText("Na voljo za odtajanje: 8 porcija")).not.toBeNull();
    expect(screen.getByText("Vnesite od 0 do 8.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Shrani vse" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Zaključi vse" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Odtajano: zmanjšaj za eno" }));
    expect((screen.getByRole("textbox", { name: "Odtajano" }) as HTMLInputElement).value).toBe("8");
    expect((screen.getByRole("button", { name: "Shrani vse" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Shrani vse" }));
    await waitFor(() => expect(mockSave.mock.calls[0][0].data.thawedQuantity).toBe(8));
  });

  it("omogoča touch spremembe za enice in desetice ter negativen popravek", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );

    await openTestDate();

    fireEvent.click(screen.getByRole("button", { name: "Odtajano: povečaj za deset" }));
    fireEvent.click(screen.getByRole("button", { name: "Pripravljeno: zmanjšaj za eno" }));
    fireEvent.click(screen.getByRole("button", { name: "Korekcija: zmanjšaj za eno" }));
    fireEvent.click(screen.getByRole("button", { name: "Zamrznjeno: povečaj za eno" }));

    expect((screen.getByRole("textbox", { name: "Odtajano" }) as HTMLInputElement).value).toBe("20");
    expect((screen.getByRole("textbox", { name: "Pripravljeno" }) as HTMLInputElement).value).toBe("4");
    expect((screen.getByRole("textbox", { name: "Korekcija" }) as HTMLInputElement).value).toBe("-1");
    expect((screen.getByRole("textbox", { name: "Zamrznjeno" }) as HTMLInputElement).value).toBe("3");
    expect(screen.getByText("23")).not.toBeNull();
  });

  it("prikazuje enoto kg in uporablja decimalne korake za dnevne količine", async () => {
    mockUnitOfMeasure = "kg";
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();

    expect(screen.getByText("(kg)")).not.toBeNull();
    const prepared = screen.getByRole("textbox", { name: "Pripravljeno (kg)" }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Pripravljeno (kg): povečaj za 0,1" }));
    expect(prepared.value).toBe("5,1");
    expect(screen.getByRole("button", { name: "Pripravljeno (kg): povečaj za 1" })).not.toBeNull();
  });

  it("omogoča neposreden decimalni vnos kg količine in shrani natančno vrednost", async () => {
    mockUnitOfMeasure = "kg";
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();

    const prepared = screen.getByRole("textbox", { name: "Pripravljeno (kg)" });
    expect((prepared as HTMLInputElement).readOnly).toBe(false);
    fireEvent.change(prepared, { target: { value: "0.35" } });
    expect((prepared as HTMLInputElement).value).toBe("0,35");
    fireEvent.click(screen.getByRole("button", { name: "Shrani vse" }));

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0].data).toEqual({
      thawedQuantity: 10,
      preparedQuantity: 0.35,
      correctionQuantity: 0,
      preparationBatches: null,
      frozenAtEndQuantity: 2,
    });
  });

  it("omogoča neposreden decimalni vnos korekcije v litrih in shrani natančno vrednost", async () => {
    mockUnitOfMeasure = "l";
    render(<QueryClientProvider client={queryClient}><PreparedFoodPage /></QueryClientProvider>);
    await openTestDate();

    const correction = screen.getByRole("textbox", { name: "Korekcija (l)" });
    expect((correction as HTMLInputElement).readOnly).toBe(false);
    fireEvent.change(correction, { target: { value: "0.025" } });
    expect((correction as HTMLInputElement).value).toBe("0,025");
    fireEvent.click(screen.getByRole("button", { name: "Shrani vse" }));

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0].data).toEqual({
      thawedQuantity: 10,
      preparedQuantity: 5,
      correctionQuantity: 0.025,
      preparationBatches: null,
      frozenAtEndQuantity: 2,
    });
  });

  it("s kljukico prenese preostanek v zamrzovanje, količina pa ostane ročno nastavljiva", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );
    await openTestDate();
    const ledgerTable = screen.getByRole("table", { name: "Dnevna evidenca pripravljene hrane" });
    expect(ledgerTable.className).toContain("block w-full");
    expect(ledgerTable.className).not.toContain("min-w-[900px]");
    expect(screen.getByText("Po prodaji: 3 porcija")).not.toBeNull();

    const freezeAll = screen.getByRole("checkbox", { name: "Zamrzni vso razpoložljivo količino: Goveja juha" });
    fireEvent.click(freezeAll);
    const frozen = screen.getByRole("textbox", { name: "Zamrznjeno" }) as HTMLInputElement;
    expect(frozen.value).toBe("3"); // Skupaj 15 − prodano 12
    expect(freezeAll.getAttribute("data-state")).toBe("checked");
    expect(mockSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Zamrznjeno: zmanjšaj za eno" }));
    expect(frozen.value).toBe("2");
    expect(freezeAll.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(screen.getByRole("button", { name: "Pripravljeno: povečaj za eno" }));
    fireEvent.click(freezeAll);
    expect(frozen.value).toBe("4"); // Ponovno upošteva trenutno pripravljeno količino

    fireEvent.click(freezeAll);
    expect(frozen.value).toBe("0"); // Odkljukanje pomeni, da gre preostanek v kalo
    fireEvent.click(freezeAll);
    expect(frozen.value).toBe("4");

    fireEvent.click(screen.getByRole("button", { name: "Shrani vse" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0].data.frozenAtEndQuantity).toBe(4);
  });

  it("zaključi vse postavke prek skupnega potrditvenega okna", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );
    
    await openTestDate();

    const closeBtn = screen.getByRole("button", { name: "Zaključi vse" });
    fireEvent.click(closeBtn);

    expect(await screen.findByText(/Zaključi evidenco za 28\.08\.2026/i)).not.toBeNull();
    
    const confirmBtn = screen.getByRole("button", { name: "Potrdi in zaključi vse" });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
  });

  it("starejšo odprto evidenco prikaže samo za ogled", async () => {
    mockEditable = false;
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );

    await openTestDate();
    expect(await screen.findByText("Samo ogled")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Shrani vse" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Zamrzni vso razpoložljivo količino/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Zgodovina" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Zapisniki kala" })).not.toBeNull();
  });

  it("kalo pokaže šele po zaključku", async () => {
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );
    await openTestDate();
    expect(screen.queryByText("1")).toBeNull();

    unmount();
    mockClosedAt = "2026-08-28T22:00:00.000Z";
    mockEditable = false;
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );
    await openTestDate();
    expect(screen.getByText("1")).not.toBeNull();
    expect(screen.getByText("Zaključeno")).not.toBeNull();
  });
});

describe("PreparedFoodPage - Opening stock", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockSaveStocks.mockClear();
  });

  it("pošlje samo spremenjeno vrstico s skupnim gumbom", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );

    const stockTab = screen.getByRole("tab", { name: /Začetna zaloga/i });
    fireEvent.mouseDown(stockTab, { button: 0, ctrlKey: false });
    const saveAll = screen.getByRole("button", { name: "Shrani vse" });
    expect((saveAll as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue("20"), { target: { value: "24" } });
    fireEvent.click(saveAll);

    expect(mockSaveStocks).toHaveBeenCalledTimes(1);
    expect(mockSaveStocks.mock.calls[0][0]).toEqual({
      year: new Date().getFullYear(),
      data: {
        items: [{
          articleId: 10,
          openingQuantity: 24,
          openingCostPerPortion: 1.5,
        }],
      },
    });
  });
});
