import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc, gte, lte, inArray } from "drizzle-orm";
import {
  db,
  journalEntriesTable,
  journalEntryLinesTable,
  accountsTable,
  accountingPeriodsTable,
  accountingRolesTable,
  auditLogTable,
  counterpartiesTable,
  costCentersTable,
  projectsTable,
  departmentsTable,
} from "@workspace/db";
import {
  CreateJournalEntryBody,
  ReverseJournalEntryBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { writeAuditLog } from "../lib/auditLog";

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
      entryDate: journalEntriesTable.entryDate,
      description: journalEntriesTable.description,
      reference: journalEntriesTable.reference,
      status: journalEntriesTable.status,
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

/** Preveri debitno-kreditno ravnovesje. Vrne null če OK, sicer opis napake. */
function checkBalance(
  lines: { side: string; amount: string }[],
): string | null {
  let debitTotal = 0;
  let creditTotal = 0;
  for (const l of lines) {
    const amt = parseFloat(l.amount);
    if (l.side === "debit") debitTotal += amt;
    else creditTotal += amt;
  }
  // Zaokroži na 2 decimalki da se izognemo floating-point napakam
  const diff = Math.abs(Math.round((debitTotal - creditTotal) * 100) / 100);
  if (diff > 0) {
    return `Temeljnica ni uravnotežena: debet ${debitTotal.toFixed(2)} ≠ kredit ${creditTotal.toFixed(2)}`;
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

    const { periodId, status, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

    const conditions: ReturnType<typeof eq>[] = [
      eq(journalEntriesTable.companyId, companyId),
    ];
    if (periodId) conditions.push(eq(journalEntriesTable.periodId, periodId));
    if (status) conditions.push(eq(journalEntriesTable.status, status as any));
    if (dateFrom) conditions.push(gte(journalEntriesTable.entryDate, dateFrom));
    if (dateTo) conditions.push(lte(journalEntriesTable.entryDate, dateTo));

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

    res.json({ entries });
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

    const { periodId, description, reference, lines, autoPost, sourceType } = parsed.data;

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
      res.status(404).json({ error: "Računovodsko obdobje ni najdeno" });
      return;
    }

    if (period.status === "locked") {
      res.status(400).json({ error: "Obdobje je zaklenjeno. Knjižbe v zaklenjeno obdobje niso dovoljene." });
      return;
    }

    // Preveri da vsi account_id-ji obstajajo in so del podjetja
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const foundAccounts = await db
      .select({
        id: accountsTable.id,
        allowsPosting: accountsTable.allowsPosting,
        requiresPartner: accountsTable.requiresPartner,
        requiresCostCenter: accountsTable.requiresCostCenter,
        requiresProject: accountsTable.requiresProject,
      })
      .from(accountsTable)
      .where(and(inArray(accountsTable.id, accountIds), eq(accountsTable.companyId, companyId)));

    if (foundAccounts.length !== accountIds.length) {
      res.status(400).json({ error: "Vsaj en konto ne obstaja ali ne pripada temu podjetju" });
      return;
    }

    const accountMap = new Map(foundAccounts.map((a) => [a.id, a]));

    // Validacija: vsi dimension FK-ji morajo biti v istem podjetju
    const allPartnerIds = [...new Set(lines.map((l) => l.partnerId).filter((x): x is string => !!x))];
    const allCostCenterIds = [...new Set(lines.map((l) => l.costCenterId).filter((x): x is string => !!x))];
    const allProjectIds = [...new Set(lines.map((l) => l.projectId).filter((x): x is string => !!x))];
    const allDepartmentIds = [...new Set(lines.map((l) => l.departmentId).filter((x): x is string => !!x))];

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

    // Validacija dimenzij: konto zahteva partnerja / stroškovno mesto / projekt
    for (const line of lines) {
      const acc = accountMap.get(line.accountId);
      if (!acc) continue;
      if (!acc.allowsPosting) {
        res.status(400).json({ error: `Konto ne dovoljuje neposrednih knjižb (skupinski konto)` });
        return;
      }
      if (acc.requiresPartner && !line.partnerId) {
        res.status(400).json({ error: `Konto zahteva poslovnega partnerja na vsaki vrstici` });
        return;
      }
      if (acc.requiresCostCenter && !line.costCenterId) {
        res.status(400).json({ error: `Konto zahteva stroškovno mesto na vsaki vrstici` });
        return;
      }
      if (acc.requiresProject && !line.projectId) {
        res.status(400).json({ error: `Konto zahteva projekt na vsaki vrstici` });
        return;
      }
    }

    // Pripravi vrstice za balance check
    const lineAmountStrings = lines.map((l) => ({
      side: l.side,
      amount: l.amount.toFixed(2),
    }));

    // Za autoPost preveri balance pred insertom
    if (autoPost) {
      const balanceErr = checkBalance(lineAmountStrings);
      if (balanceErr) {
        res.status(400).json({ error: balanceErr });
        return;
      }
    }

    // Kovert datuma: z.coerce.date() → Date → string
    const entryDate = (parsed.data.entryDate as unknown as Date).toISOString().slice(0, 10);

    const entry = await db.transaction(async (tx) => {
      const [newEntry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId,
          periodId,
          entryDate,
          description,
          reference: reference ?? null,
          status: autoPost ? "posted" : "draft",
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
        })),
      );

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
      })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.id, id), eq(journalEntriesTable.companyId, companyId)))
      .limit(1);

    if (!entry) {
      res.status(404).json({ error: "Temeljnica ni najdena" });
      return;
    }
    if (entry.status !== "draft") {
      res.status(400).json({ error: "Samo osnutke je mogoče knjižiti" });
      return;
    }

    const [period] = await db
      .select({ status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(eq(accountingPeriodsTable.id, entry.periodId))
      .limit(1);

    if (period?.status === "locked") {
      res.status(400).json({ error: "Obdobje je zaklenjeno. Knjižbe v zaklenjeno obdobje niso dovoljene." });
      return;
    }

    const lines = await db
      .select({
        side: journalEntryLinesTable.side,
        amount: journalEntryLinesTable.amount,
        accountId: journalEntryLinesTable.accountId,
        partnerId: journalEntryLinesTable.partnerId,
        costCenterId: journalEntryLinesTable.costCenterId,
        projectId: journalEntryLinesTable.projectId,
      })
      .from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, id));

    const balanceErr = checkBalance(lines);
    if (balanceErr) {
      res.status(400).json({ error: balanceErr });
      return;
    }

    // Validacija dimenzij pri knjiženju
    const lineAccountIds = [...new Set(lines.map((l) => l.accountId))];
    if (lineAccountIds.length > 0) {
      const lineAccounts = await db
        .select({
          id: accountsTable.id,
          allowsPosting: accountsTable.allowsPosting,
          requiresPartner: accountsTable.requiresPartner,
          requiresCostCenter: accountsTable.requiresCostCenter,
          requiresProject: accountsTable.requiresProject,
        })
        .from(accountsTable)
        .where(inArray(accountsTable.id, lineAccountIds));
      const lineAccountMap = new Map(lineAccounts.map((a) => [a.id, a]));
      for (const line of lines) {
        const acc = lineAccountMap.get(line.accountId);
        if (!acc) continue;
        if (!acc.allowsPosting) {
          res.status(400).json({ error: "Konto ne dovoljuje neposrednih knjižb (skupinski konto)" });
          return;
        }
        if (acc.requiresPartner && !line.partnerId) {
          res.status(400).json({ error: "Konto zahteva poslovnega partnerja na vsaki vrstici" });
          return;
        }
        if (acc.requiresCostCenter && !line.costCenterId) {
          res.status(400).json({ error: "Konto zahteva stroškovno mesto na vsaki vrstici" });
          return;
        }
        if (acc.requiresProject && !line.projectId) {
          res.status(400).json({ error: "Konto zahteva projekt na vsaki vrstici" });
          return;
        }
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(journalEntriesTable)
        .set({ status: "posted", approvedBy: authReq.clerkUserId })
        .where(eq(journalEntriesTable.id, id));

      // Revizijski dnevnik je del transakcije
      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "journal_entry",
        entityId: id,
        action: "post",
        changedBy: authReq.clerkUserId,
        payload: null,
      });
    });

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
        })),
      );

      // Označi originalni vnos kot "reversed"
      await tx
        .update(journalEntriesTable)
        .set({ status: "reversed" })
        .where(eq(journalEntriesTable.id, id));

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
