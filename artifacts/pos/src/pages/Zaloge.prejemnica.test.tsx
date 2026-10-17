/**
 * Testi za potrditveni dialog pri brisanju prejemnic v komponenti Zaloge.tsx.
 *
 * Pokritost:
 *  1. Klik gumba za brisanje prikaže AlertDialog z naslovom "Izbriši prejemnico?"
 *  2. Dialog vsebuje opozorilo o zmanjšanju zalog in nepreklicnem dejanju
 *  3. "Prekliči" zapre dialog brez klica mutacije za brisanje
 *  4. "Potrdi" sproži mutacijo za brisanje s pravilnim ID-jem
 *  5. Mutacija se NE pokliče brez klika na gumb za brisanje
 *
 * Opomba: Radix UI TabsContent renderira otroke SAMO ko je zavihek aktiven
 * (children: present && children). Preklapljanje zavihkov zahteva
 * fireEvent.mouseDown (ne click) — Trigger interno poslušna na onMouseDown.
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, within, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Zaloge from "./Zaloge";

// ── Mock podatki ────────────────────────────────────────────────────────────
const mockPrejemnica = {
  id: 42,
  stevilka: "PR-2025-001",
  datum: "2025-03-15T00:00:00.000Z",
  opomba: null,
  steviloPostavk: 5,
  skupajVrednost: "123.45",
};

// ── Hoisted mock funkcije ───────────────────────────────────────────────────
const mockDeleteMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockGetPrejemnica = vi.hoisted(() => vi.fn((): { data: any; isLoading: boolean; isError: boolean } => ({
  data: undefined,
  isLoading: true,
  isError: false,
})));

// ── Moki za @workspace/api-client-react ─────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useListZaloge: () => ({ data: [], isLoading: false }),
  useListPrejemnice: () => ({ data: [mockPrejemnica], isLoading: false }),
  useListIzdajnice: () => ({ data: [], isLoading: false }),
  useListPartnerji: () => ({ data: [], isLoading: false }),
  useCreatePartner: () => ({ mutate: vi.fn(), isPending: false }),
  useOsveziPartnerja: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePartner: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateArtikel: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateIzdajnica: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIzdajnica: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIzdajnica: () => ({ mutate: vi.fn(), isPending: false }),
  useGetIzdajnica: () => ({ data: undefined, isLoading: false }),
  useListInventure: () => ({ data: [], isLoading: false }),
  useListArtikli: () => ({ data: [] }),
  useListZacetneZaloge: () => ({ data: [], isLoading: false }),
  useCreatePrejemnica: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateInventura: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePrejemnica: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePrejemnica: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
  useUpdateInventura: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteInventura: () => ({ mutate: vi.fn(), isPending: false }),
  useGetKarticaArtikla: () => ({ data: undefined, isLoading: false }),
  useGetPrejemnica: mockGetPrejemnica,
  useGetInventura: () => ({ data: undefined, isLoading: false }),
  useCreateZacetnaZaloga: () => ({ mutate: vi.fn(), isPending: false }),
  useGetZacetnaZaloga: () => ({ data: undefined, isLoading: false }),
  useUpdateZacetnaZaloga: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteZacetnaZaloga: () => ({ mutate: vi.fn(), isPending: false }),
  useReconcileZaloge: () => ({ mutate: vi.fn(), isPending: false }),
  getListZalogeQueryKey: () => ["/api/zaloge"],
  getListPrejemniceQueryKey: () => ["/api/prejemnice"],
  getListIzdajniceQueryKey: () => ["/api/izdajnice"],
  getListInventureQueryKey: () => ["/api/inventure"],
  getGetPrejemnicaQueryKey: () => ["/api/prejemnice/detail"],
  getGetIzdajnicaQueryKey: () => ["/api/izdajnice/detail"],
  getGetInventuraQueryKey: () => ["/api/inventure/detail"],
  getListZacetneZalogeQueryKey: () => ["/api/zacetne-zaloge"],
  getGetZacetnaZalogaQueryKey: () => ["/api/zacetne-zaloge/detail"],
  getListPartnerjiQueryKey: () => ["/api/partnerji"],
  getListArtikliQueryKey: () => ["/api/artikli"],
  getEnotaId: () => 1,
  getAuthToken: async () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
  mockGetPrejemnica.mockClear();
  mockGetPrejemnica.mockReturnValue({ data: undefined, isLoading: true, isError: false });
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      ime: "Admin",
      vloga: "admin",
      podjetjeDavcna: "12345678",
      moraZamenjatiGeslo: false,
    },
    loading: false,
    login: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Pomožne funkcije ────────────────────────────────────────────────────────
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderZaloge() {
  const queryClient = makeQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Zaloge />
    </QueryClientProvider>
  );
  return { queryClient, container: result.container };
}

describe("Zaloge — neposredno odpiranje prejemnice", () => {
  it("iz poizvedbe odpre podrobnosti zahtevane prejemnice", async () => {
    window.history.pushState({}, "", "/zaloge?prejemnica=4207");

    renderZaloge();

    expect(await screen.findByText("Uredi prejemnico")).toBeInTheDocument();
    await waitFor(() => expect(mockGetPrejemnica).toHaveBeenCalledWith(4207));
    expect(screen.getByRole("tab", { name: "Prejemnice", hidden: true })).toHaveAttribute("aria-selected", "true");
  });

  it("odpre zadnjo prejemnico v načinu samo za ogled brez možnosti spreminjanja", async () => {
    const receipt = {
      id: 4209,
      stevilka: "26100009",
      datum: "2026-10-16",
      stDokumenta: "INV-42",
      valuta: "EUR",
      dobaviteljNaziv: "Mlekarna Planika",
      status: "confirmed",
      vrstaCen: "neto",
      placanoZGotovino: false,
      ddvOsnova: "15.50",
      ddvZnesek: "0.00",
      skupajVrednost: "15.50",
      postavke: [{
        id: 1,
        artikelId: 909,
        artikelIme: "Mleko polnomastno",
        enotaMere: "L",
        kolicina: "2",
        cenaKos: "7.75",
        skupaj: "15.50",
        ddvStopnja: "0",
        ddvZnesek: "0.00",
      }],
      odvisniStroski: [{
        naziv: "Prevoz",
        znesek: "2.00",
        ddvStopnja: "0",
        obravnava: "strosek",
      }],
    };
    mockGetPrejemnica.mockReturnValue({ data: receipt, isLoading: false, isError: false });
    window.history.pushState({}, "", "/zaloge?prejemnica=4209&nacin=ogled");

    renderZaloge();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /Pregled prejemnice št\. 26100009/ })).toBeInTheDocument();
    expect(within(dialog).getByText("Mlekarna Planika")).toBeInTheDocument();
    expect(within(dialog).getByText("Mleko polnomastno")).toBeInTheDocument();
    expect(within(dialog).getByTestId("text-receipt-view-total")).toHaveTextContent("15,50 EUR");
    expect(within(dialog).getByText("Prevoz")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /shrani|potrdi prejemnico|pripravi računovodski osnutek/i }))
      .not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Zapri" })).toBeInTheDocument();
    expect(mockGetPrejemnica).toHaveBeenCalledWith(4209);
  });

  it("pri nedostopni prejemnici v načinu samo za ogled pokaže napako brez urejevalnika", async () => {
    mockGetPrejemnica.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    window.history.pushState({}, "", "/zaloge?prejemnica=4210&nacin=ogled");

    renderZaloge();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Prejemnice ni mogoče odpreti. Preverite povezavo, izbrano enoto in dovoljenja.",
    );
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /shrani|potrdi prejemnico|pripravi računovodski osnutek/i }))
      .not.toBeInTheDocument();
    expect(mockGetPrejemnica).toHaveBeenCalledWith(4210);
  });

  it("pokaže jasno sporočilo, ko prejemnice ni mogoče naložiti", async () => {
    mockGetPrejemnica.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    window.history.pushState({}, "", "/zaloge?prejemnica=4208");

    renderZaloge();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Prejemnice ni mogoče odpreti. Preverite povezavo, izbrano enoto in dovoljenja.",
    );
  });

  it("zahteva pregled spremenjenih faktorjev in pri ponovnem preverjanju pokaže najnovejši faktor", async () => {
    const firstChanges = [{
      supplierOrderLineId: 781,
      articleName: "Mleko",
      orderFactor: 6,
      currentFactor: 8,
    }];
    const latestChanges = [{
      supplierOrderLineId: 781,
      articleName: "Mleko",
      orderFactor: 6,
      currentFactor: 9,
    }];
    const responses = [
      { status: 409, body: { code: "SUPPLIER_ORDER_PACKAGE_FACTOR_CHANGED", packageFactorChanges: firstChanges } },
      { status: 409, body: { code: "SUPPLIER_ORDER_PACKAGE_FACTOR_CHANGED", packageFactorChanges: latestChanges } },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/zaloge/zadnje-nabavne")) {
        return { status: 200, ok: true, json: async () => [] } as Response;
      }
      const next = responses.shift() ?? { status: 500, body: { error: "Nepričakovan zahtevek" } };
      return { status: next.status, ok: next.status < 400, json: async () => next.body } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    mockGetPrejemnica.mockReturnValue({
      data: {
        id: 4211,
        stevilka: "26100011",
        datum: "2026-10-17",
        status: "draft",
        vrstaCen: "neto",
        postavke: [],
        odvisniStroski: [],
      },
      isLoading: false,
      isError: false,
    });
    window.history.pushState({}, "", "/zaloge?prejemnica=4211");

    renderZaloge();

    const receiptDialog = await screen.findByRole("dialog");
    fireEvent.click(within(receiptDialog).getByRole("button", { name: "Potrdi prejemnico" }));
    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Potrdi prejemnico" }));

    expect(await screen.findByRole("heading", { name: "Preveri spremenjeno pakiranje" })).toBeInTheDocument();
    expect(screen.getByText("V naročilu: 6 enot / pakiranje")).toBeInTheDocument();
    expect(screen.getByText("Trenutno pri dobavitelju: 8 enot / pakiranje")).toBeInTheDocument();
    expect(screen.getByText(/Pregled ne prepiše shranjenih posnetkov/)).toBeInTheDocument();

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Pregledal/a sem — potrdi prejemnico" }));
    await waitFor(() => {
      const confirmCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/confirm"));
      expect(confirmCalls).toHaveLength(2);
      expect(JSON.parse(String(confirmCalls[1][1]?.body))).toEqual({
        reviewedPackageFactorChanges: firstChanges,
      });
    });
    expect(await screen.findByText("Trenutno pri dobavitelju: 9 enot / pakiranje")).toBeInTheDocument();
  });
});

/**
 * Preklopi na zavihek "Prejemnice".
 *
 * Radix UI TabsTrigger aktivira zavihek prek onMouseDown (ne onClick),
 * zato moramo posnemati mousedown z button=0 in ctrlKey=false.
 */
