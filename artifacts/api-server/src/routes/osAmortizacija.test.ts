/**
 * osAmortizacija.test.ts — Unit testi za amortizacijski obračun OS (Faza 3c)
 *
 * Testira:
 * - calcMeseci: mesečno angažiranje (aktivacija julija → 6 mesecev)
 * - calcOsnova: neamortizljivi del (osnova = nabavna × (100−pct)/100)
 * - calcObracunana: ustavitev pri polni odpisanosti
 * - calcAmortizacijaObracun: agregacija doknjižb (bazen 0000402 = Σ 4 doknjižb)
 * - sredstvo brez skupine → označeno, amortizacija 0
 * - dolimitiraj na preostalo
 */

import { describe, it, expect } from "vitest";
import {
  calcMeseci,
  calcOsnova,
  calcLetna,
  calcObracunana,
  calcAmortizacijaObracun,
  type SredstvoInput,
} from "./osAmortizacijaEngine";

// ─── calcMeseci — mesečno angažiranje ────────────────────────────────────────

describe("calcMeseci — mesečno angažiranje", () => {
  it("brez datumAktivacije → 0 mesecev", () => {
    expect(calcMeseci(null, null, 2024)).toBe(0);
  });

  it("aktivacija 2024-07-01 → 6 mesecev (jul–dec): prviDan=2.7 → jul, start=7", () => {
    // +1 dan = 2024-07-02 → mesec julij → 12-7+1=6
    expect(calcMeseci("2024-07-01", null, 2024)).toBe(6);
  });

  it("aktivacija 2024-01-01 → 12 mesecev (jan–dec): prviDan=2.1 → jan, start=1", () => {
    // +1 dan = 2024-01-02 → mesec januar → 12-1+1=12
    expect(calcMeseci("2024-01-01", null, 2024)).toBe(12);
  });

  it("aktivacija 2024-12-01 → 1 mesec (dec): prviDan=2.12 → dec, start=12", () => {
    // +1 dan = 2024-12-02 → mesec december → 12-12+1=1
    expect(calcMeseci("2024-12-01", null, 2024)).toBe(1);
  });

  it("aktivacija pred letom obračuna → 12 mesecev", () => {
    expect(calcMeseci("2020-03-15", null, 2024)).toBe(12);
  });

  it("aktivacija po koncu leta → 0 mesecev", () => {
    expect(calcMeseci("2025-01-01", null, 2024)).toBe(0);
  });

  it("izpis v letu obračuna (april 30.) → jan–mar = 3 mesece (mesec april se NE šteje — SRS/ZDDPO-2)", () => {
    // endMonth = april − 1 = 3 → 3 mesece (jan, feb, mar)
    expect(calcMeseci("2022-06-01", "2024-04-30", 2024)).toBe(3);
  });

  it("izpis pred letom obračuna → 0 mesecev", () => {
    expect(calcMeseci("2020-01-01", "2023-12-31", 2024)).toBe(0);
  });

  it("izpis po koncu leta → 12 mesecev (ignoriramo prihodnji izpis)", () => {
    expect(calcMeseci("2022-01-01", "2025-06-01", 2024)).toBe(12);
  });

  it("aktivacija julija 2024 + izpis 15.10.2024 → 3 mesece (jul–sep): okt mesec odtujitve se NE šteje", () => {
    // prviDan = 2024-07-02 → startMonth=7; endMonth = okt−1 = 9 → 9−7+1 = 3
    expect(calcMeseci("2024-07-01", "2024-10-15", 2024)).toBe(3);
  });
});

// ─── calcMeseci — mesec odtujitve se NE šteje (SRS/ZDDPO-2) ──────────────────

