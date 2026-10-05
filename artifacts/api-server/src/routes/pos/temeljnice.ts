import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lte, notLike, or } from "drizzle-orm";
import {
  db,
  journalEntriesTable as journalEntriesTableErp,
  journalEntryLinesTable as journalEntryLinesTableErp,
  accountsTable,
  accountingPeriodsTable,
  posBookingDraftsTable,
  posBookingDraftLinesTable,
  companyModulesTable,
} from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";
import { syncPosBookingForDay, syncPosBookingForMonth } from "../../lib/posSyncBooking";
import { transferPosDrafts } from "../../lib/posDraftTransfer";
import { z } from "zod";

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

  const allEntries: Array<{ id: string; entryDate: string; createdAt: Date } & Record<string, unknown>> = [];
  // POS arhiv ostane viden tudi po poznejšem vklopu GK, vendar se ne prenese vanjo.
  for (const [journalEntriesTable, journalEntryLinesTable] of [
    [journalEntriesTableErp, journalEntryLinesTableErp],
    [posBookingDraftsTable, posBookingDraftLinesTable],
  ] as const) {
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
    .leftJoin(
      accountingPeriodsTable,
      eq(accountingPeriodsTable.id, journalEntriesTable.periodId),
    )
    .where(
      and(
        eq(journalEntriesTable.companyId, companyId),
        gte(journalEntriesTable.entryDate, od),
        lte(journalEntriesTable.entryDate, doParam),
        // Kopija po izrecnem prenosu se prikazuje v GK, ne še enkrat poleg
        // izvirnika v POS (sicer bi skupni znesek v POS šteli dvakrat).
        journalEntriesTable === journalEntriesTableErp
          ? or(isNull(journalEntriesTable.reference), notLike(journalEntriesTable.reference, "POS:PRENOS:%"))
          : undefined,
      ),
    )
    .orderBy(asc(journalEntriesTable.entryDate), desc(journalEntriesTable.createdAt));

  if (entries.length === 0) {
    continue;
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

  const isPosArchive = journalEntriesTable === posBookingDraftsTable;
  allEntries.push(...temeljnice.map(entry => ({ ...entry, posArchive: isPosArchive })));
  }
  allEntries.sort((a, b) => a.entryDate.localeCompare(b.entryDate) || b.createdAt.getTime() - a.createdAt.getTime());
  const [erp] = await db.select({ id: companyModulesTable.id }).from(companyModulesTable)
    .where(and(eq(companyModulesTable.companyId, companyId), eq(companyModulesTable.module, "erp"))).limit(1);
  const role = (req as PosRequest).vloga;
  res.json({ temeljnice: allEntries, canTransfer: Boolean(erp) && role === "admin" });
});

router.post("/temeljnice/prenos-v-gk", async (req, res): Promise<void> => {
  const context = req as PosRequest;
  if (context.vloga !== "admin") {
    res.status(403).json({ error: "Prenos v GK lahko izvede samo administrator." });
    return;
  }
  const parsed = z.object({
    ids: z.array(z.string().uuid()).min(1).max(100),
    confirmed: z.literal(true),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Izberite temeljnice in izrecno potrdite prenos v GK." });
    return;
  }
  try {
    res.json(await transferPosDrafts(context.companyId, parsed.data.ids, context.clerkUserId));
  } catch (error) {
    req.log.warn({ err: error }, "Explicit POS draft transfer failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "Prenos ni uspel." });
  }
});

/**
 * POST /temeljnice/sync/:datum
 *
 * Ročni trigger za POS→ERP knjiženje za določen datum.
 * Zahteva requireEnota (nastavi req.companyId).
 */
router.post("/temeljnice/sync/:datum", async (req, res): Promise<void> => {
  const companyId = (req as unknown as PosRequest).companyId;
  const { datum } = req.params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    res.status(400).json({ error: "Neveljaven datum — pričakujem YYYY-MM-DD" });
    return;
  }

  try {
    const result = await syncPosBookingForDay(companyId, datum);
    res.json(result);
  } catch (err) {
    console.error("[POS sync ročni]", err);
    res.status(500).json({ error: "Napaka pri sinhronizaciji temeljnic" });
  }
});

/**
 * POST /temeljnice/sync-mesec/:mesec
 *
 * Ročni mesečni zbirnik za že zaključen mesec (YYYY-MM).
 */
router.post("/temeljnice/sync-mesec/:mesec", async (req, res): Promise<void> => {
  const companyId = (req as unknown as PosRequest).companyId;
  const { mesec } = req.params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mesec)) {
    res.status(400).json({ error: "Neveljaven mesec — pričakujem YYYY-MM" });
    return;
  }
  try {
    res.json(await syncPosBookingForMonth(companyId, mesec));
  } catch (err) {
    console.error("[POS mesečni sync ročni]", err);
    res.status(500).json({ error: "Napaka pri mesečni sinhronizaciji temeljnic" });
  }
});

export default router;
