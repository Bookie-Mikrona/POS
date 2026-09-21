/**
 * Testi za jeZcsMostNaprava logiko in odločitveni tok:
 *   - naprava za ZCS/BT most → retry, nato napaka (ne BLE)
 *   - čisti BLE tiskalnik (brez mosta) → BLE pot nespremenjeno
 *
 * jeZcsMostNaprava je inline logika v PrintReceiptButton (ne eksportirana),
 * zato jo testiramo tu kot čisto funkcijo z enako logiko.
 */

import { describe, it, expect } from "vitest";

/**
 * Replika logike iz PrintReceiptButton — mora ostati sinhronizirana.
 * Vrne true, če tiskalnikSirina indicira napravo z ZCS/BT mostom.
 * Ti tiskalniki ob nedosegljivem mostu NE smejo tiho pasti na BLE pot.
 */
function jeZcsMostNaprava(sirina: number | null | undefined): boolean {
  // 58=ZCS Z92, 32=BT most 58mm, 80=NB80 ali BT most 80mm
  // 30=NB80 58mm — NB80 ima svojo nb80BridgeAvailable logiko, tukaj ga vključimo
  return sirina === 58 || sirina === 32 || sirina === 80 || sirina === 30;
}

// ── jeZcsMostNaprava ──────────────────────────────────────────────────────────

describe("jeZcsMostNaprava — razpozna naprave z mostom", () => {
  it("sirina=32 (BT most 58mm) → true", () => {
    expect(jeZcsMostNaprava(32)).toBe(true);
  });

  it("sirina=58 (ZCS Z92) → true", () => {
    expect(jeZcsMostNaprava(58)).toBe(true);
  });

  it("sirina=80 (NB80 ali BT most 80mm) → true", () => {
    expect(jeZcsMostNaprava(80)).toBe(true);
  });

  it("sirina=30 (NB80 58mm) → true", () => {
    expect(jeZcsMostNaprava(30)).toBe(true);
  });

  it("sirina=null (ni nastavitve → samodejna zaznava, ni znana) → false", () => {
    expect(jeZcsMostNaprava(null)).toBe(false);
  });

  it("sirina=undefined → false", () => {
    expect(jeZcsMostNaprava(undefined)).toBe(false);
  });
});

// ── odločitveni tok: kdaj retry/napaka vs BLE ─────────────────────────────────

describe("odločitveni tok — most naprava vs BLE naprava", () => {
  /**
   * Simulira logiko PrintReceiptButton.renderPrintButton:
   *   jeZcsMostNaprava && !zcsBridgeAvailable && !nb80BridgeAvailable → retry gumb
   *   zcsBridgeAvailable → ZCS gumb (normalno)
   *   !jeZcsMostNaprava && !zcsBridgeAvailable → dropdown (BLE dostopen)
   */
  function odlocitev(params: {
    sirina: number | null | undefined;
    zcsBridgeAvailable: boolean;
    nb80BridgeAvailable: boolean;
  }): "retry" | "zcs" | "nb80" | "dropdown" {
    if (params.nb80BridgeAvailable) return "nb80";
    if (params.zcsBridgeAvailable) return "zcs";
    if (jeZcsMostNaprava(params.sirina) && !params.zcsBridgeAvailable && !params.nb80BridgeAvailable) {
      return "retry";
    }
    return "dropdown";
  }

  // ── most dostopen ────────────────────────────────────────────────────────

  it("sirina=32 + most dostopen → ZCS pot", () => {
    expect(odlocitev({ sirina: 32, zcsBridgeAvailable: true, nb80BridgeAvailable: false })).toBe("zcs");
  });

  it("sirina=58 + most dostopen → ZCS pot", () => {
    expect(odlocitev({ sirina: 58, zcsBridgeAvailable: true, nb80BridgeAvailable: false })).toBe("zcs");
  });

  it("sirina=80 + NB80 dostopen → NB80 pot", () => {
    expect(odlocitev({ sirina: 80, zcsBridgeAvailable: false, nb80BridgeAvailable: true })).toBe("nb80");
  });

  // ── KLJUČNO: most nedosegljiv + most naprava → retry, NE BLE ────────────

  it("sirina=32 (BT most 58mm) + most NEDOSEGLJIV → retry gumb, NE dropdown/BLE", () => {
    expect(odlocitev({ sirina: 32, zcsBridgeAvailable: false, nb80BridgeAvailable: false })).toBe("retry");
  });

  it("sirina=58 (ZCS Z92) + most NEDOSEGLJIV → retry gumb, NE dropdown/BLE", () => {
    expect(odlocitev({ sirina: 58, zcsBridgeAvailable: false, nb80BridgeAvailable: false })).toBe("retry");
  });

  it("sirina=80 (BT most 80mm) + oba mosta NEDOSEGLJIVA → retry gumb, NE dropdown/BLE", () => {
    expect(odlocitev({ sirina: 80, zcsBridgeAvailable: false, nb80BridgeAvailable: false })).toBe("retry");
  });

  it("sirina=30 (NB80 58mm) + oba mosta NEDOSEGLJIVA → retry gumb, NE dropdown/BLE", () => {
    expect(odlocitev({ sirina: 30, zcsBridgeAvailable: false, nb80BridgeAvailable: false })).toBe("retry");
  });

  // ── čisti BLE tiskalnik (brez mosta) → dropdown ostane ──────────────────

  it("sirina=null (samodejna zaznava, most nikoli ni bil zaznan) → dropdown", () => {
    expect(odlocitev({ sirina: null, zcsBridgeAvailable: false, nb80BridgeAvailable: false })).toBe("dropdown");
  });

  it("sirina=undefined + most ni dosegljiv → dropdown (BLE dostopen)", () => {
    expect(odlocitev({ sirina: undefined, zcsBridgeAvailable: false, nb80BridgeAvailable: false })).toBe("dropdown");
  });
});

// ── retry rezultat → napaka ali tisk ─────────────────────────────────────────

describe("po retry: napaka ali tisk", () => {
  /**
   * Simulira handleZcsPrintZRetryjem rezultat:
   *   waitForZcsBridge vrne true → nadaljuj s tiskom
   *   waitForZcsBridge vrne false → prikaži napako, NE BLE
   */
  function poRetriju(mostSePrebudi: boolean): "tisk" | "napaka" {
    return mostSePrebudi ? "tisk" : "napaka";
  }

  it("most se prebudi po retry → tisk prek mosta", () => {
    expect(poRetriju(true)).toBe("tisk");
  });

  it("most se NE prebudi po retry → napaka (ne BLE, ne tiho)", () => {
    expect(poRetriju(false)).toBe("napaka");
  });
});
