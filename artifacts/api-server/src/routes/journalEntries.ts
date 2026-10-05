import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc, gte, lte, inArray, exists, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  accountingPeriodsTable,
  accountingRolesTable,
  auditLogTable,
  counterpartiesTable,
  invoicesTable,
  costCentersTable,
  projectsTable,
  departmentsTable,
  vatCodesTable,
  posReceiptBookingSourcesTable,
  prejemniceTable,
} from "@workspace/db";
import {
  CreateJournalEntryBody,
  ReverseJournalEntryBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { writeAuditLog } from "../lib/auditLog";
import { accountingError } from "../lib/accountingErrors";
import {
  createVatLedgerEntries,
  reverseVatLedgerEntries,
  type EntryMeta,
  type VatLine,
} from "../lib/vatLedger";
import { resolveCompanyVatCodeLinks } from "../lib/journalVatCodeLinks";
import { getPosReceiptBookingVatEvidence } from "../lib/posReceiptBooking";
import {
  deleteDraftJournalEntry,
  getJournalEntryDeletionFailure,
} from "../lib/journalEntryDeletion";
import { isReservedOpeningReference, loadAnnualOpening, matchesAnnualOpening } from "../lib/annualOpening";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Preveri dostop do podjetja; vrne vlogo ali pošlje 403. */
async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
    return null;
  }
  return { role: row.role };
}

/** Pridobi polni zapis temeljnice (header + vrstice) za vrnitev. */
async function fetchEntryWithLines(entryId: string) {
  const [entry] = await db
    .select({
      id: journalEntriesTable.id,
      companyId: journalEntriesTable.companyId,
      periodId: journalEntriesTable.periodId,
      periodName: accountingPeriodsTable.name,
      documentDate: journalEntriesTable.documentDate,
      entryDate: journalEntriesTable.entryDate,
      taxDate: journalEntriesTable.taxDate,
      receiptDate: journalEntriesTable.receiptDate,
      description: journalEntriesTable.description,
      reference: journalEntriesTable.reference,
      status: journalEntriesTable.status,
      postedAt: journalEntriesTable.postedAt,
      reversalOf: journalEntriesTable.reversalOf,
      sourceType: journalEntriesTable.sourceType,
      approvedBy: journalEntriesTable.approvedBy,
      createdBy: journalEntriesTable.createdBy,
      createdAt: journalEntriesTable.createdAt,
      updatedAt: journalEntriesTable.updatedAt,
    })
    .from(journalEntriesTable)
    .innerJoin(
      accountingPeriodsTable,
      eq(accountingPeriodsTable.id, journalEntriesTable.periodId),
    )
    .where(eq(journalEntriesTable.id, entryId))
    .limit(1);

  if (!entry) return null;

  const lines = await db
    .select({
      id: journalEntryLinesTable.id,
      entryId: journalEntryLinesTable.entryId,
      accountId: journalEntryLinesTable.accountId,
      accountCode: accountsTable.code,
      accountName: accountsTable.name,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      description: journalEntryLinesTable.description,
      sequence: journalEntryLinesTable.sequence,
      partnerId: journalEntryLinesTable.partnerId,
      partnerName: counterpartiesTable.name,
      costCenterId: journalEntryLinesTable.costCenterId,
      costCenterName: costCentersTable.name,
      projectId: journalEntryLinesTable.projectId,
      projectName: projectsTable.name,
      departmentId: journalEntryLinesTable.departmentId,
      departmentName: departmentsTable.name,
      vatCodeId: journalEntryLinesTable.vatCodeId,
      companyVatCodeId: journalEntryLinesTable.companyVatCodeId,
      vatAmount: journalEntryLinesTable.vatAmount,
      vatDeductionPercent: journalEntryLinesTable.vatDeductionPercent,
    })
    .from(journalEntryLinesTable)
    .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, journalEntryLinesTable.partnerId))
    .leftJoin(costCentersTable, eq(costCentersTable.id, journalEntryLinesTable.costCenterId))
    .leftJoin(projectsTable, eq(projectsTable.id, journalEntryLinesTable.projectId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, journalEntryLinesTable.departmentId))
    .where(eq(journalEntryLinesTable.entryId, entryId))
    .orderBy(asc(journalEntryLinesTable.sequence));

  return { ...entry, lines };
}

/**
 * §68 — Preveri debitno-kreditno ravnovesje z Decimal.js natančnostjo.
 * §96 — Vrne null če OK, sicer strukturiran error payload.
 */
function checkBalance(lines: { side: string; amount: string }[]) {
  let debitTotal = new Decimal(0);
  let creditTotal = new Decimal(0);
  for (const l of lines) {
    const amt = new Decimal(l.amount);
    if (l.side === "debit") debitTotal = debitTotal.plus(amt);
    else creditTotal = creditTotal.plus(amt);
  }
  if (!debitTotal.equals(creditTotal)) {
    return accountingError(
      "ENTRY_NOT_BALANCED",
      `Temeljnica ni uravnotežena: debet ${debitTotal.toFixed(2)} ≠ kredit ${creditTotal.toFixed(2)}`,
    );
  }
  return null;
}

