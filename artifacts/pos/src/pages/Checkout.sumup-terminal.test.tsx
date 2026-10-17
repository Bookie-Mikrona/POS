/**
 * Testi za terminalsko plačilo v Checkoutu.
 *
 * Pokritost:
 *  1. Ko sumupTerminalSerial je nastavljen → prikaže se terminal spinner (ne QR koda overlay)
 *  2. Ko status postane PAID → samodejno se izda račun (pokliče se createRacun.mutate)
 *  3. Ko status postane FAILED → prikaže se napaka (terminalStanje = "napaka")
 *
 * Strategija:
 *  - mockTerminalConfig ima sumupTerminalSerial: "S1234567890" (ne-prazno → terminal pot)
 *  - fetch mock: POST /sumup/pay vrne checkoutId takoj; GET /sumup/status vrne PAID/FAILED
 *  - Za teste 2/3: setTimeout je zamenjan z microtask implementacijo, da se
 *    polling zanka izvede nemudoma (ne čakamo 2000ms per poll)
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, waitFor, act, within, cleanup } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import React from "react";
import Checkout from "./Checkout";
import {
  checkoutActorSession,
  CheckoutTestWrapper as Wrapper,
  createCheckoutTestQueryClient,
} from "./Checkout.test-harness";

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
// Keep query data references stable across renders. Checkout intentionally
// resets split state when the query result changes; an array literal returned
// by the mock on every render would create an artificial render loop.
const mockNarocila = [mockNarocilo];
const mockAktivneIzmene = [{ natakariId: 1, natakarIme: "Natakar" }];

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockCreateRacunMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockNapravaState = vi.hoisted(() => ({
  current: null as null | {
    placilniTerminal: string | null;
    terminalConfig: Record<string, unknown>;
  },
}));
const mockUserState = vi.hoisted(() => ({
  current: null as null | {
    id: number;
    enotaId: number;
    username: string;
    ime: string;
    vloga: string;
    podjetjeDavcna: string;
    imaTrr: boolean;
    moraZamenjatiGeslo: boolean;
    capabilities?: string[];
  },
}));
const mockSettingsState = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}));
const nativeSetTimeout = globalThis.setTimeout;

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/blagajna", mockSetLocation],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <img data-testid="qr-code-svg" alt="QR koda" data-value={value} />
  ),
}));

vi.mock("@/components/PrintReceiptButton", () => ({
  PrintReceiptButton: (props: { autoPrint?: boolean; className?: string }) => (
    <button
      data-testid="print-receipt-button"
      data-auto-print={props.autoPrint ? "true" : "false"}
      className={props.className}
    >
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
  });
});

vi.mock("@/contexts/NastavitveContext", async () => {
  const { checkoutTestSettings } = await import("./Checkout.test-harness");
  mockSettingsState.current = { ...checkoutTestSettings };
  return {
    useNastavitve: () => ({
      nastavitve: mockSettingsState.current,
      nastavitveLoading: false,
    }),
    NastavitveProvider: ({ children }: { children: React.ReactNode }) => children,
  };
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
  const naprava = createCheckoutTestDevice({
    terminalConfig: {
      sumupAktiven: true,
      sumupTerminalSerial: "S1234567890",
    },
  });
  mockNapravaState.current = naprava;
  return createCheckoutNapravaContextMock(naprava);
});

vi.mock("@/contexts/AuthContext", async () => {
  const { checkoutTestUser } = await import("./Checkout.test-harness");
  mockUserState.current = { ...checkoutTestUser };
  return {
    useAuth: () => ({
      user: mockUserState.current,
      loading: false,
      login: vi.fn(),
      updateUser: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Pomožne funkcije ─────────────────────────────────────────────────────────

function expectAuthenticatedPost(
  fetchMock: ReturnType<typeof vi.fn>,
  path: string,
  expectedActorSession = checkoutActorSession("test-actor-session"),
) {
  const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith(path));
  expect(call, `Klik mora poslati POST ${path}.`).toBeDefined();
  expect(call![1]?.method, `${path} mora uporabiti metodo POST.`).toBe("POST");
  const headers = new Headers(call![1]?.headers);
  expect(headers.get("Authorization"), `${path} mora poslati Clerk Bearer žeton.`)
    .toBe("Bearer test-clerk-token");
  expect(headers.get("X-Enota-Id"), `${path} mora poslati aktivno enoto.`)
    .toBe("1");
  expect(headers.get("X-Pos-Actor-Session"), `${path} mora poslati aktivno POS actor sejo.`)
    .toBe(expectedActorSession);
  expect(headers.get("Content-Type"), `${path} mora poslati JSON content type.`)
    .toBe("application/json");
  expect(call![1]?.credentials, `${path} mora vključiti prijavne piškotke.`)
    .toBe("include");
  return call!;
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
 * To pospeši polling zanko brez da bi pokvarili waitFor.
 */
function stubSetTimeoutImmediate() {
  const original = globalThis.setTimeout;
  // Accelerate the provider's 2-second polling only. Real timer handles keep
  // effect cleanup/cancellation functional and prevent polls leaking into the
  // next test (a Promise microtask cannot be cancelled by clearTimeout).
  globalThis.setTimeout = ((fn: TimerHandler, delay?: number, ...args: unknown[]) =>
    original(fn, delay === 2000 ? 0 : delay, ...args)) as typeof setTimeout;
  return () => {
    globalThis.setTimeout = original;
  };
}

