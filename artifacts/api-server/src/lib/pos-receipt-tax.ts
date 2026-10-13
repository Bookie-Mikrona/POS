import Decimal from "decimal.js";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, racuniTable, postavkeTable, artikliTable } from "@workspace/db";

/**
 * Razrez je analitika izdanega računa, ne nov davčni obračun. Centno razliko
 * med teoretičnimi postavkami in shranjenim DDV pripišemo največji davčni osnovi.
 * Ničelna stopnja nikoli ne dobi DDV. Predznak storna ostane nespremenjen.
 */
export function allocateReceiptTax<T extends { bruto: string; davek: string }>(
  groups: T[], receiptVat: string, receiptGross?: string,
) {
  const result = groups.map(group => {
    const gross = new Decimal(group.bruto);
    const rate = new Decimal(group.davek);
    const vat = rate.gt(0)
      ? gross.times(rate).div(rate.plus(100)).toDecimalPlaces(2)
      : new Decimal(0);
    return { ...group, bruto: gross.toFixed(2), neto: gross.minus(vat).toFixed(2), ddv: vat.toFixed(2) };
  });
  const gross = result.reduce((sum, row) => sum.plus(row.bruto), new Decimal(0));
  if (receiptGross != null && !gross.eq(new Decimal(receiptGross))) {
    throw new Error("POS davčni razrez: vsota postavk se ne ujema z izdanim računom");
  }
  const difference = new Decimal(receiptVat).minus(
    result.reduce((sum, row) => sum.plus(row.ddv), new Decimal(0)),
  );
  if (!difference.isZero()) {
    const taxable = result.filter(row => new Decimal(row.davek).gt(0))
      .sort((a, b) => new Decimal(b.bruto).abs().cmp(new Decimal(a.bruto).abs()));
    if (!taxable[0]) throw new Error("POS davčni razrez: DDV brez obdavčene postavke");
    const row = taxable[0];
    row.ddv = new Decimal(row.ddv).plus(difference).toFixed(2);
    row.neto = new Decimal(row.bruto).minus(row.ddv).toFixed(2);
  }
  return result;
}

/** Izvorni račun in njegov storno sta dve listini; ne izločimo samo pozitivne. */
export function bookingReceiptStatus() {
  return sql`(
    ${racuniTable.status} <> 'storniran' OR EXISTS (
      SELECT 1 FROM racuni reversal
      WHERE reversal.izvorni_racun_id = ${racuniTable.id}
        AND reversal.enota_id = ${racuniTable.enotaId}
        AND reversal.je_storno = TRUE AND reversal.status <> 'storniran'
    )
  )`;
}

export function sumReceiptTaxGroups<T extends {
  kategorijaId: number | null; vrstaArtikla: string | null;
  davek: string; bruto: string; neto: string; ddv: string;
}>(rows: T[]): T[] {
  const sums = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.kategorijaId}|${row.vrstaArtikla}|${new Decimal(row.davek).toFixed(2)}`;
    const previous = sums.get(key);
    sums.set(key, previous ? {
      ...previous,
      bruto: new Decimal(previous.bruto).plus(row.bruto).toFixed(2),
      neto: new Decimal(previous.neto).plus(row.neto).toFixed(2),
      ddv: new Decimal(previous.ddv).plus(row.ddv).toFixed(2),
    } : { ...row });
  }
  return [...sums.values()];
}

export async function loadReceiptTaxGroups(where: SQL) {
  const rows = await db.select({
    racunId: racuniTable.id,
    receiptVat: racuniTable.ddv,
    receiptGross: racuniTable.skupaj,
    kategorijaId: sql<number | null>`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
    vrstaArtikla: postavkeTable.vrstaArtikla,
    davek: postavkeTable.davek,
    bruto: sql<string>`SUM(${postavkeTable.skupaj}::numeric)`,
  }).from(postavkeTable)
    .innerJoin(racuniTable, eq(racuniTable.id, postavkeTable.racunId))
    .leftJoin(artikliTable, eq(artikliTable.id, postavkeTable.artikelId))
    .where(and(where))
    .groupBy(racuniTable.id,
      sql`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`,
      postavkeTable.vrstaArtikla, postavkeTable.davek)
    .orderBy(racuniTable.id, postavkeTable.davek, postavkeTable.vrstaArtikla,
      sql`COALESCE(${postavkeTable.kategorijaId}, ${artikliTable.kategorijaId})`);
  const receipts = new Map<number, typeof rows>();
  for (const row of rows) {
    const groups = receipts.get(row.racunId) ?? [];
    groups.push(row);
    receipts.set(row.racunId, groups);
  }
  return [...receipts.values()].flatMap(groups =>
    allocateReceiptTax(groups, groups[0]!.receiptVat, groups[0]!.receiptGross),
  );
}