function switchToPrejemnice(): void {
  const tabTrigger = screen.getByRole("tab", { name: "Prejemnice" });
  fireEvent.mouseDown(tabTrigger, { button: 0, ctrlKey: false });
}

/**
 * Poišče gumb za brisanje v aktivnem tabpanelu.
 * Gumb za brisanje ima razred "text-destructive" in je edini takšen gumb
 * ko so podatki za inventure in začetne zaloge prazni.
 */
function findPrejDeleteButton(container: HTMLElement): HTMLElement {
  const activePanel = container.querySelector<HTMLElement>(
    '[role="tabpanel"][data-state="active"]'
  );
  if (!activePanel) {
    throw new Error("Aktiven tabpanel ni najden");
  }
  const destructive = Array.from(
    activePanel.querySelectorAll<HTMLElement>("button")
  ).filter(b => b.className.includes("text-destructive"));

  if (destructive.length === 0) {
    const allBtns = activePanel.querySelectorAll("button");
    throw new Error(
      `Gumb za brisanje (text-destructive) ni najden. Vsi gumbi v panelu: ${allBtns.length} — razredi: ${Array.from(allBtns).map(b => b.className.substring(0, 60)).join(" | ")}`
    );
  }
  return destructive[0];
}

// ── Testi ───────────────────────────────────────────────────────────────────
describe("Zaloge — brisanje prejemnice: potrditveni dialog", () => {
  beforeEach(() => {
    mockDeleteMutate.mockReset();
    mockToast.mockReset();
  });

  it("klik gumba za brisanje prikaže AlertDialog z naslovom 'Izbriši prejemnico?'", () => {
    const { container } = renderZaloge();
    switchToPrejemnice();
    const deleteButton = findPrejDeleteButton(container);
    fireEvent.click(deleteButton);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Izbriši prejemnico?")).toBeInTheDocument();
  });

  it("dialog vsebuje opozorilo o zmanjšanju zalog in nepreklicnem dejanju", () => {
    const { container } = renderZaloge();
    switchToPrejemnice();
    fireEvent.click(findPrejDeleteButton(container));

    expect(
      screen.getByText(/zaloge bodo zmanjšane/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/tega dejanja ni mogoče razveljaviti/i)
    ).toBeInTheDocument();
  });

  it("klik 'Prekliči' zapre dialog brez klica mutacije za brisanje", () => {
    const { container } = renderZaloge();
    switchToPrejemnice();
    fireEvent.click(findPrejDeleteButton(container));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Prekliči"));

    expect(mockDeleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("klik 'Potrdi' sproži mutacijo za brisanje s pravilnim ID-jem", () => {
    const { container } = renderZaloge();
    switchToPrejemnice();
    fireEvent.click(findPrejDeleteButton(container));

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Potrdi"));

    expect(mockDeleteMutate).toHaveBeenCalledOnce();
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { id: mockPrejemnica.id },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it("mutacija za brisanje se NE pokliče brez klika na gumb za brisanje", () => {
    renderZaloge();
    switchToPrejemnice();

    expect(mockDeleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

// ── Rekonstrukcija bruto iz neto + popust (BT-147, Price/AllowanceCharge) ──
//
// Diagnosticiran vzrok: pri e-SLOG BT-147 je izv_cena = neto cena (rabatVkljucenVCeni=true).
// Display rekonstruira bruto iz: bruto = neto / ((1 − r1/100) × (1 − r2/100))
// Testi preverijo formulo neposredno (enako logiko ima Zaloge.tsx, EditPrejemnicaDialog).
describe("BT-147 rekonstrukcija bruto iz neto + popust", () => {
  // Lokalna kopija formule iz Zaloge.tsx (EditPrejemnicaDialog rows init)
  const rekonstruiraj = (netoNaPaket: number, r1: number, r2 = 0): number | null => {
    if (r1 <= 0) return null;
    const faktor = (1 - r1 / 100) * (r2 > 0 ? (1 - r2 / 100) : 1);
    if (faktor <= 0.0001) return null;
    return Math.round(netoNaPaket / faktor * 10000) / 10000;
  };

  it("rekonstruira bruto iz neto pri enem rabatu (5 %)", () => {
    // 1,43 / 0,95 = 1,5053 → zaokroženo na 4 decimalke
    expect(rekonstruiraj(1.43, 5)).toBeCloseTo(1.5053, 3);
  });

  it("rekonstruira bruto iz neto pri 10 % rabatu", () => {
    // 9,00 / 0,90 = 10,00
    expect(rekonstruiraj(9.0, 10)).toBeCloseTo(10.0, 4);
  });

  it("rekonstruira bruto pri dveh verižnih rabatih (10 % + 5 %)", () => {
    // 90 / (0,90 × 0,95) = 90 / 0,855 ≈ 105,2632
    const rezultat = rekonstruiraj(90, 10, 5);
    expect(rezultat).not.toBeNull();
    expect(rezultat!).toBeCloseTo(105.2632, 1);
  });

  it("vrne null pri rabatu 0 (ni popusta)", () => {
    expect(rekonstruiraj(1.43, 0)).toBeNull();
  });

  it("vrne null pri rabatu 100 % (deljenje z 0)", () => {
    expect(rekonstruiraj(0, 100)).toBeNull();
  });

  it("vrne null pri rabatu 99,999 % (faktor ≤ 0,0001)", () => {
    expect(rekonstruiraj(0.001, 99.999)).toBeNull();
  });

  it("ohrani 4 decimalne mesta pri zaokroževanju", () => {
    // 1,90 / 0,95 = 2,0000 — točno, brez napake zaokroževanja
    expect(rekonstruiraj(1.90, 5)).toBe(2.0);
  });
});
