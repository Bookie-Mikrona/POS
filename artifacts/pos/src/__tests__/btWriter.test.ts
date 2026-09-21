/**
 * Unit testi za btWriter.ts — adaptivni BLE chunk writer.
 *
 * Pokriva:
 *  - resolveWriteMode: WR/WNR/null glede na properties
 *  - btParamsKey: sanitizacija imen naprav
 *  - loadBtParams / saveBtParams: localStorage round-trip, neveljavni podatki
 *  - nextBtParams: traversal celotne lestvice, null na koncu
 *  - btSendAttempt: WNR vs writeValue, chunking, delay klic
 *  - btSendStream: chunking, logging, napaka z byte-rangeom
 *  - btSendAttemptWithResponse: properties-aware (WR preferred, WNR fallback)
 *  - btSendBitmap: mode selection, BREZ samodejnega retrya, abort ob napaki
 *  - btSendAll: uspeh, GATT napaka → umik, izčrpana lestvica, timeout
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BT_CHUNK_LADDER,
  BT_DELAY_LADDER,
  BT_DEFAULT_PARAMS,
  BT_BITMAP_WNR_DELAY_MS,
  BT_TIMEOUT_MS,
  btParamsKey,
  loadBtParams,
  saveBtParams,
  nextBtParams,
  resolveWriteMode,
  btSendAttempt,
  btSendStream,
  btSendAttemptWithResponse,
  btSendBitmap,
  btSendAll,
  type BtSendParams,
  type BtWriteCharacteristic,
  type BtWriteMode,
} from "../lib/btWriter";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Minimal mock characteristic.
 *
 * opts.wr  = properties.write  (with-response; default false — most cheap printers are WNR-only)
 * opts.wnr = properties.writeWithoutResponse (default true)
 */
function makeChar(opts: {
  wr?: boolean;
  wnr?: boolean;
  wnrFn?: (data: BufferSource) => Promise<void>;
  writeFn?: (data: BufferSource) => Promise<void>;
}): BtWriteCharacteristic {
  const wnrFn = opts.wnrFn ?? vi.fn().mockResolvedValue(undefined);
  const writeFn = opts.writeFn ?? vi.fn().mockResolvedValue(undefined);
  return {
    properties: {
      write: opts.wr ?? false,
      writeWithoutResponse: opts.wnr ?? true,
    },
    writeValueWithoutResponse: opts.wnr !== false ? wnrFn : undefined,
    writeValue: writeFn,
  };
}

