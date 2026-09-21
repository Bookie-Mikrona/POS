import { describe, expect, it } from "vitest";
import { formatZPorociloPrintLines, type ZPorociloSnapshot } from "./zPorocilo";
import type { XPorociloPromet, XPorociloStanje } from "./xPorocilo";

const z: ZPorociloSnapshot = {
  id: 1, blagajnaId: 1, poslovniDatum: "2026-08-20", zStevilka: 1,
  zakljucenOb: "2026-08-20T10:30:00.000Z", zakljucilUporabnik: "Administrator",
  grandTotalPrej: 0, grandTotalNov: 12, prometDneva: 12, skupajPromet: 12, skupajDdv: 2.16,
  steviloRacunov: 1, odZap: "1", doZap: "1", gotovina: 0, kartica: 15, znesekNapitnina: 3,
  sumup: 0, bon: 0, bonPica: 0, steviloBonov: 0, negotovinsko: 0,
  reprezentanca: 0, lastnaPoraba: 0, ddvPoStopnjah: [], menjalniDenar: 0,
  gotovinskaProdaja: 0, pologiGotovine: 0, izplacilaJobaviteljem: 0, pologiTrr: 0,
  stanjeBlagajne: 0, darilniBoniIzdaja: 0, darilniBoniUnovcitev: 0,
  sspSubvencija: 0, fursPotrjeni: 1, fursNepotrjeni: 0, odklenjenOb: null,
};

const promet: XPorociloPromet = {
  skupajPromet: 12, skupajDDV: 2.16,
  prometPoNacinuPlacila: { gotovina: 0, kartica: 15, napitnina: 3, sumup: 0, bon: 0, bonPica: 0, steviloBonov: 0, negotovinsko: 0, reprezentanca: 0, lastna_poraba: 0 },
  prometPoBlagajnah: [], prometPoNatakarjih: [], ddvPoStopnjah: [],
  prihodkiPoVrsti: { storitve: 0, blago: 0, material: 0 },
  izdaniKuponi: 0, prejetiKuponi: 0, podjetje: { naziv: "", naslov: "", davcnaStevilka: "" },
  enota: { id: 1, ime: "Test enota" },
};

const stanje: XPorociloStanje = {
  menjalniDenar: 0, gotovinskaProdaja: 0, pologiGotovine: 0,
  izplacilaDobaviteljem: 0, pologiTrr: 0, stanje: 0,
};

describe("formatZPorociloPrintLines", () => {
  it("prints card tips separately from sales and card charge", () => {
    const lines = formatZPorociloPrintLines({
      width: 48, datum: z.poslovniDatum, printedAt: "10:30", z, promet, stanje, premiki: [],
    }).join("\n");

    expect(lines).toContain("Prodajni promet:");
    expect(lines).toContain("12.00 EUR");
    expect(lines).toContain("Kartica (bremenitev):");
    expect(lines).toContain("15.00 EUR");
    expect(lines).toContain("Napitnine (ločeno):");
    expect(lines).toContain("3.00 EUR");
  });
});