// ── Testi ────────────────────────────────────────────────────────────────────

describe("Checkout — terminalska plačila", () => {
  let qc: QueryClient;

  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("test-actor-session"));
    qc = createCheckoutTestQueryClient();
    mockCreateRacunMutate.mockReset();
    mockToast.mockReset();
    mockSetLocation.mockReset();
    Object.assign(mockNapravaState.current!.terminalConfig, {
      terminalAktiven: false,
      paytenAndroidAktiven: false,
      sumupAktiven: true,
      sumupTerminalSerial: "S1234567890",
      vivaAktiven: false,
      vivaTerminalAktiven: false,
      vivaAndroidTerminalAktiven: false,
      vivaTapToPayAktiven: false,
    });
    mockNapravaState.current!.placilniTerminal = null;
    Object.assign(mockUserState.current!, { capabilities: ["deposits_tokens"] });
    Object.assign(mockSettingsState.current!, { fursNacin: undefined });
    localStorage.setItem("pos_last_operator_id", "1");
  });

  afterEach(() => {
    cleanup();
    qc.clear();
    // Several polling tests replace setTimeout directly. Restore it even when
    // an assertion aborts before the test-local restore callback runs.
    globalThis.setTimeout = nativeSetTimeout;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pošlje Clerk, enoto in aktivno POS sejo pri X-pregledu ter Z-zaključku", async () => {
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("test-actor-session"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/x-porocilo?")) {
        return new Response(JSON.stringify({
          pricakovanaGotovina: 0,
          reconciliation: null,
          blockers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/z-porocilo/zakljuci")) {
        return new Response(JSON.stringify({
          error: "Test namerno ne izvede dejanskega zaključka.",
          blockers: [],
        }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Nepričakovan fetch v Z-poročilo testu: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    fireEvent.click(await screen.findByRole("button", { name: "Z-poročilo — dnevni zaključek" }));

    await screen.findByRole("heading", { name: "Z-poročilo — dnevni zaključek" });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/x-porocilo?"))).toBe(true);
    });

    const xCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/x-porocilo?"));
    expect(xCall, "Odpiranje dialoga mora zahtevati X-pregled.").toBeDefined();
    const xHeaders = new Headers(xCall![1]?.headers);
    expect(xHeaders.get("Authorization"), "GET /api/x-porocilo mora poslati Clerk Bearer žeton.")
      .toBe("Bearer test-clerk-token");
    expect(xHeaders.get("X-Enota-Id"), "GET /api/x-porocilo mora poslati aktivno enoto.")
      .toBe("1");
    expect(xHeaders.get("X-Pos-Actor-Session"), "GET /api/x-porocilo mora poslati aktivno POS actor sejo.")
      .toBe(checkoutActorSession("test-actor-session"));

    sessionStorage.setItem("pos_actor_session", checkoutActorSession("new-actor-session"));
    fireEvent.click(screen.getByRole("button", { name: "Zaključi dan (Z-poročilo)" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/z-porocilo/zakljuci"))).toBe(true);
    });

    const zCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/api/z-porocilo/zakljuci"));
    expect(zCall, "Klik zaključka mora poslati POST /api/z-porocilo/zakljuci.").toBeDefined();
    expect(zCall![1]?.method).toBe("POST");
    const zHeaders = new Headers(zCall![1]?.headers);
    expect(zHeaders.get("Authorization"), "POST /api/z-porocilo/zakljuci mora poslati Clerk Bearer žeton.")
      .toBe("Bearer test-clerk-token");
    expect(zHeaders.get("X-Enota-Id"), "POST /api/z-porocilo/zakljuci mora poslati aktivno enoto.")
      .toBe("1");
    expect(zHeaders.get("X-Pos-Actor-Session"), "POST /api/z-porocilo/zakljuci mora poslati aktivno POS actor sejo.")
      .toBe(checkoutActorSession("new-actor-session"));
    expect(zHeaders.get("Content-Type")).toBe("application/json");
    expect(zCall![1]?.credentials).toBe("include");
  });

  it("pošlje Clerk, enoto in aktivno POS sejo pri uskladitvi gotovine", async () => {
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("test-actor-session"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/x-porocilo?")) {
        return new Response(JSON.stringify({
          pricakovanaGotovina: 25,
          reconciliation: null,
          blockers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/x-porocilo/uskladitev-gotovine")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Nepričakovan fetch v testu uskladitve gotovine: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    fireEvent.click(await screen.findByRole("button", { name: "Z-poročilo — dnevni zaključek" }));
    const cashInput = await screen.findByRole("spinbutton", { name: "Prešteta gotovina" });
    fireEvent.change(cashInput, { target: { value: "25" } });
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("new-actor-session"));
    fireEvent.click(screen.getByRole("button", { name: "Potrdi uskladitev" }));

    const path = "/api/x-porocilo/uskladitev-gotovine";
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(path))).toBe(true);
    });
    expectAuthenticatedPost(fetchMock, path, checkoutActorSession("new-actor-session"));
  });

  it("pošlje Clerk, enoto in aktivno POS sejo pri poslovni finalizaciji", async () => {
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("test-actor-session"));
    const racunId = 321;
    const finalizationPath = `/api/racuni/${racunId}/poslovna-finalizacija`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/x-porocilo?")) {
        return new Response(JSON.stringify({
          pricakovanaGotovina: 0,
          reconciliation: null,
          blockers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/z-porocilo/zakljuci")) {
        return new Response(JSON.stringify({
          error: "Račun zahteva poslovno finalizacijo.",
          blockers: [{
            type: "BUSINESS_FINALIZATION_PENDING",
            message: "Dokončajte račun pred zaključkom dneva.",
            items: [{ id: racunId, label: "Račun R-321" }],
          }],
        }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith(finalizationPath)) {
        return new Response(JSON.stringify({ stevilkaRacuna: "R-321" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Nepričakovan fetch v testu poslovne finalizacije: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    fireEvent.click(await screen.findByRole("button", { name: "Z-poročilo — dnevni zaključek" }));
    await screen.findByRole("heading", { name: "Z-poročilo — dnevni zaključek" });
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("new-actor-session"));
    fireEvent.click(screen.getByRole("button", { name: "Zaključi dan (Z-poročilo)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dokončaj" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(finalizationPath))).toBe(true);
    });
    expectAuthenticatedPost(fetchMock, finalizationPath, checkoutActorSession("new-actor-session"));
  });

  it("pošlje Clerk, enoto in aktivno POS sejo pri administratorskem odklepu Z-poročila", async () => {
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("test-actor-session"));
    const zId = 987;
    const unlockPath = `/api/z-porocilo/${zId}/odkleni`;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/x-porocilo?")) {
        return new Response(JSON.stringify({
          pricakovanaGotovina: 0,
          reconciliation: null,
          blockers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/z-porocilo/zakljuci")) {
        return new Response(JSON.stringify({
          id: zId,
          blagajnaId: 1,
          poslovniDatum: "2026-09-06",
          zStevilka: 12,
          zakljucenOb: "2026-09-06T20:00:00.000Z",
          zakljucilUporabnik: "test-user",
          grandTotalPrej: 100,
          grandTotalNov: 125,
          prometDneva: 25,
          skupajPromet: 25,
          skupajDdv: 4.51,
          steviloRacunov: 1,
          odZap: "1",
          doZap: "1",
          gotovina: 25,
          kartica: 0,
          znesekNapitnina: 0,
          sumup: 0,
          bon: 0,
          bonPica: 0,
          steviloBonov: 0,
          negotovinsko: 0,
          reprezentanca: 0,
          lastnaPoraba: 0,
          ddvPoStopnjah: [],
          menjalniDenar: 0,
          gotovinskaProdaja: 25,
          pologiGotovine: 0,
          izplacilaJobaviteljem: 0,
          pologiTrr: 0,
          stanjeBlagajne: 25,
          darilniBoniIzdaja: 0,
          darilniBoniUnovcitev: 0,
          sspSubvencija: 0,
          fursPotrjeni: 1,
          fursNepotrjeni: 0,
          odklenjenOb: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith(unlockPath)) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Nepričakovan fetch v testu odklepa Z-poročila: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    fireEvent.click(await screen.findByRole("button", { name: "Z-poročilo — dnevni zaključek" }));
    await screen.findByRole("heading", { name: "Z-poročilo — dnevni zaključek" });
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("new-actor-session"));
    fireEvent.click(screen.getByRole("button", { name: "Zaključi dan (Z-poročilo)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Admin odklep" }));
    const reasonInput = await screen.findByPlaceholderText("Npr. Napačen vnos — potrebna storno korekcija");
    const unlockButton = screen.getByRole("button", { name: "Odkleni" });

    expect(unlockButton).toBeDisabled();
    fireEvent.click(unlockButton);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(unlockPath))).toHaveLength(0);

    fireEvent.change(reasonInput, { target: { value: "   " } });
    expect(unlockButton).toBeDisabled();
    fireEvent.click(unlockButton);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(unlockPath))).toHaveLength(0);

    fireEvent.change(reasonInput, { target: { value: "  Testni razlog odklepa  " } });
    expect(unlockButton).toBeEnabled();
    fireEvent.click(unlockButton);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(unlockPath))).toHaveLength(1);
    });
    const unlockCall = expectAuthenticatedPost(fetchMock, unlockPath, checkoutActorSession("new-actor-session"));
    expect(JSON.parse(String(unlockCall[1]?.body))).toEqual({
      razlog: "Testni razlog odklepa",
    });
  });

  it("uporabi Viva Smart Checkout iz per-naprava terminalConfig, ne iz globalnih nastavitev", async () => {
    Object.assign(mockNapravaState.current!.terminalConfig, {
      sumupAktiven: false,
      vivaAktiven: true,
    });

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );
    await selectNarociloInKartica();

    await waitFor(() => {
      expect(screen.getByTestId("button-izdaj-racun")).toHaveTextContent(
        "Plačaj prek Viva Wallet in izdaj račun"
      );
    });
    expect(screen.queryByText(/POS terminal ni aktiviran/i)).not.toBeInTheDocument();
  });

  it("prikaže opozorilo samo kadar na trenutni napravi ni aktivnega terminala", async () => {
    Object.assign(mockNapravaState.current!.terminalConfig, {
      terminalAktiven: false,
      paytenAndroidAktiven: false,
      sumupAktiven: false,
      vivaTerminalAktiven: false,
      vivaAndroidTerminalAktiven: false,
      vivaTapToPayAktiven: false,
      vivaAktiven: false,
    });

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );
    await selectNarociloInKartica();

    expect(await screen.findByText(/POS terminal ni aktiviran/i)).toBeInTheDocument();
  });

  it("per-naprava override izbere Viva Smart Checkout tudi brez aktivne zastavice", async () => {
    Object.assign(mockNapravaState.current!.terminalConfig, {
      terminalAktiven: false,
      paytenAndroidAktiven: false,
      sumupAktiven: false,
      vivaTerminalAktiven: false,
      vivaAndroidTerminalAktiven: false,
      vivaTapToPayAktiven: false,
      vivaAktiven: false,
    });
    mockNapravaState.current!.placilniTerminal = "viva_smart";

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );
    await selectNarociloInKartica();

    await waitFor(() => {
      expect(screen.getByTestId("button-izdaj-racun")).toHaveTextContent(
        "Plačaj prek Viva Wallet in izdaj račun"
      );
    });
    expect(screen.queryByText(/POS terminal ni aktiviran/i)).not.toBeInTheDocument();
  });

  it("pri Viva Terminal APK ne prikaže podvojenega modrega obvestila", async () => {
    Object.assign(mockNapravaState.current!.terminalConfig, {
      sumupAktiven: false,
      vivaAndroidTerminalAktiven: true,
    });

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );
    await selectNarociloInKartica();

    expect(await screen.findByTestId("button-izdaj-racun")).toHaveTextContent(
      "Odpri Viva Terminal APK in plačaj"
    );
    expect(screen.queryByText(/Plačilo bo opravljeno prek Viva Terminal APK/i)).not.toBeInTheDocument();
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

  it("ob kliku plačila uporabi actor sejo, ki je veljavna v trenutku potrditve", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("actor-session-1"));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/sumup/pay")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ checkoutId: "actor-race-checkout-001" }),
        });
      }
      if (String(url).includes("/sumup/status/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "PAID" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => callbacks.onSuccess?.({
        id: 554, stevilkaRacuna: "PP001-B001-000554", datumCas: "2026-08-19T10:30:00.000Z",
        skupaj: 25, zoi: "zoi-554", eor: "eor-554", status: "poslan", jeDelni: false, narociloId: 1,
      }),
    );

    try {
      render(<Wrapper qc={qc}><Checkout /></Wrapper>);
      await selectNarociloInKartica();
      await screen.findByTestId("button-izdaj-racun");
      sessionStorage.removeItem("pos_actor_session");
      const actorRequired = vi.fn();
      window.addEventListener("pos-actor-session-required", actorRequired);
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      await waitFor(() => expect(actorRequired).toHaveBeenCalledOnce());
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/sumup/pay"))).toBe(false);
      expect(mockCreateRacunMutate).not.toHaveBeenCalled();

      sessionStorage.setItem("pos_actor_session", checkoutActorSession("actor-session-2"));
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 30; i++) await Promise.resolve();
      });
      window.removeEventListener("pos-actor-session-required", actorRequired);

      await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
      expectAuthenticatedPost(fetchMock, "/sumup/pay", checkoutActorSession("actor-session-2"));
      const statusCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/sumup/status/"));
      expect(statusCall).toBeDefined();
      expect(new Headers(statusCall![1]?.headers).get("X-Pos-Actor-Session")).toBe(checkoutActorSession("actor-session-2"));
      const sensitivePosts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
      expect(sensitivePosts).not.toHaveLength(0);
      for (const [, init] of sensitivePosts) {
        expect(new Headers(init?.headers).get("X-Pos-Actor-Session")).toBe(checkoutActorSession("actor-session-2"));
        expect(new Headers(init?.headers).get("X-Pos-Actor-Session")).not.toBe(checkoutActorSession("actor-session-1"));
      }
    } finally {
      restoreSetTimeout();
    }
  });

  it.each([
    {
      naziv: "Payten HW",
      config: { terminalAktiven: true, sumupAktiven: false },
      payPath: "/api/terminal/pay",
      statusPath: null,
      payResponse: { status: "odobren", avtorizacijskaKoda: "AUTH-1" },
      statusResponse: null,
    },
    {
      naziv: "Viva Cloud Terminal",
      config: { vivaTerminalAktiven: true, sumupAktiven: false },
      payPath: "/api/terminal/viva/terminal/pay",
      statusPath: "/api/terminal/viva/terminal/status/viva-session-matrix",
      payResponse: { sessionId: "viva-session-matrix" },
      statusResponse: {
        status: "PAID",
        transactionId: "viva-transaction-matrix",
        orderCode: "viva-order-matrix",
      },
    },
    {
      naziv: "Viva Smart",
      config: { vivaAktiven: true, sumupAktiven: false },
      payPath: "/api/terminal/viva/pay",
      statusPath: "/api/terminal/viva/status/viva-smart-order-matrix",
      payResponse: {
        orderCode: "viva-smart-order-matrix",
        checkoutUrl: "https://example.test/viva-matrix",
      },
      statusResponse: {
        status: "PAID",
        transactionId: "viva-smart-transaction-matrix",
        orderCode: "viva-smart-order-matrix",
      },
    },
    {
      naziv: "simulacija",
      config: { sumupAktiven: false },
      payPath: "/api/terminal/simulation/pay",
      statusPath: null,
      payResponse: { status: "completed" },
      statusResponse: null,
    },
  ])("$naziv ob potrditvi uporabi samo svežo actor sejo in ohrani zahtevek", async ({
    naziv,
    config,
    payPath,
    statusPath,
    payResponse,
    statusResponse,
  }) => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    Object.assign(mockNapravaState.current!.terminalConfig, config);
    if (naziv === "simulacija") {
      Object.assign(mockUserState.current!, { capabilities: ["simulation"] });
      Object.assign(mockSettingsState.current!, { fursNacin: "simulacija" });
    }
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("actor-session-1"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(payPath)) {
        return new Response(JSON.stringify(payResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (statusPath && url.endsWith(statusPath)) {
        return new Response(JSON.stringify(statusResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/card-payment-attempts/recovery?")) {
        return new Response(JSON.stringify({ attempts: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Nepričakovan ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => callbacks.onSuccess?.({
        id: 560,
        stevilkaRacuna: "PP001-B001-000560",
        datumCas: "2026-08-19T10:30:00.000Z",
        skupaj: 25,
        zoi: "zoi-560",
        eor: "eor-560",
        status: "poslan",
        jeDelni: false,
        narociloId: 1,
      }),
    );

    try {
      render(<Wrapper qc={qc}><Checkout /></Wrapper>);
      await selectNarociloInKartica();
      await screen.findByTestId("button-izdaj-racun");
      sessionStorage.setItem("pos_actor_session", checkoutActorSession("actor-session-2"));
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 40; i++) await Promise.resolve();
      });

      await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
      const payCall = expectAuthenticatedPost(fetchMock, payPath, checkoutActorSession("actor-session-2"));
      const payHeaders = new Headers(payCall[1]?.headers);
      const body = JSON.parse(String(payCall[1]?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ narociloId: 1, znesek: 25 });
      expect(body.paymentAttemptId).toBe(payHeaders.get("Idempotency-Key"));
      if (statusPath) {
        const statusCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith(statusPath));
        expect(statusCall).toBeDefined();
        expect(new Headers(statusCall![1]?.headers).get("X-Pos-Actor-Session")).toBe(checkoutActorSession("actor-session-2"));
      }
      expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith(payPath))).toHaveLength(1);
      expect((mockCreateRacunMutate.mock.calls[0][0].data as Record<string, unknown>).paymentAttemptId)
        .toBe(body.paymentAttemptId);
    } finally {
      restoreSetTimeout();
    }
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ selectionToken: "a".repeat(43) }) });
      })
    );

    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => {
        callbacks?.onSuccess?.({
          id: 99,
          stevilkaRacuna: "PP001-B001-000099",
          datumCas: "2026-08-19T10:30:00.000Z",
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
      // Two synchronous clicks happen before React can repaint a disabled
      // button.  The Checkout ref guard must still dispatch one charge only.
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
    expect((callArgs.data as { znesekNapitnina?: number }).znesekNapitnina).toBe(0);
    expect((callArgs.data as { znesekKartica?: number }).znesekKartica).toBe(25);
    const sumupPayCall = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find(([url]) => String(url).includes("/sumup/pay"));
    expect(JSON.parse(sumupPayCall?.[1]?.body ?? "{}")).toMatchObject({ narociloId: 1, znesek: 25 });
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => String(url).includes("/sumup/pay"))).toHaveLength(1);

    // Račun izdan ekran mora biti viden
    await waitFor(() => {
      expect(screen.getByText("Račun izdan")).toBeInTheDocument();
    });
    expect(screen.getByTestId("status-samodejni-tisk")).toBeInTheDocument();
    expect(screen.getByTestId("print-receipt-button")).toHaveAttribute("data-auto-print", "true");
    expect(screen.getByTestId("print-receipt-button")).toHaveClass("hidden");
    expect(screen.queryByTestId("qr-code-svg")).not.toBeInTheDocument();

    restoreSetTimeout();
  });

  it.each([
    ["strežniški 4xx", { status: 400, data: { code: "BLAGAJNA_REQUIRED", error: "Izberite blagajno." } }],
    ["prekinjena povezava", new TypeError("Failed to fetch")],
  ])("po potrjenem plačilu in napaki %s varno ponudi samo ponovno izdajo računa", async (_label, receiptError) => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    try {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/recovery/select")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ selectionToken: "a".repeat(43) }) });
        }
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ checkoutId: "paid-recovery-001" }) });
        }
        if (String(url).includes("/sumup/status/")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "PAID" }) });
        }
        if (String(url).includes("/card-payment-attempts/") && String(url).includes("/recovery")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              paymentAttemptId: "recovery-payment-key-0001",
              attemptId: "durable-attempt-0001",
              provider: "sumup",
              status: "completed",
              recoverable: true,
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal("fetch", fetchMock);
      mockCreateRacunMutate
        .mockImplementationOnce((_args: unknown, callbacks: { onError?: (e: unknown) => void }) => callbacks.onError?.(receiptError))
        .mockImplementationOnce((_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => callbacks.onSuccess?.({
          id: 199,
          stevilkaRacuna: "PP001-B001-000199",
          datumCas: "2026-08-19T10:30:00.000Z",
          skupaj: 25,
          zoi: "zoi-recovery",
          eor: "eor-recovery",
          status: "poslan",
          jeDelni: false,
          narociloId: 1,
        }));

      render(<Wrapper qc={qc}><Checkout /></Wrapper>);
      await selectNarociloInKartica();
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 40; i++) await Promise.resolve();
      });

      const recoveryButton = await screen.findByTestId("button-recover-paid-receipt");
      expect(recoveryButton).toHaveTextContent("Zaključi račun brez novega plačila");
      expect(screen.queryByTestId("button-reset-payment-guard")).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(recoveryButton);
        for (let i = 0; i < 20; i++) await Promise.resolve();
      });

      await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/sumup/pay"))).toHaveLength(1);
      const retryPayload = mockCreateRacunMutate.mock.calls[1][0].data as Record<string, unknown>;
      expect(retryPayload.paymentAttemptId).toBe("recovery-payment-key-0001");
      expect(await screen.findByText("Račun izdan")).toBeInTheDocument();
    } finally {
      restoreSetTimeout();
    }
  });

  it("po osvežitvi obnovi potrjeno SumUp plačilo brez terminalskega klica ali reference v React stanju", async () => {
    sessionStorage.setItem(
      "pos.card-payment-attempt.sumup.1",
      JSON.stringify({ key: "reload-payment-key-0001", znesek: 25 }),
    );
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/recovery/select")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ selectionToken: "a".repeat(43) }) });
      }
      if (String(url).includes("/card-payment-attempts/") && String(url).includes("/recovery")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            paymentAttemptId: "reload-payment-key-0001",
            attemptId: "reload-durable-attempt-0001",
            provider: "sumup",
            status: "completed",
            recoverable: true,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => callbacks.onSuccess?.({
        id: 200,
        stevilkaRacuna: "PP001-B001-000200",
        datumCas: "2026-08-19T10:30:00.000Z",
        skupaj: 25,
        zoi: "zoi-reload",
        eor: "eor-reload",
        status: "poslan",
        jeDelni: false,
        narociloId: 1,
      }),
    );

    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    await selectNarociloInKartica();
    const recoveryButton = await screen.findByTestId("button-recover-paid-receipt");
    fireEvent.click(recoveryButton);

    await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
    const payload = mockCreateRacunMutate.mock.calls[0][0].data as Record<string, unknown>;
    expect(payload.paymentAttemptId).toBe("reload-payment-key-0001");
    expect(payload.sumupCheckoutId).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/sumup/pay"))).toBe(false);
  });

  it("ob potrditvi obnovitve uporabi trenutno actor sejo in izbrano recovery identiteto", async () => {
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("actor-session-1"));
    sessionStorage.setItem(
      "pos.card-payment-attempt.sumup.1",
      JSON.stringify({ key: "actor-race-payment-key-001", znesek: 25 }),
    );
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/recovery/select")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ selectionToken: "a".repeat(43) }) });
      }
      if (String(url).includes("/card-payment-attempts/") && String(url).includes("/recovery")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            paymentAttemptId: "actor-race-payment-key-001",
            attemptId: "actor-race-durable-attempt-001",
            provider: "sumup",
            status: "completed",
            recoverable: true,
          }),
        });
      }
      if (String(url).includes("/sumup/pay")) throw new Error("Recovery must not start a second SumUp payment");
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => callbacks.onSuccess?.({
        id: 555, stevilkaRacuna: "PP001-B001-000555", datumCas: "2026-08-19T10:30:00.000Z",
        skupaj: 25, zoi: "zoi-555", eor: "eor-555", status: "poslan", jeDelni: false, narociloId: 1,
      }),
    );

    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    await selectNarociloInKartica();
    const recoveryButton = await screen.findByTestId("button-recover-paid-receipt");
    sessionStorage.setItem("pos_actor_session", checkoutActorSession("actor-session-2"));
    await act(async () => {
      fireEvent.click(recoveryButton);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
    expectAuthenticatedPost(fetchMock, "/recovery/select", checkoutActorSession("actor-session-2"));
    const recoveryPayload = mockCreateRacunMutate.mock.calls[0][0].data as Record<string, unknown>;
    expect(recoveryPayload).toMatchObject({
      paymentAttemptId: "actor-race-payment-key-001",
      recoverySelectedAttemptId: "actor-race-durable-attempt-001",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/sumup/pay"))).toBe(false);
  });

  it("brez sessionStorage prikaže strežniške kandidate in zahteva izbiro pred izdajo", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (String(url).endsWith("/card-payment-attempts/recovery?narociloId=1&znesek=25.00")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ attempts: [{
            attemptId: "server-durable-attempt-001", paymentAttemptId: "server-payment-key-0001",
            provider: "sumup", znesek: 25,
          }] }),
        });
      }
      if (String(url).includes("/recovery/select")) {
        expect(options?.method).toBe("POST");
        expect(JSON.parse(String(options?.body))).toMatchObject({ narociloId: 1, znesek: 25 });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ selectionToken: "a".repeat(43) }) });
      }
      if (String(url).includes("/sumup/pay")) throw new Error("A recovery must not start a second terminal charge");
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);
    mockCreateRacunMutate.mockImplementation(
      (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => callbacks.onSuccess?.({
        id: 201, stevilkaRacuna: "PP001-B001-000201", datumCas: "2026-08-19T10:30:00.000Z",
        skupaj: 25, zoi: "zoi-server-recovery", eor: "eor-server-recovery", status: "poslan", jeDelni: false, narociloId: 1,
      }),
    );
    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    await selectNarociloInKartica();
    const recoveryButton = await screen.findByTestId("button-recover-paid-receipt");
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(recoveryButton);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/recovery/select"))).toBe(true);
    expect((mockCreateRacunMutate.mock.calls[0][0].data as Record<string, unknown>)).toMatchObject({
      paymentAttemptId: "server-payment-key-0001",
      recoverySelectedAttemptId: "server-durable-attempt-001",
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/sumup/pay"))).toBe(false);
  });

  it("ob dveh klikih po neobnovljivem shranjenem poskusu začne samo eno novo terminalsko obdelavo", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    try {
      sessionStorage.setItem(
        "pos.card-payment-attempt.sumup.1",
        JSON.stringify({ key: "old-nonrecoverable-key-0001", znesek: 25 }),
      );
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/card-payment-attempts/") && String(url).includes("/recovery")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              paymentAttemptId: "old-nonrecoverable-key-0001",
              attemptId: "old-attempt-0001",
              provider: "sumup",
              status: "failed",
              recoverable: false,
            }),
          });
        }
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ checkoutId: "new-after-failed-001" }) });
        }
        if (String(url).includes("/sumup/status/")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "PAID" }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal("fetch", fetchMock);
      mockCreateRacunMutate.mockImplementation(() => undefined);

      render(<Wrapper qc={qc}><Checkout /></Wrapper>);
      await selectNarociloInKartica();
      const button = screen.getByTestId("button-izdaj-racun");
      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
        for (let i = 0; i < 40; i++) await Promise.resolve();
      });

      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/sumup/pay"))).toHaveLength(1);
    } finally {
      restoreSetTimeout();
    }
  });

  it("po spremembi plačilne vezave med preverjanjem ne nadaljuje starega terminalskega toka", async () => {
    sessionStorage.setItem(
      "pos.card-payment-attempt.sumup.1",
      JSON.stringify({ key: "delayed-recovery-key-0001", znesek: 25 }),
    );
    let resolveRecovery!: (value: unknown) => void;
    const delayedRecovery = new Promise(resolve => { resolveRecovery = resolve; });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/card-payment-attempts/") && String(url).includes("/recovery")) {
        return delayedRecovery;
      }
      if (String(url).includes("/sumup/pay")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ checkoutId: "must-not-start" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Wrapper qc={qc}><Checkout /></Wrapper>);
    await selectNarociloInKartica();
    fireEvent.click(screen.getByTestId("button-izdaj-racun"));
    fireEvent.click(await screen.findByRole("radio", { name: /gotovina/i }));
    resolveRecovery({
      ok: true,
      json: () => Promise.resolve({
        paymentAttemptId: "delayed-recovery-key-0001",
        attemptId: "delayed-attempt-0001",
        provider: "sumup",
        status: "failed",
        recoverable: false,
      }),
    });

    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/sumup/pay"))).toBe(false);
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();
  });

  it("ob FURS napaki ne sproži samodejnega tiska in pokaže opozorilo", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (String(url).includes("/sumup/pay")) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ checkoutId: "test-checkout-furs-error-003" }),
            });
          }
          if (String(url).includes("/sumup/status/")) {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ status: "PAID", napaka: null }),
            });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }),
      );
      mockCreateRacunMutate.mockImplementation(
        (_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => {
          callbacks?.onSuccess?.({
            id: 101,
            stevilkaRacuna: "PP001-B001-000101",
            datumCas: "2026-08-19T10:30:00.000Z",
            skupaj: 25,
            zoi: null,
            eor: null,
            status: "napaka",
            jeDelni: false,
            narociloId: 1,
            fursNapaka: "FURS storitev ni dosegljiva.",
          });
        },
      );

      render(<Wrapper qc={qc}><Checkout /></Wrapper>);
      await selectNarociloInKartica();
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 30; i++) await Promise.resolve();
      });

      expect(await screen.findByTestId("alert-furs-napaka")).toBeInTheDocument();
      expect(screen.getByTestId("alert-furs-napaka-sporocilo")).toHaveTextContent("FURS storitev ni dosegljiva.");
      expect(screen.queryByTestId("status-samodejni-tisk")).not.toBeInTheDocument();
      expect(screen.getByTestId("print-receipt-button")).toHaveAttribute("data-auto-print", "false");
    } finally {
      restoreSetTimeout();
    }
  });

  it("bon + sekundarna kartica terminalu in računu pošlje samo kartični preostanek", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    try {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/darilni-boni/stanje")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ izdano: 0, unovceno: 0, odprto: 0 }),
          });
        }
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ checkoutId: "bon-card-tip-001" }) });
        }
        if (String(url).includes("/sumup/status/")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: "PAID" }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal("fetch", fetchMock);
      mockCreateRacunMutate.mockImplementation((_args: unknown, callbacks: { onSuccess?: (d: unknown) => void }) => {
        callbacks?.onSuccess?.({
          id: 100, stevilkaRacuna: "PP001-B001-000100", datumCas: "2026-08-19T10:30:00.000Z",
          skupaj: 25, zoi: null, eor: null, status: "poslan", jeDelni: false, narociloId: 1,
        });
      });

      render(<Wrapper qc={qc}><Checkout /></Wrapper>);
      const card = await screen.findByTestId("card-narocilo-1");
      fireEvent.click(card);
      fireEvent.click(await screen.findByRole("radio", { name: /^bon$/i }));
      fireEvent.click(screen.getByTestId("button-legacy-voucher-mode"));

      const bonControls = screen.getByText("Znesek starih bonov (brez kode)").parentElement;
      expect(bonControls).not.toBeNull();
      fireEvent.click(within(bonControls!).getAllByRole("button")[1]);
      fireEvent.click(screen.getByRole("button", { name: /^kartica$/i }));
      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 30; i++) await Promise.resolve();
      });
      await waitFor(() => expect(mockCreateRacunMutate,
        JSON.stringify(mockCreateRacunMutate.mock.calls.map(([args]) => args)),
      ).toHaveBeenCalledOnce());

      const paymentRequest = fetchMock.mock.calls.find(([url]) => String(url).includes("/sumup/pay"));
      expect(JSON.parse(paymentRequest?.[1]?.body ?? "{}")).toMatchObject({ narociloId: 1, znesek: 15 });
      const data = mockCreateRacunMutate.mock.calls[0][0].data as Record<string, unknown>;
      expect(data).toMatchObject({ placilnaNacin: "bon", znesekBon: 10, znesekKartica: 15, znesekNapitnina: 0 });
    } finally {
      restoreSetTimeout();
    }
  });

  it("ob potrjeni Viva ECR seji shrani session, TransactionId in OrderCode na račun", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    Object.assign(mockNapravaState.current!.terminalConfig, {
      sumupAktiven: false,
      vivaTerminalAktiven: true,
    });

    try {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/api/terminal/viva/terminal/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: "viva-session-001" }),
          });
        }
        if (String(url).includes("/api/terminal/viva/terminal/status/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              status: "PAID",
              transactionId: "viva-transaction-001",
              orderCode: "viva-order-001",
              napaka: null,
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal(
        "fetch",
        fetchMock,
      );

      render(
        <Wrapper qc={qc}>
          <Checkout />
        </Wrapper>
      );
      await selectNarociloInKartica();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 30; i++) await Promise.resolve();
      });

      await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
      const callArgs = mockCreateRacunMutate.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(callArgs.data.vivaTerminalSessionId).toBe("viva-session-001");
      expect(callArgs.data.vivaTransactionId).toBe("viva-transaction-001");
      expect(callArgs.data.vivaOrderCode).toBe("viva-order-001");
      const payCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("/api/terminal/viva/terminal/pay"));
      const statusCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("/api/terminal/viva/terminal/status/"));
      expect(new Headers(payCall?.[1]?.headers).get("X-Naprava-Id")).toBe("test-naprava-kljuc");
      expect(new Headers(statusCall?.[1]?.headers).get("X-Naprava-Id")).toBe("test-naprava-kljuc");
    } finally {
      restoreSetTimeout();
    }
  });

  it("ob potrjenem Viva Smart Checkoutu shrani OrderCode in TransactionId na račun", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    Object.assign(mockNapravaState.current!.terminalConfig, {
      sumupAktiven: false,
      vivaAktiven: true,
    });

    try {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/api/terminal/viva/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              orderCode: "smart-order-001",
              checkoutUrl: "https://example.test/viva-checkout",
            }),
          });
        }
        if (String(url).includes("/api/terminal/viva/status/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              status: "PAID",
              transactionId: "smart-transaction-001",
              orderCode: "smart-order-001",
              napaka: null,
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal(
        "fetch",
        fetchMock,
      );

      render(
        <Wrapper qc={qc}>
          <Checkout />
        </Wrapper>
      );
      await selectNarociloInKartica();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 30; i++) await Promise.resolve();
      });

      await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
      const callArgs = mockCreateRacunMutate.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(callArgs.data.vivaOrderCode).toBe("smart-order-001");
      expect(callArgs.data.vivaTransactionId).toBe("smart-transaction-001");
      const payCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("/api/terminal/viva/pay"));
      const statusCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("/api/terminal/viva/status/"));
      expect(new Headers(payCall?.[1]?.headers).get("X-Naprava-Id")).toBe("test-naprava-kljuc");
      expect(new Headers(statusCall?.[1]?.headers).get("X-Naprava-Id")).toBe("test-naprava-kljuc");
    } finally {
      restoreSetTimeout();
    }
  });

  it("ob prehodni HTTP napaki Viva statusa nadaljuje polling do PAID", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();
    Object.assign(mockNapravaState.current!.terminalConfig, {
      sumupAktiven: false,
      vivaAktiven: true,
    });

    try {
      let statusCalls = 0;
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/api/terminal/viva/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              orderCode: "smart-order-transient-001",
              checkoutUrl: "https://example.test/viva-checkout",
            }),
          });
        }
        if (String(url).includes("/api/terminal/viva/status/")) {
          statusCalls += 1;
          if (statusCalls === 1) {
            return Promise.resolve({
              ok: false,
              status: 404,
              json: () => Promise.resolve({ status: "PENDING" }),
            });
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              status: "PAID",
              transactionId: "smart-transaction-transient-001",
              orderCode: "smart-order-transient-001",
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(
        <Wrapper qc={qc}>
          <Checkout />
        </Wrapper>
      );
      await selectNarociloInKartica();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-izdaj-racun"));
        for (let i = 0; i < 50; i++) await Promise.resolve();
      });

      await waitFor(() => expect(mockCreateRacunMutate).toHaveBeenCalledOnce());
      expect(statusCalls).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText("Napaka terminala")).not.toBeInTheDocument();
    } finally {
      restoreSetTimeout();
    }
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

    // Neznan/nezanesljiv zaključek ostane blokiran do izrecne uskladitve.
    expect(screen.queryByTestId("button-retry-terminal")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-reset-payment-guard")).toBeInTheDocument();
    expect(screen.getByTestId("button-change-payment")).toBeDisabled();

    restoreSetTimeout();
  });
});
