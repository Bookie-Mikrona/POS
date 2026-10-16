import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MalicePage from "./Malice";

const assignArticle = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const schedulePrice = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const toast = vi.hoisted(() => vi.fn());
const priceRows = vi.hoisted(() => ({ current: [] as Array<{ groupId: number; priceCents: number; validFrom: string; status: string }> }));
const articles = vi.hoisted(() => [
  ...Array.from({ length: 35 }, (_, index) => ({
    id: index + 1,
    ime: `Artikel ${index + 1}`,
    cena: index + 1,
    aktiven: true,
    prodajniArtikel: true,
    jePica: false,
    taxCategory: "food",
    kategorijaIme: index < 2 ? null : "Glavne jedi",
  })),
  {
    id: 36,
    ime: "Pica",
    cena: 9,
    cenaMala: 7,
    cenaDruzinska: 13,
    aktiven: true,
    prodajniArtikel: true,
    jePica: true,
    taxCategory: "food",
    kategorijaIme: "Pice",
  },
]);

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetMalicaBootstrap: () => ({
    data: { groups: [{ id: 1, name: "Malica 1", code: "M1", sortOrder: 1, active: true }], assignments: [], prices: priceRows.current },
    isLoading: false,
  }),
  useListArtikli: () => ({ data: articles }),
  useListMalicaDailyOffers: () => ({ data: [], isLoading: false }),
  useAssignMalicaArticle: () => ({ mutateAsync: assignArticle, isPending: false }),
  useScheduleMalicaGroupPrice: () => ({ mutateAsync: schedulePrice, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

describe("Malice — povezava artiklov", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    priceRows.current = [];
  });

  it("omogoči izbiro in shranjevanje artikla na koncu dolgega seznama", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MalicePage /></QueryClientProvider>);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Artikli" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj povezavo" }));
    const dialog = screen.getByRole("dialog");
    const select = within(dialog).getByRole("combobox", { name: "Artikel" }) as HTMLSelectElement;
    expect(select.querySelectorAll("option")).toHaveLength(35);
    expect(within(select).queryByRole("option", { name: "Artikel 1" })).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Artikel 2" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "35" } });
    expect(select.value).toBe("35");
    fireEvent.click(within(dialog).getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(assignArticle).toHaveBeenCalledWith({
      articleId: 35,
      data: { role: "main", groupId: null, autoSyncPrice: true, malicaPriceCents: null },
    }));
  });

  it("ob izbiri artikla predlaga njegovo ceno iz cenika za ročni vnos", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MalicePage /></QueryClientProvider>);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Artikli" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj povezavo" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Artikel" }), { target: { value: "35" } });
    fireEvent.click(within(dialog).getByLabelText("Samodejno usklajuj ceno s skupino"));

    const manualPrice = within(dialog).getByLabelText("Ročna cena (€)");
    expect(manualPrice).toHaveValue("35,00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(assignArticle).toHaveBeenCalledWith({
      articleId: 35,
      data: { role: "main", groupId: null, autoSyncPrice: false, malicaPriceCents: 3500 },
    }));
  });

  it("pri povezovanju pice omogoči velikost in shrani izbrano varianto", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MalicePage /></QueryClientProvider>);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Artikli" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj povezavo" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Artikel" }), { target: { value: "36" } });

    fireEvent.click(within(dialog).getByLabelText("Skupina malic (Katera skupina je to?)"));
    fireEvent.click(screen.getByRole("option", { name: "Malica 1 (M1)" }));
    fireEvent.click(within(dialog).getByLabelText("Velikost pice"));
    fireEvent.click(screen.getByRole("option", { name: "Mala" }));
    fireEvent.click(within(dialog).getByLabelText("Samodejno usklajuj ceno s skupino"));
    expect(within(dialog).getByLabelText("Ročna cena (€)")).toHaveValue("7,00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(assignArticle).toHaveBeenCalledWith({
      articleId: 36,
      data: {
        role: "main",
        groupId: 1,
        velikostPice: "mala",
        autoSyncPrice: false,
        malicaPriceCents: 700,
      },
    }));
  });

  it("za obstoječo ceno privzeto ponudi jutrišnji datum in pošlje 750 centov", async () => {
    priceRows.current = [{ groupId: 1, priceCents: 650, validFrom: "2026-01-01", status: "active" }];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MalicePage /></QueryClientProvider>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skupine" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Spremeni ceno" }));
    const dialog = screen.getByRole("dialog");
    const validFrom = format(addDays(new Date(), 1), "yyyy-MM-dd");
    expect(within(dialog).getByLabelText("Velja od")).toHaveValue(validFrom);
    fireEvent.change(within(dialog).getByLabelText("Nova cena (€)"), { target: { value: "7,5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(schedulePrice).toHaveBeenCalledWith({
      groupId: 1,
      data: { priceCents: 750, validFrom, reason: null },
    }));
  });

  it("dovoli vnos prve cene 7,5 € z zgodovinskim datumom", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MalicePage /></QueryClientProvider>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skupine" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Vnesi začetno ceno" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Začetna cena za skupino")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Velja od")).toHaveValue(format(new Date(), "yyyy-MM-dd"));
    fireEvent.change(within(dialog).getByLabelText("Nova cena (€)"), { target: { value: "7,5" } });
    fireEvent.change(within(dialog).getByLabelText("Velja od"), { target: { value: "2026-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(schedulePrice).toHaveBeenCalledWith({
      groupId: 1,
      data: { priceCents: 750, validFrom: "2026-01-01", reason: null },
    }));
  });

  it("ob zavrnitvi cene prikaže razlog, ki ga vrne strežnik", async () => {
    priceRows.current = [{ groupId: 1, priceCents: 650, validFrom: "2026-01-01", status: "active" }];
    schedulePrice.mockRejectedValueOnce({ data: { error: "Cena lahko začne veljati šele z naslednjim poslovnim dnem." } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MalicePage /></QueryClientProvider>);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skupine" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Spremeni ceno" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nova cena (€)"), { target: { value: "7,5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Napaka",
      description: "Cena lahko začne veljati šele z naslednjim poslovnim dnem.",
    })));
    expect(dialog).toBeInTheDocument();
  });
});