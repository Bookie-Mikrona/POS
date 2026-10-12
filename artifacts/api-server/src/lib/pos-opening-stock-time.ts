import { db } from "@workspace/db";
import { getBusinessDayBounds } from "./pos-business-day";

/** Document dates remain wall-clock dates; annual stock resets use the unit's real boundary. */
export async function openingStockEffectiveAt(
  enotaId: number,
  year: number,
  documentDate: Date,
  executor: Pick<typeof db, "execute"> = db,
): Promise<Date> {
  if (documentDate.toISOString().slice(0, 10) !== `${year}-01-01`) return documentDate;
  return (await getBusinessDayBounds(enotaId, `${year}-01-01`, executor)).start;
}
