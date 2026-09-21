import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import {
  db, accountsTable, accountingPeriodsTable, accountingRolesTable, companiesTable, enoteTable, journalEntriesTable,
  journalEntryLinesTable, natakariTable, posBookingSettingsTable, posUporabnikiTable, racuniTable,
  tipAllocationsTable, tipDistributionProfileEntriesTable, tipDistributionProfilesTable,
  tipHistoricalReviewsTable, tipPoliciesTable, tipPoolEntriesTable, tipPoolsTable, tipSettlementsTable,
} from "@workspace/db";
import {
  CreateTipAllocationBody, CreateTipAllocationResponse, CreateTipDistributionProfileBody,
  CreateTipDistributionProfileResponse, CreateTipPolicyBody, CreateTipPolicyResponse,
  CreateTipSettlementBody, CreateTipSettlementResponse, ListTipDistributionProfilesResponse,
  ListTipPoliciesResponse, ListTipsLedgerResponse,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { reverseTipSettlementJournal } from "../lib/tip-storno-ledger";

const router: IRouter = Router();
type TipsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function sanitizeSpreadsheetCell(value: unknown): string {
  const text = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function param(value: string | string[]): string { return Array.isArray(value) ? value[0] : value; }
function amount(value: string | number): number { return Number(value); }
function accountingDate(value: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(value);
}
function responseRow<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
     value instanceof Date ? value.toISOString() : ["grossAmount", "feeAmount", "netAmount", "cardFeePercent", "cardFeeFlatAmount", "sharePercent", "distributionSharePercent"].includes(key) && value != null ? amount(value as string | number) : value,
  ])) as T;
}

async function authorize(clerkUserId: string, companyId: string, write: boolean, res: Response): Promise<boolean> {
  const [[accounting], [pos]] = await Promise.all([
    db.select({ role: accountingRolesTable.role }).from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, clerkUserId), eq(accountingRolesTable.companyId, companyId))).limit(1),
    db.select({ role: posUporabnikiTable.vloga }).from(posUporabnikiTable)
      .where(and(eq(posUporabnikiTable.clerkUserId, clerkUserId), eq(posUporabnikiTable.companyId, companyId), eq(posUporabnikiTable.aktiven, true))).limit(1),
  ]);
  if (pos?.role === "admin" || (accounting?.role && (!write || accounting.role !== "viewer"))) return true;
  res.status(403).json({ error: write ? "Samo lastnik, računovodja ali POS administrator lahko ureja napitnine" : "Dostop do evidence napitnin ni dovoljen" });
  return false;
}

/** Opt-in za novo politiko je namerno POS-nastavitev, ne ERP nastavitev podjetja. */
async function authorizePosAdmin(clerkUserId: string, companyId: string, res: Response): Promise<boolean> {
  const [pos] = await db.select({ role: posUporabnikiTable.vloga })
    .from(posUporabnikiTable)
    .where(and(
      eq(posUporabnikiTable.clerkUserId, clerkUserId),
      eq(posUporabnikiTable.companyId, companyId),
      eq(posUporabnikiTable.aktiven, true),
    ))
    .limit(1);
  if (pos?.role === "admin") return true;
  res.status(403).json({ error: "Nastavitev obveznega dodatka je dovoljena samo POS administratorju" });
  return false;
}

router.get("/companies/:companyId/tip-settings", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  const [company] = await db.select({
    employerControlledTipsEnabled: companiesTable.employerControlledTipsEnabled,
  }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }
  res.json(company);
});

router.patch("/companies/:companyId/tip-settings", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorizePosAdmin((req as AuthenticatedRequest).clerkUserId, companyId, res)) return;
  if (typeof req.body?.employerControlledTipsEnabled !== "boolean") {
    res.status(400).json({ error: "employerControlledTipsEnabled mora biti boolean" });
    return;
  }
  const [updated] = await db.update(companiesTable)
    .set({ employerControlledTipsEnabled: req.body.employerControlledTipsEnabled, updatedAt: new Date() })
    .where(eq(companiesTable.id, companyId))
    .returning({ employerControlledTipsEnabled: companiesTable.employerControlledTipsEnabled });
  if (!updated) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }
  res.json(updated);
});

function profileDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function validateTipProfileShares(entries: ReadonlyArray<{ sharePercent: number }>): boolean {
  if (entries.length === 0) return false;
  return Math.abs(entries.reduce((sum, entry) => sum + entry.sharePercent, 0) - 100) <= 0.0001;
}

export function mayUseEmployerControlledTips(mode: string | null | undefined, enabled: boolean): boolean {
  return mode !== "employer_controlled" || enabled;
}

export function formatPayrollDocumentDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(value)).replaceAll("/", ".");
}

function profileView(
  profile: typeof tipDistributionProfilesTable.$inferSelect,
  entries: Array<typeof tipDistributionProfileEntriesTable.$inferSelect>,
) {
  return responseRow({
    ...profile,
    entries: entries.filter(entry => entry.profileId === profile.id).map(responseRow),
  });
}

router.get("/companies/:companyId/tip-distribution-profiles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  const [profiles, entries] = await Promise.all([
    db.select().from(tipDistributionProfilesTable)
      .where(eq(tipDistributionProfilesTable.companyId, companyId))
      .orderBy(desc(tipDistributionProfilesTable.effectiveFrom)),
    db.select().from(tipDistributionProfileEntriesTable)
      .where(eq(tipDistributionProfileEntriesTable.companyId, companyId)),
  ]);
  res.json(ListTipDistributionProfilesResponse.parse(profiles.map(profile => profileView(profile, entries))));
});

