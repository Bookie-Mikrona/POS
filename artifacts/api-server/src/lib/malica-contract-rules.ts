export type MalicaCoverageMode = "partner_all" | "guest_reduced_price" | "partner_fixed_guest_remainder" | "split";
export type MalicaQuote = {
  regularTotalCents: number; extrasCents: number; partnerCoveredCents: number;
  guestPayableCents: number; surchargeCents: number; mode: MalicaCoverageMode | "legacy";
  contractVersion: number | null;
};
export type MalicaContractQuoteInput = {
  regularCents: number; extrasCents?: number; mode?: MalicaCoverageMode;
  splitKind?: "fixed" | "percent"; splitValue?: number;
  surchargeCents?: number; version?: number;
};
/** All amounts are integer cents; percentage splits round partner coverage down. */
export function resolveMalicaContractQuote(input: MalicaContractQuoteInput): MalicaQuote {
  const regular = Math.max(0, Math.trunc(input.regularCents));
  const extras = Math.max(0, Math.trunc(input.extrasCents ?? 0));
  const surcharge = Math.max(0, Math.trunc(input.surchargeCents ?? 0));
  const coveredBase = regular + surcharge;
  let covered = 0;
  switch (input.mode) {
    case "partner_all": covered = coveredBase; break;
    case "guest_reduced_price": covered = regular; break;
    case "partner_fixed_guest_remainder": covered = Math.min(coveredBase, Math.max(0, Math.trunc(input.splitValue ?? 0))); break;
    case "split": covered = input.splitKind === "percent"
      ? Math.min(coveredBase, Math.floor(coveredBase * Math.max(0, Math.min(100, input.splitValue ?? 0)) / 100))
      : Math.min(coveredBase, Math.max(0, Math.trunc(input.splitValue ?? 0))); break;
    default: covered = 0;
  }
  return { regularTotalCents: regular, extrasCents: extras, partnerCoveredCents: covered,
    guestPayableCents: Math.max(0, coveredBase + extras - covered), surchargeCents: surcharge,
    mode: input.mode ?? "legacy", contractVersion: input.version ?? null };
}