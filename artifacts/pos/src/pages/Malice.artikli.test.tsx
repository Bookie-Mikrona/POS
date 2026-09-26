import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import MalicePage from "./Malice";

const assignArticle = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const articles = vi.hoisted(() => Array.from({ length: 35 }, (_, index) => ({
  id: index + 1,
  ime: `Artikel ${index + 1}`,
})));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useGetMalicaBootstrap: () => ({ data: { groups: [], assignments: [], prices: [] }, isLoading: false }),
  useListArtikli: () => ({ data: articles }),
  useListMalicaDailyOffers: () => ({ data: [], isLoading: false }),
  useAssignMalicaArticle: () => ({ mutateAsync: assignArticle, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("Malice — povezava artiklov", () => {
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
});