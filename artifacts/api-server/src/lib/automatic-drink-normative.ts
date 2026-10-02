import { and, eq } from "drizzle-orm";
import { artikliTable, db } from "@workspace/db";
import { drinkNameKey, drinkNormativeQuantity, parseDrinkVolumeName } from "./drink-volume";
import { normalizeSlovenianArticleName } from "./slovenian-article-name";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class AutomaticDrinkNormativeError extends Error {
  constructor(message: string) { super(message); }
}

/** The caller holds the unit business-day and normative-graph locks. Creating
 * the source and sale recipe in one transaction prevents orphaned sources and
 * duplicate one-liter articles on simultaneous saves. */
export async function resolveAutomaticDrinkNormative(
  tx: Transaction,
  sale: typeof artikliTable.$inferSelect,
  volume: { baseName: string; liters: number },
) {
  const allPurchases = await tx.select({
    id: artikliTable.id, ime: artikliTable.ime, enotaMere: artikliTable.enotaMere,
    aktiven: artikliTable.aktiven,
  }).from(artikliTable).where(and(
    eq(artikliTable.enotaId, sale.enotaId),
    eq(artikliTable.nabavniArtikel, true),
    eq(artikliTable.povratnaEmbalaza, false),
    eq(artikliTable.drobniInventar, false),
  ));
  const key = drinkNameKey(volume.baseName);
  const matches = allPurchases.filter(article => drinkNameKey(parseDrinkVolumeName(article.ime).baseName) === key);
  if (matches.length > 1) {
    throw new AutomaticDrinkNormativeError(
      `Za »${volume.baseName}« obstaja več nabavnih artiklov: ${matches.map(article => article.ime).join(", ")}. Izberite pravi vhodni artikel v zavihku Normativ.`,
    );
  }
  let source = matches[0];
  if (source && !source.aktiven) {
    throw new AutomaticDrinkNormativeError(`Nabavni artikel »${source.ime}« ni aktiven. Najprej ga aktivirajte ali ročno določite normativ.`);
  }
  if (!source) {
    const [created] = await tx.insert(artikliTable).values({
      enotaId: sale.enotaId,
      ime: normalizeSlovenianArticleName(`${volume.baseName} 1 liter`),
      cena: "0",
      davek: sale.davek,
      taxCategory: sale.taxCategory,
      addedSugar: sale.addedSugar,
      jeAlkohol: sale.taxCategory === "alcoholic",
      nabavniArtikel: true, prodajniArtikel: false,
      enotaMere: "LTR", mealType: "ala_carte", vrstaArtikla: "material",
      aktiven: true,
    }).returning();
    source = created;
  }
  const quantity = drinkNormativeQuantity(volume.liters, source);
  if (quantity == null) {
    throw new AutomaticDrinkNormativeError(`Enote nabavnega artikla »${source.ime}« (${source.enotaMere ?? "kos"}) ni mogoče pretvoriti v porabo pijače. Ročno določite normativ.`);
  }
  return [{ vhodniArtikelId: source.id, kolicina: quantity }];
}