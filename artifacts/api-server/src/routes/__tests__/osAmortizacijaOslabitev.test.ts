/**
 * osAmortizacijaOslabitev.test.ts — Testi za oslabitev vrednosti OS (SRS 1.35+)
 *
 * PRAVILNA logika (po SRS 1.35+):
 *   - Oslabitev zmanjša knjižno vrednost: nova_knjizna = preostalo_endN − oslabitev
 *   - Preračunana nova letna AM = nova_knjizna / preostala_doba
 *   - Metoda 1 (M1): preostala_doba = max(1, celotna − pretečena)
 *   - Metoda 2 (M2): preostala_doba = user-entered nova_doba
 *   - Nova letna AM se FIKSIRA in velja za VSA naslednja leta (engine dobi oslabitevNovaLetnaAmRac)
 *   - DAV amortizacija ostane po standardni formuli (neodvisna od SRS oslabitve)
 *
 * Primer:
 *   NV = 10.000 €, stopnja = 10 %, aktivacija 2020-01-01
 *   4 pretečena leta → preostalo = 10.000 − 4.000 = 6.000 €
 *   Oslabitev 2023 = 2.400 €
 *   → nova_knjizna = 6.000 − 2.400 = 3.600 €
 *   → M1: celotna=10, pretečena=4 (2023−2020+1=4), preostala=10−4=6 let; nova AM = 3.600/6 = 600 €/leto (6%)
 *   → M2: nova_doba=3 let; nova AM = 3.600/3 = 1.200 €/leto (12%)
 */

import { describe, it, expect } from "vitest";
import {
  calcAmortizacijaObracun,
  type SredstvoInput,
} from "../osAmortizacijaEngine";
import { calcKronoloskiPregled } from "../osKronoloskiPregled";
import {
  calcMedletniSredstvo,
  type RegisterSredstvoInput,
} from "../osRegisterMedletni";

// ─── Skupni testni datum ─────────────────────────────────────────────────────

const DATUM_AKTIVACIJE_2020 = "2020-01-01";
const DATUM_AKTIVACIJE_2023 = "2023-01-01";
const NV = "10000.00";
const STOPNJA = "10.000"; // 10 %

// ─── Pomožna: sestavi standardno sredstvo ────────────────────────────────────

function makeSredstvo(extraProps: Partial<SredstvoInput> = {}): SredstvoInput {
  return {
    id: "sr-1",
    inventarnaSt: "0001",
    naziv: "Testno sredstvo",
    skupinaId: "sk-1",
    skupinaNaziv: "Stroji",
    skupinaKoda: "02",
    racunovodskaStonja: STOPNJA,
    davcnaStonja: STOPNJA,
    accountId: null,
    accountCode: null,
    accountName: null,
    costCenterId: null,
    costCenterCode: null,
    costCenterName: null,
    status: "v_uporabi",
    doknjizbe: [
      {
        id: "dk-1",
        seq: 0,
        nabavnaVrednost: NV,
        odpisanaVrednost: "0.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: DATUM_AKTIVACIJE_2023,
        datumIzpisa: null,
        status: "v_uporabi",
      },
    ],
    ...extraProps,
  };
}

// ─── Test 1: Oslabitev NE vpliva na leto N (2023) ────────────────────────────

