import { describe, expect, it } from "vitest";
import { formatXPorociloPrintLines } from "./xPorocilo";

describe("formatXPorociloPrintLines", () => {
  it("natisne naslov, denarni dnevnik in jasno označen osnutek", () => {
    const lines = formatXPorociloPrintLines({
      width: 40,
      datum: "2026-08-20",
      printedAt: "10:30",
      promet: {
        skupajPromet: 120,
        skupajDDV: 21.64,
        prometPoNacinuPlacila: { gotovina: 100, kartica: 20, bon: 0, sumup: 0, bonPica: 0, steviloBonov: 0, negotovinsko: 0, napitnina: 0, reprezentanca: 0, lastna_poraba: 0 },
        prometPoBlagajnah: [],
        prometPoNatakarjih: [],
        ddvPoStopnjah: [],
        prihodkiPoVrsti: { storitve: 0, blago: 0, material: 0 },
        izdaniKuponi: 0,
        prejetiKuponi: 0,
        podjetje: { naziv: "Test d.o.o.", naslov: "", davcnaStevilka: "" },
        enota: { id: 7, ime: "Center" },
      },
      stanje: { menjalniDenar: 50, gotovinskaProdaja: 100, pologiGotovine: 10, izplacilaDobaviteljem: 20, pologiTrr: 40, stanje: 100 },
      premiki: [{ id: "draft", datumCas: "2026-08-20T08:00:00.000Z", tip: "IZPLACILO_DOBAVITELJU", status: "OSNUTEK", znesek: 20, opis: "Mleko", partnerNaziv: "Dobavitelj" }],
    });

    expect(lines).toContain("X-POROČILO");
    expect(lines).toContain("BLAGAJNISKI DNEVNIK");
    expect(lines).toContain("GIBANJE GOTOVINE");
    expect(lines.join("\n")).toContain("Teoreticno stanje:");
    expect(lines.join("\n")).toContain("OSNUTEK (NEKNJIZEN)");
  });

  it("napitnino vodi ločeno od prodajnega prometa in označi kartično bremenitev", () => {
    const lines = formatXPorociloPrintLines({
      width: 48, datum: "2026-08-20", printedAt: "10:30",
      promet: {
        skupajPromet: 120, skupajDDV: 21.64,
        prometPoNacinuPlacila: { gotovina: 100, kartica: 23, bon: 0, sumup: 0, bonPica: 0, steviloBonov: 0, negotovinsko: 0, napitnina: 3, reprezentanca: 0, lastna_poraba: 0 },
        prometPoBlagajnah: [], prometPoNatakarjih: [], ddvPoStopnjah: [],
        prihodkiPoVrsti: { storitve: 0, blago: 0, material: 0 }, izdaniKuponi: 0, prejetiKuponi: 0,
        podjetje: { naziv: "", naslov: "", davcnaStevilka: "" },
        enota: { id: 7, ime: "Center" },
      },
      stanje: { menjalniDenar: 0, gotovinskaProdaja: 100, pologiGotovine: 0, izplacilaDobaviteljem: 0, pologiTrr: 0, stanje: 100 },
      premiki: [],
    }).join("\n");

    expect(lines).toContain("Prodajni promet:");
    expect(lines).toContain("120.00 EUR");
    expect(lines).toContain("Kartica (bremenitev):");
    expect(lines).toContain("Napitnine (ločeno):");
  });

  it("prikaže poslovno enoto in ohrani poravnavo stolpcev", () => {
    const lines = formatXPorociloPrintLines({
      width: 32,
      datum: "2026-08-20",
      printedAt: "10:30",
      promet: {
        skupajPromet: 120,
        skupajDDV: 21.64,
        prometPoNacinuPlacila: { gotovina: 100, kartica: 20, bon: 0, sumup: 0, bonPica: 0, steviloBonov: 0, negotovinsko: 0, napitnina: 0, reprezentanca: 0, lastna_poraba: 0 },
        prometPoBlagajnah: [{ blagajnaKoda: "01-02", skupaj: 120, steviloRacunov: 9, odZap: "100", doZap: "108" }],
        prometPoNatakarjih: [],
        ddvPoStopnjah: [],
        prihodkiPoVrsti: { storitve: 0, blago: 0, material: 0 },
        izdaniKuponi: 0,
        prejetiKuponi: 0,
        podjetje: { naziv: "", naslov: "", davcnaStevilka: "" },
        enota: { id: 4, ime: "Ljubljana Center" },
      },
      stanje: { menjalniDenar: 0, gotovinskaProdaja: 100, pologiGotovine: 0, izplacilaDobaviteljem: 0, pologiTrr: 0, stanje: 100 },
      premiki: [],
    });

    expect(lines).toContain("Poslovna enota: Ljubljana Center");
    const registerHeader = lines.findIndex((line) => line.includes("Blagajna") && line.includes("Rac.") && line.includes("Znesek"));
    expect(registerHeader).toBeGreaterThanOrEqual(0);
    expect(lines[registerHeader + 1]).toHaveLength(32);
    expect(lines[registerHeader + 1]).toContain("120.00 EUR");
  });
});