describe("calcMeseci — datum odtujitve (mesec odtujitve se NE šteje)", () => {
  it("odtujitev 15.10.2026, aktivirano pred letom → 9 mesecev (jan–sep)", () => {
    // endMonth = 10 − 1 = 9 → 9 mesecev
    expect(calcMeseci("2024-01-01", "2026-10-15", 2026)).toBe(9);
  });

  it("odtujitev 01.01.2026 → 0 mesecev (januar je mesec odtujitve, se ne šteje)", () => {
    // endMonth = 1 − 1 = 0 → Math.max(0, 0 − 1 + 1) = 0
    expect(calcMeseci("2024-01-01", "2026-01-01", 2026)).toBe(0);
  });

  it("odtujitev 31.12.2026 → 11 mesecev (december se ne šteje)", () => {
    // endMonth = 12 − 1 = 11 → 11 mesecev (jan–nov)
    expect(calcMeseci("2024-01-01", "2026-12-31", 2026)).toBe(11);
  });

  it("odtujitev 01.02.2026 → 1 mesec (samo januar)", () => {
    // endMonth = 2 − 1 = 1 → 1 − 1 + 1 = 1
    expect(calcMeseci("2024-01-01", "2026-02-01", 2026)).toBe(1);
  });

  it("odtujitev julija, aktivacija maja istega leta → 2 meseca (maj, jun)", () => {
    // prviDan: 2026-05-01 + 1 dan = maj → startMonth=5; endMonth = 7−1 = 6 → 6−5+1=2
    expect(calcMeseci("2026-05-01", "2026-07-15", 2026)).toBe(2);
  });

  it("odtujitev pred letom → 0 mesecev", () => {
    expect(calcMeseci("2024-01-01", "2025-12-31", 2026)).toBe(0);
  });
});

// ─── calcOsnova — neamortizljivi del ─────────────────────────────────────────

describe("calcOsnova — neamortizljivi del", () => {
  it("pct=0: cela nabavna vrednost je osnova", () => {
    expect(calcOsnova("100000.00", "0")).toBe("100000.00");
  });

  it("pct=100: nič ni amortizirljivo (npr. zemljišče)", () => {
    expect(calcOsnova("50000.00", "100")).toBe("0.00");
  });

  it("pct=50: polovica je amortizirljiva", () => {
    expect(calcOsnova("20000.00", "50")).toBe("10000.00");
  });

  it("pct=25: 75 % je amortizirljive", () => {
    expect(calcOsnova("80000.00", "25")).toBe("60000.00");
  });

  it("decimalne vrednosti: pct=33.33", () => {
    // 10000 × 66.67/100 = 6667.00
    expect(calcOsnova("10000.00", "33.33")).toBe("6667.00");
  });
});

// ─── calcLetna ────────────────────────────────────────────────────────────────

describe("calcLetna — letna amortizacija", () => {
  it("10 % od 100000 = 10000", () => {
    expect(calcLetna("100000.00", "10.000")).toBe("10000.00");
  });

  it("20 % od 50000 = 10000", () => {
    expect(calcLetna("50000.00", "20.000")).toBe("10000.00");
  });

  it("0 % stopnja = 0", () => {
    expect(calcLetna("100000.00", "0")).toBe("0.00");
  });
});

// ─── calcObracunana — dolimitiraj na preostalo ────────────────────────────────

describe("calcObracunana — ustavitev pri polni odpisanosti", () => {
  it("odpisana >= osnova → 0 (preostalo=0)", () => {
    // osnova=10000, odpisana=10000 → preostalo=0.00 → 0
    expect(calcObracunana("10000.00", 12, "0.00")).toBe("0.00");
  });

  it("odpisana > osnova → 0 (negativno preostalo)", () => {
    expect(calcObracunana("1000.00", 12, "-100.00")).toBe("0.00");
  });

  it("polna letna amortizacija ko je preostalo večje", () => {
    // letna=5000, 12 mesecev, preostalo=20000 → 5000.00
    expect(calcObracunana("5000.00", 12, "20000.00")).toBe("5000.00");
  });

  it("proporcionalna za 6 mesecev", () => {
    // letna=12000, 6 mesecev → 6000, preostalo=20000 → 6000
    expect(calcObracunana("12000.00", 6, "20000.00")).toBe("6000.00");
  });

  it("dolimitiraj: proporcionalna presega preostalo", () => {
    // letna=12000, 12 mesecev → 12000, preostalo=3000 → 3000 (cap)
    expect(calcObracunana("12000.00", 12, "3000.00")).toBe("3000.00");
  });

  it("0 mesecev → 0 (brez aktivacije v letu)", () => {
    expect(calcObracunana("10000.00", 0, "8000.00")).toBe("0.00");
  });
});

// ─── calcAmortizacijaObracun — agregacija doknjižb ────────────────────────────

