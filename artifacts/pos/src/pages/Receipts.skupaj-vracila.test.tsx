/**
 * Testi za SkupajVracilaPanel — skupni pregled vračil (Viva terminal + storno računi).
 *
 * Pokritost:
 *  1. Panel prikaže skupno vsoto ko obstaja vsaj 1 paid Viva vračilo + 1 storno račun
 *  2. Panel se NE prikaže ko ni storno računov (samo terminal vračila brez storna)
 *  3. Negativni zneski storno računov se seštejejo kot absolutne vrednosti
 *
 * Logika SkupajVracilaPanel:
 *  - Vrne null če stornoRacuni.length === 0 (ni storno računov)
 *  - Vrne null če skupajVrnjeno <= 0
 *  - skupajVivaVrnjeno: vsota paid Viva vračil (samo če imaVivaTerminal=true)
 *  - skupajStornoVrnjeno: vsota abs(skupaj) za vsak storno račun
 *  - Prikaže "Terminal (N×)" vrstico samo ko so plačana Viva vračila
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Receipts from "./Receipts";

// ── Vzorčni računi ──────────────────────────────────────────────────────────

const racunGlavni = {
  id: 1,
  narociloId: 10,
  stevilkaRacuna: "PP001-B001-000001",
  skupaj: 25.0,
  ddv: 4.55,
  placilnaNacin: "kartica",
  status: "poslan",
  zoi: "abc123def456",
  eor: "eor-uuid-0001",
  fursOdgovor: null,
  mizaStevilka: 1,
  steviloPrintov: 1,
  ustvarjeno: "2024-06-01T10:00:00.000Z",
  vivaTerminalSessionId: "VIVA-SESSION-001",
  jeStorno: false,
  jeDelni: false,
  kupecNaziv: null,
  kupecDavcnaStevilka: null,
  kupecNaslov: null,
  znesekKartica: 25.0,
  znesekGotovina: null,
  znesekBon: null,
};

const racunStorno1 = {
  id: 2,
  narociloId: null,
  stevilkaRacuna: "ST001-B001-000001",
  skupaj: -15.0,
  ddv: -2.73,
  placilnaNacin: "kartica",
  status: "poslan",
  zoi: "storno-zoi-001",
  eor: "storno-eor-001",
  fursOdgovor: null,
  mizaStevilka: null,
  steviloPrintov: 1,
  ustvarjeno: "2024-06-01T11:00:00.000Z",
  vivaTerminalSessionId: null,
  jeStorno: true,
  izvorni_racun_id: 1,
  jeDelni: false,
  kupecNaziv: null,
  kupecDavcnaStevilka: null,
  kupecNaslov: null,
  znesekKartica: null,
  znesekGotovina: null,
  znesekBon: null,
};

const racunStorno2 = {
  id: 3,
  narociloId: null,
  stevilkaRacuna: "ST001-B001-000002",
  skupaj: -5.25,
  ddv: -0.95,
  placilnaNacin: "gotovina",
  status: "poslan",
  zoi: "storno-zoi-002",
  eor: "storno-eor-002",
  fursOdgovor: null,
  mizaStevilka: null,
  steviloPrintov: 1,
  ustvarjeno: "2024-06-01T12:00:00.000Z",
  vivaTerminalSessionId: null,
  jeStorno: true,
  izvorni_racun_id: 1,
  jeDelni: false,
  kupecNaziv: null,
  kupecDavcnaStevilka: null,
  kupecNaslov: null,
  znesekKartica: null,
  znesekGotovina: null,
  znesekBon: null,
};

// ── Hoisted moki ────────────────────────────────────────────────────────────

const dataRef = vi.hoisted(() => ({ current: null as unknown }));
const vivaVracilaRef = vi.hoisted(() => ({ current: {} as Record<number, unknown[]> }));
const mockToast = vi.hoisted(() => vi.fn());

// ── Moki modulov ─────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useListRacuni: () => ({ data: dataRef.current, isLoading: false }),
  usePonoviPosiljanjeRacuna: () => ({ mutate: vi.fn(), isPending: false }),
  useStornirajRacun: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRacunPlacilnaNacin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVivaTerminalRefund: () => ({ mutate: vi.fn(), isPending: false }),
  useListVivaVracila: (racunId: number) => ({
    data: vivaVracilaRef.current[racunId] ?? [],
    isLoading: false,
  }),
  getListRacuniQueryKey: () => ["/api/racuni"],
}));

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({
    nastavitve: { testniNacin: true },
    nastavitveLoading: false,
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { vloga: "blagajnik" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/PrintReceiptButton", () => ({
  PrintReceiptButton: ({ stevilkaRacuna }: { stevilkaRacuna: string }) => (
    <button type="button">Natisni {stevilkaRacuna}</button>
  ),
}));

vi.mock("@/components/ShranjeniKupciSelector", () => ({
  ShranjeniKupciSelector: () => null,
}));

// ── Pomožne funkcije ─────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderReceipts() {
  const queryClient = makeQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <Receipts />
    </QueryClientProvider>
  );
}

function razširiRacun(stevilkaRacuna: string) {
  fireEvent.click(screen.getByText(stevilkaRacuna));
}

// ── Testi ─────────────────────────────────────────────────────────────────────

describe("SkupajVracilaPanel — skupni pregled vračil", () => {
  beforeEach(() => {
    dataRef.current = null;
    vivaVracilaRef.current = {};
    mockToast.mockReset();
  });

  it("prikaže skupno vsoto ko obstaja 1 paid Viva vračilo in 1 storno račun", () => {
    dataRef.current = [racunGlavni, racunStorno1];
    vivaVracilaRef.current = {
      1: [{ id: 10, znesek: "5.00", status: "paid", ustvarjeno: "2024-06-01T10:30:00.000Z", napaka: null }],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    // Panel mora biti viden
    expect(screen.getByText("Skupaj vračila")).toBeInTheDocument();

    // Terminal vrstica v SkupajVracilaPanel: "Terminal (1×)"
    expect(screen.getByText("Terminal (1×)")).toBeInTheDocument();

    // Storno vrstica (storno 1: abs(-15.00) = 15.00 €)
    expect(screen.getByText(/Storno ST001-B001-000001/)).toBeInTheDocument();

    // Skupna vsota: 5.00 + 15.00 = 20.00 €
    expect(screen.getByText("Skupaj vrnjeno:")).toBeInTheDocument();
    expect(screen.getByText("20.00 €")).toBeInTheDocument();
  });

  it("panel se NE prikaže ko je samo storno brez plačanega Viva vračila (terminal + storno)", () => {
    dataRef.current = [racunGlavni, racunStorno1];
    // Brez paid Viva vračil (samo storno, brez terminala)
    vivaVracilaRef.current = {};

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    // Panel se NE sme prikazati — skupni pregled zahteva obe vrsti vračil
    expect(screen.queryByText("Skupaj vračila")).not.toBeInTheDocument();
    expect(screen.queryByText("Skupaj vrnjeno:")).not.toBeInTheDocument();
  });

  it("panel se NE prikaže ko ni nobenih storno računov", () => {
    dataRef.current = [racunGlavni];
    vivaVracilaRef.current = {
      1: [{ id: 10, znesek: "5.00", status: "paid", ustvarjeno: "2024-06-01T10:30:00.000Z", napaka: null }],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    // Panel se ne sme prikazati brez storno računov (stornoRacuni.length === 0 → null)
    expect(screen.queryByText("Skupaj vračila")).not.toBeInTheDocument();
    expect(screen.queryByText("Skupaj vrnjeno:")).not.toBeInTheDocument();
  });

  it("pravilno sešteje negativne zneske več storno računov skupaj s terminal vračilom", () => {
    dataRef.current = [racunGlavni, racunStorno1, racunStorno2];
    // Dodamo paid Viva vračilo, da se skupni panel sploh prikaže
    vivaVracilaRef.current = {
      1: [{ id: 10, znesek: "3.00", status: "paid", ustvarjeno: "2024-06-01T10:30:00.000Z", napaka: null }],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    // Panel mora biti viden
    expect(screen.getByText("Skupaj vračila")).toBeInTheDocument();

    // Vsota: 3.00 (terminal) + abs(-15.00) + abs(-5.25) = 23.25 €
    expect(screen.getByText("Skupaj vrnjeno:")).toBeInTheDocument();
    expect(screen.getByText("23.25 €")).toBeInTheDocument();

    // Obe storno vrstici sta prikazani z absolutnimi vrednostmi
    expect(screen.getByText(/Storno ST001-B001-000001/)).toBeInTheDocument();
    expect(screen.getByText(/Storno ST001-B001-000002/)).toBeInTheDocument();
    expect(screen.getByText("5.25 €")).toBeInTheDocument();
  });
});