/**
 * §96 — Preveri da ima vsaka vrstica amount > 0.
 */
function checkLineAmounts(lines: { amount: string | number; sequence?: number }[]) {
  for (let i = 0; i < lines.length; i++) {
    const amt = new Decimal(String(lines[i].amount));
    if (amt.lte(0)) {
      return accountingError(
        "LINE_AMOUNT_ZERO",
        `Vrstica ${i + 1}: znesek mora biti večji od 0 (dobljeno: ${amt.toFixed(2)})`,
        { line: i + 1 },
      );
    }
  }
  return null;
}

// ─── GET /companies/:companyId/entries ────────────────────────────────────────
router.get(
  "/companies/:companyId/entries",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { periodId, status, dateFrom, dateTo, costCenterId, projectId, departmentId } = req.query as Record<string, string | undefined>;

    const conditions: ReturnType<typeof eq>[] = [
      eq(journalEntriesTable.companyId, companyId),
    ];
    if (periodId) conditions.push(eq(journalEntriesTable.periodId, periodId));
    if (status) conditions.push(eq(journalEntriesTable.status, status as any));
    if (dateFrom) conditions.push(gte(journalEntriesTable.entryDate, dateFrom));
    if (dateTo) conditions.push(lte(journalEntriesTable.entryDate, dateTo));
    if (costCenterId) conditions.push(
      exists(
        db.select({ one: journalEntryLinesTable.id })
          .from(journalEntryLinesTable)
          .where(and(
            eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
            eq(journalEntryLinesTable.costCenterId, costCenterId),
          ))
      )
    );
    if (projectId) conditions.push(
      exists(
        db.select({ one: journalEntryLinesTable.id })
          .from(journalEntryLinesTable)
          .where(and(
            eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
            eq(journalEntryLinesTable.projectId, projectId),
          ))
      )
    );
    if (departmentId) conditions.push(
      exists(
        db.select({ one: journalEntryLinesTable.id })
          .from(journalEntryLinesTable)
          .where(and(
            eq(journalEntryLinesTable.entryId, journalEntriesTable.id),
            eq(journalEntryLinesTable.departmentId, departmentId),
          ))
      )
    );

    const entries = await db
      .select({
        id: journalEntriesTable.id,
        companyId: journalEntriesTable.companyId,
        periodId: journalEntriesTable.periodId,
        periodName: accountingPeriodsTable.name,
        entryDate: journalEntriesTable.entryDate,
        description: journalEntriesTable.description,
        reference: journalEntriesTable.reference,
        status: journalEntriesTable.status,
        documentDate: journalEntriesTable.documentDate,
        taxDate: journalEntriesTable.taxDate,
        postedAt: journalEntriesTable.postedAt,
        reversalOf: journalEntriesTable.reversalOf,
        sourceType: journalEntriesTable.sourceType,
        approvedBy: journalEntriesTable.approvedBy,
        createdBy: journalEntriesTable.createdBy,
        createdAt: journalEntriesTable.createdAt,
        updatedAt: journalEntriesTable.updatedAt,
      })
      .from(journalEntriesTable)
      .innerJoin(
        accountingPeriodsTable,
        eq(accountingPeriodsTable.id, journalEntriesTable.periodId),
      )
      .where(and(...conditions))
      .orderBy(asc(journalEntriesTable.entryDate), asc(journalEntriesTable.createdAt));

    // Pridobi agregirana imena dimenzij za vsako temeljnico
    const entryIds = entries.map(e => e.id);
    type DimRow = { entryId: string; costCenterName: string | null; projectName: string | null; departmentName: string | null };
    let dimRows: DimRow[] = [];
    if (entryIds.length > 0) {
      dimRows = await db
        .select({
          entryId: journalEntryLinesTable.entryId,
          costCenterName: costCentersTable.name,
          projectName: projectsTable.name,
          departmentName: departmentsTable.name,
        })
        .from(journalEntryLinesTable)
        .leftJoin(costCentersTable, eq(costCentersTable.id, journalEntryLinesTable.costCenterId))
        .leftJoin(projectsTable, eq(projectsTable.id, journalEntryLinesTable.projectId))
        .leftJoin(departmentsTable, eq(departmentsTable.id, journalEntryLinesTable.departmentId))
        .where(inArray(journalEntryLinesTable.entryId, entryIds));
    }

    // Aggrigiraj po entryId → unikatna imena
    const dimByEntry = new Map<string, { costCenterNames: Set<string>; projectNames: Set<string>; departmentNames: Set<string> }>();
    for (const row of dimRows) {
      if (!dimByEntry.has(row.entryId)) {
        dimByEntry.set(row.entryId, { costCenterNames: new Set(), projectNames: new Set(), departmentNames: new Set() });
      }
      const agg = dimByEntry.get(row.entryId)!;
      if (row.costCenterName) agg.costCenterNames.add(row.costCenterName);
      if (row.projectName) agg.projectNames.add(row.projectName);
      if (row.departmentName) agg.departmentNames.add(row.departmentName);
    }

    const enrichedEntries = entries.map(e => {
      const agg = dimByEntry.get(e.id);
      return {
        ...e,
        costCenterNames: agg ? [...agg.costCenterNames] : [],
        projectNames: agg ? [...agg.projectNames] : [],
        departmentNames: agg ? [...agg.departmentNames] : [],
      };
    });

    res.json({ entries: enrichedEntries });
  },
);