describe("calcAmortizacijaObracun — agregacija doknjižb (BAZEN 0000402)", () => {
  // Bazen ima 4 doknjižbe (seq 0,1,2,3), skupna nabavna 152707.61
  // Vrednosti so poenostavljene za test; bistvo je seštevanje po doknjižbah

  const skupinaInput = {
    id: "skupina-1",
    koda: "G10",
    naziv: "Gradbeni objekti",
    racunovodskaStonja: "10.000",
    davcnaStonja: "10.000",
  };

  function makeSredstvo(doknjizbe: SredstvoInput["doknjizbe"]): SredstvoInput {
    return {
      id: "s-bazen",
      inventarnaSt: "0000402",
      naziv: "BAZEN",
      skupinaId: skupinaInput.id,
      skupinaKoda: skupinaInput.koda,
      skupinaNaziv: skupinaInput.naziv,
      racunovodskaStonja: skupinaInput.racunovodskaStonja,
      davcnaStonja: skupinaInput.davcnaStonja,
      accountId: "acc-1",
      accountCode: "0200010",
      accountName: "Gradbeni objekt",
      costCenterId: null,
      costCenterCode: null,
      costCenterName: null,
      status: "v_uporabi",
      doknjizbe,
    };
  }

  it("4 doknjižbe sešteje skupno amortizacijo (Σ po vseh)", () => {
    const sredstvo = makeSredstvo([
      {
        id: "d0",
        seq: 0,
        nabavnaVrednost: "50000.00",
        odpisanaVrednost: "20000.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2015-01-01",
        datumIzpisa: null,
        status: "v_uporabi",
      },
      {
        id: "d1",
        seq: 1,
        nabavnaVrednost: "20000.00",
        odpisanaVrednost: "8000.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2016-01-01",
        datumIzpisa: null,
        status: "v_uporabi",
      },
      {
        id: "d2",
        seq: 2,
        nabavnaVrednost: "15000.00",
        odpisanaVrednost: "5000.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2018-01-01",
        datumIzpisa: null,
        status: "v_uporabi",
      },
      {
        id: "d3",
        seq: 3,
        nabavnaVrednost: "10000.00",
        odpisanaVrednost: "2000.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2020-01-01",
        datumIzpisa: null,
        status: "v_uporabi",
      },
    ]);
    const result = calcAmortizacijaObracun([sredstvo], 2024);

    // Vsaka doknjižba: letna = nabavna × 10% = 5000/2000/1500/1000 = skupaj 9500
    // Vse aktivirane pred 2024 → 12 mesecev → letna = obracunana (preostalo zadostuje)
    expect(result.sredstva).toHaveLength(1);
    const s = result.sredstva[0];
    expect(s.doknjizbe).toHaveLength(4);

    // Posamezne amortizacije
    expect(s.doknjizbe[0].obracunanaRacunovodska).toBe("5000.00");
    expect(s.doknjizbe[1].obracunanaRacunovodska).toBe("2000.00");
    expect(s.doknjizbe[2].obracunanaRacunovodska).toBe("1500.00");
    expect(s.doknjizbe[3].obracunanaRacunovodska).toBe("1000.00");

    // Skupna = Σ = 9500
    expect(s.skupnaObracunanaRacunovodska).toBe("9500.00");
    expect(result.skupajRacunovodska).toBe("9500.00");
  });

  it("dograditev aktivirana julija 2024 → 6 mesecev", () => {
    const sredstvo = makeSredstvo([
      {
        id: "d0",
        seq: 0,
        nabavnaVrednost: "100000.00",
        odpisanaVrednost: "0.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2023-01-01",
        datumIzpisa: null,
        status: "v_uporabi",
      },
      {
        id: "d1",
        seq: 1,
        nabavnaVrednost: "24000.00",
        odpisanaVrednost: "0.00",
        neamortizljiviDelPct: "0",
        datumAktivacije: "2024-07-01", // aktivacija julija
        datumIzpisa: null,
        status: "v_uporabi",
      },
    ]);
    const result = calcAmortizacijaObracun([sredstvo], 2024);
    const s = result.sredstva[0];

    // d0: 12 mesecev, letna=10000, obracunana=10000
    expect(s.doknjizbe[0].stMesecev).toBe(12);
    expect(s.doknjizbe[0].obracunanaRacunovodska).toBe("10000.00");

    // d1: prviDan=2024-07-02 → jul → 6 mesecev (jul–dec)
    // letna=2400 (nabavna 24000 × 10%), obracunana=2400×6/12=1200
    expect(s.doknjizbe[1].stMesecev).toBe(6);
    expect(s.doknjizbe[1].obracunanaRacunovodska).toBe("1200.00");

    expect(s.skupnaObracunanaRacunovodska).toBe("11200.00");
  });
});

// ─── Sredstvo brez skupine ────────────────────────────────────────────────────

