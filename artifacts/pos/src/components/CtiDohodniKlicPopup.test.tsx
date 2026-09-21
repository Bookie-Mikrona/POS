import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { CtiDohodniKlicPopup } from "./CtiDohodniKlicPopup";

const setLocation = vi.hoisted(() => vi.fn());
const block = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@workspace/api-client-react", () => ({ getListAktivnaNarocilaQueryKey: () => ["aktivna"] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { enotaId: 7 } }) }));
vi.mock("@/contexts/AutoStartContext", () => ({ useAutoStart: () => ({ block }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/TelefonNarociloDialog", () => ({
  TelefonNarociloDialog: ({ open, initialTelefon }: { open: boolean; initialTelefon?: string | null }) =>
    open ? <div data-testid="telefon-dialog" data-telefon={initialTelefon}>Telefon dialog</div> : null,
}));

describe("CtiDohodniKlicPopup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.includes("/aktivni-klici")) {
        return Promise.resolve(new Response(JSON.stringify([{
          id: 4, telefon: "041 123 456", prejeto: "2026-08-24T10:15:00.000Z", narocnikId: 71, narocnikIme: "Ana Novak",
        }]), { status: 200 }));
      }
      if (url.includes("/obravnavano") && options?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ id: 4, obravnavano: true }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("prikaže dohodni klic in Začni naročilo predizpolni telefonsko številko", async () => {
    render(<CtiDohodniKlicPopup />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId("cti-dohodni-klic-popup")).toHaveTextContent("Dohodni klic");
    expect(screen.getByTestId("cti-dohodni-klic-popup")).toHaveTextContent("Ana Novak");
    expect(screen.getByTestId("cti-telefon")).toHaveTextContent("041 123 456");

    fireEvent.click(screen.getByRole("button", { name: "Začni naročilo" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId("telefon-dialog")).toHaveAttribute("data-telefon", "041 123 456");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/cti/klici/4/obravnavano"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});