describe("Oslabitev OS — osnovni scenarij", () => {
  it("Oslabitev ne vpliva na amortizacijo leta 2023 (ko je vnesena)", () => {
    const sr = makeSredstvo();
    const result = calcAmortizacijaObracun([sr], 2023, 12, "naslednji_dan");
    const s = result.sredstva[0];

    expect(s.skupnaObracunanaRacunovodska).toBe("1000.00");
    expect(s.skupnaOslabitev).toBe("0.00"); // oslabitev za 2023 še ni v engine inputu
    expect(s.sedanjaVrednostPoObracunu).toBe("9000.00");
  });

  it("Oslabitev 2000 € (brez novaLetnaAmRac) → oslabitev zmanjša efektivni preostali (cap), letna ostane osnova×stopnja", () => {
    // Samo oslabitevPrevLeto brez novaLetnaAmRac: stari (cap-only) način.
    // Letna = 10000 × 10% = 1000; effectivePreostalo = 7000; cap: min(1000,7000) = 1000
    const sr = makeSredstvo({
      oslabitevPrevLeto: "2000.00",
      doknjizbe: [{
        id: "dk-1", seq: 0, nabavnaVrednost: NV,
        odpisanaVrednost: "1000.00", // amort 2023 vgrajena
        neamortizljiviDelPct: "0",
        datumAktivacije: DATUM_AKTIVACIJE_2023, datumIzpisa: null, status: "v_uporabi",
      }],
    });

    const result = calcAmortizacijaObracun([sr], 2024, 12, "naslednji_dan");
    const s = result.sredstva[0];

    expect(s.skupnaPreostalo).toBe("9000.00");
    expect(s.skupnaOslabitev).toBe("2000.00");
    expect(s.skupnaObracunanaRacunovodska).toBe("1000.00"); // standardna formula
    expect(s.sedanjaVrednostPoObracunu).toBe("6000.00");
  });

  it("Oslabitev ne more biti večja od preostale vrednosti (cap na 0)", () => {
    const sr = makeSredstvo({
      oslabitevPrevLeto: "15000.00",
      doknjizbe: [{
        id: "dk-1", seq: 0, nabavnaVrednost: NV,
        odpisanaVrednost: "1000.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: DATUM_AKTIVACIJE_2023, datumIzpisa: null, status: "v_uporabi",
      }],
    });

    const result = calcAmortizacijaObracun([sr], 2024, 12, "naslednji_dan");
    const s = result.sredstva[0];

    expect(s.skupnaOslabitev).toBe("9000.00"); // cap na preostalo
    expect(s.skupnaObracunanaRacunovodska).toBe("0.00");
    expect(s.sedanjaVrednostPoObracunu).toBe("0.00");
  });

  it("Brez oslabitve: standardna formula, kompatibilnost", () => {
    const sr = makeSredstvo({
      doknjizbe: [{
        id: "dk-1", seq: 0, nabavnaVrednost: NV,
        odpisanaVrednost: "1000.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: DATUM_AKTIVACIJE_2023, datumIzpisa: null, status: "v_uporabi",
      }],
    });

    const result = calcAmortizacijaObracun([sr], 2024, 12, "naslednji_dan");
    const s = result.sredstva[0];

    expect(s.skupnaOslabitev).toBe("0.00");
    expect(s.skupnaObracunanaRacunovodska).toBe("1000.00");
    expect(s.sedanjaVrednostPoObracunu).toBe("8000.00");
  });

  it("Sorazmerna porazdelitev oslabitve po dveh doknjižbah", () => {
    const sr = makeSredstvo({
      oslabitevPrevLeto: "2000.00",
      doknjizbe: [
        { id: "dk-1", seq: 0, nabavnaVrednost: "8000.00", odpisanaVrednost: "800.00",
          neamortizljiviDelPct: "0", datumAktivacije: DATUM_AKTIVACIJE_2023, datumIzpisa: null, status: "v_uporabi" },
        { id: "dk-2", seq: 1, nabavnaVrednost: "2000.00", odpisanaVrednost: "200.00",
          neamortizljiviDelPct: "0", datumAktivacije: DATUM_AKTIVACIJE_2023, datumIzpisa: null, status: "v_uporabi" },
      ],
    });

    const result = calcAmortizacijaObracun([sr], 2024, 12, "naslednji_dan");
    const s = result.sredstva[0];

    expect(s.skupnaPreostalo).toBe("9000.00");
    expect(s.skupnaOslabitev).toBe("2000.00");
    expect(s.skupnaObracunanaRacunovodska).toBe("1000.00"); // 800 + 200
    expect(s.sedanjaVrednostPoObracunu).toBe("6000.00");
  });
});

// ─── Test 2: oslabitevNovaLetnaAmRac — nova fiksna letna AM ──────────────────
//
// Scenarij (SRS 1.35+ pravilna logika):
//   NV=10.000, stopnja=10%, aktivacija 2020-01-01
//   Zaključen obračun 2023:
//     - 4 pretečena leta, preostalo_konec_2023 = 6.000 €
//     - Oslabitev 2.400 €, nova knjižna = 3.600 €
//   M1: preostala = 10 − 4 = 6 let → nova AM = 3.600/6 = 600 €/leto (stopnja 6%)
//   M2: nova_doba = 3 let → nova AM = 3.600/3 = 1.200 €/leto (stopnja 12%)
//
// Engine test: ko je oslabitevNovaLetnaAmRac = "600.00", amort = 600 (ne 1000).

