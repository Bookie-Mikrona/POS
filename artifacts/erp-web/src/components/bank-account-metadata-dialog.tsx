import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings2 } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { CompanyBankSuggestion } from "@/components/company-bank-suggestion";
import {
  useListBankStatementAccounts,
  useSetBankAccountMetadata,
  getListBankStatementAccountsQueryKey,
  getGetBankBalanceQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface BankAccountMetadataDialogProps {
  companyId: string;
  accountId: string;
  disabled?: boolean;
  onSaved?: () => void;
}

/**
 * Button + dialog for editing source TRR IBAN/BIC of a 110x bank account.
 * Backend exposes no bank-name field; only IBAN, BIC and the fixed SEPA profile.
 * The generated client has no GET hook, so current values come from the
 * bank statement accounts list (bankDetails).
 */
export function BankAccountMetadataDialog({ companyId, accountId, disabled, onSaved }: BankAccountMetadataDialogProps) {
  const { activeCompany } = useCompany();
  const role = activeCompany?.role as string | undefined;
  const allowed = role === "owner" || role === "accountant";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { data, isLoading } = useListBankStatementAccounts(companyId, { query: { enabled: !!companyId && open } as any });
  const save = useSetBankAccountMetadata();
  const current = data?.bankDetails.find(d => d.bankAccountId === accountId);

  useEffect(() => {
    if (!open) return;
    setIban(current?.iban ?? "");
    setBic(current?.bic ?? "");
    setErr(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current?.iban, current?.bic]);

  const submit = () => {
    setErr(null);
    setSaved(false);
    save.mutate(
      {
        companyId,
        bankAccountId: accountId,
        data: {
          iban: iban.replace(/\s+/g, "").toUpperCase(),
          bic: bic.trim() ? bic.trim().toUpperCase() : null,
          sepaProfile: "pain.001.001.03",
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          queryClient.invalidateQueries({ queryKey: getListBankStatementAccountsQueryKey(companyId) });
          queryClient.invalidateQueries({ queryKey: getGetBankBalanceQueryKey(companyId) });
          onSaved?.();
        },
        onError: (e: any) => setErr(e?.data?.error ?? e?.message ?? "Shranjevanje ni uspelo."),
      },
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !allowed || !accountId}
        title={!allowed ? "Urejanje je dovoljeno lastniku in računovodji." : undefined}
        onClick={() => setOpen(true)}
      >
        <Settings2 className="mr-1.5 h-3 w-3" />IBAN / BIC
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Izvorni TRR (IBAN)</DialogTitle>
            <DialogDescription>
              Sprememba velja za prihodnje pakete. Že pripravljeni paketi in njihov zamrznjen XML se ne spremenijo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>IBAN</Label>
              <Input value={iban} onChange={e => setIban(e.target.value)} placeholder="SI56..." disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label>BIC (neobvezno)</Label>
              <Input value={bic} onChange={e => setBic(e.target.value)} disabled={isLoading} />
            </div>
            <p className="text-xs text-muted-foreground">Profil XML: pain.001.001.03</p>
            {!isLoading && <CompanyBankSuggestion
              companyId={companyId}
              accountCode={data?.bankAccounts.find(a => a.id === accountId)?.code}
              hasSavedMetadata={!!current}
              draftEmpty={!iban && !bic}
              onSelect={(suggestedIban, suggestedBic) => { setIban(suggestedIban); setBic(suggestedBic); }}
            />}
            {err && <Alert variant="destructive"><AlertDescription>{err}</AlertDescription></Alert>}
            {saved && <Alert><AlertDescription>Shranjeno.</AlertDescription></Alert>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Zapri</Button>
            <Button onClick={submit} disabled={!iban.trim() || save.isPending || isLoading}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Integration example (selected bank account in the new payment sheet):
// {formData.bankAccountId && (
//   <BankAccountMetadataDialog companyId={activeCompany.id} accountId={formData.bankAccountId} />
// )}
