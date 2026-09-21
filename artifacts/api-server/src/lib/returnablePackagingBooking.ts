export type ReturnablePackagingJournalLine = {
  accountId: string;
  side: "debit" | "credit";
  amount: string;
  partnerId: string | null;
  vatAmount: string;
};

/** Pure, cent-rounded evidence builder used by the return route and tests. */
export function buildReturnablePackagingBooking(input: {
  packagingAccountId: string;
  payablesAccountId: string;
  supplierId: string;
  quantity: number;
  deposit: number;
}): ReturnablePackagingJournalLine[] {
  const cents = Math.round((input.quantity * input.deposit + Number.EPSILON) * 100);
  const amount = (cents / 100).toFixed(2);
  return [
    { accountId: input.payablesAccountId, side: "debit", amount, partnerId: input.supplierId, vatAmount: "0.00" },
    { accountId: input.packagingAccountId, side: "credit", amount, partnerId: null, vatAmount: "0.00" },
  ];
}