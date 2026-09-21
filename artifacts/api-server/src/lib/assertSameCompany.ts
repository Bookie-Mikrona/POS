/**
 * assertSameCompany.ts — centralni validator company-scope za reference na skupne šifrante.
 *
 * Skupna šifranta cost_centers in accounts sta company-scoped: vsak modul, ki
 * shranjuje FK na te tabele, MORA preveriti, da referencirani zapis pripada
 * istemu podjetju. Ta modul ponuja dve funkciji za batch preverbo:
 *
 *   assertCostCenterInCompany(ids, companyId) → { status: 400, error } | null
 *   assertAccountInCompany(ids, companyId)    → { status: 400, error } | null
 *
 * Obe preskočita null/undefined vrednosti, naredita en batch SELECT z IN(...)
 * in vrneta napako, če katerikoli ID ne obstaja v podjetju (ali sploh ne obstaja
 * — tega ne razlikujemo, ker bi razlika razkrila obstoj tujih zapisov).
 *
 * Uporaba v ruti:
 *   const err = await assertAccountInCompany([d.accountId, d.kontoPopravkaId], companyId);
 *   if (err) { res.status(err.status).json({ error: err.error }); return; }
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, accountsTable, costCentersTable } from "@workspace/db";

export type CompanyScopeError = { status: 400; error: string };

/** Odstrani null/undefined in podvojene ID-je. */
function cleanIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/**
 * Preveri, da vsa podana stroškovna mesta pripadajo podjetju `companyId`.
 * null/undefined vrednosti so preskočene. En batch SELECT za vse ID-je.
 */
export async function assertCostCenterInCompany(
  ids: (string | null | undefined)[],
  companyId: string,
): Promise<CompanyScopeError | null> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return null;

  const rows = await db
    .select({ id: costCentersTable.id })
    .from(costCentersTable)
    .where(and(inArray(costCentersTable.id, wanted), eq(costCentersTable.companyId, companyId)));

  const found = new Set(rows.map((r) => r.id));
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return {
      status: 400,
      error: "Stroškovno mesto ni najdeno ali ne pripada temu podjetju",
    };
  }
  return null;
}

/**
 * Preveri, da vsi podani konti pripadajo podjetju `companyId`.
 * null/undefined vrednosti so preskočene. En batch SELECT za vse ID-je.
 */
export async function assertAccountInCompany(
  ids: (string | null | undefined)[],
  companyId: string,
): Promise<CompanyScopeError | null> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return null;

  const rows = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(inArray(accountsTable.id, wanted), eq(accountsTable.companyId, companyId)));

  const found = new Set(rows.map((r) => r.id));
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return {
      status: 400,
      error: "Konto ni najden ali ne pripada temu podjetju",
    };
  }
  return null;
}
