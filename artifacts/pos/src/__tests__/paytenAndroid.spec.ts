/**
 * Testi za Payten Android Software APK integracijo.
 *
 * Preverja:
 *   1. Callback z resultCode=0 (uspeh) → account se samodejno izda (tip="uspeh")
 *   2. Callback z resultCode!=0 (napaka) → račun se ne izda, napaka se sporoči
 *   3. Callback brez resultCode (fail-safe) → račun se ne izda, sporoči se brez potrditve
 *   4. URL brez ?paytenAndroid=1 → ni Payten callback (ni_callback)
 *   5. Manjkajoč storedNarociloId → ne moremo obnoviti naročila (ni_callback)
 *   6. Prioritetna veriga: HW → Android SW → SumUp → Viva Cloud → Viva Android → Viva TtP → Viva Smart
 *   7. Per-naprava override zamenja globalno verigo
 *
 * Testi so čisti unit testi brez React ali DOM — samo logika v paytenAndroid.ts.
 */

import { describe, it, expect } from "vitest";
import {
  parsePaytenAndroidCallback,
  izracunajAktivniTerminal,
  type PaytenAndroidCallbackRezultat,
  type NastavitveTerminal,
  type NapravaTerminalOverride,
} from "../lib/paytenAndroid";

// ---------------------------------------------------------------------------
// Pomožne funkcije
// ---------------------------------------------------------------------------

function params(kvPari: Record<string, string>): URLSearchParams {
  return new URLSearchParams(kvPari);
}

// ---------------------------------------------------------------------------
// parsePaytenAndroidCallback — testi
// ---------------------------------------------------------------------------

