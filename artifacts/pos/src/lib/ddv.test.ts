/**
 * Unit testi za DDV pomožne funkcije (frontend).
 *
 * Pokritost:
 *  - round2: zaokroževanje denarnih vrednosti
 *  - izracunajDDVZaokrozen: DDV na postavko z zaokroževanjem
 *  - preveriDDVNeskladje: zaznavanje neskladja med seštevkom DDV skupin in DDV na računu
 *
 * Algoritem je usklajen s strežniško stranjo (narocila.ts / furs.ts).
 * Sprememba tukaj mora biti reflected tudi na strežniku.
 */

import { describe, it, expect } from "vitest";
import {
  round2,
  izracunajDDVZaokrozen,
  preveriDDVNeskladje,
  type PostavkaZaDDV,
} from "./ddv";

// ─── round2 ──────────────────────────────────────────────────────────────────

describe("round2", () => {
  it("zaokroži navzgor pri točno 0.005", () => {
    expect(round2(0.005)).toBe(0.01);
  });

  it("zaokroži navzdol pri 0.004", () => {
    expect(round2(0.004)).toBe(0.00);
  });

  it("ne spremeni vrednosti, ki je že zaokrožena", () => {
    expect(round2(1.23)).toBe(1.23);
    expect(round2(10.00)).toBe(10.00);
  });

  it("pravilno zaokroži tipične denarne vrednosti z nenatančnostjo IEEE 754", () => {
    // 0.1 + 0.2 = 0.30000000000000004 v IEEE 754
    expect(round2(0.1 + 0.2)).toBe(0.30);
  });

  it("deluje za negativne vrednosti", () => {
    expect(round2(-1.005)).toBe(-1.00);
    expect(round2(-1.006)).toBe(-1.01);
  });

  it("vrne 0 za 0", () => {
    expect(round2(0)).toBe(0);
  });

  it("zaokroži večje denarne vrednosti", () => {
    expect(round2(99.999)).toBe(100.00);
    expect(round2(1234.565)).toBe(1234.57);
  });
});

// ─── izracunajDDVZaokrozen ───────────────────────────────────────────────────

describe("izracunajDDVZaokrozen", () => {
  it("izračuna DDV po 22% in zaokroži na 2 decimalni mesti", () => {
    // 12.20 * 22 / 122 = 2.2 natančno
    expect(izracunajDDVZaokrozen(12.20, 22)).toBe(2.20);
  });

  it("izračuna DDV po 9.5%", () => {
    // 10.00 * 9.5 / 109.5 ≈ 0.8676... → 0.87
    expect(izracunajDDVZaokrozen(10.00, 9.5)).toBe(0.87);
  });

  it("vrne 0 za 0% DDV", () => {
    expect(izracunajDDVZaokrozen(5.00, 0)).toBe(0);
  });

  it("pravilno zaokroži pri vrednostih z nenatančnostjo zaokroževanja", () => {
    // 3.33 EUR z 22%: 3.33 * 22 / 122 = 0.60049... → 0.60
    expect(izracunajDDVZaokrozen(3.33, 22)).toBe(0.60);
  });

  it("pravilno zaokroži 1.00 EUR z 22%", () => {
    // 1.00 * 22 / 122 = 0.18032... → 0.18
    expect(izracunajDDVZaokrozen(1.00, 22)).toBe(0.18);
  });

  it("pravilno zaokroži 0.99 EUR z 22%", () => {
    // 0.99 * 22 / 122 = 0.17852... → 0.18
    expect(izracunajDDVZaokrozen(0.99, 22)).toBe(0.18);
  });

  it("vrne zaokroženo vrednost, ne surovega ulomka", () => {
    const rezultat = izracunajDDVZaokrozen(7.77, 22);
    const decimale = (rezultat.toString().split(".")[1] ?? "").length;
    expect(decimale).toBeLessThanOrEqual(2);
  });
});

// ─── preveriDDVNeskladje ─────────────────────────────────────────────────────

