/**
 * POS Gostinstvo — middleware za Clerk auth + enota/podjetje izolacija.
 *
 * requireEnota  — za rute ki zahtevajo aktivno enoto (X-Enota-Id header)
 * requirePosCompany — za rute ki zahtevajo samo company-level dostop (npr. upravljanje enot)
 */

import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { enoteTable, posUporabnikiTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export interface PosRequest extends Request {
  enotaId: number;
  clerkUserId: string;
  companyId: string;
}

/**
 * requireEnota — Clerk JWT preverjanje + enota validacija.
 * Nastavi req.enotaId, req.clerkUserId in req.companyId.
 */
export async function requireEnota(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Preveri Clerk JWT prek globalnega clerkMiddleware (nastavljenega v app.ts)
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ napaka: "Prijava je obvezna" });
    return;
  }

  // 2. Pridobi enota_id iz headerja
  const enotaIdRaw = req.headers["x-enota-id"];
  const enotaId = enotaIdRaw ? parseInt(String(enotaIdRaw), 10) : NaN;

  if (!enotaId || isNaN(enotaId)) {
    res.status(400).json({ napaka: "Manjka X-Enota-Id glava" });
    return;
  }

  // 3. Poišči POS uporabnika → pridobi companyId, vlogo in dodeljeno enoto
  const [posUser] = await db
    .select({
      companyId: posUporabnikiTable.companyId,
      vloga: posUporabnikiTable.vloga,
      dodeljenaEnotaId: posUporabnikiTable.enotaId,
    })
    .from(posUporabnikiTable)
    .where(and(eq(posUporabnikiTable.clerkUserId, userId), eq(posUporabnikiTable.aktiven, true)))
    .limit(1);

  if (!posUser) {
    res.status(403).json({ napaka: "Nimate dostopa do POS sistema" });
    return;
  }

  // admin_enote sme dostopati samo do svoje dodeljene enote
  if (posUser.vloga === "admin_enote" && posUser.dodeljenaEnotaId !== enotaId) {
    res.status(403).json({ napaka: "Admin enote sme dostopati samo do svoje dodeljene enote", koda: "ENOTA_NEDOSTOPNA" });
    return;
  }

  // 4. Preveri da enota obstaja IN pripada uporabnikovemu podjetju
  const [enota] = await db
    .select({ id: enoteTable.id, companyId: enoteTable.companyId })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, enotaId), eq(enoteTable.companyId, posUser.companyId)))
    .limit(1);

  if (!enota) {
    res.status(403).json({ napaka: "Poslovna enota ne obstaja ali nimate dostopa do nje", koda: "ENOTA_NEDOSTOPNA" });
    return;
  }

  // 5. Nastavi na zahtevku
  (req as PosRequest).enotaId = enotaId;
  (req as PosRequest).clerkUserId = userId;
  (req as PosRequest).companyId = enota.companyId;
  (req as any).companyId = enota.companyId; // za kompatibilnost z enote.ts ki bere (req as any).companyId

  next();
}

/**
 * requirePosCompany — Clerk JWT preverjanje + company izolacija prek POS user zapisa.
 * Uporablja se za rute ki ne zahtevajo X-Enota-Id (npr. upravljanje enot).
 * Nastavi req.companyId in req.clerkUserId.
 * Zahteva vlogo admin ali admin_enote.
 */
export async function requirePosCompany(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Preveri Clerk JWT
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ napaka: "Prijava je obvezna" });
    return;
  }

  // 2. Poišči POS user → pridobi companyId
  const [user] = await db
    .select({
      companyId: posUporabnikiTable.companyId,
      vloga: posUporabnikiTable.vloga,
    })
    .from(posUporabnikiTable)
    .where(
      and(
        eq(posUporabnikiTable.clerkUserId, userId),
        eq(posUporabnikiTable.aktiven, true),
      )
    )
    .limit(1);

  if (!user) {
    res.status(403).json({ napaka: "Nimate dostopa do POS sistema" });
    return;
  }

  if (user.vloga !== "admin" && user.vloga !== "admin_enote") {
    res.status(403).json({ napaka: "Upravljanje enot zahteva vlogo admin ali admin_enote" });
    return;
  }

  // 3. Nastavi na zahtevku
  (req as PosRequest).clerkUserId = userId;
  (req as PosRequest).companyId = user.companyId;
  (req as any).companyId = user.companyId;

  next();
}

/** Alias za združljivost s kopiranimi rutami — zamenjuje session requireAuth */
export const posAuth = requireEnota;
