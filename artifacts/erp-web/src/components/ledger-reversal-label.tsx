import { Link } from "wouter";
import type { LedgerLine } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

export function LedgerReversalLabel({
  isReversal, reversalOf, isReversed, reversedBy,
}: Pick<LedgerLine, "isReversal" | "reversalOf" | "isReversed" | "reversedBy">) {
  if (!isReversal && !isReversed) return null;
  const linkedEntryId = isReversal ? reversalOf : reversedBy;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="border-amber-500 text-amber-800 dark:text-amber-300">
        {isReversal ? "STORNO" : "STORNIRANO"}
      </Badge>
      {linkedEntryId && (
        <Link
          href={`/temeljnice?id=${encodeURIComponent(linkedEntryId)}`}
          className="text-xs text-primary underline underline-offset-2"
          title={isReversal ? "Odpri izvorno temeljnico" : "Odpri storno temeljnico"}
        >
          {isReversal ? "Original" : "Storno"}
        </Link>
      )}
    </span>
  );
}