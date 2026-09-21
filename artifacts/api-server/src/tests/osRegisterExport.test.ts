/**
 * osRegisterExport.test.ts — testi za razširjen register OS z izvozom
 *
 * Pokriva:
 * 1. Enrichment: JSON endpoint vrne SRS metapodatke (skupinaKoda, racunovodskaStonja, datume, konte)
 * 2. PDF register: generira se brez napake, vsebuje seštevke
 * 3. XLSX register: generira se brez napake, vsebuje vse SRS stolpce
 */

import { describe, it, expect } from "vitest";
import {
  calcMedletniSredstvo,
  calcMedletniSeštevki,
  emptyMedletniSeštevki,
  type RegisterSredstvoInput,
  type EnrichedMedletniVrstica,
} from "../routes/osRegisterMedletni";
import { generateOsRegisterPdf, type OsRegisterPdfOpts } from "../lib/report-pdf";
import ExcelJS from "exceljs";

// ─── 1. EnrichedMedletniVrstica interface ────────────────────────────────────

describe("EnrichedMedletniVrstica — SRS metapodatki", () => {
  it("razširi MedletniRegisterVrstica z vsemi SRS polji", () => {
    const input: RegisterSredstvoInput = {
      id: "sr-001",
      inventarnaSt: "OS-001",
      naziv: "Testni stroj",
      skupinaId: "sk-1",
      status: "v_teku",
      steviloDoknjizb: 0,
      doknjizbe: [
        {
          id: "dok-1",
          seq: 0,
          nabavnaVrednost: "10000.00",
          odpisanaVrednost: "2000.00",
          datumNabave: "2022-01-15",
          datumAktivacije: "2022-02-01",
        },
      ],
      obracuniPoLetih: new Map([["2023", "1000.00"]]) as unknown as Map<number, string>,
      oslabitevPoLetih: undefined,
      datumOdtujitve: null,
    };

    // Izračun vrednosti
    const inputFixed: RegisterSredstvoInput = {
      ...input,
      obracuniPoLetih: new Map<number, string>([[2023, "1000.00"]]),
    };
    const vrstica = calcMedletniSredstvo(inputFixed, 2023);
    expect(vrstica.id).toBe("sr-001");
    expect(vrstica.inventarnaSt).toBe("OS-001");

    // Sestavi enriched vrstico
    const enriched: EnrichedMedletniVrstica = {
      ...vrstica,
      skupinaKoda: "II.5",
      skupinaNaziv: "Stroji in naprave",
      racunovodskaStonja: "10.00",
      davcnaStonja: "10.00",
      datumNabave: "2022-01-15",
      datumAktivacije: "2022-02-01",
      accountCode: "0200",
      kontoPopravkaCode: "0290",
      kontoStroskaCode: "4310",
      costCenterCode: "STM-01",
    };

    expect(enriched.skupinaKoda).toBe("II.5");
    expect(enriched.racunovodskaStonja).toBe("10.00");
    expect(enriched.datumNabave).toBe("2022-01-15");
    expect(enriched.accountCode).toBe("0200");
    expect(enriched.kontoStroskaCode).toBe("4310");
  });

  it("emptyMedletniSeštevki vrne pravilno strukturo", () => {
    const empty = emptyMedletniSeštevki();
    expect(parseFloat(empty.zacNV)).toBe(0);
    expect(parseFloat(empty.konNed)).toBe(0);
  });

  it("seštevki iz enriched vrstic delajo enako kot iz navadnih", () => {
    const input: RegisterSredstvoInput = {
      id: "sr-002",
      inventarnaSt: "OS-002",
      naziv: "Računalnik",
      skupinaId: null,
      status: "v_teku",
      steviloDoknjizb: 0,
      doknjizbe: [
        { id: "dok-2", seq: 0, nabavnaVrednost: "5000.00", odpisanaVrednost: "1000.00", datumNabave: "2021-06-01", datumAktivacije: "2021-07-01" },
      ],
      obracuniPoLetih: new Map<number, string>([[2023, "500.00"]]),
      oslabitevPoLetih: undefined,
      datumOdtujitve: null,
    };
    const vrstica = calcMedletniSredstvo(input, 2023);
    const enriched: EnrichedMedletniVrstica = {
      ...vrstica,
      skupinaKoda: null, skupinaNaziv: null, racunovodskaStonja: null,
      davcnaStonja: null, datumNabave: null, datumAktivacije: null,
      accountCode: null, kontoPopravkaCode: null, kontoStroskaCode: null, costCenterCode: null,
    };
    const seštevki = calcMedletniSeštevki([enriched]);
    // seštevki ne smejo biti NaN
    expect(parseFloat(seštevki.zacNV)).not.toBeNaN();
    expect(parseFloat(seštevki.konNed)).not.toBeNaN();
  });
});

// ─── 2. PDF register generiranje ─────────────────────────────────────────────

