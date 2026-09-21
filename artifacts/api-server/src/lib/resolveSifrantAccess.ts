/**
 * Centraliziran dostop do šifrantnih rut.
 *
 * Pravila (BREZ superadmin override — izključno prek dodeljenih vlog):
 *
 * "partnerji"    — Poslovni partnerji: VSI uporabniki pišejo (ERP/OS/POS).
 *                  ERP viewer in OS viewer dobita "accountant" (ne "viewer"),
 *                  ker spec določa, da vse vloge urejajo partnerje.
 *
 * "stm_or_kontni" — StM + Kontni plan: ERP in OS pišejo; POS admin piše, ostali berejo.
 *                   ERP owner/accountant/viewer → as-is.
 *                   OS os_viewer → viewer (read-only); os_admin/os_user → accountant.
 *                   POS admin → accountant (sme pisati).
 *                   POS admin_enote / uporabnik → viewer (read-only).
 *
 * "ostale_dimenzije" — Projekti + Oddelki: obstoječe ERP/OS vloge; POS vedno viewer.
 */

import { and, eq } from "drizzle-orm";
import type { Response } from "express";
import {
  db,
  accountingRolesTable,
  osRolesTable,
  posUporabnikiTable,
} from "@workspace/db";

export type SifrantKind = "partnerji" | "stm_or_kontni" | "ostale_dimenzije";
export type SifrantRole = "owner" | "accountant" | "viewer";

export async function resolveSifrantAccess(
  clerkUserId: string,
  companyId: string,
  kind: SifrantKind,
  res: Response,
): Promise<{ role: SifrantRole } | null> {
  // 1. ERP vloga (accounting_roles)
  const [erpRow] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (erpRow) {
    if (kind === "partnerji") return { role: "accountant" }; // VSI ERP vloge pišejo
    return { role: erpRow.role }; // owner/accountant/viewer za StM/KontniPlan
  }

  // 2. OS vloga (os_roles)
  const [osRow] = await db
    .select({ role: osRolesTable.role })
    .from(osRolesTable)
    .where(
      and(
        eq(osRolesTable.clerkUserId, clerkUserId),
        eq(osRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (osRow) {
    if (kind === "partnerji") return { role: "accountant" }; // VSI OS vloge pišejo
    // StM/KontniPlan: os_viewer → samo bere; os_admin/os_user → ureja
    return { role: osRow.role === "os_viewer" ? "viewer" : "accountant" };
  }

  // 3. POS vloga (pos_uporabniki)
  const [posRow] = await db
    .select({ vloga: posUporabnikiTable.vloga })
    .from(posUporabnikiTable)
    .where(
      and(
        eq(posUporabnikiTable.clerkUserId, clerkUserId),
        eq(posUporabnikiTable.companyId, companyId),
        eq(posUporabnikiTable.aktiven, true),
      ),
    )
    .limit(1);
  if (posRow) {
    if (kind === "partnerji") return { role: "accountant" }; // vse POS vloge pišejo partnerje
    // Samo StM in kontni plan dobita POS-admin write; projekti/oddelki ostanejo read-only.
    return { role: kind === "stm_or_kontni" && posRow.vloga === "admin" ? "accountant" : "viewer" };
  }

  res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
  return null;
}
