import type { AccountRecord } from "@workspace/api-client-react";
import { Info } from "lucide-react";

type DimensionRequirements = Pick<AccountRecord,
  "requiresCostCenter" | "costCenterPolicy" | "requiresProject" | "requiresPartner"
>;

export function AccountDimensionHint({ account }: { account?: DimensionRequirements }) {
  const costCenterPolicy = account?.costCenterPolicy
    ?? (account?.requiresCostCenter ? "required" : "allowed");
  const dimensions = [
    costCenterPolicy === "required" && "stroškovno mesto",
    account?.requiresProject && "projekt",
    account?.requiresPartner && "partner",
  ].filter(Boolean);

  return (
    <div role="status" aria-live="polite">
      {dimensions.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Ta konto zahteva: {dimensions.join(", ")}.</span>
        </p>
      )}
    </div>
  );
}