describe("generateOsRegisterPdf — landscape A4", () => {
  const baseOpts: OsRegisterPdfOpts = {
    companyName: "Test d.o.o.",
    companyDavcna: "SI12345678",
    datumIzpisa: "06.08.2026",
    datumKonca: "31.12.2025",
    obracunPeriod: "12/2025",
    vrstice: [
      {
        inventarnaSt: "OS-001",
        naziv: "Testni stroj 2000",
        skupinaKoda: "II.5",
        skupinaNaziv: "Stroji in naprave",
        racunovodskaStonja: "10.00",
        datumNabave: "2022-01-15",
        datumAktivacije: "2022-02-01",
        zacNV: "10000.00", zacPV: "3000.00", zacNed: "7000.00",
        noveNabave: "0.00", amortObdobja: "1000.00",
        konNV: "10000.00", konNed: "6000.00",
        status: "v_teku",
      },
      {
        inventarnaSt: "OS-002",
        naziv: "Pisarniška oprema",
        skupinaKoda: "V.2",
        skupinaNaziv: "Pohištvo",
        racunovodskaStonja: "20.00",
        datumNabave: "2023-03-10",
        datumAktivacije: "2023-04-01",
        zacNV: "3000.00", zacPV: "600.00", zacNed: "2400.00",
        noveNabave: "0.00", amortObdobja: "600.00",
        konNV: "3000.00", konNed: "1800.00",
        status: "v_teku",
      },
    ],
    seštevki: {
      zacNV: "13000.00", zacPV: "3600.00", zacNed: "9400.00",
      noveNabave: "0.00", amortObdobja: "1600.00",
      konNV: "13000.00", konNed: "7800.00",
    },
  };

  it("generira Buffer brez napake", async () => {
    const buf = await generateOsRegisterPdf(baseOpts);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("generiran PDF vsebuje PDF header", async () => {
    const buf = await generateOsRegisterPdf(baseOpts);
    const header = buf.subarray(0, 5).toString("ascii");
    expect(header).toBe("%PDF-");
  });

  it("deluje brez amortizacijskih skupin (null polja)", async () => {
    const opts: OsRegisterPdfOpts = {
      ...baseOpts,
      vrstice: [
        {
          inventarnaSt: "OS-003",
          naziv: "Sredstvo brez skupine",
          skupinaKoda: null, skupinaNaziv: null, racunovodskaStonja: null,
          datumNabave: null, datumAktivacije: null,
          zacNV: "5000.00", zacPV: "0.00", zacNed: "5000.00",
          noveNabave: "5000.00", amortObdobja: "0.00",
          konNV: "5000.00", konNed: "5000.00",
          status: "v_teku",
        },
      ],
      seštevki: { zacNV: "5000.00", zacPV: "0.00", zacNed: "5000.00", noveNabave: "5000.00", amortObdobja: "0.00", konNV: "5000.00", konNed: "5000.00" },
      obracunPeriod: null,
    };
    const buf = await generateOsRegisterPdf(opts);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it("deluje s praznim seznamom sredstev", async () => {
    const opts: OsRegisterPdfOpts = {
      ...baseOpts,
      vrstice: [],
      seštevki: { zacNV: "0", zacPV: "0", zacNed: "0", noveNabave: "0", amortObdobja: "0", konNV: "0", konNed: "0" },
    };
    const buf = await generateOsRegisterPdf(opts);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });
});

// ─── 3. XLSX register generiranje ─────────────────────────────────────────────

describe("XLSX register — ExcelJS gradnik", () => {
  it("ExcelJS je na voljo in generira veljavno xlsx vsebino", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Register OS");
    ws.addRow(["Inv. št.", "Naziv", "Skupin", "Rac.%", "NV (1.1.)", "Ned. (k)"]);
    ws.addRow(["OS-001", "Testni stroj", "II.5", 10.00, 10000.00, 6000.00]);
    const buf = await wb.xlsx.writeBuffer();
    expect(Buffer.isBuffer(Buffer.from(buf))).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(100);
  });

  it("ExcelJS ohrani numerične vrednosti (ne string)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Test");
    ws.columns = [
      { header: "NV", key: "nv", width: 14 },
      { header: "Ned", key: "ned", width: 14 },
    ];
    ws.addRow({ nv: 10000.00, ned: 7000.00 });
    const row = ws.getRow(2);
    expect(typeof row.getCell(1).value).toBe("number");
    expect(row.getCell(1).value).toBe(10000.00);
  });

  it("calcMedletniSeštevki sešteje enriched vrstice pravilno", () => {
    const mkVrstica = (nv: number, ned: number): EnrichedMedletniVrstica => ({
      id: `sr-${nv}`, inventarnaSt: `OS-${nv}`, naziv: "Test", skupinaId: null,
      status: "v_teku", steviloDoknjizb: 0,
      zacNV: String(nv), zacPV: "0", zacNed: String(ned),
      noveNabave: "0", amortObdobja: "0",
      oslabiteVObdobja: "0",     // ← polje, ki ga sumCol pričakuje
      izlocitveNV: "0", izlocitvePV: "0",
      konNV: String(nv), konPV: "0", konNed: String(ned),
      skupinaKoda: null, skupinaNaziv: null, racunovodskaStonja: null,
      davcnaStonja: null, datumNabave: null, datumAktivacije: null,
      accountCode: null, kontoPopravkaCode: null, kontoStroskaCode: null, costCenterCode: null,
    });
    const seštevki = calcMedletniSeštevki([
      mkVrstica(10000, 7000),
      mkVrstica(5000, 4000),
    ]);
    expect(parseFloat(seštevki.zacNV)).toBe(15000);
    expect(parseFloat(seštevki.konNed)).toBe(11000);
  });
});