// ─── POST /companies/:companyId/entries ───────────────────────────────────────
router.post(
  "/companies/:companyId/entries",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje temeljnic potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreateJournalEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { periodId, description, reference, lines: requestedLines, autoPost, sourceType } = parsed.data;
    // Annual opening references are reserved for the audited annual-opening
    // workflow. In particular, autoPost must never bypass its reconciliation.
    if (isReservedOpeningReference(reference)) {
      res.status(409).json({ error: "Letno otvoritev pripravite prek postopka v Računovodskih obdobjih" });
      return;
    }
    let lines = requestedLines;

    // Preveri period pripada podjetju
    const [period] = await db
      .select({ id: accountingPeriodsTable.id, status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(
        and(
          eq(accountingPeriodsTable.id, periodId),
          eq(accountingPeriodsTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!period) {
      res.status(404).json(accountingError("PERIOD_NOT_FOUND", "Računovodsko obdobje ni najdeno"));
      return;
    }

    if (period.status === "locked") {
      res.status(400).json(accountingError("PERIOD_CLOSED", "Obdobje je zaklenjeno. Knjižbe v zaklenjeno obdobje niso dovoljene."));
      return;
    }

    // §96 — Vsaka vrstica mora imeti amount > 0
    const amountErr = checkLineAmounts(lines.map((l, i) => ({ amount: l.amount, sequence: i })));
    if (amountErr) { res.status(400).json(amountErr); return; }

    // Preveri da vsi account_id-ji obstajajo in so del podjetja
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const foundAccounts = await db
      .select({
        id: accountsTable.id,
        code: accountsTable.code,
        isActive: accountsTable.isActive,
        allowsPosting: accountsTable.allowsPosting,
        requiresPartner: accountsTable.requiresPartner,
        requiresCostCenter: accountsTable.requiresCostCenter,
        costCenterPolicy: accountsTable.costCenterPolicy,
        requiresProject: accountsTable.requiresProject,
      })
      .from(accountsTable)
      .where(and(inArray(accountsTable.id, accountIds), eq(accountsTable.companyId, companyId)));

    if (foundAccounts.length !== accountIds.length) {
      res.status(400).json(accountingError("ACCOUNT_NOT_FOUND", "Vsaj en konto ne obstaja ali ne pripada temu podjetju"));
      return;
    }

    const accountMap = new Map(foundAccounts.map((a) => [a.id, a]));

    // Validacija: vsi dimension FK-ji morajo biti v istem podjetju
    const allPartnerIds = [...new Set(lines.map((l) => l.partnerId).filter((x): x is string => !!x))];
    const allCostCenterIds = [...new Set(lines.map((l) => l.costCenterId).filter((x): x is string => !!x))];
    const allProjectIds = [...new Set(lines.map((l) => l.projectId).filter((x): x is string => !!x))];
    const allDepartmentIds = [...new Set(lines.map((l) => l.departmentId).filter((x): x is string => !!x))];
    const allCompanyVatCodeIds = [...new Set(lines.map((l) => l.companyVatCodeId).filter((x): x is string => !!x))];

    if (allPartnerIds.length > 0) {
      const found = await db
        .select({ id: counterpartiesTable.id })
        .from(counterpartiesTable)
        .where(and(inArray(counterpartiesTable.id, allPartnerIds), eq(counterpartiesTable.companyId, companyId)));
      if (found.length !== allPartnerIds.length) {
        res.status(400).json({ error: "Vsaj en poslovni partner ne obstaja ali ne pripada temu podjetju" });
        return;
      }
    }
    if (allCostCenterIds.length > 0) {
      const found = await db
        .select({ id: costCentersTable.id })
        .from(costCentersTable)
        .where(and(inArray(costCentersTable.id, allCostCenterIds), eq(costCentersTable.companyId, companyId)));
      if (found.length !== allCostCenterIds.length) {
        res.status(400).json({ error: "Vsaj eno stroškovno mesto ne obstaja ali ne pripada temu podjetju" });
        return;
      }
    }
    if (allProjectIds.length > 0) {
      const found = await db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(and(inArray(projectsTable.id, allProjectIds), eq(projectsTable.companyId, companyId)));
      if (found.length !== allProjectIds.length) {
        res.status(400).json({ error: "Vsaj en projekt ne obstaja ali ne pripada temu podjetju" });
        return;
      }
    }
    if (allDepartmentIds.length > 0) {
      const found = await db
        .select({ id: departmentsTable.id })
        .from(departmentsTable)
        .where(and(inArray(departmentsTable.id, allDepartmentIds), eq(departmentsTable.companyId, companyId)));
      if (found.length !== allDepartmentIds.length) {
        res.status(400).json({ error: "Vsaj en oddelek ne obstaja ali ne pripada temu podjetju" });
        return;
      }
    }
    if (allCompanyVatCodeIds.length > 0) {
      const found = await db
        .select({ id: vatCodesTable.id, fursCodeId: vatCodesTable.fursCodeId })
        .from(vatCodesTable)
        .where(and(
          inArray(vatCodesTable.id, allCompanyVatCodeIds),
          eq(vatCodesTable.companyId, companyId),
        ));
      const resolved = resolveCompanyVatCodeLinks(requestedLines, found);
      if (resolved.error !== null) {
        res.status(400).json({ error: resolved.error });
        return;
      }
      lines = resolved.lines;
    }

    // §69, §70 — Validacija kontov in dimenzij
    for (const line of lines) {
      const acc = accountMap.get(line.accountId);
      if (!acc) continue;
      if (!acc.isActive) {
        res.status(400).json(accountingError("ACCOUNT_INACTIVE", `Konto ${acc.code} ni aktiven.`, { account: acc.code }));
        return;
      }
      if (!acc.allowsPosting) {
        res.status(400).json(accountingError("ACCOUNT_NOT_POSTABLE", `Na konto ${acc.code} ni dovoljeno neposredno knjižiti (skupinski konto).`, { account: acc.code }));
        return;
      }
      if (acc.requiresPartner && !line.partnerId) {
        res.status(400).json(accountingError("PARTNER_REQUIRED", `Za konto ${acc.code} je poslovni partner obvezen.`, { account: acc.code, dimension: "PARTNER" }));
        return;
      }
      if ((acc.costCenterPolicy === "required" || acc.requiresCostCenter) && !line.costCenterId) {
        res.status(400).json(accountingError("COST_CENTER_REQUIRED", `Za konto ${acc.code} je stroškovno mesto obvezno.`, { account: acc.code, dimension: "COST_CENTER" }));
        return;
      }
      if (acc.costCenterPolicy === "not_allowed" && line.costCenterId) {
        res.status(400).json(accountingError("COST_CENTER_NOT_ALLOWED", `Za konto ${acc.code} stroškovno mesto ni dovoljeno.`, { account: acc.code, dimension: "COST_CENTER" }));
        return;
      }
      if (acc.requiresProject && !line.projectId) {
        res.status(400).json(accountingError("PROJECT_REQUIRED", `Za konto ${acc.code} je projekt obvezen.`, { account: acc.code, dimension: "PROJECT" }));
        return;
      }
    }

    // §68 — Za autoPost preveri balance pred insertom (Decimal natančnost)
    if (autoPost) {
      const balanceErr = checkBalance(lines.map((l) => ({ side: l.side, amount: l.amount.toFixed(2) })));
      if (balanceErr) { res.status(400).json(balanceErr); return; }
    }

    // Kovert datumov: z.coerce.date() → Date → string
    const entryDate = (parsed.data.entryDate as unknown as Date).toISOString().slice(0, 10);
    const documentDate = parsed.data.documentDate
      ? (parsed.data.documentDate as unknown as Date).toISOString().slice(0, 10)
      : null;
    const taxDate = parsed.data.taxDate
      ? (parsed.data.taxDate as unknown as Date).toISOString().slice(0, 10)
      : null;
    const receiptDate = (parsed.data as Record<string, unknown>).receiptDate
      ? ((parsed.data as Record<string, unknown>).receiptDate as Date).toISOString().slice(0, 10)
      : null;
    const now = new Date();

    const entry = await db.transaction(async (tx) => {
      const [newEntry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId,
          periodId,
          documentDate,
          entryDate,
          taxDate,
          receiptDate,
          description,
          reference: reference ?? null,
          status: autoPost ? "posted" : "draft",
          postedAt: autoPost ? now : null,
          sourceType: (sourceType ?? "manual") as "manual" | "bank_import" | "document" | "ai_suggestion",
          approvedBy: autoPost ? authReq.clerkUserId : null,
          createdBy: authReq.clerkUserId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalEntryLinesTable).values(
        lines.map((l, i) => ({
          entryId: newEntry.id,
          accountId: l.accountId,
          side: l.side,
          amount: l.amount.toFixed(2),
          description: l.description ?? null,
          sequence: i,
          partnerId: l.partnerId ?? null,
          costCenterId: l.costCenterId ?? null,
          projectId: l.projectId ?? null,
          departmentId: l.departmentId ?? null,
          vatCodeId: l.vatCodeId ?? null,
          companyVatCodeId: l.companyVatCodeId ?? null,
          vatAmount: l.vatAmount != null ? String(l.vatAmount) : null,
          vatDeductionPercent: l.vatDeductionPercent != null ? String(l.vatDeductionPercent) : null,
        })),
      );

      // ── KIR/KPR: autoPost → takoj ustvari vat_ledger vrstice ──────────────
      if (autoPost) {
        const vatLines: VatLine[] = lines
          .filter((l) => l.vatCodeId != null)
          .map((l, i) => ({
            lineId: `line-${i}`,
            vatCodeId: l.vatCodeId!,
            amount: l.amount.toFixed(2),
            vatAmount: l.vatAmount != null ? String(l.vatAmount) : null,
            vatDeductionPercent: l.vatDeductionPercent != null ? String(l.vatDeductionPercent) : null,
            partnerId: l.partnerId ?? null,
            description: l.description ?? null,
          }));

        if (vatLines.length > 0) {
          const entryMeta: EntryMeta = {
            id: newEntry.id,
            companyId,
            documentDate,
            entryDate,
            taxDate,
            receiptDate,
            reference: reference ?? null,
            sourceType: (sourceType ?? "manual") as string,
          };
          await createVatLedgerEntries(tx, entryMeta, vatLines, authReq.clerkUserId);
        }
      }

      // Revizijski dnevnik je del transakcije — napaka povzroči rollback
      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "journal_entry",
        entityId: newEntry.id,
        action: autoPost ? "create_and_post" : "create",
        changedBy: authReq.clerkUserId,
        payload: { periodId, entryDate, description, lineCount: lines.length },
      });

      return newEntry;
    });

    const result = await fetchEntryWithLines(entry.id);
    res.status(201).json(result);
  },
);

// ─── GET /companies/:companyId/entries/:id ────────────────────────────────────
router.get(
  "/companies/:companyId/entries/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    // Preveri entry pripada podjetju
    const [check] = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.companyId, companyId)))
      .limit(1);

    if (!check) {
      res.status(404).json({ error: "Temeljnica ni najdena" });
      return;
    }

    const result = await fetchEntryWithLines(id);
    res.json(result);
  },
);

