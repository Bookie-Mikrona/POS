import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { DostavaSettings } from "./DostavaSettings";

const mutate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const listDostavniKurirji = vi.hoisted(() => vi.fn());
const createDostavniKurir = vi.hoisted(() => vi.fn());
const updateDostavniKurirActivity = vi.hoisted(() => vi.fn());
const createKurirMutate = vi.hoisted(() => vi.fn());
const updateKurirMutate = vi.hoisted(() => vi.fn());

const nastavitve = {
  nazivRestavracije: "Test gostilna",
  naslovRestavracije: "Glavna 1",
  davcnaStevilka: "12345678",
  poslovniProstor: "PP001",
  elektronskaNaprava: "B001",
  testniNacin: true,
  smtpAktiven: false,
  certifikatNaložen: false,
  dostavaArtikelId: 11,
  telefonNarocilaOsnovniCasMin: 15,
  telefonNarocilaCakalnaVrstaMin: 5,
  telefonNarocilaKapaciteta: 3,
  telefonNarocilaNajvecCasMin: 90,
  telefonNarocilaZaokrozevanjeMin: 5,
  telefonNarocilaPijacaOsnovniCasMin: 3,
  telefonNarocilaPijacaCakalnaVrstaMin: 0,
  telefonNarocilaPijacaKapaciteta: 2,
  telefonNarocilaPijacaNajvecCasMin: 20,
  telefonNarocilaPijacaZaokrozevanjeMin: 1,
};

vi.mock("@workspace/api-client-react", () => ({
  useListArtikli: () => ({ data: [
    { id: 11, ime: "Dostava", cena: 0.7, aktiven: true, davek: 9.5, vrstaArtikla: "storitev" },
    { id: 12, ime: "Pizza", aktiven: true, davek: 9.5, vrstaArtikla: "blago" },
  ] }),
  useUpdateNastavitve: () => ({ mutate, isPending: false }),
  useListDostavniKurirji: listDostavniKurirji,
  useCreateDostavniKurir: createDostavniKurir,
  useUpdateDostavniKurirActivity: updateDostavniKurirActivity,
  getListDostavniKurirjiQueryKey: () => ["/api/dostava/kurirji"],
  getGetNastavitveQueryKey: () => ["/api/nastavitve"],
  getListArtikliQueryKey: () => ["/api/artikli"],
}));

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({ nastavitve, nastavitveLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

function renderComponent(enotaId: number | null = 42) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><DostavaSettings enotaId={enotaId} /></QueryClientProvider>);
}

describe("DostavaSettings", () => {
  beforeEach(() => {
    mutate.mockReset();
    toast.mockReset();
    listDostavniKurirji.mockReset();
    listDostavniKurirji.mockReturnValue({ data: [], isError: false, isLoading: false });
    createDostavniKurir.mockReset();
    createDostavniKurir.mockReturnValue({ mutate: createKurirMutate, isPending: false });
    updateDostavniKurirActivity.mockReset();
    updateDostavniKurirActivity.mockReturnValue({ mutate: updateKurirMutate, isPending: false });
    createKurirMutate.mockReset();
    updateKurirMutate.mockReset();
  });

  it("shrani izbrano dostavno storitev in ohrani ostale nastavitve", async () => {
    mutate.mockImplementation((_args: unknown, callbacks: { onSuccess?: (data: typeof nastavitve) => void }) => callbacks.onSuccess?.(nastavitve));
    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: "Shrani dostavno storitev" }));

    expect(mutate).toHaveBeenCalledWith(
      { data: expect.objectContaining({ nazivRestavracije: "Test gostilna", dostavaArtikelId: 11 }) },
      expect.any(Object),
    );
  });

  it("shrani parametre samodejne ocene prek endpointa telefonskih naročil", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderComponent();

    fireEvent.change(screen.getByLabelText("Osnovni čas kuhinje"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Kapaciteta kuhinje"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani oceno časa" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/nastavitve/telefon-narocila",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Enota-Id": "42",
        }),
        body: JSON.stringify({
          osnovniCasMin: 20,
          cakalnaVrstaMin: 5,
          kapaciteta: 4,
          najvecCasMin: 90,
          zaokrozevanjeMin: 5,
          pijacaOsnovniCasMin: 3,
          pijacaCakalnaVrstaMin: 0,
          pijacaKapaciteta: 2,
          pijacaNajvecCasMin: 20,
          pijacaZaokrozevanjeMin: 1,
        }),
      }),
    ));
  });

  it("opozori, kadar dostavna storitev ni izbrana", async () => {
    renderComponent();
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("Brez dostavne postavke"));
    expect(screen.getByText("Dostava ni mogoča, dokler ni izbrana dostavna storitev.")).toBeInTheDocument();
  });

  it("doda novega kurirja z neobveznim telefonom", async () => {
    createDostavniKurir.mockReturnValue({ mutate: createKurirMutate, isPending: false });
    renderComponent();

    fireEvent.change(screen.getByLabelText("Ime kurirja"), { target: { value: "Ana Novak" } });
    fireEvent.change(screen.getByLabelText("Telefon (neobvezno)"), { target: { value: "041 123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj kurirja" }));

    expect(createKurirMutate).toHaveBeenCalledWith({
      data: { ime: "Ana Novak", telefon: "041 123 456" },
    });
  });

  it("omogoči deaktiviranje aktivnega kurirja", async () => {
    listDostavniKurirji.mockReturnValue({
      data: [{ id: 7, ime: "Ana Novak", telefon: null, aktiven: true }],
      isError: false,
      isLoading: false,
    });
    renderComponent();

    await waitFor(() => expect(screen.getByText("Ana Novak")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Deaktiviraj" }));

    expect(updateKurirMutate).toHaveBeenCalledWith({ id: 7, data: { aktiven: false } });
  });
});