import ExcelJS from "exceljs";

export interface ExportJournal {
  id: string;
  entryDate: string;
  reference: string | null;
  description: string | null;
  status: string;
  enotaIme: string | null;
  posArchive: boolean;
  vrstice: Array<{
    kontoKoda: string; kontoIme: string; stran: "debit" | "credit"; znesek: number; opis: string | null;
    partnerSifra?: string | null;
    partnerDavcna?: string | null;
    partnerIdZaDdv?: string | null;
    partnerNaziv?: string | null;
    partnerNaslov?: string | null;
    partnerPostnaStevilka?: string | null;
    partnerKraj?: string | null;
    partnerDrzava?: string | null;
  }>;
}

export interface ExportPeriod { od: string; do: string; podjetje: string; davcna: string }

export function validJournalPeriod(od: unknown, do_: unknown): od is string {
  const valid = (value: unknown): value is string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  return valid(od) && valid(do_) && od <= do_;
}

const headers = [
  "Datum", "Enota", "Temeljnica", "Status", "Evidenca", "Konto", "Naziv konta",
  "Debet (EUR)", "Kredit (EUR)", "Opis vrstice", "Izvorna referenca", "ID temeljnice",
  "Šifra partnerja (Bookie)", "Davčna številka partnerja", "ID za DDV partnerja",
  "Polni naziv partnerja", "Naslov partnerja", "Poštna številka partnerja", "Kraj partnerja", "Država partnerja",
];
const statusNames: Record<string, string> = { draft: "Osnutek", posted: "Potrjena", reversed: "Storno" };
const dateLabel = (value: string) => value.split("-").reverse().join(".");

function rowsForExport(entries: ExportJournal[]) {
  return entries.flatMap(entry => entry.vrstice.map(line => [
    dateLabel(entry.entryDate), entry.enotaIme ?? "", entry.description ?? "",
    statusNames[entry.status] ?? entry.status, entry.posArchive ? "POS evidenca" : "Glavna knjiga",
    line.kontoKoda, line.kontoIme,
    line.stran === "debit" ? line.znesek : 0,
    line.stran === "credit" ? line.znesek : 0,
    line.opis ?? "", entry.reference ?? "", entry.id,
    line.partnerSifra ?? "", line.partnerDavcna ?? "", line.partnerIdZaDdv ?? "",
    line.partnerNaziv ?? "", line.partnerNaslov ?? "", line.partnerPostnaStevilka ?? "",
    line.partnerKraj ?? "", line.partnerDrzava ?? "",
  ]));
}

/** CSV za slovenski Excel: UTF-8 BOM, podpičja, decimalna vejica, varen tekst. */
export function createJournalCsv(entries: ExportJournal[]): string {
  const escape = (value: string | number) => {
    if (typeof value === "number") return value.toFixed(2).replace(".", ",");
    const safe = /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [headers, ...rowsForExport(entries)].map(row => row.map(escape).join(";")).join("\r\n") + "\r\n";
}

export async function createJournalXlsx(entries: ExportJournal[], period: ExportPeriod): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bookie POS";
  const sheet = workbook.addWorksheet("Temeljnice", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = headers.map((header, index) => ({
    header, width: [14, 24, 42, 14, 20, 16, 48, 18, 18, 42, 48, 40, 40, 24, 24, 48, 40, 24, 28, 24][index],
  }));
  for (const row of rowsForExport(entries)) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  sheet.getColumn(6).numFmt = "@"; // konto ostane tekst, tudi z vodilnimi ničlami
  for (let column = 13; column <= headers.length; column++) sheet.getColumn(column).numFmt = "@";
  sheet.getColumn(8).numFmt = "#,##0.00";
  sheet.getColumn(9).numFmt = "#,##0.00";
  const summary = workbook.addWorksheet("Povzetek");
  summary.columns = [{ width: 30 }, { width: 65 }];
  const rows = rowsForExport(entries);
  const total = (index: number) => Math.round(rows.reduce((sum, row) => sum + Number(row[index]), 0) * 100) / 100;
  summary.addRows([
    ["Podjetje", period.podjetje], ["Davčna številka", period.davcna],
    ["Od", dateLabel(period.od)], ["Do", dateLabel(period.do)],
    ["Število temeljnic", entries.length], ["Število vrstic", rows.length],
    ["Skupaj debet (EUR)", total(7)], ["Skupaj kredit (EUR)", total(8)],
    ["Razlika (EUR)", Math.round((total(7) - total(8)) * 100) / 100],
    ["Obseg", "Vse temeljnice podjetja za izbrano obdobje, enako kot v POS seznamu."],
    ["Opomba", "Izvoz ne prenese ali knjiži temeljnic v GK. POS izvirniki so ločeni od GK."],
    ["Partnerji", "Šifra partnerja je trajni Bookie ID, ne šifra ciljnega računovodskega programa. Za uvoz je lahko potrebna preslikava."],
  ]);
  [7, 8, 9].forEach(row => { summary.getCell(row, 2).numFmt = "#,##0.00"; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