describe("Oslabitev OS — nova fiksna letna AM (SRS 1.35+ M1/M2)", () => {
  // Sredstvo: aktivirano 2020, odpisano = 4000 (4 leta × 1000)
  function makeSredstvo2024(): SredstvoInput {
    return makeSredstvo({
      doknjizbe: [{
        id: "dk-1", seq: 0, nabavnaVrednost: NV,
        odpisanaVrednost: "4000.00", // konec 2023: 4 leta amort
        neamortizljiviDelPct: "0",
        datumAktivacije: DATUM_AKTIVACIJE_2020, datumIzpisa: null, status: "v_uporabi",
      }],
    });
  }

  it("M1: engine z novaLetnaAmRac=600 → amort=600 (ne 1000)", () => {
    const sr: SredstvoInput = {
      ...makeSredstvo2024(),
      oslabitevPrevLeto: "2400.00",
      oslabitevNovaLetnaAmRac: "600.00",
    };

    const result = calcAmortizacijaObracun([sr], 2024, 12, "naslednji_dan");
    const s = result.sredstva[0];

    // skupnaPreostalo = 10000 − 4000 = 6000
    expect(s.skupnaPreostalo).toBe("6000.00");
    // oslabitevApplied = min(2400, 6000) = 2400
    expect(s.skupnaOslabitev).toBe("2400.00");
    // effectivePreostalo = 6000 − 2400 = 3600
    // novaLetnaAmRac = 600 → amort = min(600, 3600) = 600
    expect(s.skupnaObracunanaRacunovodska).toBe("600.00");
    // sedanja = 6000 − 2400 − 600 = 3000
    expect(s.sedanjaVrednostPoObracunu).toBe("3000.00");

    // Nova letna AM in stopnja v rezultatu
    expect(s.novaLetnaAmPoOslabitvi).toBe("600.00");
    expect(s.novaStopnjaPoOslabitvi).toBeDefined(); // stopnja = 600/10000×100 = 6.0000%
    expect(parseFloat(s.novaStopnjaPoOslabitvi!)).toBeCloseTo(6.0, 2);
  });

  it("M2: engine z novaLetnaAmRac=1200 → amort=1200", () => {
    const sr: SredstvoInput = {
      ...makeSredstvo2024(),
      oslabitevPrevLeto: "2400.00",
      oslabitevNovaLetnaAmRac: "1200.00",
    };

    const result = calcAmortizacijaObracun([sr], 2024, 12, "naslednji_dan");
    const s = result.sredstva[0];

    expect(s.skupnaOslabitev).toBe("2400.00");
    // effectivePreostalo = 3600, novaLetnaAmRac = 1200 → min(1200, 3600) = 1200
    expect(s.skupnaObracunanaRacunovodska).toBe("1200.00");
    // sedanja = 6000 − 2400 − 1200 = 2400
    expect(s.sedanjaVrednostPoObracunu).toBe("2400.00");

    expect(s.novaLetnaAmPoOslabitvi).toBe("1200.00");
    expect(parseFloat(s.novaStopnjaPoOslabitvi!)).toBeCloseTo(12.0, 2);
  });

  it("novaLetnaAmRac se ohrani v letu N+2 (brez nove oslabitve)", () => {
    // V letu N+2 ni novaLetnaAmRac na prevLetoMap → engine dobi samo novaLetnaAmRac iz N
    // (loading code pošlje najnovejšo vrednost). Simuliramo tako, da
    // nastavimo oslabitevPrevLeto=0 (ni oslabitve od N+1) a novaLetnaAmRac=600.
    const sr: SredstvoInput = {
      ...makeSredstvo({
        doknjizbe: [{
          id: "dk-1", seq: 0, nabavnaVrednost: NV,
          odpisanaVrednost: "5000.00", // po 4 letih + 1 leto × 600 = amort kumulativ 4600, a za test: odpisana=5000
          neamortizljiviDelPct: "0",
          datumAktivacije: DATUM_AKTIVACIJE_2020, datumIzpisa: null, status: "v_uporabi",
        }],
      }),
      oslabitevPrevLeto: "0.00",    // v letu N+2 ni nove oslabitve
      oslabitevNovaLetnaAmRac: "600.00", // nova fiksna AM se ohrani
    };

    const result = calcAmortizacijaObracun([sr], 2025, 12, "naslednji_dan");
    const s = result.sredstva[0];

    // Brez oslabitve v N+1, novaLetnaAmRac=600 → amort=600
    expect(s.skupnaOslabitev).toBe("0.00");
    expect(s.skupnaObracunanaRacunovodska).toBe("600.00");
    expect(s.novaLetnaAmPoOslabitvi).toBe("600.00");
  });

  it("novaLetnaAmRac zamenja standardno formulo (ne M1 cap-only logika)", () => {
    // Standardna formula: 10000 × 10% = 1000. Z novaLetnaAmRac=600 mora biti 600.
    const standardna = calcAmortizacijaObracun([makeSredstvo2024()], 2024, 12, "naslednji_dan");
    const z_novo = calcAmortizacijaObracun([{
      ...makeSredstvo2024(),
      oslabitevNovaLetnaAmRac: "600.00",
    }], 2024, 12, "naslednji_dan");

    // Brez novaLetnaAmRac: standardna 1000 (osnova×stopnja)
    expect(standardna.sredstva[0].skupnaObracunanaRacunovodska).toBe("1000.00");
    // Z novaLetnaAmRac: fiksna 600
    expect(z_novo.sredstva[0].skupnaObracunanaRacunovodska).toBe("600.00");
  });

  it("activationYear je prisoten v rezultatu sredstva", () => {
    const sr = makeSredstvo2024();
    const result = calcAmortizacijaObracun([sr], 2024, 12, "naslednji_dan");
    const s = result.sredstva[0];
    expect(s.activationYear).toBe(2020);
  });
});

