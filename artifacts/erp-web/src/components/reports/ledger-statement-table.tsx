import { Fragment } from "react";
import type { TrialBalanceRow } from "@workspace/api-client-react";

export type LedgerStatementView = "bilanca" | "zakljucni";

type Field = "openingBalanceDebit" | "openingBalanceCredit" | "turnoverDebit" |
  "turnoverCredit" | "balanceDebit" | "balanceCredit";

const pairs: [Field, Field][] = [
  ["openingBalanceDebit", "openingBalanceCredit"],
  ["turnoverDebit", "turnoverCredit"],
  ["balanceDebit", "balanceCredit"],
];

function format(value: number): string {
  return value.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function totals(rows: TrialBalanceRow[], view: LedgerStatementView): number[] {
  return (view === "bilanca" ? [pairs[2]!] : pairs).flatMap(([debit, credit]) => {
    const d = rows.reduce((sum, row) => sum + Number(row[debit]), 0);
    const c = rows.reduce((sum, row) => sum + Number(row[credit]), 0);
    return [d, c, d - c];
  });
}

function Amounts({ numbers, strong = false }: { numbers: number[]; strong?: boolean }) {
  return numbers.map((number, i) => (
    <td key={i} className={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap border-l border-border/30 ${strong ? "font-semibold" : ""}`}>
      {format(number)}
    </td>
  ));
}

export function LedgerStatementTable({
  rows,
  view,
  dateFrom,
  dateTo,
  companyName,
}: {
  rows: TrialBalanceRow[];
  view: LedgerStatementView;
  dateFrom: string;
  dateTo: string;
  companyName: string;
}) {
  const groups = new Map<string, TrialBalanceRow[]>();
  for (const row of rows) {
    const digit = row.accountCode.slice(0, 1);
    const group = groups.get(digit) ?? [];
    group.push(row);
    groups.set(digit, group);
  }
  const headings = view === "bilanca"
    ? ["Debet", "Kredit", "Saldo"]
    : ["Debet OTV", "Kredit OTV", "Saldo OTV", "Debet tekoči", "Kredit tekoči", "Saldo tekoči", "Debet skupaj", "Kredit skupaj", "Saldo"];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-semibold text-base">{view === "bilanca" ? "Bilanca kontov" : "Zaključni račun"}</h2>
        <p className="text-xs text-muted-foreground">
          {companyName} · {dateFrom} – {dateTo} · šifre in nazivi kontov nove GK
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="bg-muted/60">
              <th scope="col" className="text-left px-2 py-2">Konto</th>
              <th scope="col" className="text-left px-2 py-2 min-w-56">Naziv konta</th>
              {headings.map((heading) => (
                <th scope="col" key={heading} className="text-right px-2 py-2 whitespace-nowrap border-l border-border/40">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(groups, ([digit, groupRows]) => (
              <Fragment key={digit}>
                {groupRows.map((row) => (
                  <tr key={row.accountId} className="border-t border-border/30 hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-mono">{row.accountCode}</td>
                    <td className="px-2 py-1.5">{row.accountName}</td>
                    <Amounts numbers={totals([row], view)} />
                  </tr>
                ))}
                <tr className="bg-muted/40 border-t font-semibold">
                  <th colSpan={2} scope="row" className="px-2 py-2 text-left">Skupaj razred {digit}</th>
                  <Amounts numbers={totals(groupRows, view)} strong />
                </tr>
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={headings.length + 2} className="px-3 py-8 text-center text-muted-foreground">Ni knjižb za izbrano obdobje.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-muted/70 border-t-2">
              <th colSpan={2} scope="row" className="px-2 py-2 text-left">SKUPAJ</th>
              <Amounts numbers={totals(rows, view)} strong />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Saldo = debet − kredit. Pri uvoženih letih Bookie Old je otvoritev potrjena
        letna otvoritvena temeljnica, tekoči promet pa promet po njej; sicer je
        otvoritev stanje pred izbranim obdobjem. Vrstice z ničelnim saldom in prometom ostanejo vidne.
      </p>
    </div>
  );
}