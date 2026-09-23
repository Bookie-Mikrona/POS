import type { MalicaQuote, MalicaQuoteCoursesItem, MalicaQuoteCoursesItemClassification } from "@workspace/api-client-react";

export function formatQuoteCents(cents: number): string {
  return (cents / 100).toFixed(2) + " €";
}

export function formatLimitCents(cents: number | null | undefined): string {
  if (cents == null) return "Brez omejitve";
  return formatQuoteCents(cents);
}

export function isCourseIncluded(course: MalicaQuoteCoursesItem): boolean {
  return course.classification === "included";
}

export function mapLimitErrorToMessage(mode: string, remainingDaily?: number | null, remainingBeneficiaryMonthlyCents?: number | null, remainingContractMonthlyCents?: number | null): string | null {
  if (remainingDaily !== undefined && remainingDaily !== null && remainingDaily <= 0) {
    return "Presežena dnevna omejitev malic";
  }
  if (remainingBeneficiaryMonthlyCents !== undefined && remainingBeneficiaryMonthlyCents !== null && remainingBeneficiaryMonthlyCents <= 0) {
    return "Presežena mesečna omejitev kritja za upravičenca";
  }
  if (remainingContractMonthlyCents !== undefined && remainingContractMonthlyCents !== null && remainingContractMonthlyCents <= 0) {
    return "Presežena mesečna omejitev kritja po pogodbi";
  }
  return null;
}

export function formatContractPayloadModeValues(
  contractMode: string,
  splitKind: string,
  splitValueInput: string
): { splitKind?: "fixed" | "percent"; splitValue?: number } {
  if (contractMode === "partner_fixed_guest_remainder") {
    const val = Number(splitValueInput.replace(",", "."));
    if (isNaN(val) || val <= 0) throw new Error("Vnesite veljaven znesek kritja partnerja.");
    return { splitValue: Math.round(val * 100) };
  }
  if (contractMode === "split") {
    const val = Number(splitValueInput.replace(",", "."));
    if (isNaN(val) || val <= 0) throw new Error("Vnesite veljavno vrednost delitve.");
    return {
      splitKind: splitKind as "fixed" | "percent",
      splitValue: splitKind === "percent" ? Math.round(val) : Math.round(val * 100)
    };
  }
  return {};
}
