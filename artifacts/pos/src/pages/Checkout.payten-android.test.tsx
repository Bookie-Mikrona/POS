/**
 * Testi za Payten Android Software APK integracijo — na nivoju Checkout komponente.
 *
 * Pokritost:
 *  1. Callback z resultCode=0 ne sme sam izdati računa brez strežniške potrditve
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
import { render, screen, waitFor, act, fireEvent, cleanup } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import React from "react";
import Checkout from "./Checkout";
import {
  CheckoutTestWrapper,
  createCheckoutTestQueryClient,
} from "./Checkout.test-harness";

// ── Vzorčni podatki ─────────────────────────────────────────────────────────

const NAROCILO_ID = 42;

const mockNarocilo = {
  id: NAROCILO_ID,
  mizaId: 1,
  mizaStevilka: 1,
  mizaIme: "Miza 1",
  status: "odprto",
  skupaj: 15.00,
  znesekNapitnina: 0,
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
const mockNarocila = [mockNarocilo];
const mockAktivneIzmene = [{ natakariId: 1, natakarIme: "Natakar" }];

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockCreateRacunMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockStartPaytenAndroidPayment = vi.hoisted(() => vi.fn());
const mockConfirmPaytenAndroidPayment = vi.hoisted(() => vi.fn());
const mockTimeoutPaytenAndroidPayment = vi.hoisted(() => vi.fn());
const mockPaytenActorSessions = vi.hoisted(() => ({
  start: [] as Array<string | null>,
  confirm: [] as Array<string | null>,
}));

// useSearch: vrnemo narocilo=42 za avtomatsko izbiro naročila
// Vsak test nastavi svojo varianto (s/brez paytenAndroid parametra)
const mockUseSearch = vi.hoisted(() => vi.fn());
const nativeSetTimeout = globalThis.setTimeout;

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useSearch: () => mockUseSearch(),
  useLocation: () => [`/blagajna`, mockSetLocation],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <img data-testid="qr-code-svg" alt="QR koda" data-value={value} />
  ),
}));

vi.mock("@/components/PrintReceiptButton", () => ({
  PrintReceiptButton: (props: { autoPrint?: boolean; className?: string }) => (
    <button data-testid="print-receipt-button" data-auto-print={props.autoPrint ? "true" : "false"} className={props.className}>
      Natisni
    </button>
  ),
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

vi.mock("@workspace/api-client-react", async () => {
  const { createCheckoutApiClientMock } = await import("./Checkout.test-harness");
  return createCheckoutApiClientMock({
    getNarocila: () => mockNarocila,
    getAktivneIzmene: () => mockAktivneIzmene,
    createRacunMutate: mockCreateRacunMutate,
    startPaytenAndroidPayment: mockStartPaytenAndroidPayment,
    confirmPaytenAndroidPayment: mockConfirmPaytenAndroidPayment,
    timeoutPaytenAndroidPayment: mockTimeoutPaytenAndroidPayment,
  });
});

vi.mock("@/contexts/NastavitveContext", async () => {
  const { createCheckoutNastavitveContextMock } = await import("./Checkout.test-harness");
  return createCheckoutNastavitveContextMock();
});

vi.mock("@/contexts/BlagajnaContext", async () => {
  const { createCheckoutBlagajnaContextMock } = await import("./Checkout.test-harness");
  return createCheckoutBlagajnaContextMock();
});

vi.mock("@/contexts/NapravaContext", async () => {
  const {
    createCheckoutNapravaContextMock,
    createCheckoutTestDevice,
  } = await import("./Checkout.test-harness");
  return createCheckoutNapravaContextMock(createCheckoutTestDevice({
    terminalConfig: {
      paytenAndroidAktiven: true,
    },
  }));
});

vi.mock("@/contexts/AuthContext", async () => {
  const { createCheckoutAuthContextMock } = await import("./Checkout.test-harness");
  return createCheckoutAuthContextMock();
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Pomožne funkcije ──────────────────────────────────────────────────────────

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
    qc = createCheckoutTestQueryClient();
    mockNarocilo.znesekNapitnina = 0;
    mockCreateRacunMutate.mockReset();
    mockToast.mockReset();
    mockSetLocation.mockReset();
    mockPaytenActorSessions.start.length = 0;
    mockPaytenActorSessions.confirm.length = 0;
    mockStartPaytenAndroidPayment.mockReset();
    mockStartPaytenAndroidPayment.mockImplementation(async () => {
      mockPaytenActorSessions.start.push(sessionStorage.getItem("pos_actor_session"));
      return {
        paymentAttemptId: "payten-client-attempt-0001",
        attemptId: "durable-attempt-0001",
        status: "reserved",
        launchUrl: "bookie-viva-bridge://payten/test-state",
        pollToken: "poll-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    });
    mockConfirmPaytenAndroidPayment.mockReset();
    mockConfirmPaytenAndroidPayment.mockImplementation(async () => {
      mockPaytenActorSessions.confirm.push(sessionStorage.getItem("pos_actor_session"));
      return {
        paymentAttemptId: "payten-client-attempt-0001",
        status: "UNKNOWN",
        error: "Remote confirmation is unavailable.",
      };
    });
    sessionStorage.clear(); localStorage.clear();
    localStorage.setItem("pos_last_operator_id", "1");
  });

  afterEach(() => {
    cleanup();
    qc.clear();
    globalThis.setTimeout = nativeSetTimeout;
    vi.clearAllTimers();
    vi.useRealTimers();
    simulirajBrezPaytena();
    vi.unstubAllGlobals();
  });

  it("legacy URL callback is never trusted or forwarded", async () => {
    sessionStorage.setItem("pos_actor_session", "actor-session-2");
    simulirajPaytenCallback("0");
    sessionStorage.setItem("paytenAndroid_placilo", JSON.stringify({
      placilniNacin: "bon",
      sekundarniNacin: "kartica",
      znesekDarilnegaBona: 10,
      steviloBonov: 0,
      znesekNapitnina: 2,
      paymentAttemptId: "payten-client-attempt-0001",
      attemptId: "durable-attempt-0001",
    }));

    await act(async () => {
      render(
        <CheckoutTestWrapper qc={qc}>
          <Checkout />
        </CheckoutTestWrapper>
      );
      // Počakamo, da se vsi useEffect-i izvedejo
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Način plačila")).toBeInTheDocument());
    expect(mockConfirmPaytenAndroidPayment).not.toHaveBeenCalled();
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("paytenAndroid_placilo")).not.toBeNull();
  });

  it("pred zagonom APK ustvari trajni Payten poskus in shrani njegov kontekst", async () => {
    sessionStorage.setItem("pos_actor_session", "actor-session-1");
    mockUseSearch.mockReturnValue(`narocilo=${NAROCILO_ID}`);
    render(<CheckoutTestWrapper qc={qc}><Checkout /></CheckoutTestWrapper>);
    await act(async () => {
      fireEvent.click(await screen.findByTestId(`card-narocilo-${NAROCILO_ID}`));
    });
    await screen.findByText("Način plačila");
    fireEvent.click(await screen.findByRole("radio", { name: /kartica/i }));
    const issue = await screen.findByTestId("button-izdaj-racun");
    await waitFor(() => {
      expect(issue).toBeEnabled();
      expect(issue).toHaveTextContent(/Payten APK/i);
    });
    sessionStorage.setItem("pos_actor_session", "actor-session-2");
    fireEvent.click(issue);
    await waitFor(() => {
      expect(mockStartPaytenAndroidPayment).toHaveBeenCalledWith({
        data: expect.objectContaining({ narociloId: NAROCILO_ID, znesek: 15 }),
      });
    });
    expect(mockStartPaytenAndroidPayment).toHaveBeenCalledOnce();
    expect(mockPaytenActorSessions.start).toEqual(["actor-session-2"]);
    expect(mockConfirmPaytenAndroidPayment).not.toHaveBeenCalled();
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem("paytenBridgePayment") ?? "{}");
    expect(stored).toMatchObject({
      paymentAttemptId: "payten-client-attempt-0001",
      attemptId: "durable-attempt-0001",
    });
  });

  it("QR napitnino prenese v kartični znesek brez prikaza ali vnosa na zaključku", async () => {
    mockNarocilo.znesekNapitnina = 1.25;
    mockUseSearch.mockReturnValue(`narocilo=${NAROCILO_ID}`);

    render(
      <CheckoutTestWrapper qc={qc}>
        <Checkout />
      </CheckoutTestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText("Način plačila")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("napitnina-izbira")).not.toBeInTheDocument();
    expect(screen.queryByText("Napitnina (opcijsko)")).not.toBeInTheDocument();
    expect(screen.queryByText("1.25 €")).not.toBeInTheDocument();
  });

  it("legacy failure callback cannot issue receipt", async () => {
    simulirajPaytenCallback("1");
    sessionStorage.setItem("paytenAndroid_placilo", JSON.stringify({
      placilniNacin: "kartica",
      znesekNapitnina: 10,
      paymentAttemptId: "payten-client-attempt-0001",
      attemptId: "durable-attempt-0001",
    }));

    await act(async () => {
      render(
        <CheckoutTestWrapper qc={qc}>
          <Checkout />
        </CheckoutTestWrapper>
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Počakamo, da se komponenta postavi
    await waitFor(() => expect(screen.getByText("Način plačila")).toBeInTheDocument());
    expect(mockConfirmPaytenAndroidPayment).not.toHaveBeenCalled();
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
    // Context remains available for explicit reconciliation.
    expect(sessionStorage.getItem("paytenAndroid_placilo")).not.toBeNull();
  });

  it("callback without native envelope cannot issue receipt", async () => {
    simulirajPaytenCallback(null);

    await act(async () => {
      render(
        <CheckoutTestWrapper qc={qc}>
          <Checkout />
        </CheckoutTestWrapper>
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText("Način plačila")).toBeInTheDocument());
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
  });

  it("reloads native context and issues a pure-card receipt with its exact durable attempt", async () => {
    mockUseSearch.mockReturnValue("");
    sessionStorage.setItem("pos_actor_session", "actor-session-reload");
    localStorage.setItem("paytenBridgePayment", JSON.stringify({
      paymentAttemptId: "payten-client-attempt-0001", attemptId: "durable-attempt-0001", pollToken: "poll-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), narociloId: NAROCILO_ID, provider: "payten", amount: 15,
      paymentSnapshot: { placilniNacin: "kartica", sekundarniNacin: "gotovina", znesekDarilnegaBona: 0, steviloBonov: 0, znesekNapitnina: 0, nacinZajemaNapitnine: "card" },
    }));
    mockConfirmPaytenAndroidPayment.mockResolvedValue({ status: "COMPLETED", paymentAttemptId: "payten-client-attempt-0001" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, pending: false, envelope: { keyId: "key" } }) }));
    render(<CheckoutTestWrapper qc={qc}><Checkout /></CheckoutTestWrapper>);
    await waitFor(() => expect(mockConfirmPaytenAndroidPayment).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentAttemptId: "payten-client-attempt-0001" }),
    })));
    await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalled());
    expect(mockCreateRacunMutate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      placilnaNacin: "kartica", znesekKartica: 15, paymentAttemptId: "payten-client-attempt-0001",
    }));
  });

  it("reload preserves gift-voucher/card split when secondary payment is card", async () => {
    mockUseSearch.mockReturnValue("");
    sessionStorage.setItem("pos_actor_session", "actor-session-reload");
    localStorage.setItem("paytenBridgePayment", JSON.stringify({
      paymentAttemptId: "payten-client-attempt-0001", attemptId: "durable-attempt-0001", pollToken: "poll-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), narociloId: NAROCILO_ID, provider: "payten", amount: 5,
      paymentSnapshot: { placilniNacin: "bon", sekundarniNacin: "kartica", znesekDarilnegaBona: 10, steviloBonov: 0, znesekNapitnina: 0, nacinZajemaNapitnine: "card" },
    }));
    mockConfirmPaytenAndroidPayment.mockResolvedValue({ status: "COMPLETED", paymentAttemptId: "payten-client-attempt-0001" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ ok: true, pending: false, envelope: { keyId: "key" } }) }));
    render(<CheckoutTestWrapper qc={qc}><Checkout /></CheckoutTestWrapper>);
    await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalled());
    expect(mockCreateRacunMutate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      placilnaNacin: "bon", znesekBon: 10, znesekKartica: 5, paymentAttemptId: "payten-client-attempt-0001",
    }));
  });
});
