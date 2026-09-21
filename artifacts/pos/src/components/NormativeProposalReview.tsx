import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { NormativeProposalDraft } from "@/lib/normative-proposal-draft";

type Props = {
  draft: NormativeProposalDraft;
  confirmedTokens: Set<string>;
  loading: boolean;
  staleMessage: string | null;
  onConfirmationChange: (token: string, checked: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
};

export function NormativeProposalReview({ draft, confirmedTokens, loading, staleMessage, onConfirmationChange, onApply, onCancel }: Props) {
  const allConfirmed = draft.selected.every(row => confirmedTokens.has(row.proposalToken));
  return <section className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3" aria-label="Pregled spletnih predlogov normativa">
    <div>
      <h3 className="font-semibold">Pregled spletnih predlogov</h3>
      <p className="text-sm text-muted-foreground">Predlogi za {draft.targetName} niso še uporabljeni. Potrdite vsako spremembo posebej.</p>
    </div>
    {draft.selected.map((row, index) => {
      // Proposal tokens are signed opaque strings; never use them as DOM identifiers.
      const confirmationId = `confirm-proposal-${row.normativRowId}-${index}`;
      return (
      <div className="rounded border bg-background p-3 space-y-2" key={row.proposalToken}>
        <p className="font-medium">{row.ingredientName}: {row.oldQuantity} {row.unit ?? "–"} → {row.newQuantity} {row.unit ?? "–"}</p>
        <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline" aria-label={`Odpri vir za ${row.ingredientName}: ${row.sourceTitle}`}>{row.sourceTitle}</a>
        <label className="flex items-center gap-2 text-sm" htmlFor={confirmationId}>
          <Checkbox id={confirmationId} checked={confirmedTokens.has(row.proposalToken)}
            disabled={loading} onCheckedChange={checked => onConfirmationChange(row.proposalToken, checked === true)} />
          Potrjujem spremembo za {row.ingredientName}
        </label>
      </div>
      );
    })}
    {staleMessage && <p className="text-sm text-destructive" role="alert">{staleMessage} Primerjavo zaženite znova; predlogi niso bili uporabljeni.</p>}
    <div className="flex gap-2">
      <Button type="button" onClick={onApply} disabled={loading || !allConfirmed}>{loading ? "Uporabljam..." : "Uporabi potrjene spremembe"}</Button>
      <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Prekliči predloge</Button>
    </div>
  </section>;
}