router.post("/companies/:companyId/tip-distribution-profiles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  const parsed = CreateTipDistributionProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data;
  const effectiveFrom = profileDate(body.effectiveFrom);
  const effectiveTo = body.effectiveTo ? profileDate(body.effectiveTo) : null;
  if (effectiveTo && effectiveTo < effectiveFrom) {
    res.status(400).json({ error: "effectiveTo ne sme biti pred effectiveFrom" }); return;
  }
  if (!validateTipProfileShares(body.entries)) {
    res.status(400).json({ error: "Deleži profila delitve morajo skupaj znašati natanko 100%." }); return;
  }
  if (new Set(body.entries.map(entry => entry.recipientNatakarId)).size !== body.entries.length) {
    res.status(400).json({ error: "Zaposleni se lahko v profilu pojavijo samo enkrat." }); return;
  }
  const created = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tip-profile:${companyId}:${body.enotaId}`}))`);
    const [unit] = await tx.select({ id: enoteTable.id }).from(enoteTable)
      .where(and(eq(enoteTable.id, body.enotaId), eq(enoteTable.companyId, companyId))).limit(1);
    if (!unit) throw new Error("unit");
    const [overlap] = await tx.select({ id: tipDistributionProfilesTable.id })
      .from(tipDistributionProfilesTable)
      .where(and(
        eq(tipDistributionProfilesTable.companyId, companyId),
        eq(tipDistributionProfilesTable.enotaId, body.enotaId),
        lte(tipDistributionProfilesTable.effectiveFrom, effectiveTo ?? "9999-12-31"),
        or(isNull(tipDistributionProfilesTable.effectiveTo), gte(tipDistributionProfilesTable.effectiveTo, effectiveFrom)),
      )).limit(1);
    if (overlap) throw new Error("overlap");
    const recipients = await tx.select({
      id: natakariTable.id, ime: natakariTable.ime, priimek: natakariTable.priimek,
    }).from(natakariTable).where(and(
      eq(natakariTable.companyId, companyId),
      inArray(natakariTable.id, body.entries.map(entry => entry.recipientNatakarId)),
      eq(natakariTable.aktiven, true),
    ));
    if (recipients.length !== body.entries.length) throw new Error("recipient");
    const recipientMap = new Map(recipients.map(recipient => [
      recipient.id, `${recipient.ime} ${recipient.priimek}`.trim(),
    ]));
    const [profile] = await tx.insert(tipDistributionProfilesTable).values({
      companyId, enotaId: body.enotaId, name: body.name.trim(), effectiveFrom, effectiveTo,
      createdBy: (req as AuthenticatedRequest).clerkUserId,
    }).returning();
    const entries = await tx.insert(tipDistributionProfileEntriesTable).values(body.entries.map(entry => ({
      profileId: profile.id, companyId, groupName: entry.groupName.trim(),
      recipientNatakarId: entry.recipientNatakarId,
      recipientSnapshot: recipientMap.get(entry.recipientNatakarId)!,
      sharePercent: String(entry.sharePercent),
    }))).returning();
    return { profile, entries };
  }).catch(error => {
    if (error instanceof Error && error.message === "unit") return null;
    if (error instanceof Error && error.message === "recipient") return null;
    if (error instanceof Error && error.message === "overlap") return null;
    return null;
  });
  if (!created) {
    res.status(409).json({ error: "Profil enote ne obstaja, zaposleni niso aktivni ali se obdobje prekriva z obstoječim profilom." });
    return;
  }
  res.status(201).json(CreateTipDistributionProfileResponse.parse(profileView(created.profile, created.entries)));
});

router.get("/companies/:companyId/tip-policies", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  const policies = await db.select().from(tipPoliciesTable).where(eq(tipPoliciesTable.companyId, companyId)).orderBy(desc(tipPoliciesTable.effectiveFrom));
  res.json(ListTipPoliciesResponse.parse(policies.map(responseRow)));
});

