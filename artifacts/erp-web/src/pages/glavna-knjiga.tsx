import React, { useState } from "react";
import { Search, BookMarked, AlertCircle, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useGetLedger,
  useListAccounts,
  useListPeriods,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function GlavnaKnjiga() {
  const { activeCompany } = useCompany();

  // Filters state
  const [accountId, setAccountId] = useState<string>("all");
  const [periodId, setPeriodId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Applied filters (what we actually fetch)
  const [appliedFilters, setAppliedFilters] = useState<{
    accountId?: string;
    periodId?: string;
    dateFrom?: string;
    dateTo?: string;
  } | null>(null);

  // Lists for dropdowns
  const { data: accountsData } = useListAccounts(
    activeCompany?.id ?? "",
    {},
    { query: { enabled: !!activeCompany?.id } as any }
  );
  const accounts = accountsData?.accounts?.filter(a => a.isActive) || [];

  const { data: periodsData } = useListPeriods(
    activeCompany?.id ?? "",
    { query: { enabled: !!activeCompany?.id } as any }
  );
  const periods = periodsData?.periods ?? [];

  // Ledger query
  const { data: ledgerData, isLoading, error } = useGetLedger(
    activeCompany?.id ?? "",
    appliedFilters || {},
    { query: { enabled: !!activeCompany?.id && appliedFilters !== null } as any }
  );

  const lines = ledgerData?.lines ?? [];
  const totalDebit = ledgerData?.totalDebit ? parseFloat(ledgerData.totalDebit) : 0;
  const totalCredit = ledgerData?.totalCredit ? parseFloat(ledgerData.totalCredit) : 0;
  const balance = totalDebit - totalCredit;

  const handleSearch = () => {
    setAppliedFilters({
      accountId: accountId !== "all" ? accountId : undefined,
      periodId: periodId !== "all" ? periodId : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  };

  const isSearchable = accountId !== "all" || periodId !== "all" || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Konto kartica / Glavna knjiga</h1>
        <p className="text-muted-foreground mt-1">Pregled prometa in salda po kontih.</p>
      </div>

      <div className="bg-card p-5 rounded-lg border shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Konto</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Vsi konti" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsi konti</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Obdobje</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger>
                <SelectValue placeholder="Vsa obdobja" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Vsa obdobja</SelectItem>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Od datuma</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Do datuma</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSearch} disabled={!isSearchable || isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Išči
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka</AlertTitle>
          <AlertDescription>Prišlo je do napake pri nalaganju glavne knjige.</AlertDescription>
        </Alert>
      ) : !appliedFilters ? (
        <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <BookMarked className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Glavna knjiga</h2>
          <p className="text-muted-foreground max-w-md">
            Izberite konto, obdobje ali razpon datumov in kliknite "Išči" za prikaz gibanj in prometa.
          </p>
        </div>
      ) : isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-[400px] w-full" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="text-sm font-medium text-muted-foreground mb-1">Skupaj Breme</div>
                <div className="text-2xl font-bold">{totalDebit.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm font-medium text-muted-foreground mb-1">Skupaj Dobro</div>
                <div className="text-2xl font-bold">{totalCredit.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card className={balance > 0 ? "bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900" : balance < 0 ? "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900" : ""}>
              <CardContent className="p-6">
                <div className="text-sm font-medium text-muted-foreground mb-1">Saldo (D - K)</div>
                <div className={`text-2xl font-bold ${balance > 0 ? "text-green-600 dark:text-green-500" : balance < 0 ? "text-red-600 dark:text-red-500" : ""}`}>
                  {balance.toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Datum</TableHead>
                  <TableHead>Opis</TableHead>
                  <TableHead>Sklic</TableHead>
                  <TableHead className="w-[200px]">Konto</TableHead>
                  <TableHead className="text-right w-[120px]">Breme</TableHead>
                  <TableHead className="text-right w-[120px]">Dobro</TableHead>
                  <TableHead className="text-right w-[140px]">Tekoče stanje</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length > 0 ? (
                  lines.map((line, i) => {
                    const debit = parseFloat(line.debit);
                    const credit = parseFloat(line.credit);
                    const running = parseFloat(line.runningBalance);

                    return (
                      <TableRow key={`${line.entryId}-${i}`}>
                        <TableCell className="font-medium whitespace-nowrap">{new Date(line.entryDate).toLocaleDateString("sl-SI")}</TableCell>
                        <TableCell>{line.description}</TableCell>
                        <TableCell className="text-muted-foreground">{line.reference || "-"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{line.accountCode}</div>
                          <div className="text-xs text-muted-foreground truncate" title={line.accountName}>{line.accountName}</div>
                        </TableCell>
                        <TableCell className="text-right">{debit !== 0 ? debit.toFixed(2) : ""}</TableCell>
                        <TableCell className="text-right">{credit !== 0 ? credit.toFixed(2) : ""}</TableCell>
                        <TableCell className={`text-right font-medium ${running > 0 ? "text-green-600" : running < 0 ? "text-red-600" : ""}`}>
                          {running.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      Ni najdenih postavk za izbrane filtre.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