// ─── DELETE /companies/:companyId/entries/:id ───────────────────────────────
router.delete(
  "/companies/:companyId/entries/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za brisanje osnutka potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    try {
      const deleted = await deleteDraftJournalEntry(companyId, id, authReq.clerkUserId);

      if (!deleted) {
        res.status(404).json({ error: "Temeljnica ni najdena" });
        return;
      }
      res.json({ deleted: true, id });
    } catch (error: unknown) {
      const failure = getJournalEntryDeletionFailure(error);
      if (failure.status === 500) console.error("Brisanje osnutka temeljnice ni uspelo", error);
      res.status(failure.status).json({ error: failure.message });
    }
  },
);

// ─── POST /companies/:companyId/entries/:id/post ──────────────────────────────
router.post(
  "/companies/:companyId/entries/:id/post",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za knjiženje potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [entry] = await db
      .select({
        id: journalEntriesTable.id,
        status: journalEntriesTable.status,
        periodId: journalEntriesTable.periodId,
        documentDate: journalEntriesTable.documentDate,
        entryDate: journalEntriesTable.entryDate,
        taxDate: journalEntriesTable.taxDate,
        receiptDate: journalEntriesTable.receiptDate,
        reference: journalEntriesTable.reference,
        sourceType: journalEntriesTable.sourceType,
      })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.companyId, companyId)))
      .limit(1);

    if (!entry) {
      res.status(404).json(accountingError("ACCOUNT_NOT_FOUND", "Temeljnica ni najdena"));
      return;
    }
    if (entry.status !== "draft") {
      res.status(400).json(accountingError("ENTRY_NOT_BALANCED", "Samo osnutke je mogoče knjižiti"));
      return;
    }
    const [unconfirmedReceipt] = await db
      .select({ id: prejemniceTable.id })
      .from(posReceiptBookingSourcesTable)
      .innerJoin(
        prejemniceTable,
        eq(prejemniceTable.id, posReceiptBookingSourcesTable.prejemnicaId),
      )
      .where(and(
        eq(posReceiptBookingSourcesTable.journalEntryId, id),
        eq(prejemniceTable.status, "draft"),
      ))
      .limit(1);
    if (unconfirmedReceipt) {
      res.status(409).json(accountingError(
        "ENTRY_NOT_BALANCED",
        "Temeljnice ni mogoče knjižiti, dokler prejemnica ni potrjena.",
      ));
      return;
    }
    const receiptBookingSources = await db
      .select({
        receiptId: prejemniceTable.id,
        enotaId: prejemniceTable.enotaId,
      })
      .from(posReceiptBookingSourcesTable)
      .innerJoin(
        prejemniceTable,
        eq(prejemniceTable.id, posReceiptBookingSourcesTable.prejemnicaId),
      )
      .where(eq(posReceiptBookingSourcesTable.journalEntryId, id));
    const posReceiptVatLines = (
      await Promise.all(receiptBookingSources.map((source) =>
        getPosReceiptBookingVatEvidence(companyId, source.enotaId, source.receiptId)
      ))
    ).flat();

    const [period] = await db
      .select({ status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(eq(accountingPeriodsTable.id, entry.periodId))
      .limit(1);

    if (period?.status === "locked") {
      res.status(400).json(accountingError("PERIOD_CLOSED", "Obdobje je zaklenjeno. Knjižbe v zaklenjeno obdobje niso dovoljene."));
      return;
    }

    const lines = await db
      .select({
        id: journalEntryLinesTable.id,
        side: journalEntryLinesTable.side,
        amount: journalEntryLinesTable.amount,
        accountId: journalEntryLinesTable.accountId,
        partnerId: journalEntryLinesTable.partnerId,
        costCenterId: journalEntryLinesTable.costCenterId,
        projectId: journalEntryLinesTable.projectId,
        departmentId: journalEntryLinesTable.departmentId,
        vatCodeId: journalEntryLinesTable.vatCodeId,
        companyVatCodeId: journalEntryLinesTable.companyVatCodeId,
        vatAmount: journalEntryLinesTable.vatAmount,
        vatDeductionPercent: journalEntryLinesTable.vatDeductionPercent,
        description: journalEntryLinesTable.description,
      })
      .from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, id));

    // §68 — Balance check z Decimal natančnostjo
    const balanceErr = checkBalance(lines);
    if (balanceErr) { res.status(400).json(balanceErr); return; }

    // An annual aggregate opening is the ONLY partner-free posting on 120/220.
    // Verify every amount against the locked prior year, never just the reference.
    let verifiedOpening = false;
    if (entry.reference?.startsWith("OTV-")) {
      try {
        const snapshot = await loadAnnualOpening(companyId, entry.periodId);
        if (!matchesAnnualOpening(entry, lines, snapshot)) {
          throw new Error("Vrstice otvoritve se ne ujemajo z zaključenim letom");
        }
        if (!snapshot.reconciled) {
          throw new Error("Odprte postavke 120/220 se ne ujemajo z GK ali nimajo dokazil; preverite razliko pred knjiženjem");
        }
        const [other] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
          .where(and(
            eq(journalEntriesTable.companyId, companyId),
            eq(journalEntriesTable.periodId, entry.periodId),
            eq(journalEntriesTable.status, "posted"),
            sql`${journalEntriesTable.id} <> ${id}`,
            sql`(${journalEntriesTable.reference} LIKE ${`OTV-${snapshot.year}-%`}
              OR ${journalEntriesTable.reference} LIKE ${`BOOKIE-OLD/K2/${snapshot.year}/00/%`})`,
          )).limit(1);
        if (other) throw new Error("Otvoritev za to leto je že knjižena");
        verifiedOpening = true;
      } catch (error) {
        res.status(409).json(accountingError(
          "ENTRY_NOT_BALANCED", error instanceof Error ? error.message : "Otvoritve ni mogoče knjižiti",
        ));
        return;
      }
    }

    // §69, §70 — Validacija kontov (isActive, allowsPosting, dimenzije)
    const lineAccountIds = [...new Set(lines.map((l) => l.accountId))];
    if (lineAccountIds.length > 0) {
      const lineAccounts = await db
        .select({
          id: accountsTable.id,
          code: accountsTable.code,
          isActive: accountsTable.isActive,
          allowsPosting: accountsTable.allowsPosting,
          requiresPartner: accountsTable.requiresPartner,
          requiresCostCenter: accountsTable.requiresCostCenter,
          costCenterPolicy: accountsTable.costCenterPolicy,
          requiresProject: accountsTable.requiresProject,
        })
        .from(accountsTable)
        .where(inArray(accountsTable.id, lineAccountIds));
      const lineAccountMap = new Map(lineAccounts.map((a) => [a.id, a]));
      for (const line of lines) {
        const acc = lineAccountMap.get(line.accountId);
        if (!acc) continue;
        if (!acc.isActive) {
          res.status(400).json(accountingError("ACCOUNT_INACTIVE", `Konto ${acc.code} ni aktiven.`, { account: acc.code }));
          return;
        }
        if (!acc.allowsPosting) {
          res.status(400).json(accountingError("ACCOUNT_NOT_POSTABLE", `Na konto ${acc.code} ni dovoljeno neposredno knjižiti (skupinski konto).`, { account: acc.code }));
          return;
        }
        if (acc.requiresPartner && !line.partnerId
          && !(verifiedOpening && /^(120|220)/.test(acc.code))) {
          res.status(400).json(accountingError("PARTNER_REQUIRED", `Za konto ${acc.code} je poslovni partner obvezen.`, { account: acc.code, dimension: "PARTNER" }));
          return;
        }
        if ((acc.costCenterPolicy === "required" || acc.requiresCostCenter) && !line.costCenterId) {
          res.status(400).json(accountingError("COST_CENTER_REQUIRED", `Za konto ${acc.code} je stroškovno mesto obvezno.`, { account: acc.code, dimension: "COST_CENTER" }));
          return;
        }
        if (acc.costCenterPolicy === "not_allowed" && line.costCenterId) {
          res.status(400).json(accountingError("COST_CENTER_NOT_ALLOWED", `Za konto ${acc.code} stroškovno mesto ni dovoljeno.`, { account: acc.code, dimension: "COST_CENTER" }));
          return;
        }
        if (acc.requiresProject && !line.projectId) {
          res.status(400).json(accountingError("PROJECT_REQUIRED", `Za konto ${acc.code} je projekt obvezen.`, { account: acc.code, dimension: "PROJECT" }));
          return;
        }
      }
    }

    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        if (verifiedOpening) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`annual-opening:${companyId}:${entry.periodId}`}))`);
          const fresh = await loadAnnualOpening(companyId, entry.periodId, tx as unknown as typeof db);
          if (!fresh.reconciled || !matchesAnnualOpening(entry, lines, fresh)) {
            throw new Error("Otvoritev ali odprte postavke so se med potrditvijo spremenile");
          }
          const [duplicate] = await tx.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
            .where(and(
              eq(journalEntriesTable.companyId, companyId),
              eq(journalEntriesTable.periodId, entry.periodId),
              eq(journalEntriesTable.status, "posted"),
              sql`${journalEntriesTable.id} <> ${id}`,
              sql`(${journalEntriesTable.reference} LIKE ${`OTV-${fresh.year}-%`}
                OR ${journalEntriesTable.reference} LIKE ${`BOOKIE-OLD/K2/${fresh.year}/00/%`})`,
            )).limit(1);
          if (duplicate) throw new Error("Otvoritev za to leto je že knjižena");
        }
        const [posted] = await tx
          .update(journalEntriesTable)
          .set({ status: "posted", approvedBy: authReq.clerkUserId, postedAt: now })
          .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.status, "draft")))
          .returning({ id: journalEntriesTable.id });
        if (!posted) throw new Error("Temeljnica ni več osnutek");
        // SŠP zbirni dokument je vezan na dnevno POS temeljnico. Dokler je
        // temeljnica osnutek, ni poravnaven; ob potrditvi postane viden
        // generičnemu payment toku kot odprta terjatev.
        await tx
          .update(invoicesTable)
          .set({ status: "posted" })
          .where(and(
            eq(invoicesTable.linkedEntryId, id),
            eq(invoicesTable.status, "draft"),
          ));

        // Revizijski dnevnik je del transakcije
        await tx.insert(auditLogTable).values({
          companyId,
          entityType: "journal_entry",
          entityId: id,
          action: "post",
          changedBy: authReq.clerkUserId,
          payload: null,
        });

        // ── KIR/KPR: Samodejno knjiženje DDV v vat_ledger ──────────────────
        // Za vsako vrstico z vatCodeId ustvari vrstico(e) v vat_ledger.
        // RC kode (EU pridobitve, 76.a, uvoz) → 2 vrstici s pair_id.
        const vatLines: VatLine[] = receiptBookingSources.length > 0
          ? posReceiptVatLines
          : lines
            .filter((l) => l.vatCodeId != null)
            .map((l) => ({
              lineId: l.id,
              vatCodeId: l.vatCodeId!,
              amount: l.amount,
              vatAmount: l.vatAmount ?? null,
              vatDeductionPercent: l.vatDeductionPercent ?? null,
              partnerId: l.partnerId ?? null,
              description: l.description ?? null,
            }));

        if (vatLines.length > 0) {
          const entryMeta: EntryMeta = {
            id,
            companyId,
            documentDate: entry.documentDate ?? null,
            entryDate: entry.entryDate,
            taxDate: entry.taxDate ?? null,
            receiptDate: entry.receiptDate ?? null,
            reference: entry.reference ?? null,
            sourceType: entry.sourceType,
          };
          await createVatLedgerEntries(tx, entryMeta, vatLines, authReq.clerkUserId);
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // DDV validacijska napaka (npr. manjka partner_vat_id za SEU-B)
      res.status(400).json(accountingError("VAT_LEDGER_ERROR", msg));
      return;
    }

    const result = await fetchEntryWithLines(id);
    res.json(result);
  },
);

// ─── POST /companies/:companyId/entries/:id/reverse ───────────────────────────
router.post(
  "/companies/:companyId/entries/:id/reverse",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za storno potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = ReverseJournalEntryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [original] = await db
      .select({
        id: journalEntriesTable.id,
        status: journalEntriesTable.status,
        periodId: journalEntriesTable.periodId,
        description: journalEntriesTable.description,
      })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.companyId, companyId)))
      .limit(1);

    if (!original) {
      res.status(404).json({ error: "Temeljnica ni najdena" });
      return;
    }
    if (original.status !== "posted") {
      res.status(400).json({ error: "Samo zaknjiženega vnosa je mogoče stornirati" });
      return;
    }

    // Preveri ciljno obdobje
    const targetPeriodId = parsed.data.periodId ?? original.periodId;
    const [targetPeriod] = await db
      .select({ id: accountingPeriodsTable.id, status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(
        and(
          eq(accountingPeriodsTable.id, targetPeriodId),
          eq(accountingPeriodsTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!targetPeriod) {
      res.status(404).json({ error: "Ciljno računovodsko obdobje ni najdeno" });
      return;
    }
    if (targetPeriod.status === "locked") {
      res.status(400).json({ error: "Ciljno obdobje je zaklenjeno" });
      return;
    }

    const originalLines = await db
      .select({
        accountId: journalEntryLinesTable.accountId,
        side: journalEntryLinesTable.side,
        amount: journalEntryLinesTable.amount,
        description: journalEntryLinesTable.description,
        sequence: journalEntryLinesTable.sequence,
        partnerId: journalEntryLinesTable.partnerId,
        costCenterId: journalEntryLinesTable.costCenterId,
        projectId: journalEntryLinesTable.projectId,
        departmentId: journalEntryLinesTable.departmentId,
        vatCodeId: journalEntryLinesTable.vatCodeId,
        companyVatCodeId: journalEntryLinesTable.companyVatCodeId,
        vatAmount: journalEntryLinesTable.vatAmount,
        vatDeductionPercent: journalEntryLinesTable.vatDeductionPercent,
      })
      .from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, id))
      .orderBy(asc(journalEntryLinesTable.sequence));

    const reverseDate = (parsed.data.entryDate as unknown as Date).toISOString().slice(0, 10);
    const reverseDescription = parsed.data.description ?? `STORNO: ${original.description}`;

    const reversal = await db.transaction(async (tx) => {
      // Ustvari storno temeljnico (takoj posted)
      const [newEntry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId,
          periodId: targetPeriodId,
          entryDate: reverseDate,
          description: reverseDescription,
          status: "posted",
          reversalOf: id,
          createdBy: authReq.clerkUserId,
        })
        .returning({ id: journalEntriesTable.id });

      // Zamenjaj debit ↔ kredit (ohrani dimenzije)
      await tx.insert(journalEntryLinesTable).values(
        originalLines.map((l) => ({
          entryId: newEntry.id,
          accountId: l.accountId,
          side: l.side === "debit" ? ("credit" as const) : ("debit" as const),
          amount: l.amount,
          description: l.description,
          sequence: l.sequence,
          partnerId: l.partnerId ?? null,
          costCenterId: l.costCenterId ?? null,
          projectId: l.projectId ?? null,
          departmentId: l.departmentId ?? null,
          vatCodeId: l.vatCodeId ?? null,
          companyVatCodeId: l.companyVatCodeId ?? null,
          vatAmount: l.vatAmount ?? null,
          vatDeductionPercent: l.vatDeductionPercent ?? null,
        })),
      );

      // Označi originalni vnos kot "reversed"
      await tx
        .update(journalEntriesTable)
        .set({ status: "reversed" })
        .where(eq(journalEntriesTable.id, id));

      // ── KIR/KPR: Storno vat_ledger vrstic ──────────────────────────────────
      // Kopira originalne vrstice z negiranimi zneski in linked reversed_by_id.
      // Če so vrstice že oddane (reported_at IS NOT NULL), vrže napako.
      await reverseVatLedgerEntries(
        tx,
        id,
        newEntry.id,
        authReq.clerkUserId,
        reverseDate,
      );

      // Revizijski dnevnik za oba vnosa — del transakcije
      await tx.insert(auditLogTable).values([
        {
          companyId,
          entityType: "journal_entry",
          entityId: newEntry.id,
          action: "reverse",
          changedBy: authReq.clerkUserId,
          payload: { reversalOf: id },
        },
        {
          companyId,
          entityType: "journal_entry",
          entityId: id,
          action: "reversed",
          changedBy: authReq.clerkUserId,
          payload: { reversalEntryId: newEntry.id },
        },
      ]);

      return newEntry;
    });

    const result = await fetchEntryWithLines(reversal.id);
    res.status(201).json(result);
  },
);

export default router;
