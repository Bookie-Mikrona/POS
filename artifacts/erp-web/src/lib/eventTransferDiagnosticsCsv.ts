import type {
  EventTransferDiagnosticReport,
  EventTransferDiagnosticViolation,
} from "@workspace/api-client-react";

type DiagnosticCsvOptions = {
  report: EventTransferDiagnosticReport;
  violations: EventTransferDiagnosticViolation[];
  companyName: string;
  unitName: string;
  filterLabel: string;
  kindLabels: Record<string, string>;
};

const csvCell = (value: unknown): string => {
  const text = String(value ?? "");
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

const movementCells = (
  movement: EventTransferDiagnosticViolation["expected"],
): Array<string | number | null | undefined> => [
  movement?.articleName,
  movement?.articleId,
  movement?.type,
  movement?.quantity,
  movement?.unitCost,
  movement?.value,
];

export function buildEventTransferDiagnosticsCsv({
  report,
  violations,
  companyName,
  unitName,
  filterLabel,
  kindLabels,
}: DiagnosticCsvOptions): string {
  const rows: unknown[][] = [
    ["Poročilo", "Diagnostika dogodkovnih prenosov zaloge"],
    ["Način", "SAMO ZA PREGLED — brez samodejnih popravkov"],
    ["Čas nastanka", report.generatedAt],
    ["Podjetje", companyName, report.scope.companyId],
    ["Enota", unitName, report.scope.unitId],
    ["Filter", filterLabel],
    ["Preverjeni prenosi", report.checked.transfers],
    ["Preverjene vrstice", report.checked.lines],
    ["Preverjeni premiki", report.checked.movements],
    ["Izvožena neskladja", violations.length],
    [],
    [
      "Vrsta neskladja",
      "Koda vrste",
      "Opis",
      "Dogodek",
      "Dogodek ID",
      "Prenos ID",
      "Smer",
      "Status",
      "Iz enote",
      "Iz enote ID",
      "V enoto",
      "V enoto ID",
      "Vrstica ID",
      "Premik ID",
      "Pričakovani artikel",
      "Pričakovani artikel ID",
      "Pričakovani tip",
      "Pričakovana količina",
      "Pričakovana nabavna cena",
      "Pričakovana vrednost",
      "Dejanski artikel",
      "Dejanski artikel ID",
      "Dejanski tip",
      "Dejanska količina",
      "Dejanska nabavna cena",
      "Dejanska vrednost",
      "Razlike",
    ],
    ...violations.map(violation => [
      kindLabels[violation.kind] ?? violation.kind,
      violation.kind,
      violation.detail,
      violation.eventName,
      violation.eventId,
      violation.transferId,
      violation.direction,
      violation.status,
      violation.sourceUnitName,
      violation.sourceUnitId,
      violation.targetUnitName,
      violation.targetUnitId,
      violation.lineId,
      violation.movementId,
      ...movementCells(violation.expected),
      ...movementCells(violation.actual),
      violation.differences?.join(", "),
    ]),
  ];

  return `\uFEFF${rows.map(row => row.map(csvCell).join(";")).join("\r\n")}`;
}

export function eventTransferDiagnosticsCsvFilename(
  companyName: string,
  generatedAt: string,
): string {
  const companySlug = companyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "podjetje";
  const date = generatedAt.slice(0, 10);
  return `diagnostika-dogodkovnih-prenosov-${companySlug}-${date}.csv`;
}