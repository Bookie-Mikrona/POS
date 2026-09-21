import { and, eq, sql } from "drizzle-orm";
import {
  journalEntriesTable,
  journalEntryLinesTable,
  tipAllocationsTable,
  tipPoolEntriesTable,
  tipSettlementRecoveriesTable,
  tipSettlementsTable,
} from "@workspace/db";

type TipStornoInput = {
  racunId: number;
  actor: string;
  evidenceReference: string;
};

/** Append one idempotent reversal for a settlement journal, if it exists. */
export async function reverseTipSettlementJournal(
  tx: any,
  companyId: string,
  allocationId: string,
  actor: string,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tip-settlement:${allocationId}`}))`);
  const [original] = await tx.select({
    id: journalEntriesTable.id, periodId: journalEntriesTable.periodId,
    documentDate: journalEntriesTable.documentDate, entryDate: journalEntriesTable.entryDate,
  }).from(journalEntriesTable).where(and(
    eq(journalEntriesTable.companyId, companyId),
    eq(journalEntriesTable.reference, `POS:TIP-SETTLEMENT:${allocationId}`),
  )).limit(1);
  if (!original) return;
  const [alreadyReversed] = await tx.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reversalOf, original.id))).limit(1);
  if (alreadyReversed) return;
  const lines: Array<{
    accountId: string;
    side: "debit" | "credit";
    amount: string;
    description: string | null;
  }> = await tx.select({
    accountId: journalEntryLinesTable.accountId, side: journalEntryLinesTable.side,
    amount: journalEntryLinesTable.amount, description: journalEntryLinesTable.description,
  }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, original.id));
  const [reversal] = await tx.insert(journalEntriesTable).values({
    companyId, periodId: original.periodId, documentDate: original.documentDate, entryDate: original.entryDate,
    description: `Storno poravnave obveznosti napitnine ${allocationId}`,
    reference: `POS:TIP-SETTLEMENT:${allocationId}:REVERSAL`,
    status: "draft", reversalOf: original.id, sourceType: "document", createdBy: actor,
  }).returning({ id: journalEntriesTable.id });
  await tx.insert(journalEntryLinesTable).values(lines.map((line, index) => ({
    entryId: reversal.id, accountId: line.accountId,
    side: line.side === "debit" ? "credit" as const : "debit" as const,
    amount: line.amount, description: line.description, sequence: index + 1,
  })));
}

/**
 * Reverses the economic effect of all tip allocations for a fiscal receipt.
 * Original allocations, pool movements and settlements stay intact; their
 * effect is cancelled with append-only pool/recovery records.
 */
export async function compensateTipAllocationsForReceipt(
  tx: any,
  input: TipStornoInput,
): Promise<void> {
  const allocations = await tx
    .select()
    .from(tipAllocationsTable)
    .where(eq(tipAllocationsTable.racunId, input.racunId));

  for (const allocation of allocations) {
    if (allocation.tipPoolId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${allocation.tipPoolId}))`);

      const [poolEntry] = await tx
        .select()
        .from(tipPoolEntriesTable)
        .where(and(
          eq(tipPoolEntriesTable.companyId, allocation.companyId),
          eq(tipPoolEntriesTable.allocationId, allocation.id),
          eq(tipPoolEntriesTable.entryType, "allocation"),
        ))
        .limit(1);

      if (poolEntry) {
        const [existingReversal] = await tx
          .select({ id: tipPoolEntriesTable.id })
          .from(tipPoolEntriesTable)
          .where(and(
            eq(tipPoolEntriesTable.companyId, allocation.companyId),
            eq(tipPoolEntriesTable.reversalOfId, poolEntry.id),
          ))
          .limit(1);

        if (!existingReversal) {
          await tx.insert(tipPoolEntriesTable).values({
            companyId: allocation.companyId,
            poolId: allocation.tipPoolId,
            allocationId: allocation.id,
            entryType: "reversal",
            amount: String(-Number(poolEntry.amount)),
            reversalOfId: poolEntry.id,
            evidenceReference: input.evidenceReference,
            createdBy: input.actor,
          });
        }
      }
    }

    const [settlement] = await tx
      .select()
      .from(tipSettlementsTable)
      .where(and(
        eq(tipSettlementsTable.companyId, allocation.companyId),
        eq(tipSettlementsTable.allocationId, allocation.id),
      ))
      .limit(1);

    if (settlement) {
      await tx
        .insert(tipSettlementRecoveriesTable)
        .values({
          companyId: allocation.companyId,
          allocationId: allocation.id,
          settlementId: settlement.id,
          amount: allocation.netAmount,
          evidenceReference: input.evidenceReference,
          createdBy: input.actor,
        })
        .onConflictDoNothing({ target: tipSettlementRecoveriesTable.settlementId });
      await reverseTipSettlementJournal(tx, allocation.companyId, allocation.id, input.actor);
    }

    if (allocation.status !== "cancelled") {
      await tx
        .update(tipAllocationsTable)
        .set({ status: "cancelled", updatedBy: input.actor, updatedAt: new Date() })
        .where(and(
          eq(tipAllocationsTable.id, allocation.id),
          eq(tipAllocationsTable.companyId, allocation.companyId),
        ));
    }
  }
}