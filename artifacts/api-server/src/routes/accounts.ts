import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import {
  db,
  accountsTable,
  accountingRolesTable,
} from "@workspace/db";
import { CreateAccountBody, UpdateAccountBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import {
  SLOVENIAN_CHART_OF_ACCOUNTS,
  getParentCodeMap,
} from "../lib/slovenianChartOfAccounts";

const router: IRouter = Router();

/** Preveri dostop do podjetja za prijavljenega uporabnika. Vrne vlogo ali pošlje 403. */
async function resolveAccess(
  req: AuthenticatedRequest,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, req.clerkUserId),
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

/** Izvleče companyId in accountId iz req.params, normalizira string[] → string. */
function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// GET /companies/:companyId/accounts
router.get(
  "/companies/:companyId/accounts",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq, companyId, res);
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

// POST /companies/:companyId/accounts
router.post(
  "/companies/:companyId/accounts",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq, companyId, res);
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

    const [existing] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.code, parsed.data.code)))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: `Konto s kodo "${parsed.data.code}" že obstaja` });
      return;
    }

    const [account] = await db
      .insert(accountsTable)
      .values({ ...parsed.data, companyId })
      .returning();

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

    const access = await resolveAccess(authReq, companyId, res);
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
        error: "Kontni plan za to podjetje že obstaja. Standardnega uvoza ni mogoče opraviti.",
      });
      return;
    }

    // 1. vstavi vse konte brez parentId
    const insertValues = SLOVENIAN_CHART_OF_ACCOUNTS.map((a) => ({
      companyId,
      code: a.code,
      name: a.name,
      type: a.type,
      parentId: null as string | null,
      isActive: true,
    }));

    const inserted = await db
      .insert(accountsTable)
      .values(insertValues)
      .returning({ id: accountsTable.id, code: accountsTable.code });

    // 2. razreši parentId hierarhijo
    const codeToId = new Map(inserted.map((r) => [r.code, r.id]));
    const parentCodeMap = getParentCodeMap();

    await Promise.all(
      Array.from(parentCodeMap.entries()).map(([code, parentCode]) => {
        const id = codeToId.get(code);
        const parentId = codeToId.get(parentCode);
        if (!id || !parentId) return Promise.resolve();
        return db
          .update(accountsTable)
          .set({ parentId })
          .where(eq(accountsTable.id, id));
      }),
    );

    res.status(201).json({ count: inserted.length });
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

    const access = await resolveAccess(authReq, companyId, res);
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

    const [existing] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, id), eq(accountsTable.companyId, companyId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Konto ni najden" });
      return;
    }

    // Zgradimo update objekt samo iz definiranih vrednosti
    const updateData: Partial<{
      name: string;
      description: string | null;
      isActive: boolean;
      parentId: string | null;
      allowsPosting: boolean;
      requiresPartner: boolean;
      requiresCostCenter: boolean;
      requiresProject: boolean;
      taxBehavior: "none" | "output_vat" | "input_vat" | "exempt";
    }> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if ("description" in parsed.data) updateData.description = parsed.data.description ?? null;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if ("parentId" in parsed.data) updateData.parentId = parsed.data.parentId ?? null;
    if (parsed.data.allowsPosting !== undefined) updateData.allowsPosting = parsed.data.allowsPosting;
    if (parsed.data.requiresPartner !== undefined) updateData.requiresPartner = parsed.data.requiresPartner;
    if (parsed.data.requiresCostCenter !== undefined) updateData.requiresCostCenter = parsed.data.requiresCostCenter;
    if (parsed.data.requiresProject !== undefined) updateData.requiresProject = parsed.data.requiresProject;
    if (parsed.data.taxBehavior !== undefined) updateData.taxBehavior = parsed.data.taxBehavior as any;

    if (Object.keys(updateData).length === 0) {
      const [current] = await db
        .select()
        .from(accountsTable)
        .where(eq(accountsTable.id, id))
        .limit(1);
      res.json(current);
      return;
    }

    const [updated] = await db
      .update(accountsTable)
      .set(updateData)
      .where(and(eq(accountsTable.id, id), eq(accountsTable.companyId, companyId)))
      .returning();

    res.json(updated);
  },
);

export default router;
