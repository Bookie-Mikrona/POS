import { useEffect, useRef } from "react";
import { useGetCompany } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Suggestions are unsaved form values, never implicit bank metadata writes. */
export function CompanyBankSuggestion({ companyId, accountCode, hasSavedMetadata, draftEmpty, onSelect }: {
  companyId: string;
  accountCode?: string;
  hasSavedMetadata: boolean;
  draftEmpty: boolean;
  onSelect: (iban: string, bic: string) => void;
}) {
  const { data } = useGetCompany(companyId, { query: { enabled: !!companyId } as any });
  const accounts = (data?.trr ?? []).filter(entry => entry.iban?.trim());
  const initialized = useRef("");
  useEffect(() => {
    const key = `${companyId}:${accountCode}`;
    if (!data || initialized.current === key) return;
    initialized.current = key;
    if (accountCode === "1100000" && !hasSavedMetadata && draftEmpty && accounts[0]) {
      onSelect(accounts[0].iban, accounts[0].bic ?? "");
    }
  }, [companyId, accountCode, data, hasSavedMetadata, draftEmpty, onSelect, accounts]);

  if (!accounts.length) return null;
  return (
    <div className="space-y-2">
      <Label>Predlog TRR iz podatkov podjetja</Label>
      <Select value="" onValueChange={value => {
        const entry = accounts[Number(value)];
        if (entry) onSelect(entry.iban, entry.bic ?? "");
      }}>
        <SelectTrigger><SelectValue placeholder="Izberite TRR podjetja" /></SelectTrigger>
        <SelectContent>
          {accounts.map((entry, index) => (
            <SelectItem key={`${entry.iban}:${index}`} value={String(index)}>
              {entry.iban}{entry.bic ? ` / ${entry.bic}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Preverite, ali predlagani IBAN in BIC pripadata izbranemu analitičnemu kontu. Zapišeta se šele s »Shrani«.
      </p>
    </div>
  );
}