// ─── Test 3: Kronološki pregled z oslabitivjo ─────────────────────────────────

describe("Kronološki pregled z oslabitivjo", () => {
  it("Oslabitev se prikaže kot ločena vrstica z tip=oslabitev poljem", () => {
    const doknjizbe = [{
      seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "0.00",
      datumNabave: "2023-01-01", datumAktivacije: "2023-01-01",
      status: "v_uporabi", nazivVlaganja: null,
    }];

    const obracuni = [
      { leto: 2023, doMeseca: 12, obracunano: "1000.00", status: "zakljucen", oslabitev: "2000.00" },
      { leto: 2024, doMeseca: 12, obracunano: "700.00", status: "zakljucen" },
    ];

    const pregled = calcKronoloskiPregled(doknjizbe, obracuni);

    expect(pregled).toHaveLength(4);

    const aktivacija = pregled[0];
    expect(aktivacija.opis).toBe("Aktivacija / nabava");
    expect(aktivacija.skupniPv).toBe("0.00");
    expect(aktivacija.neodpisana).toBe("10000.00");

    const amort2023 = pregled[1];
    expect(amort2023.opis).toMatch(/Letni obračun/);
    expect(amort2023.obracunanaAm).toBe("1000.00");
    expect(amort2023.skupniPv).toBe("1000.00");
    expect(amort2023.neodpisana).toBe("9000.00");

    const osl2023 = pregled[2];
    // Opis vsebuje "Oslabitev (2023, M1)"
    expect(osl2023.opis).toMatch(/^Oslabitev \(2023, M1/);
    expect(osl2023.oslabitev).toBe("2000.00");
    expect(osl2023.obracunanaAm).toBe("0.00");
    expect(osl2023.skupniPv).toBe("3000.00");
    expect(osl2023.neodpisana).toBe("7000.00");

    const amort2024 = pregled[3];
    expect(amort2024.opis).toMatch(/Letni obračun/);
    expect(amort2024.obracunanaAm).toBe("700.00");
    expect(amort2024.skupniPv).toBe("3700.00");
    expect(amort2024.neodpisana).toBe("6300.00");
  });

  it("Oslabitev z novaLetnaAmRac — opis vključuje novo AM", () => {
    const doknjizbe = [{
      seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "0.00",
      datumNabave: "2020-01-01", datumAktivacije: "2020-01-01",
      status: "v_uporabi", nazivVlaganja: null,
    }];

    const obracuni = [
      {
        leto: 2023, doMeseca: 12, obracunano: "1000.00", status: "zakljucen",
        oslabitev: "2400.00", oslabitevMetoda: 1,
        oslabitevNovaLetnaAmRac: "600.00",
      },
    ];

    const pregled = calcKronoloskiPregled(doknjizbe, obracuni);
    const oslVrstica = pregled.find((e) => e.oslabitev !== undefined);

    expect(oslVrstica).toBeDefined();
    expect(oslVrstica!.opis).toContain("M1");
    expect(oslVrstica!.opis).toContain("600");  // nova AM v opisu
  });

  it("Brez oslabitve: kronološki pregled enak kot prej", () => {
    const doknjizbe = [{
      seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "0.00",
      datumNabave: "2023-01-01", datumAktivacije: "2023-01-01",
      status: "v_uporabi", nazivVlaganja: null,
    }];

    const obracuni = [
      { leto: 2023, doMeseca: 12, obracunano: "1000.00", status: "zakljucen" },
      { leto: 2024, doMeseca: 12, obracunano: "900.00", status: "zakljucen" },
    ];

    const pregled = calcKronoloskiPregled(doknjizbe, obracuni);
    expect(pregled).toHaveLength(3);
    expect(pregled[1].skupniPv).toBe("1000.00");
    expect(pregled[2].skupniPv).toBe("1900.00");
    expect(pregled[2].neodpisana).toBe("8100.00");
  });
});

// ─── Test 4: Medletni register z oslabitivjo ─────────────────────────────────

describe("Medletni register z oslabitivjo", () => {
  it("Oslabitev leta N se prikaže v oslabiteVObdobja za leto N in poveča zacPV v letu N+1", () => {
    const obracuniPoLetih = new Map<number, string>([[2023, "1000.00"], [2024, "700.00"]]);
    const oslabitevPoLetih = new Map<number, string>([[2023, "2000.00"]]);

    const input: RegisterSredstvoInput = {
      id: "sr-1", inventarnaSt: "0001", naziv: "Test", skupinaId: "sk-1",
      status: "v_uporabi", steviloDoknjizb: 0,
      doknjizbe: [{
        id: "dk-1", seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "0.00",
        datumNabave: "2023-01-01", datumAktivacije: "2023-01-01",
      }],
      obracuniPoLetih, oslabitevPoLetih, datumOdtujitve: null,
    };

    const r = calcMedletniSredstvo(input, 2024);

    expect(r.zacNV).toBe("10000.00");
    expect(r.zacPV).toBe("3000.00"); // amort2023 + oslabitev2023
    expect(r.zacNed).toBe("7000.00");
    expect(r.amortObdobja).toBe("700.00");
    expect(r.oslabiteVObdobja).toBe("0.00");
    expect(r.konPV).toBe("3700.00");
    expect(r.konNed).toBe("6300.00");
  });

  it("Oslabitev tega leta se prikaže v oslabiteVObdobja", () => {
    const obracuniPoLetih = new Map<number, string>([[2023, "1000.00"], [2024, "700.00"]]);
    const oslabitevPoLetih = new Map<number, string>([[2023, "2000.00"], [2024, "1500.00"]]);

    const input: RegisterSredstvoInput = {
      id: "sr-1", inventarnaSt: "0001", naziv: "Test", skupinaId: "sk-1",
      status: "v_uporabi", steviloDoknjizb: 0,
      doknjizbe: [{
        id: "dk-1", seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "0.00",
        datumNabave: "2023-01-01", datumAktivacije: "2023-01-01",
      }],
      obracuniPoLetih, oslabitevPoLetih, datumOdtujitve: null,
    };

    const r = calcMedletniSredstvo(input, 2024);

    expect(r.oslabiteVObdobja).toBe("1500.00");
    expect(r.konPV).toBe("5200.00");
    expect(r.konNed).toBe("4800.00");
  });
});
