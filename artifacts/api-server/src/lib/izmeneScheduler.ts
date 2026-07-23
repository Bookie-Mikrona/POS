/**
 * Samodejno zapiranje izmene ob koncu delovnega dne.
 *
 * Vsako minuto preveri, ali je za katero enoto nastopila ura začetka dneva
 * (= konec prejšnjega delovnega dne). Če so za to enoto še odprte izmene,
 * jih zapre in izračuna skupni promet ter število računov.
 *
 * Zaščita pred dvojnim zapiranjem: hranjeno je kdaj (dan + ura) je bila
 * posamezna enota zadnjič obdelana, tako da se ista enota v isti uri ne
 * zapre dvakrat.
 */

import { and, count, eq, isNull, sum } from "drizzle-orm";
import { db, enoteTable, izmeneTable, racuniTable } from "@workspace/db";
import { logger } from "./logger";

/** Ključ: `enotaId:YYYY-MM-DD:HH:mm` — prepreči dvojno zapiranje v isti uri. */
const zaprtoPri = new Set<string>();

/** Vrne trenutni čas v Europe/Ljubljana kot `{ ura: "HH:mm", datum: "YYYY-MM-DD" }`. */
function ljubljanskiCas(): { ura: string; datum: string } {
  const zdaj = new Date();
  const fmt = new Intl.DateTimeFormat("sl-SI", {
    timeZone: "Europe/Ljubljana",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
  const deli = fmt.formatToParts(zdaj);
  const p = (tip: string) => deli.find((d) => d.type === tip)?.value ?? "00";
  const ura = `${p("hour").padStart(2, "0")}:${p("minute").padStart(2, "0")}`;
  const datum = `${p("year")}-${p("month").padStart(2, "0")}-${p("day").padStart(2, "0")}`;
  return { ura, datum };
}

/** Zapre vse odprte izmene za dano enoto in nastavi skupni znesek + število računov. */
async function zapriIzmeneEnote(enotaId: number): Promise<number> {
  // Poišči vse odprte izmene za to enoto
  const odprte = await db
    .select({ id: izmeneTable.id })
    .from(izmeneTable)
    .where(and(eq(izmeneTable.enotaId, enotaId), isNull(izmeneTable.konec)));

  if (odprte.length === 0) return 0;

  const konec = new Date();
  let zaprte = 0;

  await Promise.all(odprte.map(async ({ id }) => {
    try {
      // Izračunaj promet iz računov te izmene
      const [agg] = await db
        .select({
          skupaj: sum(racuniTable.skupaj),
          stevilo: count(racuniTable.id),
        })
        .from(racuniTable)
        .where(eq(racuniTable.izmenaId, id));

      const skupajZnesek = Number(agg?.skupaj ?? 0);
      const steviloRacunov = Number(agg?.stevilo ?? 0);

      await db
        .update(izmeneTable)
        .set({
          konec,
          skupajZnesek: skupajZnesek.toFixed(2),
          steviloRacunov,
        })
        .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId)));

      zaprte++;
    } catch (err) {
      logger.error({ err, izmenaId: id, enotaId }, "Samodejno zapiranje izmene: napaka pri posamezni izmeni");
    }
  }));

  return zaprte;
}

/** Enkratna preveritev — pokliče se vsako minuto. */
async function preveri(): Promise<void> {
  const { ura: trenutnaUra, datum } = ljubljanskiCas();

  try {
    // Poišči vse enote, katerih začetek dneva se ujema s trenutno uro
    const enote = await db
      .select({ id: enoteTable.id, ime: enoteTable.ime, zacetekDnevaUra: enoteTable.zacetekDnevaUra })
      .from(enoteTable)
      .where(eq(enoteTable.zacetekDnevaUra, trenutnaUra));

    for (const enota of enote) {
      const kljuc = `${enota.id}:${datum}:${trenutnaUra}`;
      if (zaprtoPri.has(kljuc)) continue; // Že obdelano v tej uri
      zaprtoPri.add(kljuc);

      const zaprte = await zapriIzmeneEnote(enota.id);
      if (zaprte > 0) {
        logger.info(
          { enotaId: enota.id, enotaIme: enota.ime, zaprteIzmene: zaprte, ob: trenutnaUra },
          "Samodejno zapiranje izmene: konec delovnega dne",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "Samodejno zapiranje izmene: napaka pri preverjanju");
  }

  // Počisti stare ključe (starejše od 2 dni) da Set ne raste v nedogled
  const dvaDniNazaj = new Date();
  dvaDniNazaj.setDate(dvaDniNazaj.getDate() - 2);
  const mejniDatum = dvaDniNazaj.toISOString().slice(0, 10);
  for (const k of zaprtoPri) {
    const kDatum = k.split(":")[1] ?? "";
    if (kDatum < mejniDatum) zaprtoPri.delete(k);
  }
}

/** Zaženi urnik. Kliči enkrat ob zagonu strežnika. */
export function zaženiZapiranjeIzmene(): void {
  logger.info("Samodejno zapiranje izmene: urnik nastavljen (preverjanje vsako minuto)");

  // Poravnaj na začetek naslednje minute, nato ponavljaj vsako minuto
  const zdaj = new Date();
  const msDoNaslednjeMInute = (60 - zdaj.getSeconds()) * 1000 - zdaj.getMilliseconds() + 500;

  setTimeout(() => {
    void preveri();
    setInterval(() => { void preveri(); }, 60_000);
  }, msDoNaslednjeMInute);
}
