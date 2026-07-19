/**
 * POS Gostinstvo — middleware za Clerk auth + enota izolacija.
 *
 * Zamenjuje stari session-based requireAuth iz POS projekta.
 * Vsak POS API klic mora imeti:
 *   Authorization: Bearer <clerk-jwt>
 *   X-Enota-Id: <integer>
 *
 * Middleware nastavi (req as PosRequest).enotaId za vse nadaljnje route handlere.
 */

import type { Request, Response, NextFunction } from "express";
import { requireAuth as clerkRequireAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { enoteTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface PosRequest extends Request {
  enotaId: number;
  clerkUserId: string;
}

/**
 * requireEnota — Clerk JWT preverjanje + enota validacija.
 * Nastavi req.enotaId in req.clerkUserId.
 */
export async function requireEnota(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Preveri Clerk JWT (isto kot naš ERP requireAuth)
  const clerkMiddleware = clerkRequireAuth();
  await new Promise<void>((resolve, reject) => {
    clerkMiddleware(req, res, (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  }).catch(() => {
    if (!res.headersSent) {
      res.status(401).json({ napaka: "Prijava je obvezna" });
    }
    return;
  });

  if (res.headersSent) return;

  // 2. Pridobi enota_id iz headerja
  const enotaIdRaw = req.headers["x-enota-id"];
  const enotaId = enotaIdRaw ? parseInt(String(enotaIdRaw), 10) : NaN;

  if (!enotaId || isNaN(enotaId)) {
    res.status(400).json({ napaka: "Manjka X-Enota-Id glava" });
    return;
  }

  // 3. Preveri da enota obstaja
  const [enota] = await db
    .select({ id: enoteTable.id })
    .from(enoteTable)
    .where(eq(enoteTable.id, enotaId))
    .limit(1);

  if (!enota) {
    res.status(404).json({ napaka: "Poslovna enota ne obstaja" });
    return;
  }

  // 4. Nastavi na zahtevku
  (req as PosRequest).enotaId = enotaId;
  (req as PosRequest).clerkUserId = (req as any).auth?.userId ?? "";

  next();
}

/** Alias za združljivost s kopiranimi rutami — zamenjuje session requireAuth */
export const posAuth = requireEnota;
