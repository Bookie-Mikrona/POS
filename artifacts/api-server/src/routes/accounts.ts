import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import {
  db,
  accountsTable,
  accountTypeConfirmationsTable,
} from "@workspace/db";
import { CreateAccountBody, UpdateAccountBody, SeedAccountsBody, ListAccountTypeConfirmationsResponse } from "@workspace/api-zod";
import { accountTypeWarning } from "../lib/accountTypeWarning";
import { COMPANY_CHART_OF_ACCOUNTS } from "../lib/companyChartOfAccounts";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { seedDefaultChartOfAccounts } from "../lib/seedDefaultChartOfAccounts";
import { resolveSifrantAccess } from "../lib/resolveSifrantAccess";
import { generateAccountsPdf } from "../lib/accounts-pdf";
import {
  defaultCostCenterPolicy,
  requiresCostCenterForPolicy,
  type AccountCostCenterPolicy,
} from "../lib/accountCostCenterPolicy";

const router: IRouter = Router();

/** Izvleče companyId in accountId iz req.params, normalizira string[] → string. */
function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function validateAccountParent(
  companyId: string,
  parentId: string,
  accountId?: string,
): Promise<string | null> {
  if (parentId.trim() === "") {
    return "Nadrejeni konto ni veljaven";
  }

  const visited = new Set<string>();
  let currentId: string | null = parentId;

  while (currentId) {
    if (currentId === accountId) {
      return "Konto ne more biti sam sebi neposredno ali posredno nadrejen";
    }
    if (visited.has(currentId)) {
      return "Zaznana krožna hierarhija kontov";
    }
    visited.add(currentId);

    const [current] = await db
      .select({ id: accountsTable.id, parentId: accountsTable.parentId })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, currentId), eq(accountsTable.companyId, companyId)))
      .limit(1);

    if (!current) {
      return "Nadrejeni konto ni najden v tem podjetju";
    }
    currentId = current.parentId ?? null;
  }

  return null;
}

// GET /companies/:companyId/accounts
router.get(
  "/companies/:companyId/accounts",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveSifrantAccess(authReq.clerkUserId, companyId, "stm_or_kontni", res);
    if (!access) return;

    const includeInactive = req.query.includeInactive === "true";
    const conditions: ReturnType<typeof eq>[] = [eq(accountsTable.companyId, companyId)];
    if (!includeInactive) conditions.push(eq(accountsTable.isActive, true));

    const accounts = await db
      .select()
      .from(accountsTable)
      .where(and(...conditions))
      .orderBy(asc(accountsTable.code));

    res.json({ accounts });
  },
);

