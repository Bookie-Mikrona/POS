import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db, accountingRolesTable, journalEntriesTable, journalEntryLinesTable, auditLogTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { loadAnnualOpening, matchesAnnualOpening } from "../lib/annualOpening";

const router: IRouter = Router();
const param = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

class OpeningConflict extends Error {}

async function access(req: Request, res: Response, companyId: string) {
  const [role] = await db.select({ role: accountingRolesTable.role }).from(accountingRolesTable)
    .where(and(
      eq(accountingRolesTable.companyId, companyId),
      eq(accountingRolesTable.clerkUserId, (req as AuthenticatedRequest).clerkUserId),
    )).limit(1);
  if (!role) res.status(403).json({ error: "Dostop do podjetja ni dovoljen" });
  return role?.role;
}

async function findOpening(
  companyId: string, periodId: string, year: string,
  executor: typeof db = db,
) {
  const rows = await executor.execute(sql`
    SELECT id, reference, entry_date::text, period_id, status, source_type
    FROM journal_entries
    WHERE company_id=${companyId} AND period_id=${periodId}
      AND (
        reference LIKE ${`OTV-${year}-%`}
        OR reference LIKE ${`BOOKIE-OLD/K2/${year}/00/%`}
        OR description ILIKE '%otvor%'
      )
    ORDER BY created_at
  `);
  return rows.rows as { id: string; reference: string | null; entry_date: string; period_id: string; status: string; source_type: string }[];
}

router.get(
  "/companies/:companyId/periods/:id/opening",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const companyId = param(req.params.companyId);
    if (!await access(req, res, companyId)) return;
    try {
      const snapshot = await loadAnnualOpening(companyId, param(req.params.id));
      const existing = await findOpening(companyId, snapshot.destinationPeriodId, snapshot.year);
      let conflict = existing.length > 1
        || (existing.length === 1 && existing[0].reference !== snapshot.reference);
      if (!conflict && existing.length === 1) {
        const lines = await db.select({
          accountId: journalEntryLinesTable.accountId, side: journalEntryLinesTable.side,
          amount: journalEntryLinesTable.amount, partnerId: journalEntryLinesTable.partnerId,
          costCenterId: journalEntryLinesTable.costCenterId, projectId: journalEntryLinesTable.projectId,
          departmentId: journalEntryLinesTable.departmentId, vatCodeId: journalEntryLinesTable.vatCodeId,
          companyVatCodeId: journalEntryLinesTable.companyVatCodeId, vatAmount: journalEntryLinesTable.vatAmount,
        }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, existing[0].id));
        conflict = !matchesAnnualOpening({
          reference: existing[0].reference, entryDate: existing[0].entry_date,
          periodId: existing[0].period_id, sourceType: existing[0].source_type,
        }, lines, snapshot);
      }
      res.json({
        ...snapshot,
        entryId: existing.length === 1 ? existing[0].id : null,
        entryStatus: existing.length === 1 ? existing[0].status : null,
        conflict,
      });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Otvoritve ni mogoče pripraviti" });
    }
  },
);

router.post(
  "/companies/:companyId/periods/:id/opening",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const companyId = param(req.params.companyId);
    const role = await access(req, res, companyId);
    if (!role) return;
    if (role === "viewer") {
      res.status(403).json({ error: "Za pripravo otvoritve je potrebna vloga računovodja ali lastnik" });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`annual-opening:${companyId}:${param(req.params.id)}`}))`);
        const snapshot = await loadAnnualOpening(companyId, param(req.params.id), tx as unknown as typeof db);
        const existing = await findOpening(companyId, snapshot.destinationPeriodId, snapshot.year, tx as unknown as typeof db);
        if (existing.length > 1 || (existing.length === 1 && existing[0].reference !== snapshot.reference)) {
          throw new OpeningConflict("Otvoritev za to leto že obstaja; nove ni dovoljeno podvojiti");
        }
        if (existing.length === 1) {
          const lines = await tx.select({
            accountId: journalEntryLinesTable.accountId, side: journalEntryLinesTable.side,
            amount: journalEntryLinesTable.amount, partnerId: journalEntryLinesTable.partnerId,
            costCenterId: journalEntryLinesTable.costCenterId, projectId: journalEntryLinesTable.projectId,
            departmentId: journalEntryLinesTable.departmentId, vatCodeId: journalEntryLinesTable.vatCodeId,
            companyVatCodeId: journalEntryLinesTable.companyVatCodeId, vatAmount: journalEntryLinesTable.vatAmount,
          }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, existing[0].id));
          if (!matchesAnnualOpening({
            reference: existing[0].reference, entryDate: existing[0].entry_date,
            periodId: existing[0].period_id, sourceType: existing[0].source_type,
          }, lines, snapshot)) {
            throw new OpeningConflict("Obstoječa otvoritev se ne ujema z zaključenimi saldi; preverite jo ročno");
          }
          return { ...snapshot, entryId: existing[0].id, entryStatus: existing[0].status, created: false };
        }
        const [entry] = await tx.insert(journalEntriesTable).values({
          companyId, periodId: snapshot.destinationPeriodId,
          documentDate: snapshot.date, entryDate: snapshot.date,
          description: `Letna otvoritev ${snapshot.year} – saldi zaključenega leta (osnutek)`,
          reference: snapshot.reference, status: "draft", sourceType: "manual",
          createdBy: (req as AuthenticatedRequest).clerkUserId,
        }).returning({ id: journalEntriesTable.id });
        await tx.insert(journalEntryLinesTable).values(snapshot.lines.map((line, index) => ({
          entryId: entry.id, accountId: line.accountId, side: line.side,
          amount: line.amount, sequence: index, description: `Prenos salda ${snapshot.year}`,
        })));
        await tx.insert(auditLogTable).values({
          companyId, entityType: "journal_entry", entityId: entry.id, action: "create",
          changedBy: (req as AuthenticatedRequest).clerkUserId,
          payload: {
            sourcePeriodId: snapshot.sourcePeriodId, annualOpening: true,
            reconciliation: snapshot.reconciliation, posted: false,
          },
        });
        return { ...snapshot, entryId: entry.id, entryStatus: "draft", created: true };
      });
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      if (!(error instanceof OpeningConflict)) req.log.error({ err: error }, "Priprava letne otvoritve ni uspela");
      res.status(409).json({ error: error instanceof Error ? error.message : "Otvoritve ni mogoče pripraviti" });
    }
  },
);

export default router;