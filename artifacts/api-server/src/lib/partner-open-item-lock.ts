import { inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type LockedPartnerOpenItemLine = {
  id: string;
  partner_id: string | null;
  account_id: string;
  side: "debit" | "credit";
  amount: string;
  company_id: string;
  status: string;
};

/**
 * Global row-lock primitive for manual settlements and payment-ledger posting.
 * Every caller locks source and counterpart journal rows in the same sorted
 * order so neither workflow can validate against a stale open remainder.
 */
export async function lockPartnerOpenItemLines(
  executor: Pick<typeof db, "execute">,
  companyId: string,
  lineIds: readonly string[],
): Promise<LockedPartnerOpenItemLine[]> {
  const ids = [...new Set(lineIds)].sort();
  if (ids.length === 0) return [];
  const result = await executor.execute<LockedPartnerOpenItemLine>(sql`
    SELECT l.id, l.partner_id, l.account_id,
      CASE WHEN l.amount < 0 THEN
        CASE WHEN l.side::text = 'debit' THEN 'credit' ELSE 'debit' END
        ELSE l.side::text END AS side,
      l.amount, e.company_id, e.status
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    WHERE ${inArray(sql`l.id`, ids)} AND e.company_id = ${companyId}
    ORDER BY l.id
    FOR UPDATE
  `);
  return result.rows ?? [];
}