router.post("/companies/:companyId/tip-policies", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  const parsed = CreateTipPolicyBody.safeParse(req.body);
  if (!parsed.success || !ISO_DATE.test(parsed.data?.effectiveFrom ?? "")) { res.status(400).json({ error: parsed.success ? "effectiveFrom mora biti YYYY-MM-DD" : parsed.error.message }); return; }
  const body = parsed.data;
  if (body.mode === "employer_controlled") {
    const [company] = await db.select({ enabled: companiesTable.employerControlledTipsEnabled })
      .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    if (!company) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }
    if (!company.enabled) {
      res.status(409).json({
        error: "Politika »Obvezni dodatek za storitev« ni omogočena za to podjetje. Omogoči jo POS administrator v zavihku Enote.",
      });
      return;
    }
  }
  if ((body.mode === "direct_employee" || body.mode === "independent_pool") && !body.agreementConfirmed) {
    res.status(400).json({ error: "Za izbrani režim je obvezna potrditev dogovora" }); return;
  }
  if (
    (body.cardFeeKind === "percentage" && !(Number(body.cardFeePercent) > 0))
    || (body.cardFeeKind === "flat" && (!(Number(body.cardFeeFlatAmount) > 0) || body.cardFeeTreatment !== "employer_expense"))
    || (body.cardFeeKind === "none" && (Number(body.cardFeePercent ?? 0) !== 0 || Number(body.cardFeeFlatAmount ?? 0) !== 0))
    || (body.mode === "employer_controlled" && body.cardFeeTreatment !== "employer_expense")
  ) {
    res.status(400).json({
      error: "Vrsta, znesek in obravnava kartične provizije niso medsebojno skladni",
    });
    return;
  }
  if (body.enotaId != null) {
    const [unit] = await db.select({ id: enoteTable.id }).from(enoteTable).where(and(eq(enoteTable.id, body.enotaId), eq(enoteTable.companyId, companyId))).limit(1);
    if (!unit) { res.status(400).json({ error: "Enota ne pripada podjetju" }); return; }
  }
  const created = await db.transaction(async (tx) => {
    // Serialise edits within one explicit policy scope.  Global policies and a
    // unit policy deliberately have separate scopes (unit takes precedence).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${body.enotaId ?? "global"}`}))`);
    const sameScope = body.enotaId == null ? isNull(tipPoliciesTable.enotaId) : eq(tipPoliciesTable.enotaId, body.enotaId);
    const [overlap] = await tx.select({ id: tipPoliciesTable.id }).from(tipPoliciesTable).where(and(
      eq(tipPoliciesTable.companyId, companyId), sameScope, lte(tipPoliciesTable.effectiveFrom, body.effectiveFrom),
      or(isNull(tipPoliciesTable.effectiveTo), gte(tipPoliciesTable.effectiveTo, body.effectiveFrom)),
    )).limit(1);
    if (overlap) {
      await tx.update(tipPoliciesTable).set({ effectiveTo: previousDay(body.effectiveFrom), updatedAt: new Date() }).where(eq(tipPoliciesTable.id, overlap.id));
    }
    const [later] = await tx.select({ id: tipPoliciesTable.id }).from(tipPoliciesTable).where(and(eq(tipPoliciesTable.companyId, companyId), sameScope, gte(tipPoliciesTable.effectiveFrom, body.effectiveFrom))).limit(1);
    if (later) throw new Error("Tip policy effective-date overlap");
    return (await tx.insert(tipPoliciesTable).values({
      ...body,
      cardFeePercent: body.cardFeePercent == null ? body.cardFeePercent : String(body.cardFeePercent),
      cardFeeFlatAmount: body.cardFeeFlatAmount == null ? body.cardFeeFlatAmount : String(body.cardFeeFlatAmount),
      companyId,
      createdBy: (req as AuthenticatedRequest).clerkUserId,
    }).returning())[0];
  }).catch(() => null);
  if (!created) { res.status(400).json({ error: "Politika se časovno prekriva z obstoječo politiko" }); return; }
  res.status(201).json(CreateTipPolicyResponse.parse(responseRow(created)));
});

function previousDay(iso: string): string { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10); }

router.get("/companies/:companyId/tips-ledger", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); const from = typeof req.query.from === "string" ? req.query.from : ""; const to = typeof req.query.to === "string" ? req.query.to : "";
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) { res.status(400).json({ error: "from in to morata biti veljavna datuma YYYY-MM-DD" }); return; }
  const rows = await db.select().from(tipAllocationsTable).where(and(eq(tipAllocationsTable.companyId, companyId), gte(tipAllocationsTable.createdAt, new Date(`${from}T00:00:00Z`)), lte(tipAllocationsTable.createdAt, new Date(`${to}T23:59:59.999Z`)))).orderBy(desc(tipAllocationsTable.createdAt));
  res.json(ListTipsLedgerResponse.parse(rows.map(responseRow)));
});

router.get("/companies/:companyId/tip-pools", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  const pools = await db.select().from(tipPoolsTable).where(eq(tipPoolsTable.companyId, companyId)).orderBy(desc(tipPoolsTable.effectiveFrom));
  const entries = await db.select().from(tipPoolEntriesTable).where(eq(tipPoolEntriesTable.companyId, companyId)).orderBy(desc(tipPoolEntriesTable.createdAt));
  res.json({ pools: pools.map(responseRow), entries: entries.map(responseRow) });
});

router.post("/companies/:companyId/tip-pools", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); const body = req.body as Record<string, unknown>;
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  if (!["employee_agreement", "collective_agreement"].includes(String(body.decisionType))
    || !ISO_DATE.test(String(body.effectiveFrom)) || !ISO_DATE.test(String(body.decisionDate)) || !String(body.tipPolicyId ?? "").trim() || !String(body.name ?? "").trim() || !String(body.ruleReference ?? "").trim() || !String(body.evidenceReference ?? "").trim()) {
    res.status(400).json({ error: "Za sklad so obvezni odločitev zaposlenih/pravilo, datum veljavnosti in dokazilo" }); return;
  }
  const [policy] = await db.select({ id: tipPoliciesTable.id, mode: tipPoliciesTable.mode }).from(tipPoliciesTable).where(and(eq(tipPoliciesTable.id, String(body.tipPolicyId)), eq(tipPoliciesTable.companyId, companyId))).limit(1);
  if (!policy || policy.mode !== "independent_pool") { res.status(400).json({ error: "Sklad mora biti vezan na politiko neodvisnega sklada" }); return; }
  const [pool] = await db.insert(tipPoolsTable).values({
    companyId, tipPolicyId: policy.id, name: String(body.name).trim(), decisionType: body.decisionType as "employee_agreement" | "collective_agreement",
    decisionDate: String(body.decisionDate),
    ruleReference: String(body.ruleReference).trim(), effectiveFrom: String(body.effectiveFrom),
    effectiveTo: body.effectiveTo ? String(body.effectiveTo) : null, evidenceReference: String(body.evidenceReference).trim(),
    createdBy: (req as AuthenticatedRequest).clerkUserId,
  }).returning();
  res.status(201).json(responseRow(pool));
});

