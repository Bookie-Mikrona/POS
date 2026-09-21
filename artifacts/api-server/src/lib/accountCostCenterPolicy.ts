export const ACCOUNT_COST_CENTER_POLICIES = [
  "not_allowed",
  "allowed",
  "required",
] as const;

export type AccountCostCenterPolicy = (typeof ACCOUNT_COST_CENTER_POLICIES)[number];

/**
 * Izpelje začetno politiko iz kode konta.
 *
 * Stari konto z requiresCostCenter=true ima prednost pred razrednim pravilom
 * in je zato vedno required.
 */
export function defaultCostCenterPolicy(
  code: string,
  requiresCostCenter = false,
): AccountCostCenterPolicy {
  if (requiresCostCenter) return "required";
  switch (code.trim().charAt(0)) {
    case "4":
      return "required";
    case "1":
    case "2":
    case "9":
      return "not_allowed";
    case "0":
    case "7":
    default:
      return "allowed";
  }
}

/** Združljivostni boolean, vedno izpeljan iz kanonične politike. */
export function requiresCostCenterForPolicy(policy: AccountCostCenterPolicy): boolean {
  return policy === "required";
}