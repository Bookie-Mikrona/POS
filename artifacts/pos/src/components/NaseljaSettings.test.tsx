import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { NaseljaSettings } from "./NaseljaSettings";

const toast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

function renderComponent() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><NaseljaSettings /></QueryClientProvider>);
}

describe("NaseljaSettings", () => {
  beforeEach(() => {
    toast.mockReset();
  });

  it("prikaže šifrant in pošlje nov vnos na POST /api/naselja", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 8 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderComponent();
    expect(await screen.findByText("Naselij še ni.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dodaj naselje/i }));
    fireEvent.change(screen.getByLabelText("Naziv"), { target: { value: "Medvode" } });
    fireEvent.change(screen.getByLabelText("Oddaljenost (km)"), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText("Čas dostave (min)"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani naselje" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/naselja",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ naziv: "Medvode", oddaljenostKm: 12.5, cenaDostave: 0, casDostaveMin: 18, aktivno: true }),
      }),
    ));
  });

  it("deaktivira aktivno naselje prek DELETE endpointa", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 4, naziv: "Vodice", oddaljenostKm: 9, cenaDostave: 2, casDostaveMin: 12, aktivno: true,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderComponent();
    fireEvent.click(await screen.findByRole("button", { name: "Deaktiviraj naselje Vodice" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/naselja/4",
      expect.objectContaining({ method: "DELETE" }),
    ));
  });

  it("shrani fiksno ceno prevoza, kadar jo nastavimo za naselje", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 8 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderComponent();
    await screen.findByText("Naselij še ni.");
    fireEvent.click(screen.getByRole("button", { name: /dodaj naselje/i }));
    fireEvent.change(screen.getByLabelText("Naziv"), { target: { value: "Medvode" } });
    fireEvent.change(screen.getByLabelText("Oddaljenost (km)"), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText("Cena prevoza (€)"), { target: { value: "4.5" } });
    fireEvent.change(screen.getByLabelText("Čas dostave (min)"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani naselje" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/naselja",
      expect.objectContaining({
        body: JSON.stringify({ naziv: "Medvode", oddaljenostKm: 12.5, cenaDostave: 4.5, casDostaveMin: 18, aktivno: true }),
      }),
    ));
  });

  it("v tabeli jasno prikaže stolpec Aktivno", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: 7, naziv: "Škofja Loka", oddaljenostKm: 20, cenaDostave: 4, casDostaveMin: 25, aktivno: false,
    }]), { status: 200 })));

    renderComponent();
    expect(await screen.findByText("Škofja Loka")).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "Aktivno" })).toBeInTheDocument();
    expect(screen.getByText("Ne", { selector: "span" })).toBeInTheDocument();
  });
});