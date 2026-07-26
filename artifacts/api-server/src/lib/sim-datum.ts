import { and, eq } from "drizzle-orm";
import { db, nastavitveTable } from "@workspace/db";

export const SIM_DATUM_KEY = "sim_datum";

/** Returns the simulation date string (YYYY-MM-DD) or null if not active. */
export async function getSimDatumString(enotaId: number): Promise<string | null> {
  const [row] = await db
    .select({ vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, enotaId), eq(nastavitveTable.kljuc, SIM_DATUM_KEY)));
  return row?.vrednost ?? null;
}

/**
 * Returns a Date for the current sim date with current wall-clock time injected,
 * or new Date() when sim mode is not active.
 */
export async function getSimDatumOrNow(enotaId: number): Promise<Date> {
  const datum = await getSimDatumString(enotaId);
  if (!datum) return new Date();
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  const d = new Date(`${datum}T${hh}:${mm}:${ss}.${ms}`);
  return isNaN(d.getTime()) ? new Date() : d;
}
