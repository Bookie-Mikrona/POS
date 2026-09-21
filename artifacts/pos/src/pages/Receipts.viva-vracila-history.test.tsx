/**
 * Testi za VivaVracilaHistory — barvno kodiranje statusov in prikaz napake.
 *
 * Pokritost:
 *  1. Badge "Potrjeno" je zelen (bg-green-100 text-green-800) za status "paid"
 *  2. Badge "Zavrnjeno" je rdeč (bg-red-100 text-red-800) za status "failed"
 *     in prikaže sporočilo napake pod vrstico
 *  3. Badge "V teku" je rumen (bg-yellow-100 text-yellow-800) za status "pending"
 *  4. Polling ikona (RefreshCw, aria-label="Samodejno osveževanje…") se prikaže,
 *     ko obstaja vsaj eno vračilo s statusom "pending"
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Receipts from "./Receipts";

// ── Vzorčni račun ────────────────────────────────────────────────────────────

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

// ── Hoisted moki ─────────────────────────────────────────────────────────────

const dataRef = vi.hoisted(() => ({ current: null as unknown }));
const vivaVracilaRef = vi.hoisted(() => ({ current: {} as Record<number, unknown[]> }));
const mockToast = vi.hoisted(() => vi.fn());
const userRoleRef = vi.hoisted(() => ({ current: "blagajnik" }));
const unknownRefundsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const resolveUnknownMutate = vi.hoisted(() => vi.fn());
const refundStatusCheck = vi.hoisted(() => vi.fn());

// ── Moki modulov ──────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useListRacuni: () => ({ data: dataRef.current, isLoading: false }),
  usePonoviPosiljanjeRacuna: () => ({ mutate: vi.fn(), isPending: false }),
  useStornirajRacun: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateRacunPlacilnaNacin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useVivaTerminalRefund: () => ({ mutate: vi.fn(), isPending: false }),
  useListVivaVracila: (racunId: number) => ({
    data: vivaVracilaRef.current[racunId] ?? [],
    isLoading: false,
    isFetching: false,
  }),
  useListFursAttempts: () => ({ data: { items: [] }, isLoading: false }),
  useListUnknownVivaRefunds: () => ({ data: { items: unknownRefundsRef.current }, isLoading: false }),
  getListUnknownVivaRefundsQueryKey: () => ["/api/terminal/viva/terminal/refunds/unknown"],
  useResolveUnknownVivaRefund: () => ({ mutate: resolveUnknownMutate, isPending: false }),
  vivaTerminalRefundStatus: refundStatusCheck,
  useListCardPaymentAttempts: () => ({ data: { items: [] }, isLoading: false }),
  useRetryFursBatch: () => ({ mutate: vi.fn(), isPending: false }),
  getListRacuniQueryKey: () => ["/api/racuni"],
  getListFursAttemptsQueryKey: () => ["/api/racuni/furs-attempts"],
  getListVivaVracilaQueryKey: (racunId: number) => ["/api/racuni", racunId, "viva-vracila"],
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
  useAuth: () => ({ user: { vloga: userRoleRef.current } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/PrintReceiptButton", () => ({
  PrintReceiptButton: ({ stevilkaRacuna }: { stevilkaRacuna: string }) => (
    <button type="button">Natisni {stevilkaRacuna}</button>
  ),
}));

vi.mock("@/components/PartnerjiSelector", () => ({
  PartnerjiSelector: () => null,
}));

// ── Pomožne funkcije ──────────────────────────────────────────────────────────

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

describe("VivaVracilaHistory — barvno kodiranje statusov", () => {
  beforeEach(() => {
    dataRef.current = [racunGlavni];
    vivaVracilaRef.current = {};
    userRoleRef.current = "blagajnik";
    unknownRefundsRef.current = [];
    resolveUnknownMutate.mockReset();
    refundStatusCheck.mockReset().mockResolvedValue({ status: "UNKNOWN", napaka: null });
    mockToast.mockReset();
  });

  it('badge "Potrjeno" je zelen za status "paid"', () => {
    vivaVracilaRef.current = {
      1: [{ id: 10, znesek: "25.00", status: "paid", ustvarjeno: "2024-06-01T10:30:00.000Z", napaka: null }],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    const badge = screen.getAllByText("Potrjeno").find(element => element.classList.contains("bg-green-100"));
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-green-100");
    expect(badge).toHaveClass("text-green-800");
  });

  it('badge "Zavrnjeno" je rdeč za status "failed" in prikaže sporočilo napake', () => {
    const napakaSporocilo = "Terminal je zavrnil zahtevo (koda 403)";
    vivaVracilaRef.current = {
      1: [{ id: 11, znesek: "25.00", status: "failed", ustvarjeno: "2024-06-01T10:30:00.000Z", napaka: napakaSporocilo }],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    const badge = screen.getByText("Zavrnjeno");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-red-100");
    expect(badge).toHaveClass("text-red-800");

    // Sporočilo napake mora biti prikazano pod vrstico
    expect(screen.getByText(napakaSporocilo)).toBeInTheDocument();
  });

  it('badge "V teku" je rumen za status "pending"', () => {
    vivaVracilaRef.current = {
      1: [{ id: 12, znesek: "25.00", status: "pending", ustvarjeno: "2024-06-01T10:30:00.000Z", napaka: null }],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    const badge = screen.getByText("V teku");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-yellow-100");
    expect(badge).toHaveClass("text-yellow-800");
  });

  it('polling ikona se prikaže ko obstaja vsaj eno vračilo s statusom "pending"', () => {
    vivaVracilaRef.current = {
      1: [
        { id: 13, znesek: "10.00", status: "paid", ustvarjeno: "2024-06-01T10:00:00.000Z", napaka: null },
        { id: 14, znesek: "15.00", status: "pending", ustvarjeno: "2024-06-01T10:15:00.000Z", napaka: null },
      ],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    // Polling ikona ima aria-label="Samodejno osveževanje…"
    expect(screen.getByLabelText("Samodejno osveževanje…")).toBeInTheDocument();
  });

  it('polling ikona se NE prikaže ko ni vračil s statusom "pending"', () => {
    vivaVracilaRef.current = {
      1: [
        { id: 15, znesek: "25.00", status: "paid", ustvarjeno: "2024-06-01T10:30:00.000Z", napaka: null },
      ],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    expect(screen.queryByLabelText("Samodejno osveževanje…")).not.toBeInTheDocument();
  });

  it('UNKNOWN po osvežitvi ustavi oba koraka in zahteva ročno uskladitev', () => {
    vivaVracilaRef.current = {
      1: [
        {
          id: 16,
          znesek: "25.00",
          status: "unknown",
          ustvarjeno: "2024-06-01T10:30:00.000Z",
          napaka: "Preverjanje terminala ni dosegljivo.",
        },
      ],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    expect(screen.getByText("Ročna uskladitev")).toBeInTheDocument();
    expect(screen.getByText("Postopek ustavljen")).toBeInTheDocument();
    expect(screen.getAllByText(/Ne ponavljajte vračila/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Potrdi storno" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Poskusi znova" })).not.toBeInTheDocument();
  });

  it("admin vidi izvajalca, napravo, provider referenco in časovnico prehodov", () => {
    userRoleRef.current = "admin";
    vivaVracilaRef.current = {
      1: [
        {
          id: 17,
          racunId: 1,
          refundSessionId: "refund-provider-17",
          providerReferenca: "refund-provider-17",
          znesek: 25,
          status: "paid",
          napaka: null,
          actorClerkUserId: "clerk-admin-17",
          actorNatakarId: 77,
          napravaKljuc: "POS-BAR-01",
          ustvarjeno: "2024-06-01T10:30:00.000Z",
          statusPrehodi: [
            {
              id: 170,
              prejsnjiStatus: null,
              noviStatus: "pending",
              napaka: null,
              actorClerkUserId: "clerk-admin-17",
              actorNatakarId: 77,
              napravaKljuc: "POS-BAR-01",
              providerReferenca: "refund-provider-17",
              ustvarjeno: "2024-06-01T10:30:00.000Z",
            },
            {
              id: 171,
              prejsnjiStatus: "pending",
              noviStatus: "paid",
              napaka: null,
              actorClerkUserId: "clerk-admin-17",
              actorNatakarId: 77,
              napravaKljuc: "POS-BAR-01",
              providerReferenca: "refund-provider-17",
              ustvarjeno: "2024-06-01T10:31:00.000Z",
            },
          ],
        },
      ],
    };

    renderReceipts();
    razširiRacun("PP001-B001-000001");

    expect(screen.getByText("Natakar #77")).toBeInTheDocument();
    expect(screen.getAllByText("POS-BAR-01")).toHaveLength(3);
    expect(screen.getByText("refund-provider-17")).toBeInTheDocument();
    expect(screen.getByText("Potek statusa (2)")).toBeInTheDocument();
  });

  it("admin lahko ponovno preveri UNKNOWN in ročno razreši le z razlogom ter dokazom", async () => {
    userRoleRef.current = "admin";
    unknownRefundsRef.current = [{
      id: 91,
      racunId: 1,
      stevilkaRacuna: "PP001-B001-000001",
      refundSessionId: "refund-unknown-91",
      znesek: 25,
      napaka: "Provider ni dosegljiv",
      actorClerkUserId: "clerk-admin",
      actorNatakarId: 77,
      napravaKljuc: "POS-BAR-01",
      ustvarjeno: "2024-06-01T10:30:00.000Z",
    }];
    renderReceipts();

    expect(screen.getByText("Nejasna Viva vračila (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ponovno preveri Vivo" }));
    expect(refundStatusCheck).toHaveBeenCalledWith("refund-unknown-91");

    fireEvent.click(screen.getByRole("button", { name: "Ročno razreši" }));
    const confirm = screen.getByRole("button", { name: "Potrdi ročno razrešitev" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Razlog odločitve"), {
      target: { value: "Preverjeno na terminalskem dnevniku." },
    });
    fireEvent.change(screen.getByLabelText("Dokaz ali referenca"), {
      target: { value: "TX-REF-991" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(resolveUnknownMutate).toHaveBeenCalledWith(
      {
        sessionId: "refund-unknown-91",
        data: {
          status: "paid",
          razlog: "Preverjeno na terminalskem dnevniku.",
          dokazReferenca: "TX-REF-991",
        },
      },
      expect.any(Object),
    );
  });
});