/** Vrne spy-je iz mock chara za preverjanje klicev. */
function spiesOf(char: BtWriteCharacteristic) {
  return {
    wnr: char.writeValueWithoutResponse as ReturnType<typeof vi.fn> | undefined,
    write: char.writeValue as ReturnType<typeof vi.fn>,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── resolveWriteMode ───────────────────────────────────────────────────────

describe("resolveWriteMode", () => {
  it("WR=true, WNR=false → 'WR'", () => {
    const char = makeChar({ wr: true, wnr: false });
    expect(resolveWriteMode(char)).toBe("WR");
  });

  it("WR=false, WNR=true → 'WNR'", () => {
    const char = makeChar({ wr: false, wnr: true });
    expect(resolveWriteMode(char)).toBe("WNR");
  });

  it("WR=true, WNR=true → 'WR' (WR ima prednost)", () => {
    const char = makeChar({ wr: true, wnr: true });
    expect(resolveWriteMode(char)).toBe("WR");
  });

  it("WR=false, WNR=false → null (ne more pisati)", () => {
    const char = makeChar({ wr: false, wnr: false });
    expect(resolveWriteMode(char)).toBeNull();
  });

  it("WNR=true ampak writeValueWithoutResponse metoda manjka → null", () => {
    // Karakteristika napiše 'true' v properties ampak metoda ni prisotna
    const char: BtWriteCharacteristic = {
      properties: { write: false, writeWithoutResponse: true },
      writeValueWithoutResponse: undefined, // metoda manjka!
      writeValue: vi.fn(),
    };
    expect(resolveWriteMode(char)).toBeNull();
  });

  it("vrne BtWriteMode tip ('WR' | 'WNR')", () => {
    const m: BtWriteMode | null = resolveWriteMode(makeChar({ wr: true }));
    expect(["WR", "WNR", null]).toContain(m);
  });
});

// ── btParamsKey ────────────────────────────────────────────────────────────

describe("btParamsKey", () => {
  it("generira predvidljiv ključ za znano ime", () => {
    expect(btParamsKey("Q10 Back Clip")).toBe("bt_params_v1_Q10_Back_Clip");
  });

  it("neznanano ime → fallback 'unknown'", () => {
    expect(btParamsKey(undefined)).toBe("bt_params_v1_unknown");
  });

  it("preveč dolgo ime → odrezano na 40 znakov", () => {
    const long = "A".repeat(60);
    const key = btParamsKey(long);
    expect(key.length).toBe("bt_params_v1_".length + 40);
  });

  it("posebni znaki → podčrtaj", () => {
    expect(btParamsKey("Printer (BLE) #1")).toBe("bt_params_v1_Printer__BLE___1");
  });
});

// ── loadBtParams / saveBtParams ────────────────────────────────────────────

describe("loadBtParams", () => {
  it("prazno → privzete vrednosti", () => {
    const p = loadBtParams("MyPrinter");
    expect(p.chunkSize).toBe(BT_CHUNK_LADDER[0]);
    expect(p.delayMs).toBe(BT_DELAY_LADDER[0]);
  });

  it("shrani in naloži veljavne parametre", () => {
    const params: BtSendParams = { chunkSize: 64, delayMs: 30 };
    saveBtParams("MyPrinter", params);
    const loaded = loadBtParams("MyPrinter");
    expect(loaded).toEqual(params);
  });

  it("neveljavne vrednosti v localStorage → privzete vrednosti", () => {
    localStorage.setItem(btParamsKey("MyPrinter"), JSON.stringify({ chunkSize: 999, delayMs: 999 }));
    const p = loadBtParams("MyPrinter");
    expect(p).toEqual(BT_DEFAULT_PARAMS);
  });

  it("pokvarjen JSON → privzete vrednosti", () => {
    localStorage.setItem(btParamsKey("MyPrinter"), "INVALID_JSON{{");
    const p = loadBtParams("MyPrinter");
    expect(p).toEqual(BT_DEFAULT_PARAMS);
  });

  it("naprava undefined → loči od 'unknown' samo simbolično — oba vrneta default", () => {
    const p = loadBtParams(undefined);
    expect(p).toEqual(BT_DEFAULT_PARAMS);
  });
});

// ── nextBtParams ───────────────────────────────────────────────────────────

describe("nextBtParams", () => {
  it("traversal celotne lestvice chunk", () => {
    let p: BtSendParams | null = { ...BT_DEFAULT_PARAMS };
    const chunks: number[] = [];
    while (p) {
      chunks.push(p.chunkSize);
      p = nextBtParams(p);
    }
    expect(chunks[0]).toBe(BT_CHUNK_LADDER[0]);
    expect(chunks[chunks.length - 1]).toBe(BT_CHUNK_LADDER[BT_CHUNK_LADDER.length - 1]);
    expect(chunks.length).toBe(BT_CHUNK_LADDER.length);
  });

  it("vsak korak zmanjša chunkSize", () => {
    let p: BtSendParams | null = { ...BT_DEFAULT_PARAMS };
    let prev = p.chunkSize;
    p = nextBtParams(p);
    while (p) {
      expect(p.chunkSize).toBeLessThan(prev);
      prev = p.chunkSize;
      p = nextBtParams(p);
    }
  });

  it("vsak korak poveča ali ohrani delayMs", () => {
    let p: BtSendParams | null = { ...BT_DEFAULT_PARAMS };
    let prev = p.delayMs;
    p = nextBtParams(p);
    while (p) {
      expect(p.delayMs).toBeGreaterThanOrEqual(prev);
      prev = p.delayMs;
      p = nextBtParams(p);
    }
  });

  it("null ob koncu lestvice", () => {
    const last = nextBtParams({
      chunkSize: BT_CHUNK_LADDER[BT_CHUNK_LADDER.length - 2],
      delayMs: BT_DELAY_LADDER[BT_DELAY_LADDER.length - 1],
    });
    expect(last?.chunkSize).toBe(BT_CHUNK_LADDER[BT_CHUNK_LADDER.length - 1]);
    const afterLast = nextBtParams({
      chunkSize: BT_CHUNK_LADDER[BT_CHUNK_LADDER.length - 1],
      delayMs: BT_DELAY_LADDER[BT_DELAY_LADDER.length - 1],
    });
    expect(afterLast).toBeNull();
  });

  it("neznan chunkSize → vzame naslednji korak od začetka", () => {
    const p = nextBtParams({ chunkSize: 999 as BtSendParams["chunkSize"], delayMs: 10 });
    expect(p).not.toBeNull();
    expect((BT_CHUNK_LADDER as readonly number[]).includes(p!.chunkSize)).toBe(true);
  });
});

// ── btSendAttempt ──────────────────────────────────────────────────────────

describe("btSendAttempt", () => {
  it("WNR: pošlje podatke v pravilnem številu kosov", async () => {
    const data = new Uint8Array(500).fill(0xAA);
    const char = makeChar({ wnr: true });
    const { wnr } = spiesOf(char);

    const p = btSendAttempt(char, data, { chunkSize: 180, delayMs: 10 }, true);
    await vi.runAllTimersAsync();
    await p;

    expect(wnr).toHaveBeenCalledTimes(3);
    expect((wnr!.mock.calls[0][0] as Uint8Array).length).toBe(180);
    expect((wnr!.mock.calls[1][0] as Uint8Array).length).toBe(180);
    expect((wnr!.mock.calls[2][0] as Uint8Array).length).toBe(140);
  });

  it("WNR: kliče setTimeout za delay med kosi", async () => {
    const data = new Uint8Array(360).fill(0);
    const char = makeChar({ wnr: true });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const p = btSendAttempt(char, data, { chunkSize: 180, delayMs: 10 }, true);
    await vi.runAllTimersAsync();
    await p;

    const delayCalls = setTimeoutSpy.mock.calls.filter(args => args[1] === 10);
    expect(delayCalls.length).toBe(2);
  });

  it("writeValue (ne-WNR): uporablja writeValue, ne writeValueWithoutResponse", async () => {
    const data = new Uint8Array(250).fill(0xBB);
    const char = makeChar({ wnr: false });
    const { write } = spiesOf(char);

    await btSendAttempt(char, data, { chunkSize: 100, delayMs: 30 }, false);

    expect(write).toHaveBeenCalledTimes(3);
  });

  it("ob GATT napaki vrže napako (ne je ne zajame)", async () => {
    const gattErr = new Error("GATT operation failed for unknown reason");
    const char = makeChar({
      wnr: true,
      wnrFn: vi.fn().mockRejectedValueOnce(gattErr),
    });

    await expect(
      btSendAttempt(char, new Uint8Array(10), { chunkSize: 180, delayMs: 10 }, true),
    ).rejects.toThrow("GATT operation failed");
  });

  it("delayMs=0 → brez sleep klicev", async () => {
    const data = new Uint8Array(360).fill(0);
    const char = makeChar({ wnr: true });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const p = btSendAttempt(char, data, { chunkSize: 180, delayMs: 0 as BtSendParams["delayMs"] }, true);
    await vi.runAllTimersAsync();
    await p;

    const delayCalls = setTimeoutSpy.mock.calls.filter(args => args[1] === 0);
    expect(delayCalls.length).toBe(0);
  });
});

// ── btSendStream ───────────────────────────────────────────────────────────

describe("btSendStream", () => {
  it("WR mode: kliče writeValue, ne writeValueWithoutResponse", async () => {
    const data = new Uint8Array(200).fill(0xAA);
    const char = makeChar({ wr: true, wnr: true });
    const { wnr, write } = spiesOf(char);

    await btSendStream(char, data, 100, "WR", 0, "test");

    expect(write).toHaveBeenCalledTimes(2);
    expect(wnr).not.toHaveBeenCalled();
  });

  it("WNR mode: kliče writeValueWithoutResponse, ne writeValue", async () => {
    const data = new Uint8Array(200).fill(0xBB);
    const char = makeChar({ wr: false, wnr: true });
    const { wnr, write } = spiesOf(char);

    const p = btSendStream(char, data, 100, "WNR", 0, "test");
    await vi.runAllTimersAsync();
    await p;

    expect(wnr).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
  });

  it("WNR z delayMs>0: setTimeout klican za vsak kos", async () => {
    const data = new Uint8Array(300).fill(0);
    const char = makeChar({ wnr: true });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const p = btSendStream(char, data, 100, "WNR", BT_BITMAP_WNR_DELAY_MS, "test");
    await vi.runAllTimersAsync();
    await p;

    const delayCalls = setTimeoutSpy.mock.calls.filter(args => args[1] === BT_BITMAP_WNR_DELAY_MS);
    expect(delayCalls.length).toBe(3); // 3 kosi
  });

  it("ob napaki vrže in NE nadaljuje z naslednjimi kosi", async () => {
    const gattErr = new Error("GATT fail");
    let callCount = 0;
    const char = makeChar({
      wnr: true,
      wnrFn: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(gattErr); // vedno napaka
      }),
    });

    await expect(
      btSendStream(char, new Uint8Array(300).fill(1), 100, "WNR", 0, "test"),
    ).rejects.toThrow("GATT fail");

    // Ker se po napaki vrže, ne sme biti nadaljevanja
    expect(callCount).toBe(1); // samo 1 kos preden napaka
  });
});

