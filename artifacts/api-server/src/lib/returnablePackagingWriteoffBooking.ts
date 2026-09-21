import type { ReturnablePackagingJournalLine } from "./returnablePackagingBooking";

/** Pure, cent-rounded booking for destroyed packaging; never touches supplier payables. */
export function buildReturnablePackagingWriteoffBooking(input: {
  packagingAccountId: string;
  writeoffAccountId: string;
  quantity: number;
  deposit: number;
}): ReturnablePackagingJournalLine[] {
  const cents = Math.round((input.quantity * input.deposit + Number.EPSILON) * 100);
  const amount = (cents / 100).toFixed(2);
  return [
    { accountId: input.writeoffAccountId, side: "debit", amount, partnerId: null, vatAmount: "0.00" },
    { accountId: input.packagingAccountId, side: "credit", amount, partnerId: null, vatAmount: "0.00" },
  ];
}