router.post("/companies/:companyId/tip-pools/:poolId/distributions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); const poolId = param(req.params.poolId); const body = req.body as Record<string, unknown>;
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  const distribution = Number(body.amount);
  if (!(distribution > 0) || !String(body.recipientSnapshot ?? "").trim() || !String(body.evidenceReference ?? "").trim()) {
    res.status(400).json({ error: "Distribucija zahteva zaposlenega, pozitiven znesek in dokazilo" }); return;
  }
  const entry = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${poolId}))`);
    const [pool] = await tx.select({ id: tipPoolsTable.id }).from(tipPoolsTable).where(and(eq(tipPoolsTable.id, poolId), eq(tipPoolsTable.companyId, companyId))).limit(1);
    if (!pool) throw new Error("pool");
    if (body.recipientNatakarId != null) {
      const [recipient] = await tx.select({ id: natakariTable.id }).from(natakariTable).where(and(eq(natakariTable.id, Number(body.recipientNatakarId)), eq(natakariTable.companyId, companyId))).limit(1);
      if (!recipient) throw new Error("recipient");
    }
    const balance = await tx.select({ amount: tipPoolEntriesTable.amount }).from(tipPoolEntriesTable).where(and(eq(tipPoolEntriesTable.poolId, poolId), eq(tipPoolEntriesTable.companyId, companyId)));
    if (balance.reduce((total, row) => total + amount(row.amount), 0) + 0.00001 < distribution) throw new Error("balance");
    return (await tx.insert(tipPoolEntriesTable).values({
      companyId, poolId, entryType: "distribution", amount: String(-distribution), recipientSnapshot: String(body.recipientSnapshot).trim(),
      recipientNatakarId: body.recipientNatakarId == null ? null : Number(body.recipientNatakarId), evidenceReference: String(body.evidenceReference).trim(),
      createdBy: (req as AuthenticatedRequest).clerkUserId,
    }).returning())[0];
  }).catch(() => null);
  if (!entry) { res.status(400).json({ error: "Sklad ne obstaja ali nima dovolj odprtega salda" }); return; }
  res.status(201).json(responseRow(entry));
});

router.post("/companies/:companyId/tip-pools/:poolId/entries/:entryId/reverse", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); const poolId = param(req.params.poolId); const entryId = param(req.params.entryId);
  const evidenceReference = typeof req.body?.evidenceReference === "string" ? req.body.evidenceReference.trim() : "";
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  if (!evidenceReference) { res.status(400).json({ error: "Razveljavitev zahteva sklic dokazila" }); return; }
  const reversal = await db.transaction(async tx => {
    const [original] = await tx.select().from(tipPoolEntriesTable).where(and(eq(tipPoolEntriesTable.id, entryId), eq(tipPoolEntriesTable.poolId, poolId), eq(tipPoolEntriesTable.companyId, companyId))).limit(1);
    if (!original) throw new Error("missing");
    const [alreadyReversed] = await tx.select({ id: tipPoolEntriesTable.id }).from(tipPoolEntriesTable).where(and(eq(tipPoolEntriesTable.reversalOfId, entryId), eq(tipPoolEntriesTable.companyId, companyId))).limit(1);
    if (alreadyReversed) throw new Error("reversed");
    return (await tx.insert(tipPoolEntriesTable).values({
      companyId, poolId, entryType: "reversal", amount: String(-amount(original.amount)), reversalOfId: original.id,
      recipientNatakarId: original.recipientNatakarId, recipientSnapshot: original.recipientSnapshot, evidenceReference,
      createdBy: (req as AuthenticatedRequest).clerkUserId,
    }).returning())[0];
  }).catch(() => null);
  if (!reversal) { res.status(400).json({ error: "Vnosa ni mogoče razveljaviti (ne obstaja ali je že razveljavljen)" }); return; }
  res.status(201).json(responseRow(reversal));
});

router.post("/companies/:companyId/tip-allocations/:allocationId/storno", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); const allocationId = param(req.params.allocationId);
  const evidenceReference = typeof req.body?.evidenceReference === "string" ? req.body.evidenceReference.trim() : "";
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  if (!evidenceReference) { res.status(400).json({ error: "Storno zahteva dokazilo" }); return; }
  const result = await db.transaction(async tx => {
    const [allocation] = await tx.select().from(tipAllocationsTable).where(and(eq(tipAllocationsTable.id, allocationId), eq(tipAllocationsTable.companyId, companyId))).limit(1);
    if (!allocation?.tipPoolId) throw new Error("not-pool");
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${allocation.tipPoolId}))`);
    const [entry] = await tx.select().from(tipPoolEntriesTable).where(and(eq(tipPoolEntriesTable.allocationId, allocation.id), eq(tipPoolEntriesTable.entryType, "allocation"))).limit(1);
    if (!entry) throw new Error("entry");
    const [reversed] = await tx.select({ id: tipPoolEntriesTable.id }).from(tipPoolEntriesTable).where(eq(tipPoolEntriesTable.reversalOfId, entry.id)).limit(1);
    if (reversed) throw new Error("already");
    const [poolReversal] = await tx.insert(tipPoolEntriesTable).values({
      companyId, poolId: allocation.tipPoolId, entryType: "reversal", amount: String(-amount(entry.amount)), reversalOfId: entry.id,
      evidenceReference, createdBy: (req as AuthenticatedRequest).clerkUserId,
    }).returning();
    // A settlement cannot be deleted/rewritten; recovery is its compensating record.
    const [settlement] = await tx.select().from(tipSettlementsTable).where(and(eq(tipSettlementsTable.allocationId, allocation.id), eq(tipSettlementsTable.companyId, companyId))).limit(1);
    if (settlement) {
      await tx.execute(sql`INSERT INTO tip_settlement_recoveries (company_id, allocation_id, settlement_id, amount, evidence_reference, created_by)
        VALUES (${companyId}, ${allocation.id}, ${settlement.id}, ${allocation.netAmount}, ${evidenceReference}, ${(req as AuthenticatedRequest).clerkUserId})
        ON CONFLICT (settlement_id) DO NOTHING`);
      await reverseTipSettlementJournal(tx, companyId, allocation.id, (req as AuthenticatedRequest).clerkUserId);
    }
    return poolReversal;
  }).catch(() => null);
  if (!result) { res.status(400).json({ error: "Dodelitve ni mogoče stornirati ali je že stornirana" }); return; }
  res.status(201).json(responseRow(result));
});

