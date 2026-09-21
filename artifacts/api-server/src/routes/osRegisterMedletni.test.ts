/**
 * osRegisterMedletni.test.ts — Testi za medletni register OS
 *
 * Pokriva:
 *   1. razvrstiDoknjizbo: klasifikacija po datumAktivacije / datumNabave
 *   2. lastDayOfMonthIso: zadnji dan meseca
 *   3. calcMedletniSredstvo: začetno stanje, spremembe, končno stanje
 *   4. Ravnotežje seštevkov: konNV = zacNV + noveNabave; konPV = zacPV + amort
 *   5. Scenarij 0000402: 4 doknjižbe, vse pred 2024, amort 2024 = 61.97
 *   6. calcMedletniSeštevki: vsota vrstic
 *   7. Pretekli obračuni: leto 2025 vključuje obračun 2024 v začetni PV
 *   8. Nove nabave (aktivacija v letu)
 *   9. Po-letne doknjizbe: ignorirane
 */

import { describe, it, expect } from "vitest";
import {
  razvrstiDoknjizbo,
  lastDayOfMonthIso,
  calcMedletniSredstvo,
  calcMedletniSeštevki,
  emptyMedletniSeštevki,
  type RegisterSredstvoInput,
} from "./osRegisterMedletni";

// ─── razvrstiDoknjizbo ────────────────────────────────────────────────────────

describe("razvrstiDoknjizbo — klasifikacija po letu", () => {
  it("aktivacija PRED letom → pred_letom", () => {
    expect(razvrstiDoknjizbo({ datumAktivacije: "2023-12-31", datumNabave: "2023-01-01" }, 2024))
      .toBe("pred_letom");
  });

  it("aktivacija V letu → v_letu", () => {
    expect(razvrstiDoknjizbo({ datumAktivacije: "2024-06-15", datumNabave: "2024-01-01" }, 2024))
      .toBe("v_letu");
  });

  it("aktivacija začetek leta → v_letu", () => {
    expect(razvrstiDoknjizbo({ datumAktivacije: "2024-01-01", datumNabave: "2024-01-01" }, 2024))
      .toBe("v_letu");
  });

  it("aktivacija konec leta → v_letu", () => {
    expect(razvrstiDoknjizbo({ datumAktivacije: "2024-12-31", datumNabave: "2024-01-01" }, 2024))
      .toBe("v_letu");
  });

  it("aktivacija PO letu → po_letu", () => {
    expect(razvrstiDoknjizbo({ datumAktivacije: "2025-01-01", datumNabave: "2025-01-01" }, 2024))
      .toBe("po_letu");
  });

  it("brez aktivacije — datumNabave pred letom → pred_letom (rezerva)", () => {
    expect(razvrstiDoknjizbo({ datumAktivacije: null, datumNabave: "2023-05-10" }, 2024))
      .toBe("pred_letom");
  });

  it("brez aktivacije — datumNabave v letu → v_letu (rezerva)", () => {
    expect(razvrstiDoknjizbo({ datumAktivacije: null, datumNabave: "2024-03-01" }, 2024))
      .toBe("v_letu");
  });

  it("datumAktivacije ima prednost pred datumNabave", () => {
    // aktivacija 2024 (v letu), nabava 2023 → v_letu (ne pred_letom)
    expect(razvrstiDoknjizbo({ datumAktivacije: "2024-05-01", datumNabave: "2023-12-01" }, 2024))
      .toBe("v_letu");
  });
});

// ─── lastDayOfMonthIso ────────────────────────────────────────────────────────

describe("lastDayOfMonthIso — zadnji dan meseca", () => {
  it("junij 2024 → 30.06.2024", () => {
    expect(lastDayOfMonthIso(2024, 6)).toBe("2024-06-30");
  });
  it("december 2024 → 31.12.2024", () => {
    expect(lastDayOfMonthIso(2024, 12)).toBe("2024-12-31");
  });
  it("januar 2025 → 31.01.2025", () => {
    expect(lastDayOfMonthIso(2025, 1)).toBe("2025-01-31");
  });
  it("februar 2024 (prestopno) → 29.02.2024", () => {
    expect(lastDayOfMonthIso(2024, 2)).toBe("2024-02-29");
  });
  it("februar 2023 (neprestopno) → 28.02.2023", () => {
    expect(lastDayOfMonthIso(2023, 2)).toBe("2023-02-28");
  });
});

// ─── Pomožne funkcije za teste ────────────────────────────────────────────────

