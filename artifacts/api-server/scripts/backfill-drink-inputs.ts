import { and, asc, eq, inArray } from "drizzle-orm";
import { artikliTable, db, enoteTable, normativiTable, pool } from "@workspace/db";
import { resolveAutomaticDrinkPurchase } from "../src/lib/automatic-drink-normative";
import { drinkNameKey, drinkNormativeQuantity, parseDrinkVolumeName } from "../src/lib/drink-volume";
import { lockPosBusinessDay } from "../src/lib/pos-z-helpers";
import { applyPreparedNormativUpdate, lockNormativeGraph, prepareNormativUpdate } from "../src/routes/pos/artikli";

// Explicit unit ID + exact name are both required. Default is a read-only preview.
const arg = (name: string) => process.argv[process.argv.indexOf(name) + 1];
const unitId = Number(arg("--unit-id"));
const expectedName = process.argv.includes("--expected-unit-name") ? arg("--expected-unit-name") : "";
const apply = process.argv.includes("--apply");

async function main() {
  if (!Number.isSafeInteger(unitId) || unitId <= 0 || !expectedName) {
    throw new Error("Provide --unit-id and --expected-unit-name; add --apply only after reviewing the preview.");
  }
  const [unit] = await db.select().from(enoteTable).where(eq(enoteTable.id, unitId));
  if (!unit || unit.ime !== expectedName) throw new Error("Target unit does not match the expected name.");
  return db.transaction(async tx => {
    if (apply) {
      await lockPosBusinessDay(tx, unitId);
      await lockNormativeGraph(tx, unitId);
    }
    const articles = await tx.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId))
      .orderBy(asc(artikliTable.id));
    const originalPurchaseIds = new Set(articles.filter(a => a.nabavniArtikel).map(a => a.id));
    const purchases = articles.filter(a => a.nabavniArtikel && !a.povratnaEmbalaza && !a.drobniInventar);
    const articleIds = articles.map(a => a.id);
    const existing = articleIds.length
      ? await tx.select().from(normativiTable).where(inArray(normativiTable.artikelId, articleIds))
      : [];
    const hasNormative = new Set(existing.map(n => n.artikelId));
    const createdSources = new Map<number, string>();
    const plannedSources = new Set<string>();
    const rows: Array<{ id: number; name: string; source: string; quantity: number | null }> = [];
    const preserved: string[] = [];

    for (const article of articles) {
      if (!article.prodajniArtikel || article.nabavniArtikel || !article.aktiven
        || article.povratnaEmbalaza || article.drobniInventar || article.jePica
        || !["alcoholic", "cold_beverage"].includes(article.taxCategory)) continue;
      if (hasNormative.has(article.id)) { preserved.push(article.ime); continue; }
      const volume = parseDrinkVolumeName(article.ime);
      if (!volume.baseName) throw new Error(`No drink identity: ${article.ime}`);
      // Cedevita is a sachet mixed with water, not a purchased liquid.
      const sachet = drinkNameKey(article.ime) === "cedevita";
      const inputName = sachet ? `${article.ime} vrečka` : volume.baseName;
      const matches = purchases.filter(a => drinkNameKey(parseDrinkVolumeName(a.ime).baseName) === drinkNameKey(inputName));
      if (matches.length > 1 || (matches[0] && !matches[0].aktiven)) {
        throw new Error(`Ambiguous or inactive purchase input for ${article.ime}`);
      }
      if (volume.liters == null && !sachet) {
        rows.push({ id: article.id, name: article.ime, source: "", quantity: null });
        continue;
      }
      if (!matches.length) plannedSources.add(drinkNameKey(inputName));
      let source = matches[0] ?? {
        id: -1, ime: sachet ? inputName : `${volume.baseName} 1 liter`,
        enotaMere: sachet ? "H87" : "LTR",
      };
      if (apply) {
        if (sachet) {
          if (!matches.length) {
            const [created] = await tx.insert(artikliTable).values({
              enotaId: unitId, ime: inputName, enotaMere: "H87", cena: "0",
              davek: article.davek, taxCategory: article.taxCategory, addedSugar: article.addedSugar,
              nabavniArtikel: true, prodajniArtikel: false, mealType: "ala_carte",
              vrstaArtikla: "material", aktiven: true,
            }).returning();
            source = created;
          }
        } else {
          source = await resolveAutomaticDrinkPurchase(tx, article, volume);
        }
      }
      if (sachet && !/^(H87|kos|C62|PCE|PCS|EA)$/i.test(source.enotaMere ?? "")) {
        throw new Error("Cedevita purchase input must be stocked in pieces, not liters.");
      }
      if (apply && !originalPurchaseIds.has(source.id)) createdSources.set(source.id, source.ime);
      const quantity = sachet ? 1 : volume.liters == null ? null : drinkNormativeQuantity(volume.liters, source);
      if (volume.liters != null && quantity == null) throw new Error(`Unsupported stock unit: ${article.ime}`);
      if (apply && quantity != null) {
        const prepared = await prepareNormativUpdate(article.id, unitId, {
          expectedRevision: article.normativRevision,
          items: [{ vhodniArtikelId: source.id, kolicina: quantity }],
        }, article, tx);
        await applyPreparedNormativUpdate(tx, article.id, unitId, prepared);
      }
      rows.push({ id: article.id, name: article.ime, source: source.ime, quantity });
    }
    return {
      mode: apply ? "applied" : "preview", unitId, unitName: unit.ime,
      purchaseArticles: apply ? createdSources.size : plannedSources.size,
      normatives: rows.filter(row => row.quantity != null).length,
      missingServingVolume: rows.filter(row => row.quantity == null),
      preserved, rows,
    };
  });
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}