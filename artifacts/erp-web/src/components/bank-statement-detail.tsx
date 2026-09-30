import { useGetBankStatementDetail, getGetBankStatementDetailQueryKey } from "@workspace/api-client-react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BankStatementHistoricalLedgerView } from "@/components/bank-statement-historical-ledger";

const amountFormat = new Intl.NumberFormat("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (value: string | null | undefined) => value ? value.slice(0, 10).split("-").reverse().join(". ") : "—";

interface Props {
  companyId: string;
  statementId: string | null;
  onClose: () => void;
}

export function BankStatementDetail({ companyId, statementId, onClose }: Props) {
  const { data, isLoading, error } = useGetBankStatementDetail(companyId, statementId ?? "", {
    query: {
      enabled: !!companyId && !!statementId,
      queryKey: getGetBankStatementDetailQueryKey(companyId, statementId ?? ""),
    },
  });
  const reconstructed = data?.sourceFilename?.includes("rekonstrukcija iz GK") ?? false;

  return (
    <Dialog open={!!statementId} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bančni izpisek {data?.statementNumber || dateLabel(data?.statementDate)}</DialogTitle>
          <DialogDescription>Pregled evidentiranih podatkov in prometnih vrstic. Spremembe niso mogoče.</DialogDescription>
        </DialogHeader>
        {isLoading && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Nalaganje izpiska …</div>}
        {error && <Alert variant="destructive" data-testid="error-statement-detail"><AlertCircle className="h-4 w-4" /><AlertDescription>Izpiska ni bilo mogoče odpreti. {error.message}</AlertDescription></Alert>}
        {data && (
          <div className="space-y-5" data-testid="statement-detail">
            {reconstructed && (
              <Alert data-testid="status-reconstructed-statement">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Ta zapis je rekonstruiran iz stare glavne knjige. Ni izvirna bančna datoteka; manjkajoči IBAN in stanji nista potrjena z bančnim izpiskom.</AlertDescription>
              </Alert>
            )}
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Datum</dt><dd data-testid="text-statement-date">{dateLabel(data.statementDate)}</dd></div>
              <div><dt className="text-muted-foreground">Obdobje</dt><dd>{data.periodFrom || data.periodTo ? `${dateLabel(data.periodFrom)} – ${dateLabel(data.periodTo)}` : "—"}</dd></div>
              <div><dt className="text-muted-foreground">TRR / konto</dt><dd>{data.sourceIban || "IBAN ni naveden"} · {data.bankAccountCode} — {data.bankAccountName}</dd></div>
              <div><dt className="text-muted-foreground">Vir zapisa</dt><dd className="break-words" data-testid="text-statement-source">{data.sourceFilename}</dd></div>
              <div><dt className="text-muted-foreground">Začetno stanje</dt><dd>{data.openingBalance == null ? "—" : `${amountFormat.format(Number(data.openingBalance))} ${data.currency}`}</dd></div>
              <div><dt className="text-muted-foreground">Končno stanje</dt><dd>{data.closingBalance == null ? "—" : `${amountFormat.format(Number(data.closingBalance))} ${data.currency}`}</dd></div>
            </dl>
            <div>
              <h3 className="font-semibold mb-2">Prometne vrstice ({data.lines.length})</h3>
              {data.lines.length === 0 ? <p className="text-sm text-muted-foreground">Ta izpisek nima evidentiranih prometnih vrstic.</p> : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr><th className="p-3"># / datum</th><th className="p-3">Partner / IBAN</th><th className="p-3">Opis / referenca</th><th className="p-3 text-right">Znesek</th></tr>
                    </thead>
                    <tbody>
                      {data.lines.map(line => (
                        <tr key={line.id} className="border-t" data-testid={`row-statement-line-${line.id}`}>
                          <td className="p-3 whitespace-nowrap">{line.lineNumber} · {dateLabel(line.bookingDate)}</td>
                          <td className="p-3"><div>{line.counterpartyName || "—"}</div>{line.counterpartyIban && <div className="text-xs text-muted-foreground">{line.counterpartyIban}</div>}</td>
                          <td className="p-3 min-w-48 break-words"><div>{line.description || "—"}</div>{line.reference && <div className="text-xs text-muted-foreground">Sklic: {line.reference}</div>}</td>
                          <td className="p-3 text-right tabular-nums whitespace-nowrap">{amountFormat.format(Number(line.amount))} {line.currency}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {reconstructed && (data.historicalLedger
              ? <BankStatementHistoricalLedgerView ledger={data.historicalLedger} bankAccountCode={data.bankAccountCode} currency={data.currency} />
              : <Alert data-testid="status-historical-ledger-missing"><AlertCircle className="h-4 w-4" /><AlertDescription>Povezana stara temeljnica ni bila najdena. Rekonstruirane bančne vrstice ni mogoče razčleniti na plačila.</AlertDescription></Alert>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}