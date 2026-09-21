import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PreparedFoodPage from "./PreparedFood";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mocks
const mockSave = vi.fn();
const mockClose = vi.fn();
const mockSaveStocks = vi.fn();
let mockEditable = true;
let mockClosedAt: string | null = null;
const testDate = "2026-08-28";

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as any,
    useListPreparedFoodDaily: () => ({
      data: [
        {
          id: 1,
          artikelId: 10,
          thawedQuantity: 10,
          preparedQuantity: 5,
          correctionQuantity: 0,
          soldQuantity: 12,
          frozenAtEndQuantity: 2,
          wasteQuantity: 1, // 10 + 5 + 0 - 12 - 2 = 1
          wasteValue: 2.50,
          businessDate: testDate,
          articleName: "Goveja juha",
          closedAt: mockClosedAt,
          editable: mockEditable,
        }
      ],
      isLoading: false
    }),
    useListPreparedFoodStocks: (year: number) => ({
      data: [{
        id: 5,
        enotaId: 1,
        artikelId: 10,
        articleName: "Goveja juha",
        year,
        openingQuantity: 20,
        openingCostPerPortion: 1.5,
        frozenQuantity: 8,
        frozenCostPerPortion: 1.75,
      }],
      isLoading: false,
    }),
    useListArtikli: () => ({
      data: [{ id: 10, ime: "Goveja juha" }],
      isLoading: false
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
    mockEditable = true;
    mockClosedAt = null;
    mockSave.mockResolvedValue({});
    mockClose.mockResolvedValue({});
  });

  async function openTestDate() {
    fireEvent.click(await screen.findByText("28. avgust 2026"));
    await screen.findByText("Goveja juha");
  }

  it("razširi in ponovno skrči izbrani datum", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("28. avgust 2026")).not.toBeNull();
    expect(screen.queryByText("Goveja juha")).toBeNull();

    await openTestDate();
    expect(screen.getByText("15")).not.toBeNull();
    expect(screen.getByText("12")).not.toBeNull();
    expect(screen.getByText("Na voljo za odtajanje: 8")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /28. avgust 2026/i }));
    expect(await screen.findByText("28. avgust 2026")).not.toBeNull();
    expect(screen.queryByText("Goveja juha")).toBeNull();
  });

  it("shrani vse spremembe z enim skupnim gumbom", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );

    await openTestDate();

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
      frozenAtEndQuantity: 2 // unchanged
    });
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

  it("zaključi vse postavke prek skupnega potrditvenega okna", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PreparedFoodPage />
      </QueryClientProvider>
    );
    
    await openTestDate();

    const closeBtn = screen.getByRole("button", { name: "Zaključi vse" });
    fireEvent.click(closeBtn);

    expect(await screen.findByText(/Zaključi evidenco za 28. avgust 2026/i)).not.toBeNull();
    
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
