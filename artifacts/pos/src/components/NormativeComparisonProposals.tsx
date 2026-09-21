import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { chooseOneProposal, isSafeSourceUrl, saveProposalDraft, type ProposalRow } from "@/lib/normative-proposal-draft";
import type { NormativeComparison } from "@/components/AgentLauncher";

export function isEligibleNormativeProposal(row: NormativeComparison["rows"][number]): boolean {
  return row.status === "comparable" && typeof row.normativRowId === "number"
    && !!row.proposalToken && !!row.sourceTitle && isSafeSourceUrl(row.sourceUrl)
    && typeof row.externalNormalizedQuantity === "number" && row.externalNormalizedQuantity > 0;
}

export function NormativeComparisonProposals({ comparison, onReview }: { comparison: NormativeComparison; onReview: () => void }) {
  const [selected, setSelected] = useState<ProposalRow[]>([]);
  const toggle = (row: NormativeComparison["rows"][number]) => {
    if (!isEligibleNormativeProposal(row)) return;
    const proposal: ProposalRow = {
      normativRowId: row.normativRowId, proposalToken: row.proposalToken!, ingredientName: row.ingredientName,
      oldQuantity: row.localQuantity, newQuantity: row.externalNormalizedQuantity!, unit: row.localUnit,
      sourceTitle: row.sourceTitle!, sourceUrl: row.sourceUrl!,
    };
    setSelected(previous => chooseOneProposal(previous, proposal));
  };
  const review = () => {
    saveProposalDraft({ version: 1, artikelId: comparison.localNormative.artikelId, targetName: comparison.localNormative.targetName, generatedAt: comparison.generatedAt, selected });
    onReview();
  };
  return <div className="mt-2 space-y-1.5">
    {comparison.rows.map((row, index) => {
      const eligible = isEligibleNormativeProposal(row);
      const checked = eligible && selected.some(item => item.proposalToken === row.proposalToken);
      const checkboxId = `proposal-${row.normativRowId}-${index}`;
      return <div key={`${row.normativRowId ?? row.ingredientId}-${row.proposalToken ?? row.sourceUrl ?? "missing"}`} className="border-t border-border pt-1.5">
        <span className="font-medium">{row.ingredientName}: </span>
        <span>{row.localQuantity} {row.localUnit ?? "–"} / {row.externalQuantity === null ? "ni podatka" : `${row.externalQuantity} ${row.externalUnit ?? ""}${row.servings ? ` na porcijo (${row.servings} porcij)` : ""}`}</span>
        {row.status === "comparable" && <span className="ml-1 text-muted-foreground">({row.localNormalizedQuantity} → {row.externalNormalizedQuantity} {row.comparisonUnit}; {row.difference! >= 0 ? "+" : ""}{row.difference} {row.comparisonUnit}; {row.percentDifference === null ? "delež ni določen" : `${row.percentDifference.toFixed(1)}%`})</span>}
        {!eligible && <span className="ml-1 text-muted-foreground">({row.status !== "comparable" ? "ni primerljivo" : "predlog nima preverjenega vira"})</span>}
        {row.sourceUrl && isSafeSourceUrl(row.sourceUrl) && row.sourceTitle
          ? <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline" aria-label={`Odpri vir za ${row.ingredientName}: ${row.sourceTitle}`}>{row.sourceTitle}</a>
          : <span className="ml-1 text-muted-foreground">[{row.sourceUrl ? "vir ni preverjen" : "vir ni naveden"}]</span>}
        {eligible && <label className="mt-1 flex items-center gap-2" htmlFor={checkboxId}>
          <Checkbox id={checkboxId} checked={checked} onCheckedChange={() => toggle(row)} />
          Izberi predlog vira za {row.ingredientName}
        </label>}
      </div>;
    })}
    {selected.length > 0 && <Button type="button" size="sm" onClick={review}>Preglej {selected.length} {selected.length === 1 ? "predlog" : "predloga"} v urejevalniku</Button>}
  </div>;
}