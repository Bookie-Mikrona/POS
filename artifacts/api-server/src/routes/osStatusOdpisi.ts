import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, osAmortizacijaObracunTable, osAmortizacijaObracunSredstvoTable } from "@workspace/db";

/**
 * Uvoženi odpis na doknjižbi ostane nespremenjen tudi po obračunu.
 * Zato status v registru, kartici in glavi uporablja še shranjene obračune
 * in oslabitve (ena upsert vrstica na sredstvo/leto, ne ponovljeni izračun).
 */
export async function loadObracunaniOdpisi(
  companyId: string,
  sredstvoIds: string[],
  doLeta?: number,
): Promise<Map<string, number>> {
  if (sredstvoIds.length === 0) return new Map();
  const conditions = [
    eq(osAmortizacijaObracunTable.companyId, companyId),
    inArray(osAmortizacijaObracunSredstvoTable.sredstvoId, sredstvoIds),
  ];
  if (doLeta !== undefined) conditions.push(lte(osAmortizacijaObracunTable.leto, doLeta));
  const rows = await db.select({
    sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
    skupaj: sql<string>`sum(${osAmortizacijaObracunSredstvoTable.obracunano} + ${osAmortizacijaObracunSredstvoTable.oslabitev})`,
  }).from(osAmortizacijaObracunSredstvoTable)
    .innerJoin(osAmortizacijaObracunTable, eq(osAmortizacijaObracunTable.id, osAmortizacijaObracunSredstvoTable.obracunId))
    .where(and(...conditions))
    .groupBy(osAmortizacijaObracunSredstvoTable.sredstvoId);
  return new Map(rows.map(row => [row.sredstvoId, Number(row.skupaj)]));
}
