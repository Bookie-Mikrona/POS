import Decimal from "decimal.js";

export interface Pos109InvoiceLine {
  id: string;
  accountId: string;
  amount: string | number;
}

export interface Pos109Allocation {
  lineId: string;
  accountId: string;
  transferredTo109: Decimal;
  remainingExpense: Decimal;
}

/**
 * Znesek prejemnic se porabi čez neto vrstice računa po njihovem vrstnem redu.
 * Tako se zalogovni del vedno zapre na 109, preostanek računa pa ostane strošek
 * na kontih, ki jih je določil računovodja.
 */
export function allocatePos109(
  linkedReceiptNet: Decimal.Value,
  invoiceLines: Pos109InvoiceLine[],
): { allocations: Pos109Allocation[]; unallocated: Decimal } {
  let remaining = new Decimal(linkedReceiptNet);
  const allocations = invoiceLines.map((line) => {
    const amount = new Decimal(line.amount);
    const transferredTo109 = Decimal.max(new Decimal(0), Decimal.min(amount, remaining));
    remaining = Decimal.max(new Decimal(0), remaining.minus(transferredTo109));
    return {
      lineId: line.id,
      accountId: line.accountId,
      transferredTo109,
      remainingExpense: amount.minus(transferredTo109),
    };
  });

  return { allocations, unallocated: remaining };
}

export function pos109PostingReasons(input: {
  linkedReceiptNet: Decimal.Value;
  invoiceNet: Decimal.Value;
  allReceiptsBooked: boolean;
  hasLinks: boolean;
}): string[] {
  if (!input.hasLinks) return [];

  const reasons: string[] = [];
  const linked = new Decimal(input.linkedReceiptNet);
  const invoiceNet = new Decimal(input.invoiceNet);

  if (!input.allReceiptsBooked) {
    reasons.push("Ena ali več povezanih prejemnic še nima potrjene POS temeljnice na kontu 109.");
  }
  if (linked.lte(0)) {
    reasons.push("Povezane prejemnice nimajo pozitivne neto vrednosti za zapiranje konta 109.");
  }
  if (linked.gt(invoiceNet)) {
    reasons.push("Vrednost povezanih prejemnic presega neto vrednost računa, zato se konto 109 ne bi zaprl v celoti.");
  }
  return reasons;
}