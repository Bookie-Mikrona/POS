import Decimal from "decimal.js";

export type ContractSummaryPostingLine = {
  accountId: string;
  side: "debit" | "credit";
  amount: string;
  description: string;
  partnerId: string;
};

export type MalicaAllocationAccountingFacts = {
  allocationId: number;
  partnerCents: number;
  guestCents: number;
  vatBaseCents: number;
  vatCents: number;
};

export function isMalicaAllocationEligibleForClaim(params: {
  businessDate: string;
  month: string;
  orderStatus: string;
  packageStatus: string;
  alreadyClaimed: boolean;
}): boolean {
  return (
    params.businessDate.startsWith(`${params.month}-`)
    && params.orderStatus !== "preklicano"
    && params.packageStatus !== "cancelled"
    && !params.alreadyClaimed
  );
}

export function stableMalicaAllocationLockOrder(ids: number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right);
}

/** Validates the immutable arithmetic used by the monthly Malica collector. */
export function validateMalicaAllocationAccounting(
  allocation: MalicaAllocationAccountingFacts,
): void {
  if (
    allocation.partnerCents < 0
    || allocation.guestCents < 0
    || allocation.vatBaseCents < 0
    || allocation.vatCents < 0
    || allocation.vatBaseCents + allocation.vatCents !== allocation.partnerCents
  ) {
    throw new Error(`MALICA_ALLOCATION_RECONCILIATION:${allocation.allocationId}`);
  }
}

export function resolveContractSummaryDueDate(
  invoiceDate: string,
  counterpartyPaymentTermsDays: number | null | undefined,
): string {
  const date = new Date(`${invoiceDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Number(counterpartyPaymentTermsDays ?? 0)));
  return date.toISOString().slice(0, 10);
}

export function buildContractSummaryPostingLines(params: {
  invoiceNumber: string;
  month: string | null;
  counterpartyId: string;
  receivableAccountId: string;
  transitAccountId: string;
  grossAmount: string | number;
}): ContractSummaryPostingLine[] {
  const amount = new Decimal(params.grossAmount).toDecimalPlaces(2);
  if (!amount.isPositive()) throw new Error("Znesek zbirnega A-računa mora biti pozitiven.");
  return [
    {
      accountId: params.receivableAccountId,
      side: "debit",
      amount: amount.toFixed(2),
      description: `Terjatev do pogodbenega partnerja — ${params.invoiceNumber}`,
      partnerId: params.counterpartyId,
    },
    {
      accountId: params.transitAccountId,
      side: "credit",
      amount: amount.toFixed(2),
      description: `Zaprtje prehodne terjatve pogodbenih malic — ${params.month ?? params.invoiceNumber}`,
      partnerId: params.counterpartyId,
    },
  ];
}