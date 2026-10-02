import type { AjpesAnnualReport, AjpesJolpRow } from "@workspace/api-client-react";
import { fmtAmount } from "./ajpes-annual-report-model";

export function Statement({ title, rows, year }: { title: string; rows: AjpesJolpRow[]; year: number }) {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs"><tr><th className="p-2 text-left">Postavka</th><th className="p-2 text-right">{year}</th><th className="p-2 text-right">{year - 1}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.code}-${i}`} className={`border-t ${r.bold ? "font-semibold bg-muted/30" : ""}`}>
                <td className="p-2">{r.label}</td>
                <td className="p-2 text-right tabular-nums">{fmtAmount(r.current)}</td>
                <td className="p-2 text-right tabular-nums">{fmtAmount(r.previous)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Explanation({ report }: { report: AjpesAnnualReport }) {
  const lines = [...report.balanceSheet, ...report.incomeStatement].filter((r) => r.bold && r.current !== "");
  return (
    <section className="rounded-md border p-4 text-sm space-y-1.5">
      <h3 className="font-semibold">Pojasnila iz glavne knjige</h3>
      {lines.map((r, i) => (
        <p key={i}>{r.label}: {fmtAmount(r.current)} EUR v letu {report.year} (prejšnje leto {fmtAmount(r.previous) || "ni podatka"}).</p>
      ))}
      <p className="text-muted-foreground">Preslikanih kontov: {Object.keys(report.settings.mappings).length} od {report.accounts.length}. Izločenih zaključnih knjižb: {report.settings.excludedEntryIds.length}.</p>
    </section>
  );
}
