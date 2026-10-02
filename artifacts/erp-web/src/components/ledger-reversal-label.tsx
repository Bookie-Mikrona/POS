import { Link } from "wouter";
import type { LedgerLine } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

export function LedgerReversalLabel({
  isReversal, reversalOf,
}: Pick<LedgerLine, "isReversal" | "reversalOf">) {
  if (!isReversal) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="border-amber-500 text-amber-800 dark:text-amber-300">
        STORNO
      </Badge>
      {reversalOf && (
        <Link
          href={`/temeljnice?id=${encodeURIComponent(reversalOf)}`}
          className="text-xs text-primary underline underline-offset-2"
          title="Odpri izvorno temeljnico"
        >
          Original
        </Link>
      )}
    </span>
  );
}