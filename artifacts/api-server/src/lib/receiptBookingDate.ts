import { businessDateForInstant, getEnotaBusinessDayStart } from "./pos-business-day";

/** Use the receipt's fiscal timestamp, including simulation, not the server clock. */
export async function receiptBookingDate(enotaId: number, issuedAt: Date): Promise<string> {
  return businessDateForInstant(issuedAt, await getEnotaBusinessDayStart(enotaId));
}
