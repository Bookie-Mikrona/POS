/**
 * Testi za SumUp QR plačilo brez terminala v komponenti Checkout.tsx.
 *
 * Pokritost:
 *  1. Ko sumupTerminalSerial ni nastavljen → prikaže se QR koda overlay (ne terminal spinner)
 *  2. Ko status postane PAID → samodejno se izda račun (pokliče se createRacun.mutate)
 *  3. Ko status postane FAILED → prikaže se napaka (terminalStanje = "napaka")
 *
 * Strategija:
 *  - Plačilni način "kartica" izberemo z radiobutton klikom po selekciji naročila
 *  - fetch mock: POST /sumup/pay vrne checkoutId takoj; GET /sumup/status vrne
 *    PAID/FAILED na prvem klicu
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

const mockNastavitveQr = {
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
  sumupTerminalSerial: "",   // prazno → QR koda način
  vivaAktiven: false,
  smtpAktiven: false,
  certifikatNaložen: false,
};

// ── Hoisted mocks ────────────────────────────────────────────────────────────

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
  useNastavitve: () => ({ nastavitve: mockNastavitveQr, nastavitveLoading: false }),
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

/**
 * Izberi naročilo in nastavi plačilni način na Kartica.
 * Komponenta mora biti že renderirana.
 */
async function selectNarociloInKartica() {
  const card = await screen.findByTestId("card-narocilo-1");
  await act(async () => {
    fireEvent.click(card);
  });

  // Počakamo, da se RadioGroup za plačilni način prikaže (šele ko je naročilo izbrano)
  // findByRole je async in čaka na element
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

describe("Checkout — SumUp QR plačilo brez terminala", () => {
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

  it("prikaže QR kodo overlay (ne terminal spinner) ko sumupTerminalSerial ni nastavljen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-qr-001" }),
          });
        }
        // Status ostane v zraku — QR overlay preverimo pred prvim pollom
        return new Promise(() => {});
      })
    );

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );

    await selectNarociloInKartica();

    // Preverimo, da gumb kaže SumUp tekst
    await waitFor(() => {
      expect(screen.getByTestId("button-izdaj-racun")).toHaveTextContent(
        "Plačaj prek SumUp in izdaj račun"
      );
    });

    // Klik na gumb sproži sendToSumup
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      // Sprostimo microtask queue, da se POST fetch in setState izvedeta
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // QR overlay mora biti viden
    await waitFor(
      () => {
        expect(screen.getByTestId("qr-code-svg")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // QR koda mora vsebovati SumUp checkout URL s pravilnim checkoutId
    const qrEl = screen.getByTestId("qr-code-svg");
    expect(qrEl.getAttribute("data-value")).toContain("pay.sumup.com");
    expect(qrEl.getAttribute("data-value")).toContain("test-checkout-qr-001");

    // Terminal spinner (za Payten terminal) NE sme biti viden
    expect(screen.queryByText("Čakam na terminal...")).not.toBeInTheDocument();

    // Naslov QR overlaya in napis za čakanje
    expect(screen.getByText("Plačilo s SumUp")).toBeInTheDocument();
    expect(screen.getByText("Čakam na plačilo...")).toBeInTheDocument();
  });

  it("ob PAID statusu samodejno izda račun (pokliče createRacun.mutate)", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-paid-002" }),
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

  it("gumb 'Kopiraj link' pokliče navigator.clipboard.writeText s pravilnim SumUp URL-jem", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-copy-004" }),
          });
        }
        return new Promise(() => {});
      })
    );

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );

    await selectNarociloInKartica();

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Počakamo, da se QR overlay prikaže
    await waitFor(
      () => {
        expect(screen.getByTestId("qr-code-svg")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Klik na "Kopiraj link"
    const copyBtn = screen.getByTestId("button-kopiraj-link");
    await act(async () => {
      fireEvent.click(copyBtn);
      await Promise.resolve();
    });

    // writeText mora biti poklican z ustreznim SumUp URL-jem
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("pay.sumup.com")
    );
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("test-checkout-copy-004")
    );
  });

  it("po kopiranju se besedilo gumba začasno spremeni v 'Kopirano!'", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-copied-005" }),
          });
        }
        return new Promise(() => {});
      })
    );

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );

    await selectNarociloInKartica();

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("button-kopiraj-link")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Pred klikom mora biti napis "Kopiraj link"
    expect(screen.getByTestId("button-kopiraj-link")).toHaveTextContent("Kopiraj link");

    // Klik na gumb
    await act(async () => {
      fireEvent.click(screen.getByTestId("button-kopiraj-link"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Po kopiranju se napis spremeni v "Kopirano!"
    await waitFor(() => {
      expect(screen.getByTestId("button-kopiraj-link")).toHaveTextContent("Kopirano!");
    });
  });

  it("link 'Odpri v novem zavihku' vsebuje pravi SumUp URL s checkoutId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-link-006" }),
          });
        }
        return new Promise(() => {});
      })
    );

    render(
      <Wrapper qc={qc}>
        <Checkout />
      </Wrapper>
    );

    await selectNarociloInKartica();

    await act(async () => {
      fireEvent.click(screen.getByTestId("button-izdaj-racun"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("link-odpri-zavihku")).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    const link = screen.getByTestId("link-odpri-zavihku");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("pay.sumup.com");
    expect(href).toContain("test-checkout-link-006");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("ob FAILED statusu prikaže napako (ne izda računa)", async () => {
    const restoreSetTimeout = stubSetTimeoutImmediate();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes("/sumup/pay")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ checkoutId: "test-checkout-fail-003" }),
          });
        }
        if (String(url).includes("/sumup/status/")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              status: "FAILED",
              napaka: "Plačilo zavrnjeno s strani banke",
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

    // Sporočilo napake iz SumUp
    expect(screen.getByText("Plačilo zavrnjeno s strani banke")).toBeInTheDocument();

    // Račun NI bil izdan
    expect(mockCreateRacunMutate).not.toHaveBeenCalled();

    // Možnost ponovnega poskusa in zamenjave načina plačila
    expect(screen.getByTestId("button-retry-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("button-change-payment")).toBeInTheDocument();

    restoreSetTimeout();
  });
});
