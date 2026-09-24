import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: mockCreate } },
}));
vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: any, _res: unknown, next: () => void) => {
    req.enotaId = Number(req.header("x-test-enota"));
    req.vloga = req.header("x-test-role") ?? "admin_enote";
    next();
  },
}));

import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  kategorijeTable,
  nastavitveTable,
  normativiTable,
  pool,
} from "@workspace/db";
import { clearInitialRecipeResearchCache } from "../../lib/initial-smart-normative";
import router, { setNormativRevisionLockTestHook } from "./artikli";

const run = `initial-norm-${Math.random().toString(36).slice(2)}`;
const secretBefore = process.env.POS_NORMATIVE_PROPOSAL_SECRET;
const anthropicBaseBefore = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const anthropicKeyBefore = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
let companyId = "";
let foreignCompanyId = "";
let enotaA = 0;
let enotaB = 0;
let foreignParentId = 0;
let categoryId = 0;
let parentId = 0;
let parentForMatchId = 0;
let staleParentId = 0;
let otherFoodParentId = 0;
let currentIngredient = "Rdeca paprika";
let currentQuantity = 200;
const urlA = "https://allrecipes.com/initial-recipe-a";
const urlB = "https://bbcgoodfood.com/initial-recipe-b";
const app = express();
app.use(express.json());
app.use(router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});
const headers = (unit = enotaA) => ({
  "x-enota-id": String(unit),
  "x-test-enota": String(unit),
  "x-test-role": "admin_enote",
});
const preview = (id = parentId, unit = enotaA) =>
  supertest(app).post(`/artikli/${id}/normativi/pametni-predlog`).set(headers(unit)).send({});
const apply = (id: number, token: string, unit = enotaA) =>
  supertest(app).post(`/artikli/${id}/normativi/pametni-predlog/uporabi`).set(headers(unit)).send({
    token,
    confirmed: true,
    classifications: [{ index: 0, taxCategory: "other", addedSugar: false, rawConfirmed: true }],
  });
const applyWithClassifications = (id: number, token: string, classifications: Array<{
  index: number;
  taxCategory: "food" | "hot_beverage" | "cold_beverage" | "alcoholic" | "other" | "vat_super_reduced_5";
  addedSugar: boolean;
  rawConfirmed: true;
}>, unit = enotaA) =>
  supertest(app).post(`/artikli/${id}/normativi/pametni-predlog/uporabi`).set(headers(unit)).send({
    token,
    confirmed: true,
    classifications,
  });

function makeSearchResponse(withTypedSources = true) {
  const results = withTypedSources ? [
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Recipe A" }] },
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlB, title: "Recipe B" }] },
  ] : [];
  return {
    content: [
      ...results,
      { type: "text", text: JSON.stringify({ recipes: [
        { sourceUrl: urlA, servings: 2, ingredients: [{ name: currentIngredient, quantity: currentQuantity, unit: "g" }] },
        { sourceUrl: urlB, servings: 4, ingredients: [{ name: currentIngredient.toLocaleLowerCase("sl"), quantity: currentQuantity * 2, unit: "g" }] },
      ] }) },
    ],
  };
}

async function configuredGeneralVatRate(): Promise<string> {
  const rows = await db.select({
    kljuc: nastavitveTable.kljuc,
    vrednost: nastavitveTable.vrednost,
  }).from(nastavitveTable).where(eq(nastavitveTable.enotaId, 0));
  return Number(rows.find(row => row.kljuc === "ddvSplosnaSt")?.vrednost ?? "22").toFixed(2);
}

