import { and, eq } from "drizzle-orm";
import { db, nastavitveTable } from "@workspace/db";

export const OFFLINE_FISCAL_ENABLED_KEY = "offlineFiscalEnabled";

export async function isOfflineFiscalEnabled(enotaId: number): Promise<boolean> {
  const [setting] = await db.select({ value: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(
      eq(nastavitveTable.enotaId, enotaId),
      eq(nastavitveTable.kljuc, OFFLINE_FISCAL_ENABLED_KEY),
    ))
    .limit(1);
  return setting?.value === "true";
}