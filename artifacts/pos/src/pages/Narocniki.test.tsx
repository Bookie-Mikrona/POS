import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Narocniki from "./Narocniki";

const toast = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  getEnotaId: () => "7",
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const narocnik = {
  id: 14,
  ime: "Ana Novak",
  telefon: "041 123 456",
  email: "ana@example.com",
  opombe: null,
  steviloNarocil: 3,
  zadnjeNarocilo: "2026-08-25T12:00:00.000Z",
  naslovi: [],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Narocniki />
    </QueryClientProvider>,
  );
}

describe("Narocniki", () => {
  beforeEach(() => {
    toast.mockReset();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/narocniki") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify([narocnik]), { status: 200 });
      }
      if (url.endsWith("/api/narocniki/14/narocila")) {
        return new Response(JSON.stringify([{
          id: 91,
          stevilkaNarocila: 12,
          status: "zakljuceno",
          skupaj: 16.4,
          nacin: "telefon",
          nacinIzpolnitve: "dostava",
          strankaIme: "Ana Novak",
          strankaTelefon: "041 123 456",
          predvidenPrevzem: null,
          predvidenaDostava: "2026-08-25T12:30:00.000Z",
          ustvarjeno: "2026-08-25T12:00:00.000Z",
        }, {
          id: 92,
          stevilkaNarocila: 13,
          status: "odprto",
          skupaj: 0,
          nacin: "miza",
          nacinIzpolnitve: "prevzem",
          strankaIme: null,
          strankaTelefon: null,
          predvidenPrevzem: null,
          predvidenaDostava: null,
          ustvarjeno: "2026-08-26T12:00:00.000Z",
        }]), { status: 200 });
      }
      if (url.endsWith("/api/narocniki/14") && init?.method === "PUT") {
        return new Response(JSON.stringify(narocnik), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));
  });

  it("prikaže zgodovino in ob praznem e-poštnem polju pošlje null", async () => {
    renderPage();

    expect(await screen.findByText("Ana Novak")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Zgodovina naročil"));
    expect(await screen.findByText("Naročilo 12")).toBeInTheDocument();
    expect(screen.getByText("16.40 €")).toBeInTheDocument();
    expect(screen.getByText("Naročilo 13")).toBeInTheDocument();
    expect(screen.getByText("Pri mizi")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Uredi naročnika"));
    const email = await screen.findByLabelText("E-pošta");
    fireEvent.change(email, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));

    await waitFor(() => {
      const putCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) => String(url).endsWith("/api/narocniki/14") && init?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      expect(JSON.parse(putCall![1].body)).toMatchObject({
        ime: "Ana Novak",
        telefon: "041 123 456",
        email: null,
        opombe: null,
      });
    });
  });
});