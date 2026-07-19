/**
 * Testi za filter napak FURS v komponenti Receipts.tsx (Arhiv računov).
 *
 * Pokritost:
 *  1. Značka (badge) na gumbu "Napake" prikazuje pravilno število računov z napako
 *  2. Ko ni računov z napako, se značka ne prikazuje
 *  3. Po kliku na "Napake" so prikazani samo računi z napako
 *  4. Po kliku na "Vsi" se obnovi celoten seznam
 *
 * Logika napake (jeNapaka):
 *  - status === "napaka" → napaka
 *  - !zoi && status !== "testni" → napaka (FURS ni potrdil in ni testni izpis)
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Receipts from "./Receipts";

// ── Vzorčni računi ──────────────────────────────────────────────────────────

const racunPotrjen = {
  id: 1,
  narociloId: 10,
  stevilkaRacuna: "PP001-B001-000001",
  skupaj: 25.0,
  ddv: 4.55,
  placilnaNacin: "gotovina",
  status: "poslan",
  zoi: "abc123def456",
  eor: "eor-uuid-0001",
  fursOdgovor: null,
  mizaStevilka: 1,
  steviloPrintov: 1,
  ustvarjeno: "2024-06-01T10:00:00.000Z",
};

const racunTestni = {
  id: 2,
  narociloId: 11,
  stevilkaRacuna: "PP001-B001-000002",
  skupaj: 12.5,
  ddv: 2.27,
  placilnaNacin: "kartica",
  status: "testni",
  zoi: null,
  eor: null,
  fursOdgovor: null,
  mizaStevilka: 2,
  steviloPrintov: 0,
  ustvarjeno: "2024-06-01T11:00:00.000Z",
};

const racunNapakaStatus = {
  id: 3,
  narociloId: 12,
  stevilkaRacuna: "PP001-B001-000003",
  skupaj: 30.0,
  ddv: 5.45,
  placilnaNacin: "gotovina",
  status: "napaka",
  zoi: null,
  eor: null,
  fursOdgovor: "<ErrorCode>S003</ErrorCode><ErrorMessage>Napaka podpisa</ErrorMessage>",
  mizaStevilka: 3,
  steviloPrintov: 0,
  ustvarjeno: "2024-06-01T12:00:00.000Z",
};

const racunBrezZoi = {
  id: 4,
  narociloId: 13,
  stevilkaRacuna: "PP001-B001-000004",
  skupaj: 8.0,
  ddv: 1.45,
  placilnaNacin: "bon",
  status: "poslan",
  zoi: null,
  eor: null,
  fursOdgovor: null,
  mizaStevilka: null,
  steviloPrintov: 0,
  ustvarjeno: "2024-06-01T13:00:00.000Z",
};

// Vsi vzorčni računi: 2 normalna (potrjen + testni), 2 z napako (napaka + brez ZOI)
const vsiRacuni = [racunPotrjen, racunTestni, racunNapakaStatus, racunBrezZoi];

// ── Hoisted moki ────────────────────────────────────────────────────────────
// vi.hoisted() zagotavlja, da so ti moki na voljo preden vi.mock() dvigne klice.
// Referenca na podatke (dataRef) je inicializirana prazno; beforeEach jo napolni.

const dataRef = vi.hoisted(() => ({ current: null as unknown }));
const mockPonoviMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

// ── Moki modulov ─────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useListRacuni: () => ({ data: dataRef.current, isLoading: false }),
  usePonoviPosiljanjeRacuna: () => ({ mutate: mockPonoviMutate, isPending: false }),
  getListRacuniQueryKey: () => ["/api/racuni"],
}));

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({
    nastavitve: { testniNacin: true },
    nastavitveLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/PrintReceiptButton", () => ({
  PrintReceiptButton: ({ stevilkaRacuna }: { stevilkaRacuna: string }) => (
    <button type="button">Natisni {stevilkaRacuna}</button>
  ),
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
  return { queryClient };
}

// ── Testi ─────────────────────────────────────────────────────────────────────

describe("Receipts — filter napak FURS", () => {
  beforeEach(() => {
    dataRef.current = vsiRacuni;
    mockPonoviMutate.mockReset();
    mockToast.mockReset();
  });

  it("značka na gumbu Napake prikazuje pravilno število računov z napako", () => {
    renderReceipts();

    // Sta 2 računa z napako: racunNapakaStatus (status=napaka) in racunBrezZoi (!zoi && status!=testni)
    const badge = screen.getByText("2");
    expect(badge).toBeInTheDocument();

    // Badge mora biti znotraj gumba "Napake"
    const napakeButton = screen.getByRole("button", { name: /napake/i });
    expect(napakeButton).toContainElement(badge);
  });

  it("ko ni računov z napako, se značka ne prikazuje", () => {
    dataRef.current = [racunPotrjen, racunTestni];
    renderReceipts();

    const napakeButton = screen.getByRole("button", { name: /^napake$/i });
    expect(napakeButton).toBeInTheDocument();
    expect(napakeButton.querySelector(".bg-red-600")).toBeNull();
  });

  it("po kliku na 'Napake' so prikazani samo računi z napako FURS", () => {
    renderReceipts();

    expect(screen.getByText("PP001-B001-000001")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000002")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000003")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000004")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /napake/i }));

    expect(screen.queryByText("PP001-B001-000001")).not.toBeInTheDocument();
    expect(screen.queryByText("PP001-B001-000002")).not.toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000003")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000004")).toBeInTheDocument();
  });

  it("po kliku na 'Vsi' se obnovi celoten seznam po predhodni aktivaciji filtra napak", () => {
    renderReceipts();

    fireEvent.click(screen.getByRole("button", { name: /napake/i }));

    expect(screen.queryByText("PP001-B001-000001")).not.toBeInTheDocument();
    expect(screen.queryByText("PP001-B001-000002")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^vsi$/i }));

    expect(screen.getByText("PP001-B001-000001")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000002")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000003")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000004")).toBeInTheDocument();
  });

  it("filter napak pokaže prazen seznam z ustreznim sporočilom, če ni računov z napako", () => {
    dataRef.current = [racunPotrjen, racunTestni];
    renderReceipts();

    fireEvent.click(screen.getByRole("button", { name: /napake/i }));

    expect(screen.getByText("Ni računov z napako FURS.")).toBeInTheDocument();
  });
});