function makeSredstvo(
  overrides: Partial<RegisterSredstvoInput> & {
    doknjizbe?: RegisterSredstvoInput["doknjizbe"];
    obracuniPoLetih?: Map<number, string>;
  },
): RegisterSredstvoInput {
  return {
    id: "sr1",
    inventarnaSt: "0000001",
    naziv: "Testno sredstvo",
    skupinaId: null,
    status: "v_uporabi",
    steviloDoknjizb: 0,
    doknjizbe: [],
    obracuniPoLetih: new Map(),
    ...overrides,
  };
}

// ─── calcMedletniSredstvo — osnovni scenariji ─────────────────────────────────

describe("calcMedletniSredstvo — začetno stanje", () => {
  it("ena pred-letna doknjižba, brez obračunov", () => {
    const s = makeSredstvo({
      doknjizbe: [
        { id: "d1", seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "3000.00",
          datumNabave: "2020-01-01", datumAktivacije: "2020-01-01" },
      ],
    });
    const r = calcMedletniSredstvo(s, 2024);
    expect(r.zacNV).toBe("10000.00");
    expect(r.zacPV).toBe("3000.00"); // uvozena odpisana
    expect(r.zacNed).toBe("7000.00");
    expect(r.noveNabave).toBe("0.00");
    expect(r.amortObdobja).toBe("0.00");
    expect(r.konNV).toBe("10000.00");
    expect(r.konPV).toBe("3000.00");
    expect(r.konNed).toBe("7000.00");
  });

  it("ravnotežje: konNV = zacNV + noveNabave", () => {
    const s = makeSredstvo({
      doknjizbe: [
        { id: "d1", seq: 0, nabavnaVrednost: "8000.00", odpisanaVrednost: "2000.00",
          datumNabave: "2021-01-01", datumAktivacije: "2021-01-01" },
        { id: "d2", seq: 1, nabavnaVrednost: "3000.00", odpisanaVrednost: "0.00",
          datumNabave: "2024-03-01", datumAktivacije: "2024-03-01" },
      ],
      obracuniPoLetih: new Map([[2024, "800.00"]]),
    });
    const r = calcMedletniSredstvo(s, 2024);
    // zacNV = 8000 (pred letom)
    expect(r.zacNV).toBe("8000.00");
    // noveNabave = 3000 (v letu)
    expect(r.noveNabave).toBe("3000.00");
    // konNV = 8000 + 3000 = 11000
    expect(r.konNV).toBe("11000.00");
    // konNV == zacNV + noveNabave (ravnotežje)
    expect(parseFloat(r.konNV)).toBeCloseTo(parseFloat(r.zacNV) + parseFloat(r.noveNabave), 2);
  });

  it("ravnotežje: konPV = zacPV + amortObdobja", () => {
    const s = makeSredstvo({
      doknjizbe: [
        { id: "d1", seq: 0, nabavnaVrednost: "5000.00", odpisanaVrednost: "1000.00",
          datumNabave: "2022-01-01", datumAktivacije: "2022-01-01" },
      ],
      obracuniPoLetih: new Map([[2024, "500.00"]]),
    });
    const r = calcMedletniSredstvo(s, 2024);
    // zacPV = 1000 (uvozena, brez preteklih)
    expect(r.zacPV).toBe("1000.00");
    // amortObdobja = 500
    expect(r.amortObdobja).toBe("500.00");
    // konPV = 1000 + 500 = 1500
    expect(r.konPV).toBe("1500.00");
    // konPV == zacPV + amortObdobja (ravnotežje)
    expect(parseFloat(r.konPV)).toBeCloseTo(parseFloat(r.zacPV) + parseFloat(r.amortObdobja), 2);
  });
});

// ─── Scenarij 0000402 ─────────────────────────────────────────────────────────

