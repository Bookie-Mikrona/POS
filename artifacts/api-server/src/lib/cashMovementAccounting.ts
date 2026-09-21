export type CashMovementType =
  | "IZPLACILO_DOBAVITELJU"
  | "POLOG_GOTOVINE"
  | "DVIG_GOTOVINE"
  | "POLOG_TRR"
  | "PRILIV_TRR"
  | "STORNO";

export interface CashMovementAccounts {
  cashAccountId: string;
  payablesAccountId: string;
  cashInTransitAccountId: string;
  bankAccountId: string;
}

export interface CashMovementLine {
  accountId: string;
  side: "debit" | "credit";
  partnerId?: string | null;
}

/**
 * POS del prenosa TRR ↔ blagajna vedno knjiži prek 109. Bančna stopnja
 * (D 110 / K 109 oziroma D 109 / K 110) je ločen ERP dogodek ob izpisku.
 */
export function cashMovementLines(
  tip: Exclude<CashMovementType, "STORNO">,
  accounts: CashMovementAccounts,
  partnerId?: string | null,
): CashMovementLine[] {
  switch (tip) {
    case "IZPLACILO_DOBAVITELJU":
      return [
        { accountId: accounts.payablesAccountId, side: "debit", partnerId: partnerId ?? null },
        { accountId: accounts.cashAccountId, side: "credit", partnerId: partnerId ?? null },
      ];
    case "POLOG_GOTOVINE":
      return [
        { accountId: accounts.cashAccountId, side: "debit" },
        { accountId: accounts.cashInTransitAccountId, side: "credit" },
      ];
    case "DVIG_GOTOVINE":
      return [
        { accountId: accounts.cashInTransitAccountId, side: "debit" },
        { accountId: accounts.bankAccountId, side: "credit" },
      ];
    case "POLOG_TRR":
      return [
        { accountId: accounts.cashInTransitAccountId, side: "debit" },
        { accountId: accounts.cashAccountId, side: "credit" },
      ];
    case "PRILIV_TRR":
      return [
        { accountId: accounts.bankAccountId, side: "debit" },
        { accountId: accounts.cashInTransitAccountId, side: "credit" },
      ];
  }
}

export function reverseCashMovementLines(lines: CashMovementLine[]): CashMovementLine[] {
  return lines.map((line) => ({
    ...line,
    side: line.side === "debit" ? "credit" : "debit",
  }));
}

export interface CashBalanceInput {
  menjalniDenar: number;
  gotovinskaProdaja: number;
  pologiGotovine: number;
  izplacilaDobaviteljem: number;
  dvigiGotovine: number;
  pologiTrr: number;
}

/** Formula za prihodnje X-poročilo; brez prihodkovne/DDV interpretacije premikov. */
export function calculateTheoreticalCashBalance(input: CashBalanceInput): number {
  return Number((
    input.menjalniDenar
    + input.gotovinskaProdaja
    + input.pologiGotovine
    - input.izplacilaDobaviteljem
    - input.pologiTrr
  ).toFixed(2));
}