import { describe, expect, it } from "vitest";
import {
  izracunajPredvidenPrevzem,
  jeNarociloSamoPijaca,
  pickupBeverageEstimateSettingsFromMap,
  pickupEstimateSettingsFromMap,
  PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE,
  PRIVZETE_NASTAVITVE_PREVZEMA,
  samoPijace,
} from "./pos-pickup-estimate";

describe("izracunajPredvidenPrevzem", () => {
  const reference = new Date("2026-08-23T10:00:00.000Z");

  it("upošteva obremenitev odprte kuhinje, kapaciteto in najdaljšo pripravo novega naročila", () => {
    const result = izracunajPredvidenPrevzem(
      [{ casPripraveMin: 20, kolicina: 1 }, { casPripraveMin: 5, kolicina: 2 }],
      [{ casPripraveMin: 15, kolicina: 4 }],
      { osnovniCasMin: 10, cakalnaVrstaMin: 5, kapaciteta: 2, najvecCasMin: 90, zaokrozevanjeMin: 5 },
      reference,
    );

    // Čakalna vrsta: 60 / 2 = 30; novo naročilo: max(10, 20, 30 / 2) = 20; + 5 min.
    expect(result.toISOString()).toBe("2026-08-23T10:55:00.000Z");
  });

  it("uporabi varne privzete vrednosti za manjkajoče ali neveljavne nastavitve", () => {
    expect(pickupEstimateSettingsFromMap({
      telefonNarocilaKapaciteta: "0",
      telefonNarocilaNajvecCasMin: "neveljavno",
    })).toEqual(PRIVZETE_NASTAVITVE_PREVZEMA);
    expect(pickupBeverageEstimateSettingsFromMap({
      telefonNarocilaPijacaOsnovniCasMin: "0",
    })).toEqual(PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE);
  });

  it("eno pico brez vrste oceni v območju 5–10 minut", () => {
    const result = izracunajPredvidenPrevzem(
      [{ artikelId: 100, kategorijaTip: "hrana", casPripraveMin: 5, kolicina: 1 }],
      [],
      PRIVZETE_NASTAVITVE_PREVZEMA,
      new Date("2026-08-23T10:02:00.000Z"),
    );

    expect(result.toISOString()).toBe("2026-08-23T10:10:00.000Z");
  });

  it("čisto naročilo pijač uporablja le pijače iz ločene barske vrste", () => {
    const ciljnePijace = [
      { artikelId: 896, kategorijaTip: "pijaca", casPripraveMin: 0, kolicina: 2 },
      { artikelId: null, kategorijaTip: null, casPripraveMin: 0, kolicina: 2 },
    ];
    const odprtePostavke = [
      { artikelId: 10, kategorijaTip: "hrana", casPripraveMin: 30, kolicina: 4 },
      { artikelId: 11, kategorijaTip: "pijaca", casPripraveMin: 0, kolicina: 1 },
    ];

    expect(jeNarociloSamoPijaca(ciljnePijace)).toBe(true);
    expect(samoPijace(odprtePostavke)).toEqual([
      { artikelId: 11, kategorijaTip: "pijaca", casPripraveMin: 0, kolicina: 1 },
    ]);

    const result = izracunajPredvidenPrevzem(
      ciljnePijace,
      samoPijace(odprtePostavke),
      PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE,
      reference,
    );
    expect(result.toISOString()).toBe("2026-08-23T10:03:00.000Z");
  });

  it("mešano naročilo ni čisto naročilo pijač", () => {
    expect(jeNarociloSamoPijaca([
      { artikelId: 896, kategorijaTip: "pijaca", casPripraveMin: 0, kolicina: 1 },
      { artikelId: 100, kategorijaTip: "hrana", casPripraveMin: 15, kolicina: 1 },
    ])).toBe(false);
  });

  it("omeji oceno na nastavljeno največje trajanje", () => {
    const result = izracunajPredvidenPrevzem(
      [{ casPripraveMin: 100, kolicina: 10 }],
      [{ casPripraveMin: 100, kolicina: 10 }],
      { osnovniCasMin: 10, cakalnaVrstaMin: 5, kapaciteta: 1, najvecCasMin: 45, zaokrozevanjeMin: 5 },
      reference,
    );
    expect(result.toISOString()).toBe("2026-08-23T10:45:00.000Z");
  });

  it("zaokroži končni čas navzgor na nastavljen interval", () => {
    const result = izracunajPredvidenPrevzem(
      [{ casPripraveMin: 12, kolicina: 1 }],
      [],
      { osnovniCasMin: 10, cakalnaVrstaMin: 0, kapaciteta: 1, najvecCasMin: 90, zaokrozevanjeMin: 5 },
      new Date("2026-08-23T10:00:00.000Z"),
    );
    expect(result.toISOString()).toBe("2026-08-23T10:15:00.000Z");
  });

  it("pri intervalu ena ali manj ne zaokrožuje", () => {
    const result = izracunajPredvidenPrevzem(
      [],
      [],
      { osnovniCasMin: 12, cakalnaVrstaMin: 0, kapaciteta: 1, najvecCasMin: 90, zaokrozevanjeMin: 1 },
      new Date("2026-08-23T10:00:30.000Z"),
    );
    expect(result.toISOString()).toBe("2026-08-23T10:12:30.000Z");
  });
});