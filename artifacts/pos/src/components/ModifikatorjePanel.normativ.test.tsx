import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ModifikatorjePanel from "./ModifikatorjePanel";

const saveNormativi = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: showToast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListModSkupine: () => ({ data: [{ id: 1, ime: "Dodatki", obvezna: false, minIzbir: 0, maxIzbir: 0 }] }),
  useGetModSkupina: () => ({ data: { id: 1, modifikatorji: [] }, isLoading: false }),
  useListArtikli: () => ({ data: [
    { id: 11, ime: "Surovina", nabavniArtikel: true, prodajniArtikel: false, mealType: "ala_carte" },
    { id: 16, ime: "Kozarci", nabavniArtikel: true, prodajniArtikel: false, drobniInventar: true },
    { id: 12, ime: "Polizdelek", nabavniArtikel: false, prodajniArtikel: false, taxCategory: "food", mealType: "prepared" },
    { id: 13, ime: "Prodajna pripravljena jed", nabavniArtikel: false, prodajniArtikel: true, mealType: "prepared" },
    { id: 14, ime: "Prodajna à la carte jed", nabavniArtikel: false, prodajniArtikel: true, mealType: "ala_carte" },
    { id: 15, ime: "Sestavljena jed", nabavniArtikel: false, prodajniArtikel: true, mealType: "composite" },
  ] }),
  useGetModifikatorNormativi: () => ({ data: undefined }),
  useCreateModSkupina: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateModSkupina: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteModSkupina: () => ({ mutate: vi.fn() }),
  useAddModifikator: () => ({
    mutate: (_args: unknown, options: { onSuccess: (mod: { id: number }) => void }) => options.onSuccess({ id: 22 }),
    isPending: false,
  }),
  useUpdateModifikator: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteModifikator: () => ({ mutate: vi.fn() }),
  useSetModifikatorNormativi: () => ({ mutate: saveNormativi, isPending: false }),
  getListModSkupineQueryKey: () => ["mod-skupine"],
  getListArtikliQueryKey: () => ["/api/artikli"],
  getGetModSkupinaQueryKey: (id: number) => ["mod-skupina", id],
  getGetModifikatorNormativiQueryKey: (id: number) => ["mod-normativi", id],
}));

describe("normativ modifikatorja", () => {
  it("ne potrdi modifikatorja, če izbranemu prodajnemu artiklu manjka količina", () => {
    saveNormativi.mockClear();
    showToast.mockClear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModifikatorjePanel jeUporabnik={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Dodatki"));
    fireEvent.click(screen.getByRole("button", { name: "Dodaj modifikator" }));
    fireEvent.change(screen.getByPlaceholderText("Npr. Brez čebule"), { target: { value: "Zelena" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj vrstico" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "14" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Dodaj modifikator" }));

    expect(saveNormativi).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Nepopoln normativ modifikatorja" }));
  });
  it("ponudi prodajne artikle ločeno in shrani izbrano pripravljeno jed", () => {
    saveNormativi.mockClear();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <ModifikatorjePanel jeUporabnik={false} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Dodatki"));
    fireEvent.click(screen.getByRole("button", { name: "Dodaj modifikator" }));
    fireEvent.change(screen.getByPlaceholderText("Npr. Brez čebule"), { target: { value: "Dodatna porcija" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj vrstico" }));

    const select = screen.getByRole("combobox");
    const groups = within(select).getAllByRole("group");
    expect(groups.map(group => group.getAttribute("label"))).toEqual([
      "Nabavni artikli", "Polizdelki", "Prodajni artikli",
    ]);
    expect(within(groups[0]).getAllByRole("option").map(option => option.textContent)).toEqual(["Surovina"]);
    expect(within(select).queryByRole("option", { name: "Kozarci" })).not.toBeInTheDocument();
    expect(within(groups[2]).getAllByRole("option").map(option => option.textContent)).toEqual([
      "Prodajna pripravljena jed", "Prodajna à la carte jed",
    ]);
    expect(within(select).queryByRole("option", { name: "Sestavljena jed" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "13" } });
    const quantity = screen.getByRole("textbox", { name: "Količina sestavnice 1" });
    expect(quantity.parentElement).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_6rem_2.25rem]");
    fireEvent.change(quantity, { target: { value: "1" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Dodaj modifikator" }));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/artikli"] });
    expect(saveNormativi).toHaveBeenCalledWith(
      { id: 22, data: { normativi: [{ vhodniArtikelId: 13, kolicina: 1 }] } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});