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
import { render, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Receipts from "./Receipts";
import { AuthProvider } from "@/contexts/AuthContext";

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
const mockUpdate = vi.hoisted(() => vi.fn());
const mockPrinted = vi.hoisted(() => vi.fn());
const mockPrintError = vi.hoisted(() => vi.fn());

// ── Moki modulov ─────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useUpdateVivaRefundApprovalPolicy: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useGetVivaRefundAlertOverview: () => ({ data: undefined, isLoading: false, isError: false }),
  getGetVivaRefundAlertOverviewQueryKey: () => ["/api/viva-refund-alerts"],
  useUpdateVivaRefundAlertSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useListRacuni: () => ({ data: dataRef.current, isLoading: false }),
  usePonoviPosiljanjeRacuna: () => ({ mutate: mockPonoviMutate, isPending: false }),
  useUpdateRacunPlacilnaNacin: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useStornirajRacun: () => ({ mutate: vi.fn(), isPending: false }),
  useListUnknownVivaRefunds: () => ({ data: { items: [] }, isLoading: false }),
  useListVivaVracila: () => ({ data: [], isLoading: false }),
  useResolveUnknownVivaRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVivaTerminalRefund: () => ({ mutateAsync: vi.fn(), isPending: false }),
  getListUnknownVivaRefundsQueryKey: () => ["/api/terminal/viva/unknown"],
  getListVivaVracilaQueryKey: () => ["/api/terminal/viva/refunds"],
  vivaTerminalRefundStatus: vi.fn(),
  useListFursAttempts: () => ({ data: { items: [] }, isLoading: false }),
  useListCardPaymentAttempts: () => ({ data: { items: [] }, isLoading: false }),
  useRetryFursBatch: () => ({ mutate: vi.fn(), isPending: false }),
  getListRacuniQueryKey: () => ["/api/racuni"],
  getListFursAttemptsQueryKey: () => ["/api/racuni/furs-attempts"],
}));

vi.mock("@/contexts/NapravaContext", () => ({
  useNaprava: () => ({ napravaKljuc: "test-naprava-kljuc" }),
}));

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({
    nastavitve: { testniNacin: true },
    nastavitveLoading: false,
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", ime: "Admin", vloga: "admin" },
    loading: false,
    login: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/PrintReceiptButton", () => ({
  PrintReceiptButton: ({ stevilkaRacuna, onBeforePrint }: { stevilkaRacuna: string; onBeforePrint?: () => Promise<void> }) => (
    <button type="button" onClick={async () => {
      try { await onBeforePrint?.(); mockPrinted(); } catch (error) { mockPrintError(error); }
    }}>Natisni {stevilkaRacuna}</button>
  ),
}));
vi.mock("@/components/PartnerjiSelector", () => ({ PartnerjiSelector: () => null }));
vi.mock("@/components/MonthlyInvoicesDialog", () => ({ MonthlyInvoicesDialog: () => null }));

// ── Pomožne funkcije ─────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderReceipts() {
  const queryClient = makeQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><Receipts /></AuthProvider>
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

  it("značka na filtru neuspelih FURS prikazuje samo eksplicitne napake", () => {
    renderReceipts();

    // Samo status=napaka je neuspel; odsotni ZOI/EOR pomeni neznano stanje.
    const napakeButton = screen.getByTestId("button-filter-furs-failed");
    const badge = within(napakeButton).getByText("1");
    expect(badge).toBeInTheDocument();

    expect(napakeButton).toContainElement(badge);
  });

  it("ko ni računov z napako, se značka ne prikazuje", () => {
    dataRef.current = [racunPotrjen, racunTestni];
    renderReceipts();

    const napakeButton = screen.getByTestId("button-filter-furs-failed");
    expect(napakeButton).toBeInTheDocument();
    expect(napakeButton.querySelector(".bg-red-600")).toBeNull();
  });

  it("po kliku na 'Napake' so prikazani samo računi z napako FURS", () => {
    renderReceipts();

    expect(screen.getByText("PP001-B001-000001")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000002")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000003")).toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000004")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-filter-furs-failed"));

    expect(screen.queryByText("PP001-B001-000001")).not.toBeInTheDocument();
    expect(screen.queryByText("PP001-B001-000002")).not.toBeInTheDocument();
    expect(screen.getByText("PP001-B001-000003")).toBeInTheDocument();
    expect(screen.queryByText("PP001-B001-000004")).not.toBeInTheDocument();
  });

  it("po kliku na 'Vsi' se obnovi celoten seznam po predhodni aktivaciji filtra napak", () => {
    renderReceipts();

    fireEvent.click(screen.getByTestId("button-filter-furs-failed"));

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

    fireEvent.click(screen.getByTestId("button-filter-furs-failed"));

    expect(screen.getByText("Ni računov FURS v stanju »failed« za izbrane filtre.")).toBeInTheDocument();
  });
});

describe("Receipts — kopija računa brez nepotrebnega preverjanja actorja", () => {
  beforeEach(() => {
    dataRef.current = [{
      ...racunPotrjen, skupaj: 2.7, znesekGotovina: 2.7, znesekKartica: 0,
      znesekBon: 0, znesekBonPica: 0, steviloBonov: 0,
      kupecNaziv: "Test d.o.o.", kupecDavcnaStevilka: "12345678", kupecNaslov: "Testni naslov",
    }];
    mockUpdate.mockReset();
    mockUpdate.mockRejectedValue(new Error("POS actor seja je potekla ali ni veljavna."));
    mockPrinted.mockReset();
    mockPrintError.mockReset();
  });

  function openPrint() {
    renderReceipts();
    fireEvent.click(screen.getByText(racunPotrjen.stevilkaRacuna));
    fireEvent.click(screen.getByRole("button", { name: "Natisni" }));
    return within(screen.getByRole("dialog"));
  }

  it("nespremenjen račun natisne tudi ob potekli actor seji, brez PATCH", async () => {
    const dialog = openPrint();
    fireEvent.click(dialog.getByRole("button", { name: `Natisni ${racunPotrjen.stevilkaRacuna}` }));
    await waitFor(() => expect(mockPrinted).toHaveBeenCalledOnce());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPrintError).not.toHaveBeenCalled();
  });

  it("dejanski popravek zneskov še vedno potrebuje zaščiten PATCH in ob 401 ne natisne", async () => {
    const dialog = openPrint();
    fireEvent.change(dialog.getByLabelText("Gotovina (€)"), { target: { value: "2,60" } });
    fireEvent.change(dialog.getByLabelText("Darilni bon (€)"), { target: { value: "0,10" } });
    fireEvent.click(dialog.getByRole("button", { name: `Natisni ${racunPotrjen.stevilkaRacuna}` }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledOnce());
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: racunPotrjen.id, data: expect.objectContaining({ znesekGotovina: 2.6, znesekBon: 0.1 }),
    }));
    await waitFor(() => expect(mockPrintError).toHaveBeenCalledOnce());
    expect(mockPrinted).not.toHaveBeenCalled();
  });
});
