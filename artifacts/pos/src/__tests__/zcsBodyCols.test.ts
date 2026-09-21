/**
 * Preverja, da printZcsReceipt pošlje mostu (POST /print-text) telo
 * z usklajenim "cols" in "sirina" — enako vrednost kot ?cols query param na /zcs.
 *
 * Vzrok napake: 80mm/40-kolonska vsebina je bila odrezana na 32, ker most
 * ni vedel za širino → izrisal sliko privzetih 384px namesto 576px.
 * Rešitev: BtTiskalniMost v2.4+ bere "cols" iz telesa POST /print-text.
 *
 * Testna strategija: interceptiramo globalni fetch.
 *   - Klic na /status → vrne bridge tip
 *   - Klic na /zcs?cols=X → vrne lažni ZcsRacunJson
 *   - Klic na localhost:8090/print-text → ujamemo telo in ga preverimo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { printZcsReceipt, waitForZcsBridge, ZcsRacunJson } from "@/lib/zcsAndroidPrinter";

vi.mock("@workspace/api-client-react", () => ({
  getAuthToken: vi.fn(async () => "test-clerk-token"),
}));

const FAKE_JSON: ZcsRacunJson = {
  linee: ["Vrstica 1", "Vrstica 2"],
  formati: ["B", "N"],
  qrUrl: "https://example.com/qr",
  zoi: "ABC123",
  qrBase64: "data:image/png;base64,abc",
};

/**
 * Nastavi mock fetch za tri poti:
 *  - localhost:8090/status  → { model, bridge }
 *  - /api/print/...         → FAKE_JSON (vsebina dokumenta)
 *  - localhost:8090/print-text → { ok: true }  ← telo ulovimo tukaj
 *
 * Vrne spy, prek katerega poiščemo klic na /print-text.
 */
