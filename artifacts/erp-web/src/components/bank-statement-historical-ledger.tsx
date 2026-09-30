import type { BankStatementHistoricalLedger } from "@workspace/api-client-react";

const money = new Intl.NumberFormat("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (value: string | null | undefined) => value ? value.slice(0, 10).split("-").reverse().join(". ") : "—";
const closingDate = (value: string) => {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  return match ? `${match[2]}. ${match[1]}. ${match[3]}` : value;
};

interface Props {
  ledger: BankStatementHistoricalLedger;
  bankAccountCode: string;
  currency: string;
}

export function BankStatementHistoricalLedgerView({ ledger, bankAccountCode, currency }: Props) {
  const bankLines = ledger.lines.filter(line => line.accountCode === bankAccountCode);
  const debit = bankLines.reduce((sum, line) => sum + (line.side === "debit" ? Number(line.amount) : 0), 0);
  const credit = bankLines.reduce((sum, line) => sum + (line.side === "credit" ? Number(line.amount) : 0), 0);
  const closingCount = ledger.lines.reduce((sum, line) => sum + line.historicalClosings.length, 0);
  const hasSupplierEvidence = ledger.reference.startsWith("BOOKIE-OLD/K2/2026/10/");

  return (
    <section className="space-y-3 border-t pt-5" data-testid="section-statement-historical-ledger">
      <div>
        <h3 className="font-semibold">Razčlenitev povezane stare temeljnice ({ledger.lines.length} vrstic)</h3>
        <p className="text-sm text-muted-foreground break-words" data-testid="text-historical-ledger-reference">
          {ledger.reference} · listina {dateLabel(ledger.documentDate)} · knjiženje {dateLabel(ledger.bookingDate)} · {ledger.status === "draft" ? "osnutek" : ledger.status === "posted" ? "knjiženo" : "stornirano"}
        </p>
      </div>
      {bankLines.length > 0
        ? <p className="text-sm" data-testid="text-historical-bank-net">
            Konto {bankAccountCode}: debet {money.format(debit)} {currency} − kredit {money.format(credit)} {currency} = neto {money.format(debit - credit)} {currency}.
            <span className="text-muted-foreground"> Neto bančna vrstica ni nujno eno plačilo.</span>
          </p>
        : <p className="text-sm text-muted-foreground" data-testid="text-historical-bank-net">
            Na tej stari temeljnici ni prometne vrstice konta {bankAccountCode}; neto bančnega zneska ni mogoče izračunati.
          </p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-3">Konto / izvor</th>
              <th className="p-3">Partner / opis</th>
              <th className="p-3 text-right">Debet</th>
              <th className="p-3 text-right">Kredit</th>
            </tr>
          </thead>
          <tbody>
            {ledger.lines.map(line => (
              <tr key={line.id} className="border-t align-top" data-testid={`row-historical-ledger-${line.id}`}>
                <td className="p-3 whitespace-nowrap">
                  <div>{line.accountCode} — {line.accountName}</div>
                  {line.sourceLineId && <div className="text-xs text-muted-foreground">GLAVNA #{line.sourceLineId}</div>}
                </td>
                <td className="p-3 min-w-56 break-words">
                  <div className="font-medium">{line.partnerName || "—"}</div>
                  <div className="text-xs text-muted-foreground">{line.description || "—"}</div>
                  {line.historicalClosings.map(closing => (
                    <div key={closing.closingId} className="mt-2 rounded border bg-muted/40 p-2 text-xs" data-testid={`text-historical-closing-${closing.closingId}`}>
                      Staro zapiranje: {closing.invoiceType === "issued" ? "izdani" : "prejeti"} račun {closing.invoiceNumber} · {money.format(Number(closing.amount))} {currency} · datum izvorne povezave {closingDate(closing.recordedDate)}
                    </div>
                  ))}
                </td>
                <td className="p-3 text-right tabular-nums whitespace-nowrap">{line.side === "debit" ? money.format(Number(line.amount)) : "—"}</td>
                <td className="p-3 text-right tabular-nums whitespace-nowrap">{line.side === "credit" ? money.format(Number(line.amount)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="status-historical-closing-coverage">
        V ERP je za to temeljnico prenesenih {closingCount} dokazil o zapiranju
        {hasSupplierEvidence ? " izdanih in prejetih računov." : " izdanih računov. Zapiranja dobaviteljev za ta leta niso prenesena."}
        Odsotnost oznake ni dokaz, da v starem sistemu ni bilo zapiranja.
        Ta pregled ne ustvarja plačil ali novih knjižb.
      </p>
    </section>
  );
}