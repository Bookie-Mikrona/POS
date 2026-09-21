import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db, tipPoliciesTable, type TipPolicy } from "@workspace/db";

export type TipTreatment = {
  policy: TipPolicy | null;
  mode: TipPolicy["mode"] | null;
  vatAmount: number;
  feeAmount: number;
  flatFeeAmount: number;
  employeeLiability: number;
  feeTaxTreatment: "not_applicable" | "private_nondeductible" | "business_deductible" | "withheld_from_employee";
};

export function toLjubljanaDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function calculateTipTreatment(
  tipAmount: number,
  policy: TipPolicy | null,
  standardVatRate = 22,
  paymentMethod: "cash" | "card" = "card",
): TipTreatment {
  if (tipAmount <= 0) {
    return {
      policy,
      mode: policy?.mode ?? null,
      vatAmount: 0,
      feeAmount: 0,
      flatFeeAmount: 0,
      employeeLiability: 0,
      feeTaxTreatment: "not_applicable",
    };
  }
  if (!policy) throw new Error("TIP_POLICY_REQUIRED");
  if (
    (policy.mode === "direct_employee" || policy.mode === "independent_pool")
    && (!policy.agreementConfirmed || !policy.evidenceReference.trim())
  ) {
    throw new Error("TIP_POLICY_EVIDENCE_REQUIRED");
  }
  const percentage = paymentMethod === "card" && policy.cardFeeKind === "percentage" ? Number(policy.cardFeePercent ?? 0) : 0;
  const feeAmount = Math.round((tipAmount * percentage / 100 + Number.EPSILON) * 100) / 100;
  const flatFeeAmount = paymentMethod === "card" && policy.cardFeeKind === "flat" ? Number(policy.cardFeeFlatAmount ?? 0) : 0;
  if (policy.mode === "employer_controlled") {
    const vatAmount = Math.round((tipAmount * standardVatRate / (100 + standardVatRate) + Number.EPSILON) * 100) / 100;
    return {
      policy,
      mode: policy.mode,
      vatAmount,
      feeAmount,
      flatFeeAmount,
      employeeLiability: 0,
      feeTaxTreatment: policy.cardFeeKind === "none" ? "not_applicable" : "business_deductible",
    };
  }
  const deductFromTip = policy.cardFeeKind === "percentage" && policy.cardFeeTreatment === "deduct_from_tip";
  return {
    policy,
    mode: policy.mode,
    vatAmount: 0,
    feeAmount,
    flatFeeAmount,
    employeeLiability: deductFromTip
      ? Math.max(0, Math.round((tipAmount - feeAmount + Number.EPSILON) * 100) / 100)
      : tipAmount,
    feeTaxTreatment: policy.cardFeeKind === "none"
      ? "not_applicable"
      : policy.cardFeeKind === "flat"
        ? "business_deductible"
        : deductFromTip
          ? "withheld_from_employee"
          : "private_nondeductible",
  };
}

export async function resolveTipPolicy(
  companyId: string,
  enotaId: number,
  instant: Date,
  executor: any = db,
): Promise<TipPolicy | null> {
  const date = toLjubljanaDate(instant);
  const [policy] = await executor
    .select()
    .from(tipPoliciesTable)
    .where(and(
      eq(tipPoliciesTable.companyId, companyId),
      or(isNull(tipPoliciesTable.enotaId), eq(tipPoliciesTable.enotaId, enotaId)),
      lte(tipPoliciesTable.effectiveFrom, date),
      or(isNull(tipPoliciesTable.effectiveTo), gte(tipPoliciesTable.effectiveTo, date)),
    ))
    .orderBy(desc(sql`${tipPoliciesTable.enotaId} IS NOT NULL`), desc(tipPoliciesTable.effectiveFrom))
    .limit(1);
  return policy ?? null;
}