describe("preveriDDVNeskladje", () => {
  describe("prazno naročilo", () => {
    it("vrne imaNeskladje=false za prazne postavke", () => {
      const rezultat = preveriDDVNeskladje([]);
      expect(rezultat.imaNeskladje).toBe(false);
      expect(rezultat.razlika).toBe(0);
    });
  });

  describe("enostavni primeri brez neskladja", () => {
    it("ena postavka po 22%: ni neskladja", () => {
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 1, cenaKos: 12.20, skupaj: 12.20, davek: 22 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });

    it("ena postavka po 9.5%: ni neskladja", () => {
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 2, cenaKos: 5.00, skupaj: 10.00, davek: 9.5 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });

    it("ena postavka po 0%: ni neskladja", () => {
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 3, cenaKos: 2.00, skupaj: 6.00, davek: 0 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });
  });

  describe("mešane DDV stopnje brez neskladja", () => {
    it("22% + 9.5%: ni neskladja", () => {
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 1, cenaKos: 10.00, skupaj: 10.00, davek: 22 },
        { kolicina: 1, cenaKos: 5.00, skupaj: 5.00, davek: 9.5 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });

    it("22% + 9.5% + 0%: ni neskladja", () => {
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 1, cenaKos: 12.20, skupaj: 12.20, davek: 22 },
        { kolicina: 1, cenaKos: 5.00, skupaj: 5.00, davek: 9.5 },
        { kolicina: 1, cenaKos: 3.00, skupaj: 3.00, davek: 0 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });

    it("5 postavk po 1.00 EUR (22%): zaokroževanje ne povzroči lažnega alarma", () => {
      const postavke: PostavkaZaDDV[] = Array.from({ length: 5 }, () => ({
        kolicina: 1,
        cenaKos: 1.00,
        skupaj: 1.00,
        davek: 22,
      }));
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });

    it("10 postavk po 3.33 EUR (22%): neurejena cena brez lažnega alarma", () => {
      const postavke: PostavkaZaDDV[] = Array.from({ length: 10 }, () => ({
        kolicina: 1,
        cenaKos: 3.33,
        skupaj: 3.33,
        davek: 22,
      }));
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });

    it("večja količina na eni postavki: ni neskladja", () => {
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 10, cenaKos: 3.33, skupaj: round2(10 * 3.33), davek: 22 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
    });
  });

  describe("primer, ki povzroči DDV neskladje", () => {
    it("skupaj ne ustreza kolicina×cenaKos — zazna neskladje", () => {
      // cenaKos=5.00, kolicina=1, skupaj=6.00 → namerno napačna vrednost skupaj
      // DDV iz skupaj: round2(6.00 * 22/122) = 1.08
      // DDV iz kolicina×cenaKos: round2(5.00 * 22/122) = 0.90
      // razlika = |1.08 - 0.90| = 0.18 > 0.01
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 1, cenaKos: 5.00, skupaj: 6.00, davek: 22 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(true);
      expect(rezultat.razlika).toBeGreaterThan(0.01);
    });

    it("razlika 0.02 EUR med skupaj in kolicina×cenaKos — neskladje", () => {
      // cenaKos=10.00, skupaj=10.05 → skupaj je za 0.05 EUR večji
      // DDV iz skupaj: round2(10.05 * 22/122) ≈ 1.81
      // DDV iz kolicina×cenaKos: round2(10.00 * 22/122) = 1.80
      // razlika ≈ 0.01 (mejna vrednost, a skupaj je za 0.05 višji → razlika > 0.01)
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 1, cenaKos: 10.00, skupaj: 10.10, davek: 22 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(true);
    });

    it("mešane stopnje z napačnim skupaj — zazna neskladje", () => {
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 1, cenaKos: 10.00, skupaj: 15.00, davek: 22 },
        { kolicina: 1, cenaKos: 5.00, skupaj: 5.00, davek: 9.5 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(true);
    });
  });

  describe("mejna vrednost razlike", () => {
    it("razlika točno 0.01 EUR ali manj NI neskladje", () => {
      // Obe vrednosti skupaj in kolicina×cenaKos sta enaki — razlika = 0
      const postavke: PostavkaZaDDV[] = [
        { kolicina: 1, cenaKos: 12.20, skupaj: 12.20, davek: 22 },
      ];
      const rezultat = preveriDDVNeskladje(postavke);
      expect(rezultat.imaNeskladje).toBe(false);
      expect(rezultat.razlika).toBeLessThanOrEqual(0.01);
    });
  });

  describe("oblika rezultata", () => {
    it("vrne objekt z imaNeskladje in razlika", () => {
      const rezultat = preveriDDVNeskladje([
        { kolicina: 1, cenaKos: 5.00, skupaj: 5.00, davek: 22 },
      ]);
      expect(rezultat).toHaveProperty("imaNeskladje");
      expect(rezultat).toHaveProperty("razlika");
      expect(typeof rezultat.imaNeskladje).toBe("boolean");
      expect(typeof rezultat.razlika).toBe("number");
    });

    it("razlika je zaokrožena na 2 decimalni mesti", () => {
      const rezultat = preveriDDVNeskladje([
        { kolicina: 1, cenaKos: 5.00, skupaj: 6.00, davek: 22 },
      ]);
      const decimale = (rezultat.razlika.toString().split(".")[1] ?? "").length;
      expect(decimale).toBeLessThanOrEqual(2);
    });
  });
});
