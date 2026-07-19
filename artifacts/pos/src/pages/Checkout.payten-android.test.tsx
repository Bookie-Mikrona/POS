/**
 * Testi za Payten Android Software APK integracijo — na nivoju Checkout komponente.
 *
 * Pokritost:
 *  1. Callback z resultCode=0 → samodejno se izda račun (createRacun.mutate se pokliče)
 *  2. Callback z resultCode=1 (napaka) → račun se NE izda, prikaže se napaka
 *  3. Callback brez resultCode (fail-safe) → račun se NE izda, prikaže se napaka
 *
 * Strategija:
 *  - window.location.search se nastavi z window.history.pushState pred renderom
 *  - sessionStorage.setItem("paytenAndroid_narociloId") simulira shranjeni ID iz pred-klica
 *  - useSearch (wouter) vrne narocilo=42 za avtomatsko izbiro naročila
 *  - createRacun.mutate je shpioniran — z njim preverimo ali je bil poklican
 */

import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Checkout from "./Checkout";

// ── Vzorčni podatki ─────────────────────────────────────────────────────────

const NAROCILO_ID = 42;

const mockNarocilo = {
  id: NAROCILO_ID,
  mizaId: 1,
  mizaStevilka: 1,
  mizaIme: "Miza 1",
  status: "odprto",
  skupaj: 15.00,
  ddvNeskladje: null,
  postavke: [
    {
      id: 201,
      ime: "Kava",
      kolicina: 1,
      cenaKos: 15.00,
      skupaj: 15.00,
      davek: 9.5,
      ddv: 1.30,
      jePica: false,
      racunId: null,
      gostStevilka: null,
    },
  ],
};

const mockNastavitvePayten = {
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
  paytenAndroidAktiven: true,         // Payten Android SW je aktiven
  paytenAndroidPackageName: "com.payten.mpos",
  sumupAktiven: false,
  vivaAktiven: false,
  smtpAktiven: false,
  certifikatNaložen: false,
};

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockCreateRacunMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());

// useSearch: vrnemo narocilo=42 za avtomatsko izbiro naročila
// Vsak test nastavi svojo varianto (s/brez paytenAndroid parametra)
const mockUseSearch = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useSearch: () => mockUseSearch(),
  useLocation: () => [`/blagajna`, mockSetLocation],
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
  useNastavitve: () => ({ nastavitve: mockNastavitvePayten, nastavitveLoading: false }),
  NastavitveProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/BlagajnaContext", () => ({
  useBlagajna: () => ({ activeBlagajnaId: 1, setActiveBlagajnaId: vi.fn() }),
}));

vi.mock("@/contexts/NapravaContext", () => ({
  useNaprava: () => ({
    naprava: null,          // null = globalna prioritetna veriga
    napravaKljuc: "test-naprava-kljuc",
    napravaLoading: false,
    refreshNaprava: vi.fn(),
  }),
  NapravaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

// ── Pomožne funkcije ──────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children, qc }: { children: React.ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/**
 * Simulira povratek iz Payten APK:
 *  - nastavi window.location.search z callback parametri
 *  - nastavi sessionStorage z narociloId
 *  - vrne useSearch() vrednost za avto-izbiro naročila
 */
function simulirajPaytenCallback(resultCode: string | null) {
  const params = new URLSearchParams({
    narocilo: String(NAROCILO_ID),
    paytenAndroid: "1",
  });
  if (resultCode !== null) {
    params.set("resultCode", resultCode);
  }
  const searchStr = params.toString();

  // Nastavi window.location.search (jsdom podpira history API)
  window.history.pushState({}, "", `?${searchStr}`);

  // Nastavi sessionStorage (simulira vrednost, ki jo handlePaytenAndroidPay shrani pred redirectom)
  sessionStorage.setItem("paytenAndroid_narociloId", String(NAROCILO_ID));

  // useSearch vrne parametre brez vodečega ?
  mockUseSearch.mockReturnValue(searchStr);
}

function simulirajBrezPaytena() {
  window.history.pushState({}, "", "/blagajna");
  sessionStorage.removeItem("paytenAndroid_narociloId");
  mockUseSearch.mockReturnValue("");
}

// ── Testi ────────────────────────────────────────────────────────────────────

describe("Checkout — Payten Android Software APK callback", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = makeQueryClient();
    mockCreateRacunMutate.mockReset();
    mockToast.mockReset();
    mockSetLocation.mockReset();
    sessionStorage.clear();
  });

  afterEach(() => {
    simulirajBrezPaytena();
    vi.unstubAllGlobals();
  });

  it("1. resultCode=0 (uspeh) → createRacun.mutate se pokliče s placilnaNacin='kartica'", async () => {
    simulirajPaytenCallback("0");

    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => {
        callbacks?.onSuccess?.({
          id: 999,
          stevilkaRacuna: "PP001-B001-000099",
          skupaj: 15.00,
          zoi: "zoi-test",
          eor: "eor-test",
          status: "poslan",
          jeDelni: false,
          narociloId: NAROCILO_ID,
          fursNapaka: null,
          opozorilo: null,
        });
      }
    );

    await act(async () => {
      render(
        <Wrapper qc={qc}>
          <Checkout />
        </Wrapper>
      );
      // Počakamo, da se vsi useEffect-i izvedejo
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // createRacun.mutate mora biti poklican (samodejno po povratku iz Payten APK)
    await waitFor(
      () => {
        expect(mockCreateRacunMutate).toHaveBeenCalledOnce();
      },
      { timeout: 3000 }
    );

    const callArgs = mockCreateRacunMutate.mock.calls[0][0] as {
      data: { placilnaNacin: string; narociloId: number };
    };
    // Plačilni način mora biti 'kartica' (Payten je vedno kartično)
    expect(callArgs.data.placilnaNacin).toBe("kartica");
    expect(callArgs.data.narociloId).toBe(NAROCILO_ID);

    // Ekran "Račun izdan" mora biti viden
    await waitFor(() => {
      expect(screen.getByText("Račun izdan")).toBeInTheDocument();
    });
  });

  it("2. resultCode=1 (napaka) → createRacun.mutate se NE pokliče, napaka je prikazana", async () => {
    simulirajPaytenCallback("1");

    await act(async () => {
      render(
        <Wrapper qc={qc}>
          <Checkout />
        </Wrapper>
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Počakamo, da se komponenta postavi
    await waitFor(() => {
      // Napaka terminala mora biti prikazana (terminalStanje = "napaka")
      expect(screen.getByText("Napaka terminala")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Sporocilo napake mora vsebovati kodo
    expect(screen.getByText(/Payten Android.*koda 1/i)).toBeInTheDocument();

    // Račun NI bil izdan
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
  });

  it("3. Brez resultCode (fail-safe) → createRacun.mutate se NE pokliče, prikazana je napaka brez potrditve", async () => {
    simulirajPaytenCallback(null);

    await act(async () => {
      render(
        <Wrapper qc={qc}>
          <Checkout />
        </Wrapper>
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("Napaka terminala")).toBeInTheDocument();
    }, { timeout: 3000 });

    // Sporocilo fail-safe
    expect(screen.getByText(/plačilo ni bilo potrjeno/i)).toBeInTheDocument();

    // Račun NI bil izdan (fail-safe zagotovi, da se ne izda)
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
  });
});