describe("scenarij 0000402 — 4 doknjižbe, leto 2024", () => {
  /**
   * Podatki 0000402:
   *   seq=0: nab=3000, odp=3000, akt=2020-01-01 (polno odpisana)
   *   seq=1: nab=1000, odp=1000, akt=2021-01-01 (polno odpisana)
   *   seq=2: nab=500,  odp=242.01, akt=2022-01-01 (delno odpisana)
   *   seq=3: nab=500,  odp=500,  akt=2023-01-01 (polno odpisana → 0 preostanka)
   *
   * Vse so pred letom 2024.
   * zacNV = 3000+1000+500+500 = 5000
   * zacPV_uvozena = 3000+1000+242.01+500 = 4742.01
   * Brez preteklih obračunov (uvoz je bil 12/2023)
   * → zacPV = 4742.01
   * → zacNed = 5000 - 4742.01 = 257.99
   *
   * Obračun 2024 = 61.97 (iz dejanskega obračuna)
   * → konNV = 5000 + 0 = 5000
   * → konPV = 4742.01 + 61.97 = 4803.98
   * → konNed = 5000 - 4803.98 = 196.02
   */
  const sr0000402 = makeSredstvo({
    inventarnaSt: "0000402",
    doknjizbe: [
      { id: "d0", seq: 0, nabavnaVrednost: "3000.00", odpisanaVrednost: "3000.00",
        datumNabave: "2020-01-01", datumAktivacije: "2020-01-01" },
      { id: "d1", seq: 1, nabavnaVrednost: "1000.00", odpisanaVrednost: "1000.00",
        datumNabave: "2021-01-01", datumAktivacije: "2021-01-01" },
      { id: "d2", seq: 2, nabavnaVrednost: "500.00",  odpisanaVrednost: "242.01",
        datumNabave: "2022-01-01", datumAktivacije: "2022-01-01" },
      { id: "d3", seq: 3, nabavnaVrednost: "500.00",  odpisanaVrednost: "500.00",
        datumNabave: "2023-01-01", datumAktivacije: "2023-01-01" },
    ],
    obracuniPoLetih: new Map([[2024, "61.97"]]),
  });

  it("zacNV = 5000.00", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).zacNV).toBe("5000.00");
  });
  it("zacPV = 4742.01 (uvozena odpisana)", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).zacPV).toBe("4742.01");
  });
  it("zacNed = 257.99 (= register stanje pred obračunom)", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).zacNed).toBe("257.99");
  });
  it("noveNabave = 0 (ni aktivacij v 2024)", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).noveNabave).toBe("0.00");
  });
  it("amortObdobja = 61.97 (iz shranjenega obračuna)", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).amortObdobja).toBe("61.97");
  });
  it("konNV = 5000.00", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).konNV).toBe("5000.00");
  });
  it("konPV = 4803.98", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).konPV).toBe("4803.98");
  });
  it("konNed = 196.02", () => {
    expect(calcMedletniSredstvo(sr0000402, 2024).konNed).toBe("196.02");
  });
  it("ravnotežje: konNed = zacNed + noveNabave - amortObdobja", () => {
    const r = calcMedletniSredstvo(sr0000402, 2024);
    const expected = parseFloat(r.zacNed) + parseFloat(r.noveNabave) - parseFloat(r.amortObdobja);
    expect(parseFloat(r.konNed)).toBeCloseTo(expected, 2);
  });
  it("ravnotežje za 6dd84bed: zacNed + amort = konNed (sign check)", () => {
    const r = calcMedletniSredstvo(sr0000402, 2024);
    // zacNed - amort (ker amort zmanjša knjižno vrednost)
    expect(parseFloat(r.konNed)).toBeCloseTo(257.99 - 61.97, 2);
  });
});

// ─── Pretekli obračuni (leto > 2024) ─────────────────────────────────────────

describe("pretekli obračuni — začetni PV za nadaljnja leta", () => {
  /**
   * Sredstvo: nab=10000, uvozena odpisana=1000 (stanje 12/2023)
   * Obračun 2024 = 500
   * Za leto 2025:
   *   zacPV = 1000 (uvozena) + 500 (obr.2024) = 1500
   *   zacNed = 10000 - 1500 = 8500
   */
  const sr = makeSredstvo({
    doknjizbe: [
      { id: "d1", seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "1000.00",
        datumNabave: "2022-01-01", datumAktivacije: "2022-01-01" },
    ],
    obracuniPoLetih: new Map([
      [2024, "500.00"],
      [2025, "500.00"],
    ]),
  });

  it("leto 2024: zacPV = 1000 (samo uvozena, brez preteklih)", () => {
    const r = calcMedletniSredstvo(sr, 2024);
    expect(r.zacPV).toBe("1000.00");
    expect(r.zacNed).toBe("9000.00");
  });

  it("leto 2025: zacPV = 1500 (uvozena + obr.2024)", () => {
    const r = calcMedletniSredstvo(sr, 2025);
    expect(r.zacPV).toBe("1500.00");
    expect(r.zacNed).toBe("8500.00");
  });

  it("leto 2026: zacPV = 2000 (uvozena + obr.2024 + obr.2025)", () => {
    const r = calcMedletniSredstvo(sr, 2026);
    expect(r.zacPV).toBe("2000.00");
    expect(r.zacNed).toBe("8000.00");
  });

  it("amortObdobja tekoče leto se ne prišteje k začetnemu PV", () => {
    // Za leto 2025: obracun 2025 (500) NE sme biti v zacPV
    const r = calcMedletniSredstvo(sr, 2025);
    expect(r.zacPV).toBe("1500.00"); // ne 2000
    expect(r.amortObdobja).toBe("500.00");
  });
});

