/**
 * POS Nastavitve knjiženja — ERP API
 *
 * GET  /companies/:companyId/pos-booking-settings      — preberi nastavitve
 * PUT  /companies/:companyId/pos-booking-settings      — shrani nastavitve
 * POST /companies/:companyId/pos-booking-settings/sync/:datum  — ročni trigger za datum
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  posBookingSettingsTable,
  accountingRolesTable,
  accountsTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { syncPosBookingForDay } from "../lib/posSyncBooking";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveOwnerOrAccountant(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<boolean> {
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
    return false;
  }
  if (row.role === "viewer") {
    res.status(403).json({ error: "Samo lastnik ali računovodja lahko ureja nastavitve" });
    return false;
  }
  return true;
}

// ── Veljavni UUID ali null ────────────────────────────────────────────────────

function uuidOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/pos-booking-settings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const [row] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(
        and(
          eq(accountingRolesTable.clerkUserId, authReq.clerkUserId),
          eq(accountingRolesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(403).json({ error: "Dostop ni dovoljen" });
      return;
    }

    const [settings] = await db
      .select()
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, companyId))
      .limit(1);

    res.json(settings ?? null);
  },
);

// ── PUT ───────────────────────────────────────────────────────────────────────

const ACCOUNT_FIELDS = [
  "revenueAccountId",
  "cashAccountId",
  "cardAccountId",
  "otherPaymentAccountId",
  "vatLiabilityAccountId",
  "inventoryAccountId",
  "payablesAccountId",
  "cogsAccountId",
] as const;

router.put(
  "/companies/:companyId/pos-booking-settings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolveOwnerOrAccountant(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    const body = req.body as Record<string, unknown>;

    // Zgradi patch object — samo polja ki so prisotna v body
    const patch: Record<string, string | null> = {};
    for (const field of ACCOUNT_FIELDS) {
      if (field in body) {
        patch[field] = uuidOrNull(body[field]);
      }
    }

    // Preveri da vsi nastavljeni accountId-ji obstajajo in so del podjetja
    const nonNullIds = Object.values(patch).filter((v): v is string => v !== null);
    if (nonNullIds.length > 0) {
      const found = await db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(
          and(
            eq(accountsTable.companyId, companyId),
          ),
        );
      const foundSet = new Set(found.map(r => r.id));
      const missing = nonNullIds.filter(id => !foundSet.has(id));
      if (missing.length > 0) {
        res.status(400).json({ error: "Nekateri konti ne obstajajo v kontnem planu tega podjetja" });
        return;
      }
    }

    // Upsert
    const [upserted] = await db
      .insert(posBookingSettingsTable)
      .values({
        companyId,
        ...patch,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: posBookingSettingsTable.companyId,
        set: {
          ...patch,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json(upserted);
  },
);

// ── POST /sync/:datum — ročni trigger ─────────────────────────────────────────

router.post(
  "/companies/:companyId/pos-booking-settings/sync/:datum",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const datum = extractParam(req.params.datum);

    // Preveri datum format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      res.status(400).json({ error: "Neveljaven datum — pričakujem YYYY-MM-DD" });
      return;
    }

    const ok = await resolveOwnerOrAccountant(authReq.clerkUserId, companyId, res);
    if (!ok) return;

    try {
      const result = await syncPosBookingForDay(companyId, datum);
      res.json(result);
    } catch (err) {
      console.error("POS sync napaka:", err);
      res.status(500).json({ error: "Napaka pri sinhronizaciji POS temeljnic" });
    }
  },
);

export default router;