describe("sredstvo brez skupine — označeno, amortizacija 0", () => {
  it("skupinaId=null → brezSkupine=true, amortizacija=0, NE ustavi obračun ostalih", () => {
    const sredstvaBrezSkupine: SredstvoInput = {
      id: "s-brez",
      inventarnaSt: "0000999",
      naziv: "Sredstvo brez skupine",
      skupinaId: null,
      skupinaKoda: null,
      skupinaNaziv: null,
      racunovodskaStonja: null,
      davcnaStonja: null,
      accountId: null,
      accountCode: null,
      accountName: null,
      costCenterId: null,
      costCenterCode: null,
      costCenterName: null,
      status: "v_uporabi",
      doknjizbe: [
        {
          id: "d0",
          seq: 0,
          nabavnaVrednost: "50000.00",
          odpisanaVrednost: "0.00",
          neamortizljiviDelPct: "0",
          datumAktivacije: "2020-01-01",
          datumIzpisa: null,
          status: "v_uporabi",
        },
      ],
    };

    const sredstvoZSkupino: SredstvoInput = {
      id: "s-ok",
      inventarnaSt: "0000100",
      naziv: "Normalno sredstvo",
      skupinaId: "skupina-1",
      skupinaKoda: "G10",
      skupinaNaziv: "Gradbeni objekti",
      racunovodskaStonja: "10.000",
      davcnaStonja: "10.000",
      accountId: null,
      accountCode: "0400000",
      accountName: "Oprema",
      costCenterId: null,
      costCenterCode: null,
      costCenterName: null,
      status: "v_uporabi",
      doknjizbe: [
        {
          id: "d1",
          seq: 0,
          nabavnaVrednost: "20000.00",
          odpisanaVrednost: "0.00",
          neamortizljiviDelPct: "0",
          datumAktivacije: "2022-01-01",
          datumIzpisa: null,
          status: "v_uporabi",
        },
      ],
    };

    const result = calcAmortizacijaObracun(
      [sredstvaBrezSkupine, sredstvoZSkupino],
      2024,
    );

    // Skupaj 2 sredstvi
    expect(result.steviloSredstev).toBe(2);
    expect(result.brezSkupine).toBe(1);

    // Brez skupine → amortizacija 0
    const brezSk = result.sredstva.find((s) => s.id === "s-brez")!;
    expect(brezSk.brezSkupine).toBe(true);
    expect(brezSk.skupnaObracunanaRacunovodska).toBe("0.00");
    expect(brezSk.doknjizbe[0].opomba).toBe("brez_skupine");

    // Z skupino → normalna amortizacija (20000 × 10% = 2000)
    const zSk = result.sredstva.find((s) => s.id === "s-ok")!;
    expect(zSk.brezSkupine).toBe(false);
    expect(zSk.skupnaObracunanaRacunovodska).toBe("2000.00");

    // Skupaj = samo normalno sredstvo
    expect(result.skupajRacunovodska).toBe("2000.00");
  });
});

// ─── Neamortizljivi del (osnova) ──────────────────────────────────────────────

describe("neamortizljivi del — amortizirljiva osnova", () => {
  it("pct=25: osnova = 75 % nabavne, amortizacija samo od osnove", () => {
    const sredstvo: SredstvoInput = {
      id: "s-pct",
      inventarnaSt: "0000200",
      naziv: "Mešani objekt 25 % neamortizljivo",
      skupinaId: "sk1",
      skupinaKoda: "G5",
      skupinaNaziv: "Stavbe",
      racunovodskaStonja: "4.000",
      davcnaStonja: "4.000",
      accountId: null,
      accountCode: "0200000",
      accountName: "Stavba",
      costCenterId: null,
      costCenterCode: null,
      costCenterName: null,
      status: "v_uporabi",
      doknjizbe: [
        {
          id: "d0",
          seq: 0,
          nabavnaVrednost: "400000.00",
          odpisanaVrednost: "0.00",
          neamortizljiviDelPct: "25", // 25 % neamortizljivo
          datumAktivacije: "2020-01-01",
          datumIzpisa: null,
          status: "v_uporabi",
        },
      ],
    };
    const result = calcAmortizacijaObracun([sredstvo], 2024);
    const s = result.sredstva[0];

    // osnova = 400000 × 75/100 = 300000
    expect(s.doknjizbe[0].osnova).toBe("300000.00");
    // letna = 300000 × 4% = 12000
    expect(s.doknjizbe[0].letnaRacunovodska).toBe("12000.00");
    // 12 mesecev → obracunana = 12000
    expect(s.doknjizbe[0].obracunanaRacunovodska).toBe("12000.00");
  });
});

// ─── Polno odpisano ───────────────────────────────────────────────────────────

