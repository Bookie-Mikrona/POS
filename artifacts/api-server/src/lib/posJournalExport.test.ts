import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createJournalCsv, createJournalXlsx, validJournalPeriod, type ExportJournal } from "./posJournalExport";

const entry: ExportJournal = {
  id: "journal-id", entryDate: "2026-09-28", reference: "POS:PRODAJA:2026-09-28:E309",
  description: "Dnevna prodaja POS — 2026-09-28", status: "draft", enotaIme: "Križišče", posArchive: true,
  vrstice: [
    { kontoKoda: "01000", kontoIme: "Gotovina", stran: "debit", znesek: 62.4, opis: "Gotovina" },
    { kontoKoda: "7601200", kontoIme: "Prihodki", stran: "credit", znesek: 56.99, opis: 'Opis; "šumniki"\nDruga vrstica' },
    { kontoKoda: "2601000", kontoIme: "DDV", stran: "credit", znesek: 5.41, opis: null },
  ],
};
const period = { od: "2026-09-01", do: "2026-09-30", podjetje: "Gostilna Križišče", davcna: "12345678" };

describe("Izvoz POS temeljnic", () => {
  it("preveri resnične datume, vrstni red in vključujoč enodnevni interval", () => {
    expect(validJournalPeriod("2026-09-28", "2026-09-28")).toBe(true);
    expect(validJournalPeriod("2026-09-30", "2026-09-01")).toBe(false);
    expect(validJournalPeriod("2026-02-30", "2026-09-30")).toBe(false);
    expect(validJournalPeriod(undefined, "2026-09-30")).toBe(false);
  });
  it("CSV ohrani vse vrstice, šumnike, kontne kode in ločena zneska", () => {
    const csv = createJournalCsv([entry]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"28.09.2026";"Križišče"');
    expect(csv).toContain('"01000";"Gotovina";62,40;0,00');
    expect(csv).toContain('"7601200";"Prihodki";0,00;56,99');
    expect(csv).toContain('"Opis; ""šumniki""\nDruga vrstica"');
    expect(csv.match(/"journal-id"/g)).toHaveLength(3);
  });
  it("CSV prepreči formule iz opisov ali imen", () => {
    const csv = createJournalCsv([{ ...entry, enotaIme: '=HYPERLINK("https://example.com")',
      vrstice: [{ ...entry.vrstice[0], opis: "  +cmd" }] }]);
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).toContain('"\'  +cmd"');
  });
  it("pravi XLSX vsebuje številčne zneske, tekstovne konte in povzetek obdobja", async () => {
    const buffer = await createJournalXlsx([entry], period);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("Temeljnice")!;
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getCell("B2").value).toBe("Križišče");
    expect(sheet.getCell("F2").value).toBe("01000");
    expect(sheet.getCell("H2").value).toBe(62.4);
    expect(sheet.getCell("I3").value).toBe(56.99);
    expect(sheet.getCell("H2").numFmt).toBe("#,##0.00");
    const summary = workbook.getWorksheet("Povzetek")!;
    expect(summary.getCell("B1").value).toBe("Gostilna Križišče");
    expect(summary.getCell("B3").value).toBe("01.09.2026");
    expect(summary.getCell("B4").value).toBe("30.09.2026");
    expect(summary.getCell("B7").value).toBe(62.4);
    expect(summary.getCell("B8").value).toBe(62.4);
    expect(summary.getCell("B9").value).toBe(0);
  });
});
