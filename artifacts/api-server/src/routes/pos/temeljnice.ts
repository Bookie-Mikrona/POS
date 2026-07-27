import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  accountingPeriodsTable,
} from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";

const router: IRouter = Router();

/**
 * GET /temeljnice?od=YYYY-MM-DD&do=YYYY-MM-DD
 *
 * Vrne vse temeljnice podjetja za izbrano obdobje, skupaj z vrsticami.
 * Zahteva requireEnota (nastavi req.companyId).
 */
router.get("/temeljnice", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const companyId = (req as PosRequest).companyId;

  const { od, do: doParam } = req.query as { od?: string; do?: string };
  if (!od || !doParam) {
    res.status(400).json({ error: "Manjkata parametra od in do (YYYY-MM-DD)" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" });
    return;
  }

  const entries = await db
    .select({
      id: journalEntriesTable.id,
      entryDate: journalEntriesTable.entryDate,
      reference: journalEntriesTable.reference,
      description: journalEntriesTable.description,
      status: journalEntriesTable.status,
      createdAt: journalEntriesTable.createdAt,
      postedAt: journalEntriesTable.postedAt,
      periodName: accountingPeriodsTable.name,
    })
    .from(journalEntriesTable)
    .innerJoin(
      accountingPeriodsTable,
      eq(accountingPeriodsTable.id, journalEntriesTable.periodId),
    )
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        gte(journalEntriesTable.entryDate, od),
        lte(journalEntriesTable.entryDate, doParam),
      ),
    )
    .orderBy(asc(journalEntriesTable.entryDate), desc(journalEntriesTable.createdAt));

  if (entries.length === 0) {
    res.json({ temeljnice: [] });
    return;
  }

  const entryIds = entries.map((e) => e.id);

  const lines = await db
    .select({
      entryId: journalEntryLinesTable.entryId,
      sequence: journalEntryLinesTable.sequence,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      description: journalEntryLinesTable.description,
    })
    .from(journalEntryLinesTable)
    .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .where(inArray(journalEntryLinesTable.entryId, entryIds))
    .orderBy(asc(journalEntryLinesTable.entryId), asc(journalEntryLinesTable.sequence));

  // Grupiraj vrstice po entryId
  const linesByEntry = new Map<string, typeof lines>();
  for (const line of lines) {
    if (!linesByEntry.has(line.entryId)) linesByEntry.set(line.entryId, []);
    linesByEntry.get(line.entryId)!.push(line);
  }

  const temeljnice = entries.map((e) => {
    const vrstice = linesByEntry.get(e.id) ?? [];
    const debet = vrstice
      .filter((l) => l.side === "debit")
      .reduce((s, l) => s + parseFloat(l.amount), 0);
    return {
      ...e,
      vrstice: vrstice.map((l) => ({
        kontoKoda: l.accountCode,
        kontoIme: l.accountName,
        stran: l.side,
        znesek: parseFloat(l.amount),
        opis: l.description,
      })),
      skupajDebet: debet,
    };
  });

  res.json({ temeljnice });
});

export default router;
