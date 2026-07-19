/**
 * Testi za SumUp terminal push plačilo — ko je sumupTerminalSerial nastavljen.
 *
 * Pokritost:
 *  1. Ko sumupTerminalSerial je nastavljen → prikaže se terminal spinner (ne QR koda overlay)
 *  2. Ko status postane PAID → samodejno se izda račun (pokliče se createRacun.mutate)
 *  3. Ko status postane FAILED → prikaže se napaka (terminalStanje = "napaka")
 *
 * Strategija:
 *  - mockNastavitveTerminal ima sumupTerminalSerial: "S1234567890" (ne-prazno → terminal pot)
 *  - fetch mock: POST /sumup/pay vrne checkoutId takoj; GET /sumup/status vrne PAID/FAILED
 *  - Za teste 2/3: setTimeout je zamenjan z microtask implementacijo, da se
 *    polling zanka izvede nemudoma (ne čakamo 2000ms per poll)
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Checkout from "./Checkout";

// ── Vzorčni podatki ─────────────────────────────────────────────────────────

const mockNarocilo = {
  id: 1,
  mizaId: 1,
  mizaStevilka: 1,
  mizaIme: "Miza 1",
  status: "odprto",
  skupaj: 25.00,
  ddvNeskladje: null,
  postavke: [
    {
      id: 101,
      ime: "Kava",
      kolicina: 2,
      cenaKos: 10.00,
      skupaj: 20.00,
      davek: 9.5,
      ddv: 1.74,
      jePica: false,
      racunId: null,
      gostStevilka: null,
    },
    {
      id: 102,
      ime: "Torta",
      kolicina: 1,
      cenaKos: 5.00,
      skupaj: 5.00,
      davek: 9.5,
      ddv: 0.43,
      jePica: false,
      racunId: null,
      gostStevilka: null,
    },
  ],
};

const mockNastavitveTerminal = {
  nazivRestavracije: "Test restavracija",
  naslovRestavracije: "Testna ulica 1",
  davcnaStevilka: "12345678",
  poslovniProstor: "PP001",
  elektronskaNaprava: "B001",
  testniNacin: true,
  terminalIp: "",
  terminalPort: 9000,
  terminalTimeoutMs: 30000,
  terminalAktiven: false,
  sumupAktiven: true,
  sumupTerminalSerial: "S1234567890",  // ne-prazno → terminal push način
  vivaAktiven: false,
  smtpAktiven: false,
  certifikatNaložen: false,
};

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockCreateRacunMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/blagajna", mockSetLocation],
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <img data-testid="qr-code-svg" alt="QR koda" data-value={value} />
  ),
}));

vi.mock("@/components/PrintReceiptButton", () => ({
  PrintReceiptButton: () => <button data-testid="print-receipt-button">Natisni</button>,
}));

vi.mock("@/components/DdvNeskladjeAlert", () => ({
  DdvNeskladjeAlert: () => null,
}));

vi.mock("recharts", () => ({
  LineChart: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListAktivnaNarocila: () => ({ data: [mockNarocilo], isLoading: false }),
  useCreateRacun: () => ({ mutate: mockCreateRacunMutate, isPending: false }),
  useListAktivneIzmene: () => ({ data: [] }),
  useUpdateNarocilo: () => ({ mutate: vi.fn(), isPending: false }),
  useRemovePostavka: () => ({ mutate: vi.fn() }),
  useUpdatePostavkaKolicina: () => ({ mutateAsync: vi.fn() }),
  useSpojiNarocili: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  poisciKupca: vi.fn(),
  getListAktivnaNarocilaQueryKey: () => ["/api/narocila/aktivna"],
  getListMizeQueryKey: () => ["/api/mize"],
  getListRacuniQueryKey: () => ["/api/racuni"],
  getGetNarociloQueryKey: (id: number) => ["/api/narocila", id],
}));

vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({ nastavitve: mockNastavitveTerminal, nastavitveLoading: false }),
  NastavitveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/BlagajnaContext", () => ({
  useBlagajna: () => ({ activeBlagajnaId: 1, setActiveBlagajnaId: vi.fn() }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "natakar",
      ime: "Natakar",
      vloga: "natakar",
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

// ── Pomožne funkcije ─────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children, qc }: { children: React.ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function selectNarociloInKartica() {
  const card = await screen.findByTestId("card-narocilo-1");
  await act(async () => {
    fireEvent.click(card);
  });

  const karticaRadio = await screen.findByRole("radio", { name: /kartica/i });
  await act(async () => {
    fireEvent.click(karticaRadio);
  });
}

/**
 * Stub setTimeout tako, da se callback pokliče nemudoma (microtask).
 * To pospeši polling zanko v sendToSumup brez da bi pokvarili waitFor.
 */