// ── btSendAttemptWithResponse ──────────────────────────────────────────────

describe("btSendAttemptWithResponse", () => {
  it("WR-capable char: kliče writeValue, nikoli WNR", async () => {
    const data = new Uint8Array(360).fill(0xAA);
    const char = makeChar({ wr: true, wnr: true }); // oba podprta
    const { wnr, write } = spiesOf(char);

    await btSendAttemptWithResponse(char, data, { chunkSize: 180, delayMs: 10 });

    expect(write).toHaveBeenCalled();
    expect(wnr).not.toHaveBeenCalled();
  });

  it("WNR-only char (wr=false): kliče writeValueWithoutResponse (fallback)", async () => {
    const data = new Uint8Array(200).fill(0xCC);
    const char = makeChar({ wr: false, wnr: true });
    const { wnr, write } = spiesOf(char);

    const p = btSendAttemptWithResponse(char, data, { chunkSize: 100, delayMs: 10 });
    await vi.runAllTimersAsync();
    await p;

    expect(wnr).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("niti WR niti WNR → vrže napako", async () => {
    const char = makeChar({ wr: false, wnr: false });

    await expect(
      btSendAttemptWithResponse(char, new Uint8Array(10), { chunkSize: 180, delayMs: 10 }),
    ).rejects.toThrow(/WR|WNR|pisanja/i);
  });

  it("pravilno število WR kosov", async () => {
    const data = new Uint8Array(500).fill(0xBB);
    const char = makeChar({ wr: true, wnr: false });
    const { write } = spiesOf(char);

    await btSendAttemptWithResponse(char, data, { chunkSize: 180, delayMs: 10 });

    expect(write).toHaveBeenCalledTimes(3); // 180+180+140
  });

  it("ob GATT napaki vrže napako", async () => {
    const gattErr = new Error("GATT operation failed");
    const char = makeChar({
      wr: true,
      writeFn: vi.fn().mockRejectedValueOnce(gattErr),
    });

    await expect(
      btSendAttemptWithResponse(char, new Uint8Array(10), { chunkSize: 180, delayMs: 10 }),
    ).rejects.toThrow("GATT operation failed");
  });
});

// ── btSendBitmap ───────────────────────────────────────────────────────────

describe("btSendBitmap", () => {

  // ── Mode selection ──────────────────────────────────────────────────────

  it("WNR-only char (Q10): kliče WNR, nikoli writeValue, ok=true", async () => {
    // Q10 Back Clip ima samo writeWithoutResponse
    const char = makeChar({ wr: false, wnr: true });
    const { wnr, write } = spiesOf(char);

    const p = btSendBitmap(char, new Uint8Array(200).fill(0x1B), "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(wnr).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(res.writeMode).toBe("WNR");
  });

  it("WR-only char: kliče writeValue, nikoli WNR, ok=true", async () => {
    const char = makeChar({ wr: true, wnr: false });
    const { wnr, write } = spiesOf(char);

    const p = btSendBitmap(char, new Uint8Array(200).fill(0x1B), "Printer");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(write).toHaveBeenCalled();
    expect(wnr).toBeUndefined(); // metoda sploh ni na mockcharu
    expect(res.writeMode).toBe("WR");
  });

  it("WR+WNR char: WR ima prednost (writeValue klican, WNR ne)", async () => {
    const char = makeChar({ wr: true, wnr: true });
    const { wnr, write } = spiesOf(char);

    const p = btSendBitmap(char, new Uint8Array(100).fill(0x1B), "Dual");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(write).toHaveBeenCalled();
    expect(wnr).not.toHaveBeenCalled();
    expect(res.writeMode).toBe("WR");
  });

  it("niti WR niti WNR → ok=false, jasno sporočilo", async () => {
    const char = makeChar({ wr: false, wnr: false });

    const p = btSendBitmap(char, new Uint8Array(100), "NoWrite");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/pisanja|profil/i);
    expect(res.attempts).toBe(1);
  });

  // ── WNR pacing ──────────────────────────────────────────────────────────

  it("WNR: delay med kosi je BT_BITMAP_WNR_DELAY_MS", async () => {
    const char = makeChar({ wr: false, wnr: true });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const p = btSendBitmap(char, new Uint8Array(360).fill(0), "Q10");
    await vi.runAllTimersAsync();
    await p;

    // 360 / 180 = 2 kosi → 2 delay klicev s pravilnim intervalom
    const delayCalls = setTimeoutSpy.mock.calls.filter(args => args[1] === BT_BITMAP_WNR_DELAY_MS);
    expect(delayCalls.length).toBe(2);
  });

  it("WR: brez inter-chunk zakasnitve (delay=0) — ni klicev setTimeout z BT_BITMAP_WNR_DELAY_MS", async () => {
    const char = makeChar({ wr: true, wnr: false });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const p = btSendBitmap(char, new Uint8Array(360).fill(0), "WRPrinter");
    await vi.runAllTimersAsync();
    await p;

    // Preverimo izključno, da NI bil klican setTimeout z BT_BITMAP_WNR_DELAY_MS (pacing).
    // Ne preverjamo vseh nizkih zamikov — vi.runAllTimersAsync() interno ustvari lastne timerje.
    const pacingCalls = setTimeoutSpy.mock.calls.filter(
      args => (args[1] as number) === BT_BITMAP_WNR_DELAY_MS,
    );
    expect(pacingCalls.length).toBe(0);
  });

  // ── NO RETRY — abort on error ─────────────────────────────────────────

  it("KLJUČNO: ob GATT napaki → ok=false, attempts=1, BREZ samodejnega retrya", async () => {
    const gattErr = new Error("GATT operation failed");
    let callCount = 0;
    const char = makeChar({
      wr: false,
      wnr: true,
      wnrFn: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(gattErr);
      }),
    });

    const p = btSendBitmap(char, new Uint8Array(200).fill(0x1B), "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(1); // NIKOLI > 1 — ni retrya
    // Kos metoda klicana samo 1× (napaka pri 1. kosu → prekinitev, ni ponavljanja)
    expect(callCount).toBe(1);
    expect(res.error).toMatch(/ni uspel|izklopit|poskusite/i);
  });

  it("napaka pri 3. kosu → prekinitev, predhodnih kosov NE pošlje znova", async () => {
    const gattErr = new Error("GATT fail mid-stream");
    let callCount = 0;
    const char = makeChar({
      wr: false,
      wnr: true,
      wnrFn: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 3) return Promise.reject(gattErr);
        return Promise.resolve();
      }),
    });

    // 5 kosov po 100B = 500B skupaj
    const p = btSendBitmap(char, new Uint8Array(500).fill(0x1B), "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(false);
    expect(callCount).toBe(3); // 1+2 OK, 3 napaka → stop
    expect(res.attempts).toBe(1); // brez retrya
  });

  it("WR napaka (char podpira samo WNR) → napaka, ne pa silent fallback", async () => {
    // Char z write=true ampak writeValue meče napako — ne sme tiho preiti na WNR
    const gattErr = new Error("NotSupported");
    const char = makeChar({
      wr: true, // WR declared
      wnr: true,
      writeFn: vi.fn().mockRejectedValue(gattErr), // ampak pisanje meče napako
    });
    const { wnr } = spiesOf(char);

    const p = btSendBitmap(char, new Uint8Array(100).fill(0), "BadChar");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(false);
    expect(wnr).not.toHaveBeenCalled(); // NE sme tiho preiti na WNR
    expect(res.attempts).toBe(1);
  });

  // ── Uspešen izpis ────────────────────────────────────────────────────────

  it("uspeh → ok=true, attempts=1, writeMode prisoten", async () => {
    const char = makeChar({ wr: false, wnr: true });

    const p = btSendBitmap(char, new Uint8Array(200).fill(0x1B), "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(res.writeMode).toBeDefined();
  });

  it("shrani chunk size v localStorage ob uspehu", async () => {
    const char = makeChar({ wr: false, wnr: true });
    const p = btSendBitmap(char, new Uint8Array(100), "Q10-save");
    await vi.runAllTimersAsync();
    await p;

    const saved = loadBtParams("Q10-save");
    expect((BT_CHUNK_LADDER as readonly number[]).includes(saved.chunkSize)).toBe(true);
  });

  it("ne shrani v localStorage ob napaki", async () => {
    localStorage.clear();
    const char = makeChar({
      wr: false,
      wnr: true,
      wnrFn: vi.fn().mockRejectedValue(new Error("GATT fail")),
    });

    const p = btSendBitmap(char, new Uint8Array(100), "Q10-fail");
    await vi.runAllTimersAsync();
    await p;

    expect(localStorage.getItem(btParamsKey("Q10-fail"))).toBeNull();
  });

  it("timeout → ok=false, 'časovni limit' v sporočilu", async () => {
    const char = makeChar({
      wr: false,
      wnr: true,
      wnrFn: vi.fn().mockImplementation(() => new Promise(() => {})),
    });

    const p = btSendBitmap(char, new Uint8Array(50), "Q10");
    vi.advanceTimersByTime(BT_TIMEOUT_MS + 1);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.error).toContain("časovni limit");
    expect(res.attempts).toBe(1);
  });

  it("naprava undefined → shrani pod 'bt_params_v1_unknown'", async () => {
    const char = makeChar({ wr: false, wnr: true });
    const p = btSendBitmap(char, new Uint8Array(50), undefined);
    await vi.runAllTimersAsync();
    await p;

    expect(localStorage.getItem("bt_params_v1_unknown")).not.toBeNull();
  });
});