describe("parsePaytenAndroidCallback — zaznavanje callback URL-ja iz Payten APK", () => {

  describe("1. resultCode=0 (uspešno plačilo)", () => {
    it("vrne tip='uspeh' in narociloId kadar APK sporoči uspeh", () => {
      const searchParams = params({ paytenAndroid: "1", resultCode: "0", narocilo: "42" });
      const rezultat: PaytenAndroidCallbackRezultat = parsePaytenAndroidCallback(searchParams, "42");
      expect(rezultat.tip).toBe("uspeh");
      if (rezultat.tip === "uspeh") {
        expect(rezultat.narociloId).toBe(42);
      }
    });

    it("narociloId se vzame iz sessionStorage, ne iz URL parametrov", () => {
      const searchParams = params({ paytenAndroid: "1", resultCode: "0" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "99");
      expect(rezultat.tip).toBe("uspeh");
      if (rezultat.tip === "uspeh") {
        expect(rezultat.narociloId).toBe(99);
      }
    });
  });

  describe("2. resultCode!=0 (napaka iz APK)", () => {
    it("vrne tip='napaka' in sporocilo z kodo kadar APK vrne nekoda 0", () => {
      const searchParams = params({ paytenAndroid: "1", resultCode: "5" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "42");
      expect(rezultat.tip).toBe("napaka");
      if (rezultat.tip === "napaka") {
        expect(rezultat.napakaSporocilo).toContain("koda 5");
      }
    });

    it("sporocilo z napako vsebuje posredovano kodo napake", () => {
      const searchParams = params({ paytenAndroid: "1", resultCode: "99" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "1");
      expect(rezultat.tip).toBe("napaka");
      if (rezultat.tip === "napaka") {
        expect(rezultat.napakaSporocilo).toContain("koda 99");
        expect(rezultat.napakaSporocilo).toMatch(/Payten Android/);
      }
    });

    it("negativna koda napake se pravilno vključi v sporocilo", () => {
      const searchParams = params({ paytenAndroid: "1", resultCode: "-1" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "7");
      expect(rezultat.tip).toBe("napaka");
      if (rezultat.tip === "napaka") {
        expect(rezultat.napakaSporocilo).toContain("koda -1");
      }
    });
  });

  describe("3. Manjkajoč resultCode — fail-safe", () => {
    it("vrne tip='brez_potrditve' kadar APK ne vrne resultCode (fail-safe)", () => {
      const searchParams = params({ paytenAndroid: "1" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "42");
      expect(rezultat.tip).toBe("brez_potrditve");
    });

    it("fail-safe velja tudi kadar so prisotni drugi parametri brez resultCode", () => {
      const searchParams = params({
        paytenAndroid: "1",
        transactionId: "TXN123",
        merchantReference: "REF456",
      });
      const rezultat = parsePaytenAndroidCallback(searchParams, "10");
      expect(rezultat.tip).toBe("brez_potrditve");
    });
  });

  describe("4. Ni Payten callback — ignoriranje URL-ja", () => {
    it("vrne tip='ni_callback' kadar ?paytenAndroid ni '1'", () => {
      const searchParams = params({ narocilo: "42" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "42");
      expect(rezultat.tip).toBe("ni_callback");
    });

    it("vrne tip='ni_callback' kadar je paytenAndroid='0'", () => {
      const searchParams = params({ paytenAndroid: "0", resultCode: "0" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "42");
      expect(rezultat.tip).toBe("ni_callback");
    });

    it("vrne tip='ni_callback' kadar je paytenAndroid prisoten, a storedNarociloId je null", () => {
      const searchParams = params({ paytenAndroid: "1", resultCode: "0" });
      const rezultat = parsePaytenAndroidCallback(searchParams, null);
      expect(rezultat.tip).toBe("ni_callback");
    });

    it("vrne tip='ni_callback' kadar storedNarociloId ni veljavno število", () => {
      const searchParams = params({ paytenAndroid: "1", resultCode: "0" });
      const rezultat = parsePaytenAndroidCallback(searchParams, "ni_stevilo");
      expect(rezultat.tip).toBe("ni_callback");
    });
  });
});

// ---------------------------------------------------------------------------
// izracunajAktivniTerminal — testi prioritetne verige
// ---------------------------------------------------------------------------

describe("izracunajAktivniTerminal — prioritetna veriga terminalov", () => {

  describe("6. Globalna prioritetna veriga (napravaTerminal = null)", () => {
    it("HW terminal (Payten TCP) ima prednost pred vsemi drugimi", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: true,
        paytenAndroidAktiven: true,
        sumupAktiven: true,
        vivaAktiven: true,
      };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("payten_hw");
    });

    it("Payten Android SW je aktiven kadar HW terminal ni aktiven", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: false,
        paytenAndroidAktiven: true,
        sumupAktiven: true,
      };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("payten_android");
    });

    it("SumUp je aktiven kadar HW in Android SW nista aktivna", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: false,
        paytenAndroidAktiven: false,
        sumupAktiven: true,
        vivaAktiven: true,
      };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("sumup");
    });

    it("Viva Cloud terminal je aktiven kadar so HW, Android SW in SumUp neaktivni", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: false,
        paytenAndroidAktiven: false,
        sumupAktiven: false,
        vivaTerminalAktiven: true,
        vivaAktiven: true,
      };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("viva_cloud");
    });

    it("Viva Android terminal pride po Viva Cloud v prioritetni verigi", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: false,
        paytenAndroidAktiven: false,
        sumupAktiven: false,
        vivaTerminalAktiven: false,
        vivaAndroidTerminalAktiven: true,
        vivaAktiven: true,
      };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("viva_android");
    });

    it("Viva Tap to Pay pride za Viva Android", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: false,
        paytenAndroidAktiven: false,
        sumupAktiven: false,
        vivaTerminalAktiven: false,
        vivaAndroidTerminalAktiven: false,
        vivaTapToPayAktiven: true,
        vivaAktiven: true,
      };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("viva_ttp");
    });

    it("Viva Smart (spletni) je zadnji v verigi", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: false,
        paytenAndroidAktiven: false,
        sumupAktiven: false,
        vivaTerminalAktiven: false,
        vivaAndroidTerminalAktiven: false,
        vivaTapToPayAktiven: false,
        vivaAktiven: true,
      };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("viva_smart");
    });

    it("vrne 'brez_terminala' kadar ni nobenega terminala aktivnega", () => {
      expect(izracunajAktivniTerminal({}, null)).toBe("brez_terminala");
      expect(izracunajAktivniTerminal(null, null)).toBe("brez_terminala");
    });

    it("HW terminal blokira Payten Android SW v globalni verigi", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: true,
        paytenAndroidAktiven: true,
      };
      const rezultat = izracunajAktivniTerminal(nastavitve, null);
      expect(rezultat).toBe("payten_hw");
      expect(rezultat).not.toBe("payten_android");
    });

    it("Payten Android SW blokira SumUp v globalni verigi", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: false,
        paytenAndroidAktiven: true,
        sumupAktiven: true,
      };
      const rezultat = izracunajAktivniTerminal(nastavitve, null);
      expect(rezultat).toBe("payten_android");
      expect(rezultat).not.toBe("sumup");
    });
  });

  describe("7. Per-naprava override zamenja globalno verigo", () => {
    it("override 'payten_android' aktivira Payten Android ne glede na globalne nastavitve", () => {
      const nastavitve: NastavitveTerminal = {
        terminalAktiven: true,
        paytenAndroidAktiven: false,
        sumupAktiven: true,
      };
      const override: NapravaTerminalOverride = "payten_android";
      expect(izracunajAktivniTerminal(nastavitve, override)).toBe("payten_android");
    });

    it("override 'payten_hw' vrne payten_hw ne glede na nastavitve", () => {
      expect(izracunajAktivniTerminal({ paytenAndroidAktiven: true }, "payten_hw")).toBe("payten_hw");
    });

    it("override 'sumup' vrne sumup ne glede na nastavitve", () => {
      expect(izracunajAktivniTerminal({ terminalAktiven: true }, "sumup")).toBe("sumup");
    });

    it("override 'viva_android' vrne viva_android", () => {
      expect(izracunajAktivniTerminal({}, "viva_android")).toBe("viva_android");
    });

    it("override 'viva_ttp' vrne viva_ttp", () => {
      expect(izracunajAktivniTerminal({}, "viva_ttp")).toBe("viva_ttp");
    });

    it("override 'none' onemogoči terminal za to napravo (globalna veriga se ignorira)", () => {
      const nastavitve: NastavitveTerminal = { paytenAndroidAktiven: true, terminalAktiven: true };
      // Ko je naprava nastavljena na "brez terminala", nobena globalna nastavitev ne sme aktivirati terminala
      expect(izracunajAktivniTerminal(nastavitve, "none")).toBe("brez_terminala");
    });

    it("null (brez overrida) uporablja globalno verigo", () => {
      const nastavitve: NastavitveTerminal = { sumupAktiven: true };
      expect(izracunajAktivniTerminal(nastavitve, null)).toBe("sumup");
    });
  });
});