router.get("/companies/:companyId/tips-historical-review", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  const rows = await db.select({ racunId: racuniTable.id, createdAt: racuniTable.ustvarjeno, tip: racuniTable.znesekNapitnina, state: tipHistoricalReviewsTable.state, note: tipHistoricalReviewsTable.note })
    .from(racuniTable).innerJoin(enoteTable, eq(racuniTable.enotaId, enoteTable.id))
    .leftJoin(tipHistoricalReviewsTable, eq(tipHistoricalReviewsTable.racunId, racuniTable.id))
    .where(and(eq(enoteTable.companyId, companyId), gt(racuniTable.znesekNapitnina, "0"), isNull(racuniTable.tipPolicyId))).orderBy(desc(racuniTable.ustvarjeno));
  res.json(rows.map(row => responseRow({ ...row, state: row.state ?? "pending" })));
});

router.post("/companies/:companyId/tips-historical-review/:racunId/confirm", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); const racunId = Number(param(req.params.racunId)); const note = typeof req.body?.note === "string" ? req.body.note : null;
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  const confirmed = await db.transaction(async tx => {
    const [receipt] = await tx.select({ id: racuniTable.id }).from(racuniTable).innerJoin(enoteTable, eq(racuniTable.enotaId, enoteTable.id))
      .where(and(eq(racuniTable.id, racunId), eq(enoteTable.companyId, companyId), isNull(racuniTable.tipPolicyId))).limit(1);
    if (!receipt) throw new Error("not-historical");
    const [row] = await tx.insert(tipHistoricalReviewsTable).values({ companyId, racunId, state: "confirmed", note, confirmedBy: (req as AuthenticatedRequest).clerkUserId, confirmedAt: new Date() })
      .onConflictDoNothing().returning();
    return row;
  }).catch(() => null);
  if (!confirmed) { res.status(400).json({ error: "Račun ni zgodovinski ali je pregled že potrjen; politika računa se ne spreminja." }); return; }
  res.status(201).json(responseRow(confirmed));
});

router.get("/companies/:companyId/tips-payroll/export", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId);
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    res.status(400).json({ error: "from in to morata biti veljavna datuma YYYY-MM-DD" }); return;
  }
  const allocations = await db.select({
    recipientNatakarId: tipAllocationsTable.recipientNatakarId,
    recipientSnapshot: tipAllocationsTable.recipientSnapshot,
    grossAmount: tipAllocationsTable.grossAmount,
    feeAmount: tipAllocationsTable.feeAmount,
    netAmount: tipAllocationsTable.netAmount,
    status: tipAllocationsTable.status,
    documentDate: racuniTable.datumCas,
  }).from(tipAllocationsTable)
    .innerJoin(racuniTable, eq(tipAllocationsTable.racunId, racuniTable.id))
    .innerJoin(tipPoliciesTable, eq(tipAllocationsTable.tipPolicyId, tipPoliciesTable.id)).where(and(
    eq(tipAllocationsTable.companyId, companyId),
    isNotNull(racuniTable.datumCas),
    inArray(tipPoliciesTable.mode, ["direct_employee", "independent_pool"]),
    sql`(${racuniTable.datumCas} AT TIME ZONE 'Europe/Ljubljana')::date >= ${from}::date`,
    sql`(${racuniTable.datumCas} AT TIME ZONE 'Europe/Ljubljana')::date <= ${to}::date`,
  ));
  type PayrollRow = {
    recipientNatakarId: number | null;
    employee: string;
    documentDate: string;
    gross: number;
    fee: number;
    net: number;
    settled: number;
    open: number;
    cancelled: number;
    allocationCount: number;
  };
  const byEmployee = new Map<string, PayrollRow>();
  for (const allocation of allocations) {
    if (!allocation.documentDate) continue;
    const date = formatPayrollDocumentDate(allocation.documentDate);
    const key = `${allocation.recipientNatakarId ?? ""}|${allocation.recipientSnapshot}|${date}`;
    const row = byEmployee.get(key) ?? {
      recipientNatakarId: allocation.recipientNatakarId, employee: allocation.recipientSnapshot, documentDate: date,
      gross: 0, fee: 0, net: 0, settled: 0, open: 0, cancelled: 0, allocationCount: 0,
    };
    const net = amount(allocation.netAmount);
    row.gross += amount(allocation.grossAmount);
    row.fee += amount(allocation.feeAmount);
    row.net += net;
    row.allocationCount += 1;
    if (allocation.status === "settled") row.settled += net;
    else if (allocation.status === "cancelled") row.cancelled += net;
    else row.open += net;
    byEmployee.set(key, row);
  }
  const rows = [...byEmployee.values()].map(row => ({
    recipientNatakarId: row.recipientNatakarId ?? "",
    employee: row.employee,
    documentDate: row.documentDate,
    gross: row.gross.toFixed(2),
    fee: row.fee.toFixed(2),
    net: row.net.toFixed(2),
    settled: row.settled.toFixed(2),
    open: row.open.toFixed(2),
    cancelled: row.cancelled.toFixed(2),
    allocationCount: row.allocationCount,
  }));
  const columns = ["documentDate", "recipientNatakarId", "employee", "gross", "fee", "net", "settled", "open", "cancelled", "allocationCount"] as const;
  const quote = (value: unknown) => `"${sanitizeSpreadsheetCell(value).replaceAll('"', '""')}"`;
  res.type("text/csv").attachment(`tips-payroll-${from}-${to}.csv`)
    .send([columns.join(","), ...rows.map(row => columns.map(column => quote(row[column])).join(","))].join("\n"));
});

