import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql, sum } from "drizzle-orm";
import {
  artikliTable,
  counterpartiesTable,
  db,
  embalazniPrometiTable,
  enoteTable,
  kategorijeTable,
  normativiTable,
  pizzaDoughSettingsTable,
  zalogeTable,
} from "@workspace/db";
import {
  buildArticleCatalogPdf,
  selectArticleCatalogScope,
  type ArticleCatalogScope,
  type ArticleCatalogRow,
} from "../../lib/pos-article-catalog-pdf";
import Decimal from "decimal.js";

const router: IRouter = Router();
const VALID_SCOPES = new Set<ArticleCatalogScope>([
  "nabavni",
  "prodajni",
  "polizdelki",
  "drobni",
  "embalaza",
]);

router.get("/artikli/izvozi-katalog.pdf", async (req, res): Promise<void> => {
  const scope = req.query.scope;
  if (typeof scope !== "string" || !VALID_SCOPES.has(scope as ArticleCatalogScope)) {
    res.status(400).json({ error: "Parameter scope mora biti nabavni, prodajni, polizdelki, drobni ali embalaza." });
    return;
  }
  const catalogScope = scope as ArticleCatalogScope;
  const enotaId = (req as any).enotaId as number;

  try {
    const [unit] = await db.select({ name: enoteTable.ime })
      .from(enoteTable)
      .where(eq(enoteTable.id, enotaId))
      .limit(1);
    if (!unit) {
      res.status(404).json({ error: "Poslovna enota ni najdena." });
      return;
    }

    const allRows = await db.select({
      id: artikliTable.id,
      name: artikliTable.ime,
      active: artikliTable.aktiven,
      category: kategorijeTable.ime,
      unit: artikliTable.enotaMere,
      articleType: artikliTable.vrstaArtikla,
      purchaseName: artikliTable.imeZaNabavo,
      purchaseOnly: artikliTable.nabavniArtikel,
      salesOnly: artikliTable.prodajniArtikel,
      groupPurchase: artikliTable.jeSkupinskiNabavniArtikel,
      smallEquipment: artikliTable.drobniInventar,
      returnablePackaging: artikliTable.povratnaEmbalaza,
      packagingType: artikliTable.vrstaEmbalaze,
      depositValue: artikliTable.depozitnaVrednost,
      price: artikliTable.cena,
      taxRate: artikliTable.davek,
      grossWeightG: artikliTable.brutoTezaG,
      netWeightG: artikliTable.netoTezaG,
      netSharePercent: artikliTable.netoDelezOdst,
      stockQuantity: zalogeTable.kolicina,
      preparationType: artikliTable.pripravaVrsta,
      preparationMinutes: artikliTable.casPripraveMin,
      isPizza: artikliTable.jePica,
    })
      .from(artikliTable)
      .leftJoin(kategorijeTable, and(
        eq(kategorijeTable.id, artikliTable.kategorijaId),
        eq(kategorijeTable.enotaId, enotaId),
      ))
      .leftJoin(zalogeTable, eq(zalogeTable.artikelId, artikliTable.id))
      .where(eq(artikliTable.enotaId, enotaId))
      .orderBy(asc(artikliTable.id));

    const articles: ArticleCatalogRow[] = allRows.map(row => ({
      ...row,
      depositValue: row.depositValue == null ? null : Number(row.depositValue),
      price: row.price == null ? null : Number(row.price),
      taxRate: row.taxRate == null ? null : Number(row.taxRate),
      grossWeightG: row.grossWeightG == null ? null : Number(row.grossWeightG),
      netWeightG: row.netWeightG == null ? null : Number(row.netWeightG),
      netSharePercent: row.netSharePercent == null ? null : Number(row.netSharePercent),
      stockQuantity: row.stockQuantity == null ? null : Number(row.stockQuantity),
      preparationMinutes: row.preparationMinutes == null ? null : Number(row.preparationMinutes),
      preparationNotes: [],
      supplierBalances: [],
      ingredients: [],
    }));
    const selectedArticles = selectArticleCatalogScope(articles, catalogScope);

    if (catalogScope === "nabavni" || catalogScope === "prodajni" || catalogScope === "polizdelki") {
      if (selectedArticles.some(article => article.isPizza)) {
        const [doughSettings] = await db.select({
          normalId: pizzaDoughSettingsTable.normalDoughArticleId,
          smallId: pizzaDoughSettingsTable.smallDoughArticleId,
        }).from(pizzaDoughSettingsTable).where(eq(pizzaDoughSettingsTable.enotaId, enotaId)).limit(1);
        if (doughSettings) {
          const doughRows = await db.select({
            id: artikliTable.id,
            name: artikliTable.ime,
            unit: artikliTable.enotaMere,
          }).from(artikliTable).where(and(
            eq(artikliTable.enotaId, enotaId),
            inArray(artikliTable.id, [doughSettings.normalId, doughSettings.smallId]),
          ));
          const doughById = new Map(doughRows.map(dough => [dough.id, dough]));
          const normalDough = doughById.get(doughSettings.normalId);
          const smallDough = doughById.get(doughSettings.smallId);
          if (!normalDough || !smallDough) {
            throw new Error("Nastavljeni hlebčki za pico niso dostopni v trenutni poslovni enoti.");
          }
          for (const article of selectedArticles) {
            if (article.isPizza) {
              article.preparationNotes!.push(
                `Hlebček za pico: normalna ${normalDough.name} (1 ${normalDough.unit || "kos"}); mala ${smallDough.name} (1 ${smallDough.unit || "kos"}).`,
              );
            }
          }
        }
      }
      const articleIds = selectedArticles.map(article => article.id);
      if (articleIds.length > 0) {
        const normRows = await db.select({
          articleId: normativiTable.artikelId,
          ingredientId: normativiTable.vhodniArtikelId,
          quantity: normativiTable.kolicina,
        })
          .from(normativiTable)
          .where(inArray(normativiTable.artikelId, articleIds))
          .orderBy(asc(normativiTable.artikelId), asc(normativiTable.vrstniRed), asc(normativiTable.id));
        const ingredientIds = [...new Set(normRows.map(row => row.ingredientId))];
        const ingredientRows = ingredientIds.length === 0
          ? []
          : await db.select({
              id: artikliTable.id,
              name: artikliTable.ime,
              unit: artikliTable.enotaMere,
            })
              .from(artikliTable)
              .where(and(
                eq(artikliTable.enotaId, enotaId),
                inArray(artikliTable.id, ingredientIds),
              ));
        if (ingredientRows.length !== ingredientIds.length) {
          throw new Error("Normativ vsebuje sestavino, ki ni dostopna v trenutni poslovni enoti.");
        }
        const ingredientById = new Map(ingredientRows.map(row => [row.id, row]));
        const articleById = new Map(selectedArticles.map(article => [article.id, article]));
        for (const row of normRows) {
          const ingredient = ingredientById.get(row.ingredientId);
          const article = articleById.get(row.articleId);
          if (!ingredient || !article) {
            throw new Error("Normativ vsebuje neveljavno povezavo artikla.");
          }
          article.ingredients!.push({
            name: ingredient.name,
            quantity: Number(row.quantity),
            unit: ingredient.unit,
          });
        }
      }
    }
    if (catalogScope === "embalaza" && selectedArticles.length > 0) {
      // Keep saldo semantics aligned with GET /embalaza/bilance: sum the
      // movement ledger by article and supplier, within the active unit only.
      const balanceRows = await db.select({
        articleId: embalazniPrometiTable.artikelId,
        supplierId: embalazniPrometiTable.dobaviteljId,
        supplierName: sql<string | null>`COALESCE(${counterpartiesTable.kratkiNaziv}, ${counterpartiesTable.name})`,
        quantity: sum(embalazniPrometiTable.kolicina),
      }).from(embalazniPrometiTable)
        .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, embalazniPrometiTable.dobaviteljId))
        .where(and(
          eq(embalazniPrometiTable.enotaId, enotaId),
          inArray(embalazniPrometiTable.artikelId, selectedArticles.map(article => article.id)),
        ))
        .groupBy(
          embalazniPrometiTable.artikelId,
          embalazniPrometiTable.dobaviteljId,
          counterpartiesTable.kratkiNaziv,
          counterpartiesTable.name,
        )
        .orderBy(asc(embalazniPrometiTable.artikelId), asc(counterpartiesTable.name));
      const articleById = new Map(selectedArticles.map(article => [article.id, article]));
      const totals = new Map<number, Decimal>();
      for (const row of balanceRows) {
        const article = articleById.get(row.articleId);
        if (!article) {
          throw new Error("Dobaviteljski promet vsebuje artikel izven kataloga trenutne enote.");
        }
        article.supplierBalances!.push({
          supplierName: row.supplierName || "Dobavitelj ni določen",
          quantity: Number(row.quantity ?? 0),
        });
        totals.set(
          row.articleId,
          (totals.get(row.articleId) ?? new Decimal(0)).plus(row.quantity ?? 0),
        );
      }
      for (const article of selectedArticles) {
        article.supplierBalanceTotal = totals.get(article.id)?.toNumber() ?? null;
      }
    }

    const pdf = await buildArticleCatalogPdf({
      scope: catalogScope,
      unitName: unit.name,
      generatedAt: new Date(),
      articles: selectedArticles,
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="katalog-${catalogScope}.pdf"`);
    res.send(pdf);
  } catch {
    req.log?.error({ scope: catalogScope }, "POS katalog PDF ni bil ustvarjen");
    res.status(500).json({ error: "Izvoz kataloga ni uspel. Preverite podatke artiklov in normativov." });
  }
});

export default router;