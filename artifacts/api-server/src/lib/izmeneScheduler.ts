/**
 * Samodejno zapiranje izmene ob koncu delovnega dne.
 *
 * Vsako minuto (in ob zagonu) zapre izmene, katerih poslovni dan je že končan.
 */

import { and, count, eq, isNull, sum } from "drizzle-orm";
import { db, enoteTable, izmeneTable, racuniTable } from "@workspace/db";
import { logger } from "./logger";
import { businessDateForInstant, getBusinessDayBounds } from "./pos-business-day";

/** Zapre eno odprto izmeno in nastavi skupni znesek + število računov. */
async function zapriIzmeno(id: number, enotaId: number, konec: Date): Promise<void> {
  const [agg] = await db
    .select({ skupaj: sum(racuniTable.skupaj), stevilo: count(racuniTable.id) })
    .from(racuniTable)
    .where(eq(racuniTable.izmenaId, id));
  await db
    .update(izmeneTable)
    .set({
      konec,
      skupajZnesek: Number(agg?.skupaj ?? 0).toFixed(2),
      steviloRacunov: Number(agg?.stevilo ?? 0),
    })
    .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId), isNull(izmeneTable.konec)));
}

/**
 * Zapre vse odprte izmene, katerih poslovni dan se je že končal. Izmeno zapre z
 * dejanskim koncem poslovnega dne (npr. 04:00), tudi če strežnik ob tej uri ni deloval:
 * pri naslednjem preverjanju (ali zagonu) nadoknadi zamujeno zapiranje.
 */
async function preveri(): Promise<void> {
  try {
    const odprte = await db
      .select({ id: izmeneTable.id, enotaId: izmeneTable.enotaId, zacetek: izmeneTable.zacetek, ura: enoteTable.zacetekDnevaUra })
      .from(izmeneTable)
      .innerJoin(enoteTable, eq(enoteTable.id, izmeneTable.enotaId))
      .where(isNull(izmeneTable.konec));
    const zdaj = new Date();
    const meje = new Map<string, Date>();
    for (const izmena of odprte) {
      try {
        const poslovniDan = businessDateForInstant(izmena.zacetek, izmena.ura ?? undefined);
        const kljuc = `${izmena.enotaId}:${poslovniDan}`;
        let konecDneva = meje.get(kljuc);
        if (!konecDneva) {
          konecDneva = (await getBusinessDayBounds(izmena.enotaId, poslovniDan)).end;
          meje.set(kljuc, konecDneva);
        }
        if (zdaj < konecDneva) continue;
        await zapriIzmeno(izmena.id, izmena.enotaId, konecDneva);
        logger.info(
          { izmenaId: izmena.id, enotaId: izmena.enotaId, konec: konecDneva.toISOString() },
          "Samodejno zapiranje izmene: konec delovnega dne",
        );
      } catch (err) {
        logger.error({ err, izmenaId: izmena.id, enotaId: izmena.enotaId }, "Samodejno zapiranje izmene: napaka pri posamezni izmeni");
      }
    }
  } catch (err) {
    logger.error({ err }, "Samodejno zapiranje izmene: napaka pri preverjanju");
  }
}

/** Zaženi urnik. Kliči enkrat ob zagonu strežnika. */
export function zaženiZapiranjeIzmene(): void {
  logger.info("Samodejno zapiranje izmene: urnik nastavljen (preverjanje vsako minuto)");

  // Poravnaj na začetek naslednje minute, nato ponavljaj vsako minuto
  const zdaj = new Date();
  const msDoNaslednjeMInute = (60 - zdaj.getSeconds()) * 1000 - zdaj.getMilliseconds() + 500;

  void preveri(); // nadoknadi zamujeno zapiranje po zagonu
  setTimeout(() => {
    void preveri();
    setInterval(() => { void preveri(); }, 60_000);
  }, msDoNaslednjeMInute);
}
