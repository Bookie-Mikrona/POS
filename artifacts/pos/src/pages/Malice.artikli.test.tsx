import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MalicePage from "./Malice";

const assignArticle = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const schedulePrice = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const toast = vi.hoisted(() => vi.fn());
const articles = vi.hoisted(() => Array.from({ length: 35 }, (_, index) => ({
  id: index + 1,
  ime: `Artikel ${index + 1}`,
})));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetMalicaBootstrap: () => ({
    data: { groups: [{ id: 1, name: "Malica 1", code: "M1", sortOrder: 1, active: true }], assignments: [], prices: [] },
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
  });

  it("omogoči izbiro in shranjevanje artikla na koncu dolgega seznama", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MalicePage /></QueryClientProvider>);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Artikli" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj povezavo" }));
    const dialog = screen.getByRole("dialog");
    const select = within(dialog).getByRole("combobox", { name: "Artikel" }) as HTMLSelectElement;
    expect(select.querySelectorAll("option")).toHaveLength(36);
    fireEvent.change(select, { target: { value: "35" } });
    expect(select.value).toBe("35");
    fireEvent.click(within(dialog).getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(assignArticle).toHaveBeenCalledWith({
      articleId: 35,
      data: { role: "main", groupId: null, autoSyncPrice: true, malicaPriceCents: null },
    }));
  });

  it("za 7,5 € privzeto ponudi jutrišnji datum in pošlje 750 centov", async () => {
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

  it("ob zavrnitvi cene prikaže razlog, ki ga vrne strežnik", async () => {
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