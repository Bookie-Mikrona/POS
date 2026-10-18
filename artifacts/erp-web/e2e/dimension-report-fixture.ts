import type { DimensionReportExcelOptions } from "../src/lib/dimensionReportExcel";

export function largeDimensionReport(count = 20_000): DimensionReportExcelOptions {
  return {
    companyName: "Šiviljstvo Čebelica Žužemberk d.o.o.",
    dimensionLabel: "Stroškovna mesta",
    dateFrom: "2026-01-01", dateTo: "2026-12-31",
    rows: Array.from({ length: count }, (_, index) => ({
      id: `${index}`, code: `${index}`.padStart(6, "0"),
      name: `${index}: Čebelarstvo, vzdrževanje in računovodstvo – Škofja Loka, Žužemberk; dolg slovenski naziv. `.repeat(5),
      totalDebit: "1234.56", totalCredit: "2000.10", balance: "-765.54",
    })),
    grandTotalDebit: (count * 123456 / 100).toFixed(2),
    grandTotalCredit: (count * 200010 / 100).toFixed(2),
    grandTotalBalance: (count * -76554 / 100).toFixed(2),
  };
}
