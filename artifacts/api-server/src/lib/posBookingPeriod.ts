import { and, eq, gte, lte, notInArray } from "drizzle-orm";
import { accountingPeriodsTable, companyModulesTable, posBookingDraftsTable, db } from "@workspace/db";

/**
 * Samostojni POS pripravi osnutek brez interne GK in brez odpiranja obdobij.
 * Pri ERP najemniku ostane obstoječa kontrola obdobja nespremenjena.
 */
export async function resolvePosBookingPeriod(companyId: string, from: string, to = from) {
  const modules = await db.select({ module: companyModulesTable.module, enabledAt: companyModulesTable.enabledAt })
    .from(companyModulesTable)
    .where(eq(companyModulesTable.companyId, companyId));
  // Legacy podjetje brez deklariranih modulov ohrani dosedanjo ERP kontrolo.
  const pos = modules.find(row => row.module === "pos");
  const erp = modules.find(row => row.module === "erp");
  // Poznejši vklop GK ni dovoljenje za uvoz prejšnjega POS prometa.
  const erpStart = erp?.enabledAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
  const laterErp = pos && erp && pos.enabledAt.getTime() < erp.enabledAt.getTime();
  if (pos && (!erp || (laterErp && erpStart && from < erpStart))) {
    return { id: null };
  }
  // Vklop ERP sredi istega poslovnega dne prav tako ne premakne obstoječega
  // POS osnutka v GK ob naslednjem računu ali ročnem ponovnem syncu.
  if (pos) {
    const [archived] = await db.select({ id: posBookingDraftsTable.id }).from(posBookingDraftsTable)
      .where(and(eq(posBookingDraftsTable.companyId, companyId),
        gte(posBookingDraftsTable.entryDate, from), lte(posBookingDraftsTable.entryDate, to)))
      .limit(1);
    if (archived) return { id: null };
  }
  const [period] = await db.select({ id: accountingPeriodsTable.id })
    .from(accountingPeriodsTable)
    .where(and(
      eq(accountingPeriodsTable.companyId, companyId),
      lte(accountingPeriodsTable.startDate, from),
      gte(accountingPeriodsTable.endDate, to),
      notInArray(accountingPeriodsTable.status, ["locked"]),
    ))
    .limit(1);
  return period ?? null;
}