router.get("/companies/:companyId/tips-ledger/export", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); const from = String(req.query.from ?? ""); const to = String(req.query.to ?? ""); const format = req.query.format === "xlsx" ? "xlsx" : "csv";
  if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, false, res)) return;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) { res.status(400).json({ error: "from in to morata biti veljavna datuma YYYY-MM-DD" }); return; }
  const allocations = await db.select().from(tipAllocationsTable).where(and(eq(tipAllocationsTable.companyId, companyId), gte(tipAllocationsTable.createdAt, new Date(`${from}T00:00:00Z`)), lte(tipAllocationsTable.createdAt, new Date(`${to}T23:59:59.999Z`))));
  const poolEntries = await db.select().from(tipPoolEntriesTable).where(and(eq(tipPoolEntriesTable.companyId, companyId), gte(tipPoolEntriesTable.createdAt, new Date(`${from}T00:00:00Z`)), lte(tipPoolEntriesTable.createdAt, new Date(`${to}T23:59:59.999Z`))));
  const rows = [
    ...allocations.map(a => ({ kind: "receipt_allocation", receipt: a.racunId, pool: a.tipPoolId ?? "", employee: a.recipientSnapshot, amount: amount(a.netAmount), status: a.status, evidence: "", createdAt: a.createdAt.toISOString() })),
    ...poolEntries.map(e => ({ kind: e.entryType, receipt: "", pool: e.poolId, employee: e.recipientSnapshot ?? "", amount: amount(e.amount), status: "posted", evidence: e.evidenceReference, createdAt: e.createdAt.toISOString() })),
  ];
  const columns = ["kind", "receipt", "pool", "employee", "amount", "status", "evidence", "createdAt"] as const;
  if (format === "csv") {
    const quote = (value: unknown) => `"${sanitizeSpreadsheetCell(value).replaceAll('"', '""')}"`;
    res.type("text/csv").attachment(`tip-ledger-${from}-${to}.csv`).send([columns.join(","), ...rows.map(row => columns.map(c => quote(row[c])).join(","))].join("\n")); return;
  }
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Tip ledger");
  sheet.columns = columns.map(key => ({ header: key, key, width: 22 }));
  sheet.addRows(rows.map(row => Object.fromEntries(
    columns.map(key => [key, typeof row[key] === "string" ? sanitizeSpreadsheetCell(row[key]) : row[key]]),
  )));
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").attachment(`tip-ledger-${from}-${to}.xlsx`).send(Buffer.from(await workbook.xlsx.writeBuffer()));
});