function stubSetTimeoutImmediate() {
  const original = globalThis.setTimeout;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).setTimeout = (fn: TimerHandler, _delay?: number) => {
    if (typeof fn === "function") {
      Promise.resolve().then(() => (fn as () => void)());
    }
    return 0;
  };
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).setTimeout = original;
  };
}

// ── Testi ────────────────────────────────────────────────────────────────────

describe("Checkout — SumUp terminal push plačilo (sumupTerminalSerial nastavljen)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockCreateRacunMutate.mockReset();
    mockToast.mockReset();
    mockSetLocation.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prikaže terminal spinner (ne QR overlay) ko sumupTerminalSerial je nastavljen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-terminal-001" }),
          });
        }
        // Status ostane v zraku — spinner preverimo pred prvim pollom
        return new Promise(() => {});
      })
    );

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );

    await selectNarociloInKartica();

    await waitFor(() => {
      expect(screen.getByTestId("button-izdaj-racun")).toHaveTextContent(
        "Plačaj prek SumUp in izdaj račun"
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Terminal spinner mora biti viden
    await waitFor(
      () => {
        expect(screen.getByText("Čakam na terminal...")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // QR overlay NE sme biti viden (ni QRCodeSVG z data-testid="qr-code-svg")
    expect(screen.queryByTestId("qr-code-svg")).not.toBeInTheDocument();

    // SumUp QR tekst ne sme biti prisoten
    expect(screen.queryByText("Plačilo s SumUp")).not.toBeInTheDocument();
    expect(screen.queryByText("Čakam na plačilo...")).not.toBeInTheDocument();
  });

  it("ob PAID statusu samodejno izda račun (pokliče createRacun.mutate)", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-terminal-paid-002" }),
          });
        }
        if (String(url).includes("/sumup/status/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ status: "PAID", napaka: null }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      })
    );

    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => {
        callbacks?.onSuccess?.({
          id: 99,
          stevilkaRacuna: "PP001-B001-000099",
          skupaj: 25.00,
          zoi: "zoi-test",
          eor: "eor-test",
          status: "poslan",
          jeDelni: false,
          narociloId: 1,
          fursNapaka: null,
          opozorilo: null,
        });
      }
    );

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );

    await selectNarociloInKartica();

    await waitFor(() => {
      expect(screen.getByTestId("button-izdaj-racun")).toHaveTextContent(
        "Plačaj prek SumUp in izdaj račun"
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      for (let i = 0; i < 30; i++) {
        await Promise.resolve();
      }
    });

    // createRacun.mutate mora biti poklican po PAID statusu
    await waitFor(
      () => {
        expect(mockCreateRacunMutate).toHaveBeenCalledOnce();
      },
      { timeout: 4000 }
    );

    const callArgs = mockCreateRacunMutate.mock.calls[0][0] as {
      data: { placilnaNacin: string; narociloId: number };
    };
    expect(callArgs.data.placilnaNacin).toBe("kartica");
    expect(callArgs.data.narociloId).toBe(1);

    // Račun izdan ekran mora biti viden
    await waitFor(() => {
      expect(screen.getByText("Račun izdan")).toBeInTheDocument();
    });

    restoreSetTimeout();
  });

  it("ob FAILED statusu prikaže napako (ne izda računa)", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-terminal-fail-003" }),
          });
        }
        if (String(url).includes("/sumup/status/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              status: "FAILED",
              napaka: "Plačilo zavrnjeno — terminal napaka",
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      })
    );

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );

    await selectNarociloInKartica();

    await waitFor(() => {
      expect(screen.getByTestId("button-izdaj-racun")).toHaveTextContent(
        "Plačaj prek SumUp in izdaj račun"
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      for (let i = 0; i < 30; i++) {
        await Promise.resolve();
      }
    });

    // Napaka overlay mora biti viden
    await waitFor(
      () => {
        expect(screen.getByText("Napaka terminala")).toBeInTheDocument();
      },
      { timeout: 4000 }
    );

    // Sporočilo napake
    expect(screen.getByText("Plačilo zavrnjeno — terminal napaka")).toBeInTheDocument();

    // Račun NI bil izdan
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();

    // Možnost ponovnega poskusa in zamenjave načina plačila
    expect(screen.getByTestId("button-retry-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("button-change-payment")).toBeInTheDocument();

    restoreSetTimeout();
  });
});