function setupFetchMock(bridgeType: string, singleJobQr = false) {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("localhost:8090/status") || url.includes("localhost:8090/status")) {
        return new Response(
          JSON.stringify({ model: "zcs", bridge: bridgeType, singleJobQr }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("localhost:8090/print-text")) {
        return new Response(
          JSON.stringify({ ok: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // /api/print/racun/:id/zcs?cols=... ali /nb80?cols=...
      if (url.includes("/api/print/")) {
        return new Response(
          JSON.stringify(FAKE_JSON),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    },
  );
  return spy;
}

/** Poišče telo POST klica na localhost:8090/print-text med vsemi klici. */
async function captureBodySentToBridge(
  fetchSpy: ReturnType<typeof vi.spyOn>,
): Promise<Record<string, unknown> | null> {
  for (const call of fetchSpy.mock.calls) {
    const url = String(call[0]);
    const init = call[1] as RequestInit | undefined;
    if (url.includes("localhost:8090/print-text") && init?.body) {
      return JSON.parse(String(init.body)) as Record<string, unknown>;
    }
  }
  return null;
}

function captureBodiesSentToBridge(
  fetchSpy: ReturnType<typeof vi.spyOn>,
): Array<Record<string, unknown>> {
  return fetchSpy.mock.calls
    .filter(([url, init]) =>
      String(url).includes("localhost:8090/print-text") &&
      Boolean((init as RequestInit | undefined)?.body),
    )
    .map(([, init]) =>
      JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
    );
}

describe("printZcsReceipt → telo mostu: cols + sirina usklajeni z /zcs ?cols", () => {
  beforeEach(() => {
    // Ponastavi module-level cache v zcsAndroidPrinter (med testi ne sme ostati staro stanje)
    vi.resetModules();
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("BT most 80mm: /zcs?cols=40 IN telo mostu cols=40, sirina=80", async () => {
    const spy = setupFetchMock("bt");

    // colsOverride=40 (PrintReceiptButton nastavi za 80mm), deviceSirina=80
    const rez = await printZcsReceipt(1, false, "zcs", 40, 80);
    expect(rez.ok, rez.error).toBe(true);

    const body = await captureBodySentToBridge(spy);
    expect(body).not.toBeNull();
    expect(body!.cols).toBe(40);   // ← usklajen z /zcs?cols=40
    expect(body!.sirina).toBe(80); // ← fizična širina papirja

    // Preveri, da je API strežnik dobil ?cols=40
    const zcsCall = spy.mock.calls.find(([u]) => String(u).includes("/api/print/"));
    expect(String(zcsCall![0])).toContain("cols=40");
  });

  it("zaščitenemu API endpointu pošlje Clerk Bearer žeton", async () => {
    const spy = setupFetchMock("bt");

    const rez = await printZcsReceipt(1, false, "zcs", 32, 58);
    expect(rez.ok, rez.error).toBe(true);

    const apiCall = spy.mock.calls.find(([u]) => String(u).includes("/api/print/"));
    expect(apiCall).toBeDefined();
    const init = apiCall![1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-clerk-token");
  });

  it("BT most 58mm: /zcs?cols=32 IN telo mostu cols=32, sirina=58", async () => {
    const spy = setupFetchMock("bt");

    const rez = await printZcsReceipt(1, false, "zcs", 32, 58);
    expect(rez.ok, rez.error).toBe(true);

    const body = await captureBodySentToBridge(spy);
    expect(body!.cols).toBe(32);
    expect(body!.sirina).toBe(58);

    const zcsCall = spy.mock.calls.find(([u]) => String(u).includes("/api/print/"));
    expect(String(zcsCall![0])).toContain("cols=32");
  });

  it("ZCS Z92 (30 kol): brez colsOverride → telo mostu BREZ cols in sirina", async () => {
    vi.useFakeTimers();
    const spy = setupFetchMock("zcs");

    // ZCS naprava: noben colsOverride, brez deviceSirina
    const tisk = printZcsReceipt(1, false, "zcs", undefined, undefined);
    await vi.advanceTimersByTimeAsync(12_000);
    const rez = await tisk;
    expect(rez.ok, rez.error).toBe(true);

    const bodies = captureBodiesSentToBridge(spy);
    expect(bodies).toHaveLength(2);
    const body = bodies[0];
    expect(body).not.toBeNull();
    // ZCS most dobi samo vsebino, ne cols/sirina — pade na svojo nastavitev (30)
    expect(body!.cols).toBeUndefined();
    expect(body!.sirina).toBeUndefined();
    expect(body!.linee).toEqual(FAKE_JSON.linee);
    expect(body!.qrUrl).toBeNull();
    expect(body!.zoi).toBeNull();

    // QR gre v ločenem klicu šele po čakanju, zato ne prekine besedila.
    expect(bodies[1].linee).toEqual([]);
    expect(bodies[1].qrUrl).toBe(FAKE_JSON.qrUrl);
    expect(bodies[1].zoi).toBe(FAKE_JSON.zoi);

    // API strežnik brez ?cols → privzeto 30
    const zcsCall = spy.mock.calls.find(([u]) => String(u).includes("/api/print/"));
    expect(String(zcsCall![0])).not.toContain("cols=");
    vi.useRealTimers();
  });

  it("ZCS most 1.1.1: besedilo in QR gresta v enem klicu brez čakanja", async () => {
    const spy = setupFetchMock("zcs", true);
    expect(await waitForZcsBridge(1, 0)).toBe(true);

    const rez = await printZcsReceipt(1, false, "zcs", undefined, 58);
    expect(rez.ok, rez.error).toBe(true);

    const bodies = captureBodiesSentToBridge(spy);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].linee).toEqual(FAKE_JSON.linee);
    expect(bodies[0].qrUrl).toBe(FAKE_JSON.qrUrl);
    expect(bodies[0].zoi).toBe(FAKE_JSON.zoi);
  });

  it("NB80 80mm (cols=40): telo mostu cols=40, sirina=80 (nyx endpoint)", async () => {
    const spy = setupFetchMock("nyx");

    const rez = await printZcsReceipt(1, false, "nyx", 40, 80);
    expect(rez.ok, rez.error).toBe(true);

    const body = await captureBodySentToBridge(spy);
    expect(body!.cols).toBe(40);
    expect(body!.sirina).toBe(80);

    // NB80 → /nb80 endpoint (ne /zcs)
    const apiCall = spy.mock.calls.find(([u]) => String(u).includes("/api/print/"));
    expect(String(apiCall![0])).toContain("/nb80");
    expect(String(apiCall![0])).toContain("cols=40");
  });

  it("NB80 58mm (cols=30): telo mostu cols=30, sirina=58", async () => {
    const spy = setupFetchMock("nyx");

    const rez = await printZcsReceipt(1, false, "nyx", 30, 58);
    expect(rez.ok, rez.error).toBe(true);

    const body = await captureBodySentToBridge(spy);
    expect(body!.cols).toBe(30);
    expect(body!.sirina).toBe(58);
  });

  it("obstoječa polja (linee, qrUrl, zoi, qrBase64) se ohranijo poleg cols+sirina", async () => {
    const spy = setupFetchMock("bt");

    await printZcsReceipt(1, false, "zcs", 40, 80);

    const body = await captureBodySentToBridge(spy);
    expect(body!.linee).toEqual(FAKE_JSON.linee);
    expect(body!.formati).toEqual(FAKE_JSON.formati);
    expect(body!.qrUrl).toBe(FAKE_JSON.qrUrl);
    expect(body!.zoi).toBe(FAKE_JSON.zoi);
    expect(body!.qrBase64).toBe(FAKE_JSON.qrBase64);
    // Plus novi polji
    expect(body!.cols).toBe(40);
    expect(body!.sirina).toBe(80);
  });

  it("stara naprava (brez colsOverride/sirina): most ne dobi cols → varna združljivost", async () => {
    vi.useFakeTimers();
    const spy = setupFetchMock("q10"); // star APK

    // Stara naprava — PrintReceiptButton ni poslal colsOverride niti deviceSirina
    const tisk = printZcsReceipt(1, false, "zcs", undefined, undefined);
    await vi.advanceTimersByTimeAsync(12_000);
    const rez = await tisk;
    expect(rez.ok, rez.error).toBe(true);

    const body = await captureBodySentToBridge(spy);
    // Ni cols v telesu — stari APK pade na svojo nastavitev (ne pokvari)
    expect(body!.cols).toBeUndefined();
    expect(body!.sirina).toBeUndefined();
    vi.useRealTimers();
  });
});

// ─── Enota: ZcsRacunJson tip sprejme cols + sirina ────────────────────────────

describe("ZcsRacunJson tip — cols + sirina sta neobvezni polji", () => {
  it("objekt z cols=40, sirina=80 je veljaven", () => {
    const obj: ZcsRacunJson = { linee: [], qrUrl: null, cols: 40, sirina: 80 };
    expect(obj.cols).toBe(40);
    expect(obj.sirina).toBe(80);
  });

  it("objekt brez cols in sirina je veljaven (stare naprave)", () => {
    const obj: ZcsRacunJson = { linee: [], qrUrl: null };
    expect(obj.cols).toBeUndefined();
    expect(obj.sirina).toBeUndefined();
  });
});