// ── btSendAll ──────────────────────────────────────────────────────────────

describe("btSendAll", () => {
  it("uspeh ob prvem poskusu → ok=true, attempts=1", async () => {
    const char = makeChar({ wnr: true });
    const data = new Uint8Array(100).fill(0x1B);

    const p = btSendAll(char, data, "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(res.usedParams?.chunkSize).toBe(BT_CHUNK_LADDER[0]);
  });

  it("shrani delujoče parametre v localStorage", async () => {
    const char = makeChar({ wnr: true });
    const p = btSendAll(char, new Uint8Array(50), "Q10");
    await vi.runAllTimersAsync();
    await p;

    const saved = loadBtParams("Q10");
    expect(saved.chunkSize).toBe(BT_CHUNK_LADDER[0]);
  });

  it("naslednji izpis začne s shranjenimi parametri (manjši kos)", async () => {
    saveBtParams("Q10", { chunkSize: 64, delayMs: 30 });

    const char = makeChar({ wnr: true });
    const p = btSendAll(char, new Uint8Array(200), "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(res.usedParams?.chunkSize).toBe(64);
    expect(res.attempts).toBe(1);
  });

  it("GATT napaka → umik na manjši kos, uspeh pri 2. poskusu", async () => {
    const gattErr = new Error("GATT operation failed for unknown reason");
    let call = 0;
    const wnrFn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.reject(gattErr);
      return Promise.resolve();
    });
    const char = makeChar({ wnr: true, wnrFn });

    const p = btSendAll(char, new Uint8Array(180), "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.usedParams!.chunkSize).toBeLessThan(BT_CHUNK_LADDER[0]);
  });

  it("ponovi od bajta 0 — ESC @ je na začetku 2. poskusa", async () => {
    const gattErr = new Error("GATT operation failed");
    const sentFirstBytes: number[] = [];
    let attempt = 0;
    const wnrFn = vi.fn().mockImplementation((data: Uint8Array) => {
      attempt++;
      sentFirstBytes.push(data[0]);
      if (attempt === 1) return Promise.reject(gattErr);
      return Promise.resolve();
    });
    const char = makeChar({ wnr: true, wnrFn });

    const data = new Uint8Array(200);
    data[0] = 0x1B; data[1] = 0x40;
    for (let i = 2; i < 200; i++) data[i] = i % 256;

    const p = btSendAll(char, data, "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(sentFirstBytes[1]).toBe(0x1B);
  });

  it("vse stopnje lestvice neuspešne → ok=false z jasnim sporočilom", async () => {
    const gattErr = new Error("GATT operation failed for unknown reason");
    const wnrFn = vi.fn().mockRejectedValue(gattErr);
    const char = makeChar({ wnr: true, wnrFn });

    const p = btSendAll(char, new Uint8Array(100), "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.error).toContain("GATT napaka");
    expect(res.attempts).toBe(BT_CHUNK_LADDER.length);
  });

  it("izčrpana lestvica → ne shrani v localStorage", async () => {
    const gattErr = new Error("GATT operation failed");
    const char = makeChar({
      wnr: true,
      wnrFn: vi.fn().mockRejectedValue(gattErr),
    });
    localStorage.clear();

    const p = btSendAll(char, new Uint8Array(100), "Q10");
    await vi.runAllTimersAsync();
    await p;

    expect(localStorage.getItem(btParamsKey("Q10"))).toBeNull();
  });

  it("timeout → ok=false z opisnim sporočilom", async () => {
    const char = makeChar({
      wnr: true,
      wnrFn: vi.fn().mockImplementation(() => new Promise(() => {})),
    });

    const p = btSendAll(char, new Uint8Array(50), "Q10");
    vi.advanceTimersByTime(30_001);
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.error).toContain("časovni limit");
    expect(res.attempts).toBe(1);
  });

  it("WNR=false: uporablja writeValue (ACK flow control)", async () => {
    const char = makeChar({ wnr: false });
    const { write } = spiesOf(char);
    const data = new Uint8Array(360).fill(0);

    const p = btSendAll(char, data, "Q10");
    await vi.runAllTimersAsync();
    const res = await p;

    expect(res.ok).toBe(true);
    expect(write).toHaveBeenCalled();
  });

  it("naprava undefined → ključ 'bt_params_v1_unknown'", async () => {
    const char = makeChar({ wnr: true });
    const p = btSendAll(char, new Uint8Array(50), undefined);
    await vi.runAllTimersAsync();
    await p;

    expect(localStorage.getItem("bt_params_v1_unknown")).not.toBeNull();
  });
});