// GET /companies/:companyId/accounts/export/pdf
router.get(
  "/companies/:companyId/accounts/export/pdf",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveSifrantAccess(authReq.clerkUserId, companyId, "stm_or_kontni", res);
    if (!access) return;

    const accounts = await db
      .select({
        code: accountsTable.code,
        name: accountsTable.name,
        type: accountsTable.type,
        isActive: accountsTable.isActive,
      })
      .from(accountsTable)
      .where(eq(accountsTable.companyId, companyId))
      .orderBy(asc(accountsTable.code));
    const pdf = await generateAccountsPdf(accounts);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="kontni-plan-${companyId}.pdf"`);
    res.send(pdf);
  },
);

// POST /companies/:companyId/accounts
router.post(
  "/companies/:companyId/accounts",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveSifrantAccess(authReq.clerkUserId, companyId, "stm_or_kontni", res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje kontnega plana potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const warning = accountTypeWarning(parsed.data);
    if (warning && !parsed.data.confirmTypeException) {
      res.status(422).json({ error: "Potrdite izjemo tipa konta.", warnings: [warning] });
      return;
    }

    if (parsed.data.parentId !== null && parsed.data.parentId !== undefined) {
      const parentError = await validateAccountParent(companyId, parsed.data.parentId);
      if (parentError) {
        res.status(400).json({ error: parentError });
        return;
      }
    }

    const [existing] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.code, parsed.data.code)))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: `Konto s kodo "${parsed.data.code}" že obstaja` });
      return;
    }

    const policy = parsed.data.costCenterPolicy
      ?? defaultCostCenterPolicy(parsed.data.code, parsed.data.requiresCostCenter ?? false);
    const { confirmTypeException: _confirmation, ...accountData } = parsed.data;
    const account = await db.transaction(async tx => {
      const [account] = await tx
        .insert(accountsTable)
        .values({
          ...accountData,
          costCenterPolicy: policy,
          requiresCostCenter: requiresCostCenterForPolicy(policy),
          companyId,
        })
        .returning();
      if (warning) {
        await tx.insert(accountTypeConfirmationsTable).values({
          companyId, accountId: account.id, actorId: authReq.clerkUserId,
          code: account.code, selectedType: account.type, expectedType: warning.expectedType,
          source: "create",
        });
      }
      return account;
    });

    res.status(201).json(account);
  },
);

// POST /companies/:companyId/accounts/seed
// IMPORTANT: mora biti pred /:id route da Express ne zamenja "seed" za id
router.post(
  "/companies/:companyId/accounts/seed",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveSifrantAccess(authReq.clerkUserId, companyId, "stm_or_kontni", res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za uvoz kontnega plana potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const [existing] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.companyId, companyId))
      .limit(1);

    if (existing) {
      res.status(400).json({
        error: "Kontni plan za to podjetje že obstaja. Privzetega uvoza ni mogoče opraviti.",
      });
      return;
    }

    const parsed = SeedAccountsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const warnings = COMPANY_CHART_OF_ACCOUNTS.flatMap(account => {
      const warning = accountTypeWarning(account);
      return warning ? [warning] : [];
    });
    if (warnings.length && !parsed.data.confirmTypeException) {
      res.status(422).json({ error: "Pred uvozom potrdite izjeme tipov kontov.", warnings });
      return;
    }
    const count = await db.transaction(async tx => {
      const count = await seedDefaultChartOfAccounts(companyId, tx);
      if (warnings.length) {
        const imported = await tx.select().from(accountsTable).where(eq(accountsTable.companyId, companyId));
        const confirmations = imported.flatMap(account => {
          const warning = accountTypeWarning(account);
          return warning ? [{
            companyId, accountId: account.id, actorId: authReq.clerkUserId,
            code: account.code, selectedType: account.type, expectedType: warning.expectedType,
            source: "import" as const,
          }] : [];
        });
        if (confirmations.length) await tx.insert(accountTypeConfirmationsTable).values(confirmations);
      }
      return count;
    });
    res.status(201).json({ count });
  },
);

// PATCH /companies/:companyId/accounts/:id
router.patch(
  "/companies/:companyId/accounts/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveSifrantAccess(authReq.clerkUserId, companyId, "stm_or_kontni", res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje kontov potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = UpdateAccountBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const result = await db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(accountsTable)
      .where(and(eq(accountsTable.id, id), eq(accountsTable.companyId, companyId)))
      .limit(1)
      .for("update");

    if (!existing) {
      return { status: 404, body: { error: "Konto ni najden" } };
    }

    const warning = accountTypeWarning({ ...existing, type: parsed.data.type ?? existing.type });
    if (warning && !parsed.data.confirmTypeException) {
      return { status: 422, body: { error: "Potrdite izjemo tipa konta.", warnings: [warning] } };
    }

    if (parsed.data.parentId !== null && parsed.data.parentId !== undefined) {
      const parentError = await validateAccountParent(companyId, parsed.data.parentId, id);
      if (parentError) {
        return { status: 400, body: { error: parentError } };
      }
    }

    // Zgradimo update objekt samo iz definiranih vrednosti
    const updateData: Partial<{
      type: typeof accountsTable.$inferSelect.type;
      name: string;
      description: string | null;
      isActive: boolean;
      parentId: string | null;
      allowsPosting: boolean;
      requiresPartner: boolean;
      requiresCostCenter: boolean;
      costCenterPolicy: AccountCostCenterPolicy;
      requiresProject: boolean;
      taxBehavior: "none" | "output_vat" | "input_vat" | "exempt";
      isCash: boolean;
      isOpenItem: boolean;
    }> = {};
    if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if ("description" in parsed.data) updateData.description = parsed.data.description ?? null;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if ("parentId" in parsed.data) updateData.parentId = parsed.data.parentId ?? null;
    if (parsed.data.allowsPosting !== undefined) updateData.allowsPosting = parsed.data.allowsPosting;
    if (parsed.data.requiresPartner !== undefined) updateData.requiresPartner = parsed.data.requiresPartner;
    if (parsed.data.costCenterPolicy !== undefined) {
      updateData.costCenterPolicy = parsed.data.costCenterPolicy;
      updateData.requiresCostCenter = requiresCostCenterForPolicy(parsed.data.costCenterPolicy);
    } else if (parsed.data.requiresCostCenter !== undefined) {
      // Stari odjemalci lahko še vedno pošljejo boolean; kanonično politiko
      // izpeljemo iz njega, da alias ostane sinhroniziran.
      const policy = parsed.data.requiresCostCenter ? "required" : "allowed";
      updateData.costCenterPolicy = policy;
      updateData.requiresCostCenter = parsed.data.requiresCostCenter;
    }
    if (parsed.data.requiresProject !== undefined) updateData.requiresProject = parsed.data.requiresProject;
    if (parsed.data.taxBehavior !== undefined) updateData.taxBehavior = parsed.data.taxBehavior;
    if (parsed.data.isCash !== undefined) updateData.isCash = parsed.data.isCash;
    if (parsed.data.isOpenItem !== undefined) updateData.isOpenItem = parsed.data.isOpenItem;

    const [updated] = Object.keys(updateData).length === 0 ? [existing] : await tx
      .update(accountsTable)
      .set(updateData)
      .where(and(eq(accountsTable.id, id), eq(accountsTable.companyId, companyId)))
      .returning();

    if (warning) {
      await tx.insert(accountTypeConfirmationsTable).values({
        companyId, accountId: updated.id, actorId: authReq.clerkUserId,
        code: updated.code, selectedType: updated.type, expectedType: warning.expectedType,
        source: "update",
      });
    }
    return { status: 200, body: updated };
    });
    res.status(result.status).json(result.body);
  },
);

router.get(
  "/companies/:companyId/accounts/:id/type-confirmations",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveSifrantAccess((req as AuthenticatedRequest).clerkUserId, companyId, "stm_or_kontni", res);
    if (!access) return;
    const [account] = await db.select({ id: accountsTable.id }).from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.id, id))).limit(1);
    if (!account) {
      res.status(404).json({ error: "Konto ni najden" });
      return;
    }
    const history = await db.select().from(accountTypeConfirmationsTable)
      .where(and(eq(accountTypeConfirmationsTable.companyId, companyId), eq(accountTypeConfirmationsTable.accountId, id)))
      .orderBy(desc(accountTypeConfirmationsTable.confirmedAt), desc(accountTypeConfirmationsTable.id));
    res.json(ListAccountTypeConfirmationsResponse.parse(history));
  },
);

export default router;
