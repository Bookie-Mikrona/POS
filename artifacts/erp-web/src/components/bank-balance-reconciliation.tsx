import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getGetLedgerQueryKey, useGetLedger } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDatum } from "@/lib/utils";

// Compare integer cents, so exactly one cent never triggers a floating-point warning.
export function moneyCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  const cents = (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) *
    (normalized.startsWith("-") ? -1 : 1);
  return Number.isSafeInteger(cents) ? cents : null;
}

const euros = (cents: number) =>
  new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(cents / 100);

export function BankBalanceReconciliation({
  companyId, accountId, accountCode,
}: { companyId: string; accountId: string; accountCode: string }) {
  const [statementBalance, setStatementBalance] = useState("");
  const [statementDate, setStatementDate] = useState(() =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" }));
  const params = { accountId, dateTo: statementDate, recentLimit: 1 };
  const { data, isLoading, isError, isFetching, isPlaceholderData } = useGetLedger(
    companyId,
    params,
    { query: {
      queryKey: getGetLedgerQueryKey(companyId, params),
      enabled: !!companyId && !!accountId && !!statementDate,
      placeholderData: () => undefined,
      staleTime: 0, refetchInterval: 60_000,
    } },
  );
  const ready = !!statementDate && !isLoading && !isError && !isFetching && !isPlaceholderData;
  const debit = ready && data ? moneyCents(data.totalDebit) : null;
  const credit = ready && data ? moneyCents(data.totalCredit) : null;
  const booked = debit !== null && credit !== null ? debit - credit : null;
  const actual = moneyCents(statementBalance);
  const difference = booked !== null && actual !== null && !isError && !isFetching
    ? booked - actual : null;
  const invalid = statementBalance.trim() !== "" && actual === null;
  const inputId = `statement-balance-${accountId}`;

  return (
    <div className="mx-1.5 mb-3 mt-1 space-y-2 rounded border border-border/60 p-2 text-xs">
      <div className="space-y-1">
        <Label htmlFor={`${inputId}-date`} className="text-xs">Presečni datum izpiska · {accountCode}</Label>
        <Input
          id={`${inputId}-date`}
          type="date"
          value={statementDate}
          onChange={event => setStatementDate(event.target.value)}
          className="h-8"
          required
        />
      </div>
      <p className="flex justify-between gap-2">
        <span className="text-muted-foreground">
          Knjiženi saldo · {accountCode}{statementDate ? ` · do vključno ${formatDatum(statementDate)}` : ""}
        </span>
        <span className="font-semibold tabular-nums">
          {!statementDate ? "Izberite datum" : isLoading || isFetching ? "Nalaganje …" : booked === null ? "Ni na voljo" : euros(booked)}
        </span>
      </p>
      <div className="space-y-1">
        <Label htmlFor={inputId} className="text-xs">Stanje po bančnem izpisku · {accountCode} (€)</Label>
        <Input
          id={inputId}
          type="text"
          inputMode="decimal"
          placeholder="npr. 1234,56"
          value={statementBalance}
          onChange={event => setStatementBalance(event.target.value)}
          aria-invalid={invalid}
          aria-describedby={`${inputId}-help${invalid ? ` ${inputId}-error` : ""}`}
          className="h-8 tabular-nums"
        />
        <p id={`${inputId}-help`} className="text-[11px] text-muted-foreground">
          Primerjava velja na izbrani presečni datum, vključno s knjižbami tega dne.
          Ročni vnos je le za primerjavo in se ne shrani ter ne spreminja kritja za pripravo plačil.
        </p>
        {invalid && <p id={`${inputId}-error`} className="text-destructive">Vnesite veljaven znesek z največ dvema decimalnima mestoma.</p>}
      </div>
      {isError && <p role="alert" className="text-destructive">Knjiženega salda ni bilo mogoče naložiti. Primerjava ni na voljo.</p>}
      {difference !== null && (
        Math.abs(difference) > 1 ? (
          <Alert variant="destructive" className="border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" role="alert">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Saldo ni usklajen z bančnim izpiskom.
              <span className="mt-1 block font-semibold tabular-nums">Razlika (knjige − izpisek): {euros(difference)}</span>
            </AlertDescription>
          </Alert>
        ) : (
          <p role="status" className="text-emerald-700 dark:text-emerald-400">
            Saldo je usklajen v okviru 0,01 €. Razlika (knjige − izpisek): {euros(difference)}
          </p>
        )
      )}
    </div>
  );
}