router.post("/companies/:companyId/tip-allocations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  const parsed = CreateTipAllocationBody.safeParse(req.body);
  if (!parsed.success || Math.abs((parsed.data?.grossAmount ?? 0) - (parsed.data?.feeAmount ?? 0) - (parsed.data?.netAmount ?? 0)) > 0.00001) { res.status(400).json({ error: parsed.success ? "Neto znesek mora biti bruto minus provizija" : parsed.error.message }); return; }
  const body = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [receipt] = await tx.select({
      enotaId: racuniTable.enotaId,
      tip: racuniTable.znesekNapitnina,
      fee: racuniTable.tipCardFeeAmount,
      feeTreatment: racuniTable.tipCardFeeTreatment,
      tipPolicyId: racuniTable.tipPolicyId,
      receiptDate: racuniTable.datumCas,
    }).from(racuniTable).innerJoin(enoteTable, eq(racuniTable.enotaId, enoteTable.id)).where(and(eq(racuniTable.id, body.racunId), eq(enoteTable.companyId, companyId))).limit(1);
    const [policy] = await tx.select({ id: tipPoliciesTable.id, enotaId: tipPoliciesTable.enotaId, mode: tipPoliciesTable.mode }).from(tipPoliciesTable).where(and(eq(tipPoliciesTable.id, body.tipPolicyId), eq(tipPoliciesTable.companyId, companyId))).limit(1);
    if (!receipt || !policy || receipt.tipPolicyId !== policy.id || (policy.enotaId != null && policy.enotaId !== receipt.enotaId)) throw new Error("foreign");
    const requestedPoolId = (body as typeof body & { tipPoolId?: string | null }).tipPoolId;
    if ((policy.mode === "independent_pool") !== Boolean(requestedPoolId)) throw new Error("pool-required");
    let recipientNatakarId: number | null = null;
    let recipientSnapshot = "";
    if (requestedPoolId) {
      const [pool] = await tx.select().from(tipPoolsTable).where(and(eq(tipPoolsTable.id, requestedPoolId), eq(tipPoolsTable.companyId, companyId))).limit(1);
      const receiptDate = (receipt.receiptDate ?? new Date()).toISOString().slice(0, 10);
      if (!pool || pool.tipPolicyId !== policy.id || pool.effectiveFrom > receiptDate || (pool.effectiveTo != null && pool.effectiveTo < receiptDate)) throw new Error("pool");
      recipientSnapshot = pool.name;
    } else {
      if (body.recipientNatakarId == null) throw new Error("recipient-required");
      const [recipient] = await tx.select({
        id: natakariTable.id,
        ime: natakariTable.ime,
        priimek: natakariTable.priimek,
        aktiven: natakariTable.aktiven,
      }).from(natakariTable).where(and(
        eq(natakariTable.id, body.recipientNatakarId),
        eq(natakariTable.companyId, companyId),
      )).limit(1);
      if (!recipient || !recipient.aktiven) throw new Error("recipient");
      recipientNatakarId = recipient.id;
      recipientSnapshot = `${recipient.ime} ${recipient.priimek}`.trim();
    }
    const allocations = await tx.select({ net: tipAllocationsTable.netAmount }).from(tipAllocationsTable).where(and(eq(tipAllocationsTable.racunId, body.racunId), ne(tipAllocationsTable.status, "cancelled")));
    const available = amount(receipt.tip) - (receipt.feeTreatment === "deduct_from_tip" ? amount(receipt.fee) : 0);
    if (allocations.reduce((total, row) => total + amount(row.net), 0) + body.netAmount > available + 0.00001) throw new Error("exceeds");
    const [created] = await tx.insert(tipAllocationsTable).values({
      ...body,
      grossAmount: String(body.grossAmount),
      feeAmount: String(body.feeAmount),
      netAmount: String(body.netAmount),
      companyId,
      enotaId: receipt.enotaId,
      allocationKind: "manual",
      tipPoolId: requestedPoolId ?? null,
      recipientNatakarId,
      recipientSnapshot,
      createdBy: (req as AuthenticatedRequest).clerkUserId,
    }).returning();
    if (requestedPoolId) await tx.insert(tipPoolEntriesTable).values({
      companyId, poolId: requestedPoolId, allocationId: created.id, entryType: "allocation", amount: String(body.netAmount),
      evidenceReference: `allocation:${created.id}`, createdBy: (req as AuthenticatedRequest).clerkUserId,
    });
    return created;
  }).catch(() => null);
  if (!result) { res.status(400).json({ error: "Dodelitev ni veljavna ali presega razpoložljivo neto napitnino računa" }); return; }
  res.status(201).json(CreateTipAllocationResponse.parse(responseRow(result)));
});

export async function createTipSettlementJournal(
  tx: TipsTransaction,
  companyId: string,
  allocationId: string,
  settledAt: Date,
  amountValue: string | number,
  settlementMethod: "cash" | "bank" | "payroll" | "student_service",
  actor: string,
): Promise<string> {
  if (settlementMethod === "payroll" || settlementMethod === "student_service") {
    throw new Error("settlement-payment-account-not-configured");
  }
  const [settings] = await tx.select({
    tipsLiabilityAccountId: posBookingSettingsTable.tipsLiabilityAccountId,
    cashAccountId: posBookingSettingsTable.cashAccountId,
    bankAccountId: posBookingSettingsTable.bankAccountId,
  }).from(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId)).limit(1);
  const paymentAccountId = settlementMethod === "cash" ? settings?.cashAccountId : settings?.bankAccountId;
  if (!settings?.tipsLiabilityAccountId || !paymentAccountId) throw new Error("settlement-payment-account-not-configured");
  const accountIds = [settings.tipsLiabilityAccountId, paymentAccountId];
  const accounts = await tx.select({ id: accountsTable.id, type: accountsTable.type }).from(accountsTable).where(and(
    eq(accountsTable.companyId, companyId), inArray(accountsTable.id, accountIds),
  ));
  const liabilityAccount = accounts.find(account => account.id === settings.tipsLiabilityAccountId);
  const paymentAccount = accounts.find(account => account.id === paymentAccountId);
  if (accounts.length !== accountIds.length || liabilityAccount?.type !== "liability" || paymentAccount?.type !== "asset") {
    throw new Error("settlement-payment-account-not-configured");
  }
  const documentDate = accountingDate(settledAt);
  const [period] = await tx.select({ id: accountingPeriodsTable.id }).from(accountingPeriodsTable).where(and(
    eq(accountingPeriodsTable.companyId, companyId),
    lte(accountingPeriodsTable.startDate, documentDate),
    gte(accountingPeriodsTable.endDate, documentDate),
    eq(accountingPeriodsTable.status, "open"),
  )).limit(1);
  if (!period) throw new Error("settlement-accounting-period-not-open");
  const reference = `POS:TIP-SETTLEMENT:${allocationId}`;
  const [existing] = await tx.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
    eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, reference),
  )).limit(1);
  if (existing) return existing.id;
  const [entry] = await tx.insert(journalEntriesTable).values({
    companyId, periodId: period.id, documentDate, entryDate: documentDate,
    description: `Poravnava obveznosti napitnine ${allocationId}`,
    reference, status: "draft", sourceType: "document", createdBy: actor,
  }).returning({ id: journalEntriesTable.id });
  await tx.insert(journalEntryLinesTable).values([
    { entryId: entry.id, accountId: settings.tipsLiabilityAccountId, side: "debit", amount: Number(amountValue).toFixed(2), description: "Zapiranje obveznosti do osebja", sequence: 1 },
    { entryId: entry.id, accountId: paymentAccountId, side: "credit", amount: Number(amountValue).toFixed(2), description: settlementMethod === "cash" ? "Izplačilo napitnine iz blagajne" : "Izplačilo napitnine z bančnega računa", sequence: 2 },
  ]);
  return entry.id;
}

