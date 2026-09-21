import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { TelefonNarociloDialog } from "./TelefonNarociloDialog";

const mutate = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  getEnotaId: () => null,
  getGetDostavaPredogledQueryKey: (params: { naseljeId: number }) => ["/api/dostava/predogled", params],
  useCreateNarocilo: () => ({ mutate, isPending: false }),
  useGetDostavaPredogled: () => ({ data: dostavaPredogled, isLoading: false, isError: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const naselja = [{ id: 8, naziv: "Medvode", aktivno: true }];
const dostavaPredogled = { storitevIme: "Dostava", cenaNaKm: 0.7, oddaljenostKm: 5, cenaNaselja: 0, cenaDostave: 3.5, casDostaveMin: 10 };
const narocnik = {
  id: 14,
  ime: "Ana Novak",
  telefon: "041123456",
  naslovi: [{
    id: 21, ulica: "Cesta", hisnaStevilka: "7", vhod: "B", nadstropje: "2",
    naseljeId: 8, navodilo: "Pokličite", privzet: true, naselje: { id: 8, naziv: "Medvode", aktivno: true },
  }],
};

describe("TelefonNarociloDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mutate.mockReset();
    toast.mockReset();
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/api/naselja")) return Promise.resolve(new Response(JSON.stringify(naselja), { status: 200 }));
      if (url.includes("/api/dostava/predogled")) return Promise.resolve(new Response(JSON.stringify(dostavaPredogled), { status: 200 }));
      if (url.includes("/api/narocniki/po-telefonu")) return Promise.resolve(new Response(JSON.stringify(narocnik), { status: 200 }));
      return Promise.resolve(new Response(null, { status: 404 }));
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("poišče naročnika, predizpolni naslov ter ustvari telefonsko dostavo s shranjenim naslovom", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const onBlockAutoStart = vi.fn();
    mutate.mockImplementation((_args: unknown, callbacks: { onSuccess: (result: { id: number }) => void }) => callbacks.onSuccess({ id: 42 }));

    render(<TelefonNarociloDialog open onOpenChange={onOpenChange} onCreated={onCreated} onBlockAutoStart={onBlockAutoStart} />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "041 123 456" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });

    expect(screen.getByText("Najden naročnik: Ana Novak")).toBeInTheDocument();
    expect(screen.getByLabelText("Ime naročnika")).toHaveValue("Ana Novak");

    fireEvent.click(screen.getByTestId("telefon-nacin-dostava"));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("telefon-naselje-podatki")).toHaveTextContent("Dostavna storitev: Dostava · 5 km × 0.70 € = 3.50 €");
    expect(screen.getByTestId("telefon-naselje-podatki")).toHaveTextContent("10 min vožnje");
    expect(screen.getByLabelText("Ulica")).toHaveValue("Cesta");

    fireEvent.click(screen.getByRole("button", { name: "Ustvari naročilo" }));

    expect(onBlockAutoStart).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(
      { data: expect.objectContaining({
        nacin: "telefon",
        nacinIzpolnitve: "dostava",
        strankaIme: "Ana Novak",
        strankaTelefon: "041 123 456",
        narocnikId: 14,
        dostavaNaslovId: 21,
      }) },
      expect.any(Object),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalledWith({ id: 42 });
  });

  it("preklopi med prevzemom in dostavo ter pri novem naslovu prikaže predogled dostave", async () => {
    render(<TelefonNarociloDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} onBlockAutoStart={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText("Dostavni naslov")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("telefon-nacin-dostava"));
    expect(screen.getByText("Dostavni naslov")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Naselje"), { target: { value: "8" } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("telefon-naselje-podatki")).toHaveTextContent("5 km × 0.70 € = 3.50 €");

    fireEvent.click(screen.getByTestId("telefon-nacin-prevzem"));
    expect(screen.queryByText("Dostavni naslov")).not.toBeInTheDocument();
  });

  it("pri novem naslovu najdenega naročnika pošlje tudi narocnikId", async () => {
    render(<TelefonNarociloDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} onBlockAutoStart={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "041 123 456" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(screen.getByText("Najden naročnik: Ana Novak")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("telefon-nacin-dostava"));
    fireEvent.change(screen.getByLabelText("Shranjeni naslov"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText("Ulica"), { target: { value: "Nova cesta" } });
    fireEvent.change(screen.getByLabelText("Hišna št."), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Naselje"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Ustvari naročilo" }));

    expect(mutate).toHaveBeenCalledWith(
      { data: expect.objectContaining({
        narocnikId: 14,
        dostavaNaslov: expect.objectContaining({ ulica: "Nova cesta", hisnaStevilka: "12", naseljeId: 8 }),
      }) },
      expect.any(Object),
    );
  });

  it("prikaže razlog napake, ki ga vrne strežnik", async () => {
    mutate.mockImplementation((_args: unknown, callbacks: { onError: (error: unknown) => void }) => {
      callbacks.onError({ data: { napaka: "Poslovna enota ne obstaja ali nimate dostopa do nje" } });
    });

    render(<TelefonNarociloDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} onBlockAutoStart={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "041 123 456" } });
    fireEvent.change(screen.getByLabelText("Ime naročnika"), { target: { value: "Ana Novak" } });
    fireEvent.click(screen.getByRole("button", { name: "Ustvari naročilo" }));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Poslovna enota ne obstaja ali nimate dostopa do nje",
    }));
    expect(screen.getByRole("alert")).toHaveTextContent("Poslovna enota ne obstaja ali nimate dostopa do nje");
  });
});