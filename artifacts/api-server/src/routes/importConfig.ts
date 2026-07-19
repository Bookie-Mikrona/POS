import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  companyImportConfigTable,
  accountingRolesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

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

// GET /companies/:companyId/import-config
router.get(
  "/companies/:companyId/import-config",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [row] = await db
      .select()
      .from(companyImportConfigTable)
      .where(eq(companyImportConfigTable.companyId, companyId))
      .limit(1);

    if (!row) {
      res.json({ bankAccountId: null, arAccountId: null, apAccountId: null });
      return;
    }

    res.json({
      bankAccountId: row.bankAccountId,
      arAccountId: row.arAccountId,
      apAccountId: row.apAccountId,
    });
  },
);

// PUT /companies/:companyId/import-config
router.put(
  "/companies/:companyId/import-config",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    // Only owners and accountants may write import config
    if (access.role === "viewer") {
      res.status(403).json({ error: "Gledalci ne morejo spreminjati nastavitev uvoza" });
      return;
    }

    const { bankAccountId, arAccountId, apAccountId } = req.body as {
      bankAccountId?: string | null;
      arAccountId?: string | null;
      apAccountId?: string | null;
    };

    await db
      .insert(companyImportConfigTable)
      .values({
        companyId,
        bankAccountId: bankAccountId ?? null,
        arAccountId: arAccountId ?? null,
        apAccountId: apAccountId ?? null,
      })
      .onConflictDoUpdate({
        target: companyImportConfigTable.companyId,
        set: {
          bankAccountId: bankAccountId ?? null,
          arAccountId: arAccountId ?? null,
          apAccountId: apAccountId ?? null,
          updatedAt: new Date(),
        },
      });

    res.json({ ok: true });
  },
);

export default router;