router.post("/companies/:companyId/tip-settlements", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const companyId = param(req.params.companyId); if (!await authorize((req as AuthenticatedRequest).clerkUserId, companyId, true, res)) return;
  const parsed = CreateTipSettlementBody.safeParse(req.body);
  if (!parsed.success || Number.isNaN(Date.parse(parsed.data?.settledAt ?? ""))) { res.status(400).json({ error: parsed.success ? "settledAt mora biti veljaven časovni žig" : parsed.error.message }); return; }
  const body = parsed.data;
  let failure = "";
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tip_allocations WHERE id = ${body.allocationId} AND company_id = ${companyId} FOR UPDATE`);
    const [existing] = await tx.select().from(tipSettlementsTable).where(and(
      eq(tipSettlementsTable.allocationId, body.allocationId), eq(tipSettlementsTable.companyId, companyId),
    )).limit(1);
    if (existing) {
      const [existingAllocation] = await tx.select({
        netAmount: tipAllocationsTable.netAmount, policyMode: tipPoliciesTable.mode,
      }).from(tipAllocationsTable).innerJoin(tipPoliciesTable, eq(tipAllocationsTable.tipPolicyId, tipPoliciesTable.id))
        .where(eq(tipAllocationsTable.id, body.allocationId)).limit(1);
      if (existingAllocation?.policyMode !== "employer_controlled") {
        await createTipSettlementJournal(
          tx, companyId, body.allocationId, existing.settledAt,
          existingAllocation?.netAmount ?? "0", existing.settlementMethod,
          (req as AuthenticatedRequest).clerkUserId,
        );
      }
      return { settlement: existing, already: true };
    }
    const [allocation] = await tx.select({
      id: tipAllocationsTable.id, netAmount: tipAllocationsTable.netAmount, policyMode: tipPoliciesTable.mode,
    }).from(tipAllocationsTable).innerJoin(tipPoliciesTable, eq(tipAllocationsTable.tipPolicyId, tipPoliciesTable.id))
      .where(and(eq(tipAllocationsTable.id, body.allocationId), eq(tipAllocationsTable.companyId, companyId), eq(tipAllocationsTable.status, "open"))).limit(1);
    if (!allocation) throw new Error("not-open");
    if (allocation.policyMode === "employer_controlled") throw new Error("employer-controlled-not-employee-liability");
    if (body.settlementMethod === "payroll" || body.settlementMethod === "student_service") throw new Error("settlement-payment-account-not-configured");
    const [created] = await tx.insert(tipSettlementsTable).values({
      ...body, companyId, settledAt: new Date(body.settledAt), settledBy: (req as AuthenticatedRequest).clerkUserId,
    }).returning();
    await createTipSettlementJournal(tx, companyId, allocation.id, new Date(body.settledAt), allocation.netAmount, body.settlementMethod, (req as AuthenticatedRequest).clerkUserId);
    await tx.update(tipAllocationsTable).set({ status: "settled", updatedBy: (req as AuthenticatedRequest).clerkUserId, updatedAt: new Date() }).where(eq(tipAllocationsTable.id, allocation.id));
    return { settlement: created, already: false };
  }).catch(error => {
    failure = error instanceof Error ? error.message : "settlement-failed";
    return null;
  });
  if (!result) {
    const messages: Record<string, string> = {
      "employer-controlled-not-employee-liability": "Obvezni dodatek za storitev je prihodek podjetja in ne zapira obveznosti do zaposlenih.",
      "settlement-payment-account-not-configured": "Poravnave ni mogoče knjižiti: nastavite varen konto blagajne/TRR; obračun plač in študentski servis nimata varnega plačilnega konta.",
      "settlement-accounting-period-not-open": "Poravnave ni mogoče knjižiti: računovodsko obdobje za datum poravnave ni odprto.",
      "not-open": "Dodelitev ne obstaja, ne pripada podjetju ali ni odprta.",
    };
    res.status(409).json({ code: failure || "settlement-failed", error: messages[failure] ?? "Poravnava ni bila izvedena; knjižba ni bila ustvarjena." }); return;
  }
  res.status(result.already ? 200 : 201).json(CreateTipSettlementResponse.parse(responseRow(result.settlement)));
});

export default router;