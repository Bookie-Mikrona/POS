/**
 * Testi za resolveBtCols in isBtBridge.
 *
 * Pokrivajo:
 *  - hladni start (isZcsBridgeAvailable ni tekla, bridgeType=null)
 *  - bridge="bt" (APK v2.2+) in bridge="q10" (APK ≤v2.1) → enaki rezultat
 *  - varnostna mreža sirina=32 (nedvoumno BT)
 *  - ZCS (sirina=58/30) ostane 30 (brez cols parametra)
 *  - NB80/nyx pot nespremenjena
 */

import { describe, it, expect } from "vitest";
import { isBtBridge, resolveBtCols } from "../lib/zcsAndroidPrinter";

// ── isBtBridge ────────────────────────────────────────────────────────────────

describe("isBtBridge", () => {
  it("bridge='bt' (APK v2.2+) → true", () => {
    expect(isBtBridge("bt")).toBe(true);
  });

  it("bridge='q10' (APK ≤v2.1, star) → true (združljivost)", () => {
    expect(isBtBridge("q10")).toBe(true);
  });

  it("bridge='zcs' → false", () => {
    expect(isBtBridge("zcs")).toBe(false);
  });

  it("bridge=null (hladni start, ni zaznano) → false", () => {
    expect(isBtBridge(null)).toBe(false);
  });

  it("bridge=undefined → false", () => {
    expect(isBtBridge(undefined)).toBe(false);
  });

  it("bridge='nyx' → false", () => {
    expect(isBtBridge("nyx")).toBe(false);
  });
});

// ── resolveBtCols ─────────────────────────────────────────────────────────────

describe("resolveBtCols — colsOverride ima prednost", () => {
  it("colsOverride=32 → 32 (ne glede na bridgeType)", () => {
    expect(resolveBtCols(32, null, undefined)).toBe(32);
    expect(resolveBtCols(32, "zcs", undefined)).toBe(32);
    expect(resolveBtCols(32, "bt", undefined)).toBe(32);
  });

  it("colsOverride=40 → 40", () => {
    expect(resolveBtCols(40, "bt", 80)).toBe(40);
    expect(resolveBtCols(40, null, 80)).toBe(40);
  });

  it("colsOverride=30 → 30", () => {
    expect(resolveBtCols(30, "bt", undefined)).toBe(30);
  });
});

describe("resolveBtCols — bridge zaznava (normalni primer)", () => {
  it("bridge='bt' + brez override → 32 (privzeto BT 58mm)", () => {
    expect(resolveBtCols(undefined, "bt", undefined)).toBe(32);
  });

  it("bridge='q10' (star APK) + brez override → 32 (enako kot bt)", () => {
    expect(resolveBtCols(undefined, "q10", undefined)).toBe(32);
  });

  it("bridge='zcs' + brez override → undefined (→ brez ?cols → 30 privzeto)", () => {
    expect(resolveBtCols(undefined, "zcs", undefined)).toBeUndefined();
  });

  it("bridge=null + brez override → varnostna mreža", () => {
    // brez sirine tudi → undefined
    expect(resolveBtCols(undefined, null, undefined)).toBeUndefined();
  });
});

describe("resolveBtCols — HLADNI START: bridge=null, colsOverride=undefined", () => {
  it("sirina=32 (nedvoumno BT most 58mm) → 32, NE 30", () => {
    // Brez isZcsBridgeAvailable() ankete in brez colsOverride:
    // varnostna mreža zagotovi, da BT most nikoli ne dobi 30 kolon.
    expect(resolveBtCols(undefined, null, 32)).toBe(32);
  });

  it("sirina=58 (ZCS Z92) + bridge=null → undefined (→ 30 privzeto, pravilno)", () => {
    expect(resolveBtCols(undefined, null, 58)).toBeUndefined();
  });

  it("sirina=80 (ambiguozno: NB80 ali BT 80mm) + bridge=null → undefined (ne ugibamo)", () => {
    // sirina=80 je ambiguozno — rešuje colsOverride (iz PrintReceiptButton) ali bridge zaznava.
    // resolveBtCols ne ugiba, da ne bi NB80 dobil napačnih 40 kolon.
    expect(resolveBtCols(undefined, null, 80)).toBeUndefined();
  });

  it("sirina=30 (NB80 58mm) + bridge=null → undefined (pravilno, gre prek /nb80)", () => {
    expect(resolveBtCols(undefined, null, 30)).toBeUndefined();
  });
});

describe("resolveBtCols — kombinacije hladni start + colsOverride iz PrintReceiptButton", () => {
  it("hladni start + sirina=32 BT → PrintReceiptButton poda colsOverride=32 → 32", () => {
    // Ko bridge ni zaznan, PrintReceiptButton (else-veja) nastavi colsOverride=32 za sirina=32
    expect(resolveBtCols(32, null, 32)).toBe(32);
  });

  it("bridge='bt' + sirina=80 + colsOverride=40 → 40 (BT 80mm)", () => {
    // PrintReceiptButton poda colsOverride=40 ko bridge zaznano + sirina=80
    expect(resolveBtCols(40, "bt", 80)).toBe(40);
  });

  it("bridge='q10' (star APK) + sirina=80 + colsOverride=40 → 40", () => {
    expect(resolveBtCols(40, "q10", 80)).toBe(40);
  });

  it("bridge='zcs' (ZCS Z92) + sirina=58 + brez override → undefined (→ 30)", () => {
    expect(resolveBtCols(undefined, "zcs", 58)).toBeUndefined();
  });

  it("NB80 nyx pot: colsOverride=30 + sirina=30 → 30 (/nb80?cols=30)", () => {
    expect(resolveBtCols(30, null, 30)).toBe(30);
  });
});