// ─── Nove nabave in po-letne doknjižbe ───────────────────────────────────────

describe("nove nabave in po-letne doknjizbe", () => {
  it("doknjižba aktivirana V letu: NV gre v noveNabave, ne v zacNV", () => {
    const s = makeSredstvo({
      doknjizbe: [
        { id: "d1", seq: 0, nabavnaVrednost: "5000.00", odpisanaVrednost: "1000.00",
          datumNabave: "2020-01-01", datumAktivacije: "2020-01-01" },
        { id: "d2", seq: 1, nabavnaVrednost: "2000.00", odpisanaVrednost: "0.00",
          datumNabave: "2024-06-01", datumAktivacije: "2024-06-01" },
      ],
    });
    const r = calcMedletniSredstvo(s, 2024);
    expect(r.zacNV).toBe("5000.00"); // samo pred-letna
    expect(r.noveNabave).toBe("2000.00"); // v-letna
    expect(r.konNV).toBe("7000.00"); // skupaj
  });

  it("po-letna doknjižba: ignorirana (ne v zacNV, ne v noveNabave)", () => {
    const s = makeSredstvo({
      doknjizbe: [
        { id: "d1", seq: 0, nabavnaVrednost: "3000.00", odpisanaVrednost: "500.00",
          datumNabave: "2023-01-01", datumAktivacije: "2023-01-01" },
        { id: "d2", seq: 1, nabavnaVrednost: "8000.00", odpisanaVrednost: "0.00",
          datumNabave: "2025-01-01", datumAktivacije: "2025-01-01" },
      ],
    });
    const r = calcMedletniSredstvo(s, 2024);
    expect(r.zacNV).toBe("3000.00"); // samo pred-letna
    expect(r.noveNabave).toBe("0.00"); // po-letna ignorirana
    expect(r.konNV).toBe("3000.00");
  });

  it("neaktivirana (v_teku) doknjižba z datumNabave v letu → noveNabave", () => {
    const s = makeSredstvo({
      doknjizbe: [
        { id: "d1", seq: 0, nabavnaVrednost: "4000.00", odpisanaVrednost: "0.00",
          datumNabave: "2024-04-01", datumAktivacije: null },
      ],
    });
    const r = calcMedletniSredstvo(s, 2024);
    // datumAktivacije null → rezerva = datumNabave 2024 → v_letu
    expect(r.noveNabave).toBe("4000.00");
    expect(r.zacNV).toBe("0.00");
  });
});

// ─── calcMedletniSeštevki ──────────────────────────────────────────────────────

describe("calcMedletniSeštevki — seštevki vrstic", () => {
  it("prazno → vse nič", () => {
    const s = calcMedletniSeštevki([]);
    expect(s.zacNV).toBe("0.00");
    expect(s.konNed).toBe("0.00");
  });

  it("sešteje vse vrednosti pravilno", () => {
    const vr1 = calcMedletniSredstvo(
      makeSredstvo({
        id: "sr1",
        doknjizbe: [{ id: "d1", seq: 0, nabavnaVrednost: "10000.00", odpisanaVrednost: "3000.00",
          datumNabave: "2020-01-01", datumAktivacije: "2020-01-01" }],
        obracuniPoLetih: new Map([[2024, "200.00"]]),
      }),
      2024,
    );
    const vr2 = calcMedletniSredstvo(
      makeSredstvo({
        id: "sr2",
        doknjizbe: [{ id: "d2", seq: 0, nabavnaVrednost: "5000.00", odpisanaVrednost: "1000.00",
          datumNabave: "2021-01-01", datumAktivacije: "2021-01-01" }],
        obracuniPoLetih: new Map([[2024, "100.00"]]),
      }),
      2024,
    );
    const s = calcMedletniSeštevki([vr1, vr2]);
    // zacNV: 10000 + 5000 = 15000
    expect(s.zacNV).toBe("15000.00");
    // zacPV: 3000 + 1000 = 4000
    expect(s.zacPV).toBe("4000.00");
    // zacNed: 7000 + 4000 = 11000
    expect(s.zacNed).toBe("11000.00");
    // amortObdobja: 200 + 100 = 300
    expect(s.amortObdobja).toBe("300.00");
    // konPV: (3000+200) + (1000+100) = 3200 + 1100 = 4300
    expect(s.konPV).toBe("4300.00");
    // konNed: (7000-200) + (4000-100) = 6800 + 3900 = 10700
    expect(s.konNed).toBe("10700.00");
  });

  it("seštevki konzistentni: konNV = zacNV + noveNabave (za vse vrstice skupaj)", () => {
    const vr1 = calcMedletniSredstvo(
      makeSredstvo({
        id: "sr1",
        doknjizbe: [
          { id: "d1", seq: 0, nabavnaVrednost: "8000.00", odpisanaVrednost: "2000.00",
            datumNabave: "2021-01-01", datumAktivacije: "2021-01-01" },
          { id: "d2", seq: 1, nabavnaVrednost: "3000.00", odpisanaVrednost: "0.00",
            datumNabave: "2024-01-01", datumAktivacije: "2024-01-01" },
        ],
      }),
      2024,
    );
    const s = calcMedletniSeštevki([vr1]);
    expect(parseFloat(s.konNV))
      .toBeCloseTo(parseFloat(s.zacNV) + parseFloat(s.noveNabave), 2);
    expect(parseFloat(s.konPV))
      .toBeCloseTo(parseFloat(s.zacPV) + parseFloat(s.amortObdobja), 2);
  });

  it("emptyMedletniSeštevki: vse '0.00'", () => {
    const e = emptyMedletniSeštevki();
    expect(e.zacNV).toBe("0.00");
    expect(e.konNed).toBe("0.00");
    expect(e.izlocitveNV).toBe("0.00");
  });
});