describe("initial smart normative proposal and apply", () => {
  beforeAll(async () => {
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = `${run}-secret`;
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.test";
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-only";
    mockCreate.mockImplementation(async () => makeSearchResponse());
    const [company] = await db.insert(companiesTable).values({ podjetjeDavcna: run, naziv: run }).returning({ id: companiesTable.id });
    companyId = company!.id;
    const [foreignCompany] = await db.insert(companiesTable).values({
      podjetjeDavcna: `${run}-foreign`,
      naziv: `${run}-foreign`,
    }).returning({ id: companiesTable.id });
    foreignCompanyId = foreignCompany!.id;
    const units = await db.insert(enoteTable).values([
      { companyId, ime: `${run}-a` },
      { companyId, ime: `${run}-b` },
    ]).returning({ id: enoteTable.id });
    enotaA = units[0]!.id;
    enotaB = units[1]!.id;
    const [category] = await db.insert(kategorijeTable).values({
      enotaId: enotaA,
      ime: `${run}-food`,
      tip: "hrana",
    }).returning({ id: kategorijeTable.id });
    categoryId = category!.id;
    const [otherCategory] = await db.insert(kategorijeTable).values({
      enotaId: enotaB,
      ime: `${run}-other-food`,
      tip: "hrana",
    }).returning({ id: kategorijeTable.id });
    const [foreignUnit] = await db.insert(enoteTable).values({
      companyId: foreignCompanyId,
      ime: `${run}-foreign-unit`,
    }).returning({ id: enoteTable.id });
    const [foreignCategory] = await db.insert(kategorijeTable).values({
      enotaId: foreignUnit!.id,
      ime: `${run}-foreign-food`,
      tip: "hrana",
    }).returning({ id: kategorijeTable.id });
    const articles = await db.insert(artikliTable).values([
      { enotaId: enotaA, ime: `${run}-parent`, cena: "10", davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true, mealType: "ala_carte" },
      { enotaId: enotaA, ime: `${run}-match-parent`, cena: "10", davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true, mealType: "prepared" },
      { enotaId: enotaA, ime: `${run}-stale-parent`, cena: "10", davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true, mealType: "ala_carte" },
      { enotaId: enotaB, ime: `${run}-other-unit-parent`, cena: "10", davek: "9.5", kategorijaId: otherCategory!.id, prodajniArtikel: true, mealType: "ala_carte" },
    ]).returning({ id: artikliTable.id });
    parentId = articles[0]!.id;
    parentForMatchId = articles[1]!.id;
    staleParentId = articles[2]!.id;
    otherFoodParentId = articles[3]!.id;
    const [foreignParent] = await db.insert(artikliTable).values({
      enotaId: foreignUnit!.id,
      ime: `${run}-foreign-parent`,
      cena: "10",
      davek: "9.5",
      kategorijaId: foreignCategory!.id,
      prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    foreignParentId = foreignParent!.id;
  });

  afterAll(async () => {
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    if (foreignCompanyId) await db.delete(companiesTable).where(eq(companiesTable.id, foreignCompanyId));
    if (secretBefore === undefined) delete process.env.POS_NORMATIVE_PROPOSAL_SECRET;
    else process.env.POS_NORMATIVE_PROPOSAL_SECRET = secretBefore;
    if (anthropicBaseBefore === undefined) delete process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
    else process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = anthropicBaseBefore;
    if (anthropicKeyBefore === undefined) delete process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    else process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = anthropicKeyBefore;
    clearInitialRecipeResearchCache();
    await pool.end();
  });
  beforeEach(() => {
    clearInitialRecipeResearchCache();
    currentQuantity = 200;
  });

  it("previews without DB writes and atomically creates raw purchase ingredients and norms on confirmation", async () => {
    currentIngredient = "Water";
    const before = await db.select({ id: artikliTable.id }).from(artikliTable).where(eq(artikliTable.enotaId, enotaA));
    const response = await supertest(app)
      .post(`/artikli/${parentId}/normativi/pametni-predlog`)
      .set(headers());
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      articleId: parentId,
      revision: 1,
      items: [{ name: currentIngredient, quantity: 0.1, unit: "KGM", existingArticleId: null, willCreate: true }],
    });
    expect(response.body.sources).toHaveLength(2);
    expect(response.body.warnings).toEqual([expect.stringContaining("vsebinsko niso preverjeni")]);
    expect(await db.select({ id: artikliTable.id }).from(artikliTable).where(eq(artikliTable.enotaId, enotaA))).toHaveLength(before.length);

    const missingClassification = await applyWithClassifications(parentId, response.body.token, []);
    expect(missingClassification.status).toBe(400);
    expect(await db.select({ id: artikliTable.id }).from(artikliTable).where(eq(artikliTable.enotaId, enotaA))).toHaveLength(before.length);
    expect(await db.select({ id: normativiTable.id }).from(normativiTable).where(eq(normativiTable.artikelId, parentId))).toHaveLength(0);

    const applied = await apply(parentId, response.body.token);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.normativRevision).toBe(2);
    expect(applied.body.createdArticleIds).toHaveLength(1);
    const [ingredient] = await db.select().from(artikliTable).where(eq(artikliTable.id, applied.body.createdArticleIds[0]));
    expect(ingredient).toMatchObject({
      enotaId: enotaA,
      ime: currentIngredient,
      imeZaNabavo: currentIngredient,
      nabavniArtikel: true,
      prodajniArtikel: false,
      vrstaArtikla: "material",
      mealType: "ala_carte",
      enotaMere: "KGM",
      taxCategory: "other",
      addedSugar: false,
      cena: "0.00",
      davek: await configuredGeneralVatRate(),
    });
    const norms = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, parentId));
    expect(norms).toHaveLength(1);
    expect(norms[0]!.kolicina).toBe("0.1000");

    currentIngredient = "Wine";
    const [alcoholParent] = await db.insert(artikliTable).values({
      enotaId: enotaA,
      ime: `${run}-alcohol-parent`,
      cena: "10",
      davek: "9.5",
      kategorijaId: categoryId,
      prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const alcoholPreview = await preview(alcoholParent!.id);
    expect(alcoholPreview.status).toBe(200);
    const alcoholApply = await applyWithClassifications(alcoholParent!.id, alcoholPreview.body.token, [{
      index: 0,
      taxCategory: "alcoholic",
      addedSugar: false,
      rawConfirmed: true,
    }]);
    expect(alcoholApply.status).toBe(200);
    const [alcohol] = await db.select().from(artikliTable).where(eq(artikliTable.id, alcoholApply.body.createdArticleIds[0]));
    expect(alcohol).toMatchObject({ taxCategory: "alcoholic", davek: await configuredGeneralVatRate() });
  });

  it("matches a raw purchase article by normalized purchase name and converts to its stored unit", async () => {
    currentIngredient = `${run}-known`;
    const [existing] = await db.insert(artikliTable).values({
      enotaId: enotaA,
      ime: `${run}-supplier-name`,
      imeZaNabavo: currentIngredient.toLocaleLowerCase("sl"),
      cena: "2",
      davek: "9.5",
      enotaMere: "GRM",
      nabavniArtikel: true,
      prodajniArtikel: false,
      vrstaArtikla: "material",
    }).returning({ id: artikliTable.id });
    const response = await preview(parentForMatchId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.items[0]).toMatchObject({ existingArticleId: existing!.id, willCreate: false, unit: "KGM", quantity: 0.1 });
    const applied = await applyWithClassifications(parentForMatchId, response.body.token, []);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.createdArticleIds).toEqual([]);
    const norms = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, parentForMatchId));
    expect(norms[0]!.vhodniArtikelId).toBe(existing!.id);
    expect(norms[0]!.kolicina).toBe("100.0000");
  });

  it("rejects missing/mismatched unit, non-admin, cross-unit articles, source spoofing, and stale apply", async () => {
    currentIngredient = `${run}-stale`;
    const noHeader = await supertest(app).post(`/artikli/${otherFoodParentId}/normativi/pametni-predlog`)
      .set("x-test-enota", String(enotaA)).set("x-test-role", "admin_enote").send({});
    expect(noHeader.status).toBe(400);

    const wrongRole = await supertest(app).post(`/artikli/${otherFoodParentId}/normativi/pametni-predlog`)
      .set({ ...headers(), "x-test-role": "natakar" }).send({});
    expect(wrongRole.status).toBe(403);

    const crossUnit = await preview(otherFoodParentId, enotaA);
    expect(crossUnit.status).toBe(404);
    expect((await preview(foreignParentId, enotaA)).status).toBe(404);

    mockCreate.mockImplementationOnce(async () => makeSearchResponse(false));
    const spoofed = await preview(otherFoodParentId, enotaB);
    expect(spoofed.status).toBe(422);

    const stalePreview = await preview(staleParentId, enotaA);
    expect(stalePreview.status).toBe(200);
    setNormativRevisionLockTestHook(async context => {
      if (context.artikelId === staleParentId) {
        await db.update(artikliTable).set({ normativRevision: 2 }).where(eq(artikliTable.id, staleParentId));
      }
    });
    let staleApply;
    try {
      staleApply = await apply(staleParentId, stalePreview.body.token, enotaA);
    } finally {
      setNormativRevisionLockTestHook();
    }
    expect(staleApply.status).toBe(409);
    expect(await db.select({ id: normativiTable.id }).from(normativiTable).where(eq(normativiTable.artikelId, staleParentId))).toHaveLength(0);

    currentIngredient = `${run}-renamed-target-ingredient`;
    const renamePreview = await preview(otherFoodParentId, enotaB);
    expect(renamePreview.status).toBe(200);
    const existingBeforeRenameApply = await db.select({ id: artikliTable.id }).from(artikliTable).where(eq(artikliTable.enotaId, enotaB));
    await db.update(artikliTable).set({ ime: `${run}-renamed-after-preview` }).where(eq(artikliTable.id, otherFoodParentId));
    const renamedApply = await apply(otherFoodParentId, renamePreview.body.token, enotaB);
    expect(renamedApply.status).toBe(409);
    expect(await db.select({ id: artikliTable.id }).from(artikliTable).where(eq(artikliTable.enotaId, enotaB))).toHaveLength(existingBeforeRenameApply.length);
    expect(await db.select({ id: normativiTable.id }).from(normativiTable).where(eq(normativiTable.artikelId, otherFoodParentId))).toHaveLength(0);
  });

  it("rejects non-food targets and never creates a duplicate on ambiguous names", async () => {
    const [nonFood] = await db.insert(kategorijeTable).values({
      enotaId: enotaA,
      ime: `${run}-not-food`,
      tip: "pijaca",
    }).returning({ id: kategorijeTable.id });
    const [nonFoodArticle] = await db.insert(artikliTable).values({
      enotaId: enotaA,
      ime: `${run}-drink`,
      cena: "1",
      davek: "22",
      kategorijaId: nonFood!.id,
      prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    expect((await preview(nonFoodArticle!.id)).status).toBe(422);

    currentIngredient = `${run}-duplicate`;
    const duplicate = await db.insert(artikliTable).values([
      { enotaId: enotaA, ime: currentIngredient, cena: "1", davek: "9.5", enotaMere: "KGM", nabavniArtikel: true, prodajniArtikel: false },
      { enotaId: enotaA, ime: currentIngredient, cena: "1", davek: "9.5", enotaMere: "KGM", nabavniArtikel: true, prodajniArtikel: false },
    ]).returning({ id: artikliTable.id });
    const duplicateParent = (await db.insert(artikliTable).values({
      enotaId: enotaA,
      ime: `${run}-duplicate-parent`,
      cena: "1",
      davek: "9.5",
      kategorijaId: categoryId,
      prodajniArtikel: true,
    }).returning({ id: artikliTable.id }))[0]!;
    const response = await preview(duplicateParent.id);
    expect(response.status).toBe(422);
    expect(await db.select({ id: artikliTable.id }).from(artikliTable).where(and(
      eq(artikliTable.enotaId, enotaA),
      eq(artikliTable.ime, currentIngredient),
    ))).toHaveLength(duplicate.length);

    currentIngredient = `${run}-too-small`;
    currentQuantity = 0.001;
    const [tinyParent] = await db.insert(artikliTable).values({
      enotaId: enotaA,
      ime: `${run}-tiny-parent`,
      cena: "1",
      davek: "9.5",
      kategorijaId: categoryId,
      prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const tinyResponse = await preview(tinyParent!.id);
    expect(tinyResponse.status).toBe(422);
    expect(tinyResponse.body.error).toContain("štiri decimalna mesta");
  });
});