describe("polno odpisano — amortizacija 0", () => {
  it("odpisana >= osnova → opomba=polno_odpisano, amortizacija=0", () => {
    const sredstvo: SredstvoInput = {
      id: "s-odpisano",
      inventarnaSt: "0000300",
      naziv: "Polno odpisano sredstvo",
      skupinaId: "sk1",
      skupinaKoda: "S20",
      skupinaNaziv: "Oprema",
      racunovodskaStonja: "20.000",
      davcnaStonja: "20.000",
      accountId: null,
      accountCode: "0400000",
      accountName: "Oprema",
      costCenterId: null,
      costCenterCode: null,
      costCenterName: null,
      status: "odpisano",
      doknjizbe: [
        {
          id: "d0",
          seq: 0,
          nabavnaVrednost: "10000.00",
          odpisanaVrednost: "10000.00", // polno odpisano
          neamortizljiviDelPct: "0",
          datumAktivacije: "2019-01-01",
          datumIzpisa: null,
          status: "odpisano",
        },
      ],
    };
    const result = calcAmortizacijaObracun([sredstvo], 2024);
    const s = result.sredstva[0];

    expect(s.doknjizbe[0].preostalo).toBe("0.00");
    expect(s.doknjizbe[0].obracunanaRacunovodska).toBe("0.00");
    expect(s.doknjizbe[0].opomba).toBe("polno_odpisano");
    expect(s.polnoOdpisano).toBe(true);
    expect(result.skupajRacunovodska).toBe("0.00");
  });
});

// ─── Računovodska vs. davčna ──────────────────────────────────────────────────

describe("računovodska vs. davčna stopnja", () => {
  it("različni stopnji → ločena obracunana vrednost", () => {
    const sredstvo: SredstvoInput = {
      id: "s-rac-dav",
      inventarnaSt: "0000500",
      naziv: "Sredstvo z različnima stopnjama",
      skupinaId: "sk1",
      skupinaKoda: "V",
      skupinaNaziv: "Vozila",
      racunovodskaStonja: "12.500", // 12.5 %
      davcnaStonja: "25.000",       // 25 %
      accountId: null,
      accountCode: "0400000",
      accountName: "Oprema",
      costCenterId: null,
      costCenterCode: null,
      costCenterName: null,
      status: "v_uporabi",
      doknjizbe: [
        {
          id: "d0",
          seq: 0,
          nabavnaVrednost: "40000.00",
          odpisanaVrednost: "0.00",
          neamortizljiviDelPct: "0",
          datumAktivacije: "2022-01-01",
          datumIzpisa: null,
          status: "v_uporabi",
        },
      ],
    };
    const result = calcAmortizacijaObracun([sredstvo], 2024);
    const d = result.sredstva[0].doknjizbe[0];

    // računovodska: 40000 × 12.5% = 5000
    expect(d.obracunanaRacunovodska).toBe("5000.00");
    // davčna: 40000 × 25% = 10000
    expect(d.obracunanaDavcna).toBe("10000.00");
  });
});

// ─── Vsote po kontih ──────────────────────────────────────────────────────────

describe("vsote po kontih", () => {
  it("dve sredstvi na istem kontu → sešteje skupaj", () => {
    const mk = (id: string, nv: string): SredstvoInput => ({
      id,
      inventarnaSt: id,
      naziv: id,
      skupinaId: "sk1",
      skupinaKoda: "O",
      skupinaNaziv: "Oprema",
      racunovodskaStonja: "10.000",
      davcnaStonja: "10.000",
      accountId: "acc-eq",
      accountCode: "0400000",
      accountName: "Oprema",
      costCenterId: null,
      costCenterCode: null,
      costCenterName: null,
      status: "v_uporabi",
      doknjizbe: [
        {
          id: `${id}-d0`,
          seq: 0,
          nabavnaVrednost: nv,
          odpisanaVrednost: "0.00",
          neamortizljiviDelPct: "0",
          datumAktivacije: "2020-01-01",
          datumIzpisa: null,
          status: "v_uporabi",
        },
      ],
    });

    const result = calcAmortizacijaObracun([mk("A", "10000.00"), mk("B", "30000.00")], 2024);
    // Skupaj: (1000 + 3000) = 4000
    expect(result.skupajRacunovodska).toBe("4000.00");
    expect(result.poKontih).toHaveLength(1);
    expect(result.poKontih[0].accountCode).toBe("0400000");
    expect(result.poKontih[0].skupajRacunovodska).toBe("4000.00");
    expect(result.poKontih[0].stevilaSredstev).toBe(2);
  });
});