// ─── calcMedletniSredstvo — odtujitev v letu registra ────────────────────────

describe("calcMedletniSredstvo — odtujitev v letu (datumOdtujitve)", () => {
  /**
   * Sredstvo nabavljeno 1.1.2024, NV = 10 000 €, AM stopnja 10 %/leto.
   * Obračuni: 2024 = 1 000 €, 2025 = 1 000 €, 2026 = 750 € (9 mes., jan–sep).
   * Odtujitev: 15.10.2026 → izlocitvePV = zacPV(2026) + amort(2026) = 2000 + 750 = 2750.
   */
  const baseDoknjizba = {
    id: "d1",
    seq: 0,
    nabavnaVrednost: "10000.00",
    odpisanaVrednost: "0",
    datumNabave: "2024-01-01",
    datumAktivacije: "2024-01-01",
  };
  const obracuniPoLetih2026 = new Map<number, string>([
    [2024, "1000.00"],
    [2025, "1000.00"],
    [2026, "750.00"],
  ]);

  const sredstvoInput: RegisterSredstvoInput = {
    id: "s1",
    inventarnaSt: "0001",
    naziv: "Test stroj",
    skupinaId: null,
    status: "v_uporabi",
    steviloDoknjizb: 0,
    datumOdtujitve: "2026-10-15",
    doknjizbe: [baseDoknjizba],
    obracuniPoLetih: obracuniPoLetih2026,
  };

  const r = calcMedletniSredstvo(sredstvoInput, 2026);

  it("zacNV = 10 000 (vse pred letom)", () => {
    expect(r.zacNV).toBe("10000.00");
  });

  it("zacPV = 2 000 (obračuna 2024 + 2025)", () => {
    expect(r.zacPV).toBe("2000.00");
  });

  it("amortObdobja = 750 (9 mesecev jan–sep 2026)", () => {
    expect(r.amortObdobja).toBe("750.00");
  });

  it("izlocitveNV = skupna NV = 10 000", () => {
    expect(r.izlocitveNV).toBe("10000.00");
  });

  it("izlocitvePV = zacPV + amortObdobja = 2 750", () => {
    expect(r.izlocitvePV).toBe("2750.00");
  });

  it("konNV = 0 (razknjiženo)", () => {
    expect(r.konNV).toBe("0.00");
  });

  it("konPV = 0 (razknjiženo)", () => {
    expect(r.konPV).toBe("0.00");
  });

  it("konNed = 0 (razknjiženo)", () => {
    expect(r.konNed).toBe("0.00");
  });

  it("odtujitev v prihodnosti (2027) → NO izlocitve v registru 2026", () => {
    const future: RegisterSredstvoInput = { ...sredstvoInput, datumOdtujitve: "2027-03-01" };
    const rFuture = calcMedletniSredstvo(future, 2026);
    expect(rFuture.izlocitveNV).toBe("0.00");
    expect(parseFloat(rFuture.konNV)).toBeGreaterThan(0);
  });

  it("ni datumOdtujitve → izlocitveNV = 0 (navadno sredstvo)", () => {
    const noDisposal: RegisterSredstvoInput = { ...sredstvoInput, datumOdtujitve: null };
    const rNone = calcMedletniSredstvo(noDisposal, 2026);
    expect(rNone.izlocitveNV).toBe("0.00");
    expect(parseFloat(rNone.konNV)).toBeGreaterThan(0);
  });
});
