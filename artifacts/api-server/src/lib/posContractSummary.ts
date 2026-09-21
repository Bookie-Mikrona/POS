import Decimal from "decimal.js";

export type ContractSummaryPostingLine = {
  accountId: string;
  side: "debit" | "credit";
  amount: string;
  description: string;
  partnerId: string;
};

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