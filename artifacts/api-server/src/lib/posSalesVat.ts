import Decimal from "decimal.js";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db, vatCodeTable } from "@workspace/db";

/** Resolve the global, versioned FURS codes at the document date, not today. */
export async function loadPosSalesVatCodes(date: string): Promise<Map<string, string>> {
  const rows = await db.select({
    id: vatCodeTable.id, code: vatCodeTable.code, rate: vatCodeTable.rate,
  }).from(vatCodeTable).where(and(
    inArray(vatCodeTable.code, ["S22", "S95", "S5"]),
    eq(vatCodeTable.direction, "OUT"),
    lte(vatCodeTable.validFrom, date),
    or(isNull(vatCodeTable.validTo), gte(vatCodeTable.validTo, date)),
  ));
  const codes = new Map<string, string>();
  for (const row of rows) {
    const rate = new Decimal(row.rate).toFixed(2);
    if (codes.has(rate)) throw new Error(`Več veljavnih FURS DDV kod ${row.code} za ${date}`);
    codes.set(rate, row.id);
  }
  return codes;
}

/** Metadata belongs on the NET revenue line, never the VAT liability line.
 * Issued receipt tax takes precedence over recalculation (cent reconciliation).
 * Signed amounts are applied when projecting journal lines into the VAT ledger.
 */
export function posRevenueVat(
  codes: Map<string, string>,
  rate: Decimal,
  net: Decimal,
  issuedVat = net.times(rate).div(100).toDecimalPlaces(2),
): { vatCodeId?: string; vatAmount?: string } {
  if (rate.isZero()) return {};
  const vatCodeId = codes.get(rate.toFixed(2));
  if (!vatCodeId) throw new Error(`Manjka veljavna izhodna FURS DDV koda za stopnjo ${rate.toString()} %`);
  return { vatCodeId, vatAmount: issuedVat.abs().toFixed(2) };
}
