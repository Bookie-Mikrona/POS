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
const beanSaladItems = [
  { name: "Fižol konzerviran, odcejen", quantity: 0.18, unit: "kg" },
  { name: "Čebula rdeča", quantity: 0.02, unit: "kg" },
  { name: "Olje sončnično", quantity: 0.01, unit: "l" },
  { name: "Kis vinski", quantity: 0.01, unit: "l" },
  { name: "Sladkor", quantity: 0.002, unit: "kg" },
  { name: "Sol", quantity: 0.002, unit: "kg" },
  { name: "Poper", quantity: 0.001, unit: "kg" },
  { name: "Peteršilj", quantity: 0.003, unit: "kg" },
  { name: "Česen", quantity: 0.003, unit: "kg" },
];
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

function makeCatalogResponse(name: string, withTypedSource = true) {
  const url = "https://example-shop.com/drinks/product";
  return { content: [
    ...(withTypedSource ? [{
      type: "web_search_tool_result",
      content: [{ type: "web_search_result", url, title: `${name} – alcoholic drink` }],
    }] : []),
    { type: "text", text: JSON.stringify({ sourceUrl: url, productName: name, isSingleIngredientDrink: true }) },
  ] };
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
    mockCreate.mockImplementation(async () => makeSearchResponse());
  });

  it("rejects portion-based research for kg/l prepared intermediates before contacting AI", async () => {
    for (const unit of ["KGM", "LTR"]) {
      const [bulk] = await db.insert(artikliTable).values({
        enotaId: enotaA, ime: `${run}-bulk-${unit}`, cena: "0", davek: "9.5",
        nabavniArtikel: false, prodajniArtikel: false, taxCategory: "food",
        mealType: "prepared", enotaMere: unit,
      }).returning({ id: artikliTable.id });
      mockCreate.mockClear();
      const response = await preview(bulk!.id);
      expect(response.status).toBe(422);
      expect(response.body.error).toContain("na porcijo");
      expect(mockCreate).not.toHaveBeenCalled();
    }
  });

  it("rejects an already issued portion proposal after the target becomes kg/l", async () => {
    const [portion] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: `${run}-bulk-stale`, cena: "0", davek: "9.5",
      nabavniArtikel: false, prodajniArtikel: false, taxCategory: "food",
      mealType: "prepared", enotaMere: "H87",
    }).returning({ id: artikliTable.id });
    const suggestion = await preview(portion!.id);
    expect(suggestion.status).toBe(200);
    await db.update(artikliTable).set({ enotaMere: "KGM" }).where(eq(artikliTable.id, portion!.id));
    const response = await apply(portion!.id, suggestion.body.token);
    expect(response.status).toBe(409);
    const stored = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, portion!.id));
    expect(stored).toHaveLength(0);
  });

  it("predlaga in po potrditvi shrani normativ živilskega polizdelka obeh vrst, brez spremembe v prodajni artikel", async () => {
    const intermediates = await db.insert(artikliTable).values([
      {
        enotaId: enotaA, ime: `${run}-paniran-zrezek`, cena: "0", davek: "0",
        nabavniArtikel: false, prodajniArtikel: false, taxCategory: "food", mealType: "ala_carte",
      },
      {
        enotaId: enotaA, ime: `${run}-pripravljena-osnova`, cena: "0", davek: "0",
        nabavniArtikel: false, prodajniArtikel: false, taxCategory: "food", mealType: "prepared",
      },
    ]).returning({ id: artikliTable.id });
    for (const intermediate of intermediates) {
      currentIngredient = `${run}-surovina-${intermediate.id}`;
      const suggestion = await preview(intermediate.id);
      expect(suggestion.status, JSON.stringify(suggestion.body)).toBe(200);
      expect(suggestion.body.items).toEqual([expect.objectContaining({
        name: currentIngredient, quantity: 0.1, unit: "KGM",
      })]);
      expect((await db.select().from(normativiTable).where(eq(normativiTable.artikelId, intermediate.id)))).toEqual([]);
      const accepted = await applyWithClassifications(intermediate.id, suggestion.body.token, [
        { index: 0, taxCategory: "food", addedSugar: false, rawConfirmed: true },
      ]);
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      expect((await db.select().from(normativiTable).where(eq(normativiTable.artikelId, intermediate.id)))).toHaveLength(1);
      const [saved] = await db.select({
        sale: artikliTable.prodajniArtikel,
        purchase: artikliTable.nabavniArtikel,
      }).from(artikliTable).where(eq(artikliTable.id, intermediate.id));
      expect(saved).toEqual({ sale: false, purchase: false });
    }
    expect(mockCreate.mock.calls[0]?.[0]?.messages[0]?.content).toContain("Naziv živilskega polizdelka");
  });

  it("ne dovoli predloga za nabavni ali sestavljeni artikel in zavrne zastarelo vlogo polizdelka", async () => {
    const [intermediate, purchase, composite] = await db.insert(artikliTable).values([
      { enotaId: enotaA, ime: `${run}-vmesni`, cena: "0", davek: "0", nabavniArtikel: false, prodajniArtikel: false, taxCategory: "food", mealType: "ala_carte" },
      { enotaId: enotaA, ime: `${run}-nabavni`, cena: "0", davek: "0", nabavniArtikel: true, prodajniArtikel: false, taxCategory: "food", mealType: "ala_carte" },
      { enotaId: enotaA, ime: `${run}-sestavljeni`, cena: "0", davek: "0", nabavniArtikel: false, prodajniArtikel: false, taxCategory: "food", mealType: "composite" },
    ]).returning({ id: artikliTable.id });
    expect((await preview(purchase!.id)).status).toBe(422);
    expect((await preview(composite!.id)).status).toBe(422);
    const suggestion = await preview(intermediate!.id);
    expect(suggestion.status, JSON.stringify(suggestion.body)).toBe(200);
    await db.update(artikliTable).set({ nabavniArtikel: true }).where(eq(artikliTable.id, intermediate!.id));
    const stale = await applyWithClassifications(intermediate!.id, suggestion.body.token,
      suggestion.body.items[0]?.willCreate
        ? [{ index: 0, taxCategory: "food", addedSugar: false, rawConfirmed: true }]
        : []);
    expect(stale.status, JSON.stringify(stale.body)).toBe(409);
    expect((await db.select().from(normativiTable).where(eq(normativiTable.artikelId, intermediate!.id)))).toEqual([]);
  });

  it("reports an aborted web search clearly and allows a fresh retry", async () => {
    mockCreate.mockImplementationOnce(async () => {
      throw Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
    });
    const failed = await preview();
    expect(failed.status).toBe(503);
    expect(failed.body.error).toContain("trajalo predolgo");
    expect(mockCreate.mock.calls.at(-1)?.[1]).toMatchObject({ timeout: 90_000 });
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, parentId))).toEqual([]);

    const retried = await preview();
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.token).toEqual(expect.any(String));
  });

  it("searches bean salad without the menu's large-portion suffix", async () => {
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: JSON.stringify({ estimate: { sourceUrl: urlA, items: beanSaladItems } }) },
    ] }));
    const response = await preview(salad!.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const request = mockCreate.mock.lastCall?.[0] as { messages: Array<{ content: string }> };
    expect(request.messages[0]?.content).toContain('jed "Fižolova solata"');
    expect(request.messages[0]?.content).toContain('Polni prodajni naziv: "Fižolova solata – velika"');
    expect(request.messages[0]?.content).toContain("slovenskih veleprodajah");
    mockCreate.mockImplementationOnce(async () => ({ content: [{ type: "text", text: '{"recipes":[]}' }] }));
    const [another] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – mala", cena: "4",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const unavailable = await preview(another!.id);
    expect(unavailable.status).toBe(422);
    expect(unavailable.body.error).toContain("preverljiv spletni zadetek");
  });

  it("recovers an unstructured search answer through a forced structured estimate", async () => {
    mockCreate.mockClear();
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => ({ stop_reason: "end_turn", content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: "Found a bean salad but could not return JSON." },
    ] }));
    mockCreate.mockImplementationOnce(async () => ({ content: [{
      type: "tool_use", name: "submit_recipe_estimate",
      input: { sourceUrl: urlA, items: beanSaladItems },
    }] }));
    const result = await preview(salad!.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.origin).toBe("web_estimate");
    expect(result.body.items[0]).toMatchObject({ name: "Fižol konzerviran, odcejen", quantity: 0.18, unit: "KGM" });
    expect(result.body.items).toHaveLength(9);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const recoveryRequest = mockCreate.mock.calls[1]![0];
    expect(recoveryRequest.tool_choice).toEqual({ type: "tool", name: "submit_recipe_estimate" });
    expect(recoveryRequest.tools[0].input_schema.properties.sourceUrl.enum).toEqual([urlA]);
  });

  it("asks for a complete estimate when a salad search returns only one ingredient", async () => {
    mockCreate.mockClear();
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: JSON.stringify({ estimate: {
        sourceUrl: urlA, items: [{ name: "Fižol", quantity: 0.18, unit: "kg" }],
      } }) },
    ] }));
    mockCreate.mockImplementationOnce(async () => ({ content: [{
      type: "tool_use", name: "submit_recipe_estimate", input: {
        sourceUrl: urlA, items: beanSaladItems,
      },
    }] }));

    const result = await preview(salad!.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.origin).toBe("web_estimate");
    expect(result.body.items.map((item: { name: string }) => item.name)).toEqual(beanSaladItems.map(item => item.name));
    expect(mockCreate.mock.calls[1]![0].tools[0].input_schema.properties.items.minItems).toBe(9);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("never presents or caches a one-ingredient salad after the structured retry", async () => {
    mockCreate.mockClear();
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => makeSearchResponse());
    mockCreate.mockImplementationOnce(async () => ({ content: [{
      type: "tool_use", name: "submit_recipe_estimate",
      input: { sourceUrl: urlA, items: [{ name: "Fižol", quantity: 0.18, unit: "kg" }] },
    }] }));
    const failed = await preview(salad!.id);
    expect(failed.status).toBe(422);
    expect(failed.body.error).toContain("vseh potrebnih sestavin");
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id))).toEqual([]);

    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: JSON.stringify({ estimate: { sourceUrl: urlA, items: beanSaladItems } }) },
    ] }));
    const retried = await preview(salad!.id);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.items).toHaveLength(9);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("repairs a bulk-package bean quantity before showing a one-serving draft", async () => {
    mockCreate.mockClear();
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: JSON.stringify({ estimate: {
        sourceUrl: urlA, items: [{ ...beanSaladItems[0]!, quantity: 5 }, ...beanSaladItems.slice(1)],
      } }) },
    ] }));
    mockCreate.mockImplementationOnce(async () => ({ content: [{
      type: "tool_use", name: "submit_recipe_estimate",
      input: { sourceUrl: urlA, items: beanSaladItems },
    }] }));
    const result = await preview(salad!.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.items[0]).toMatchObject({ quantity: 0.18, unit: "KGM" });
    expect(mockCreate.mock.calls[1]![0].messages[0].content).toContain("RECIPE_IMPLAUSIBLE_PORTION");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("never presents or caches a repeated bulk-package quantity", async () => {
    mockCreate.mockClear();
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const oversized = [{ ...beanSaladItems[0]!, quantity: 5 }, ...beanSaladItems.slice(1)];
    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: JSON.stringify({ estimate: { sourceUrl: urlA, items: oversized } }) },
    ] }));
    mockCreate.mockImplementationOnce(async () => ({ content: [{
      type: "tool_use", name: "submit_recipe_estimate", input: { sourceUrl: urlA, items: oversized },
    }] }));
    const failed = await preview(salad!.id);
    expect(failed.status).toBe(422);
    expect(failed.body.error).toContain("pretirane količine");
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id))).toEqual([]);
    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: JSON.stringify({ estimate: { sourceUrl: urlA, items: beanSaladItems } }) },
    ] }));
    const retried = await preview(salad!.id);
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.items[0].quantity).toBe(0.18);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("offers a Slovenian-source restaurant draft with ordinary ingredients and no automatic save", async () => {
    mockCreate.mockClear();
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const url = "https://www.mercator.si/ponudba/konzerviran-fizol";
    const names = ["Fižol konzerviran, odcejen", "Čebula rdeča", "Olje sončnično",
      "Kis vinski", "Sladkor", "Sol", "Poper", "Peteršilj", "Česen"];
    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [
        { type: "web_search_result", url, title: "Konzerviran fižol" },
      ] },
      { type: "text", text: JSON.stringify({ estimate: {
        sourceUrl: url, items: names.map((name, index) => ({
          name, quantity: index === 0 ? 0.18 : 0.01,
          unit: index === 2 || index === 3 ? "l" : "kg",
        })),
      } }) },
    ] }));
    const result = await preview(salad!.id);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.origin).toBe("web_estimate");
    expect(result.body.items.map((item: { name: string }) => item.name)).toEqual(names);
    expect(result.body.sources).toEqual([{ url, title: "Konzerviran fižol" }]);
    expect(result.body.warnings[0]).toContain("okviren gostinski predlog");
    const request = mockCreate.mock.calls[0]![0];
    expect(request.messages[0].content).toContain("slovenskih veleprodajah");
    expect(request.system).toContain("canned cooked/drained beans");
    const saved = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id));
    expect(saved).toEqual([]);
  });

  it("does not recover without a typed search result or accept a forged recovery URL", async () => {
    mockCreate.mockClear();
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Fižolova solata – velika", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => ({ content: [{ type: "text", text: "No recipes found." }] }));
    const missing = await preview(salad!.id);
    expect(missing.status).toBe(422);
    expect(missing.body.error).toContain("preverljiv spletni zadetek");
    expect(mockCreate).toHaveBeenCalledTimes(1);

    mockCreate.mockImplementationOnce(async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
      { type: "text", text: "No JSON" },
    ] }));
    mockCreate.mockImplementationOnce(async () => ({ content: [{
      type: "tool_use", name: "submit_recipe_estimate",
      input: { sourceUrl: urlB, items: [{ name: "Fižol", quantity: 0.19, unit: "kg" }] },
    }] }));
    const forged = await preview(salad!.id);
    expect(forged.status).toBe(422);
    expect(forged.body.error).toContain("preverljiv spletni zadetek");
  });

  it("offers a web-backed approximate bean salad norm and writes it only after confirmation", async () => {
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Solata s fižolom", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => ({
      content: [
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
        { type: "text", text: JSON.stringify({ estimate: { sourceUrl: urlA, items: [
          { name: "Fižol", quantity: 0.2, unit: "kg" },
          { name: "Čebula", quantity: 0.035, unit: "kg" },
        ] } }) },
      ],
    }));
    const response = await preview(salad!.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.origin).toBe("web_estimate");
    expect(response.body.warnings[0]).toContain("okviren gostinski predlog");
    expect(response.body.items).toEqual([
      expect.objectContaining({ name: "Fižol", quantity: 0.2, unit: "KGM" }),
      expect.objectContaining({ name: "Čebula", quantity: 0.035, unit: "KGM" }),
    ]);
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id))).toEqual([]);
    const applied = await applyWithClassifications(salad!.id, response.body.token, [
      { index: 0, taxCategory: "food", addedSugar: false, rawConfirmed: true },
      { index: 1, taxCategory: "food", addedSugar: false, rawConfirmed: true },
    ]);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const norm = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id));
    expect(norm.map(row => row.kolicina)).toEqual(["0.2000", "0.0350"]);
  });

  it("applies only reviewed ingredients, reuses existing oil and creates the added salt atomically", async () => {
    const [salad] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Solata s fižolom", cena: "6",
      davek: "9.5", kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const [oil] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Olje sončnično", cena: "0", davek: "9.5",
      nabavniArtikel: true, prodajniArtikel: false, enotaMere: "LTR",
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => ({
      content: [
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: urlA, title: "Bean salad" }] },
        { type: "text", text: JSON.stringify({ estimate: { sourceUrl: urlA, items: [
          { name: "Fižol", quantity: 0.15, unit: "kg" },
          { name: "Črni fižol", quantity: 0.15, unit: "kg" },
          { name: "Rdeči fižol", quantity: 0.15, unit: "kg" },
          { name: "Olje", quantity: 0.01, unit: "l" },
        ] } }) },
      ],
    }));
    const suggested = await preview(salad!.id);
    expect(suggested.status, JSON.stringify(suggested.body)).toBe(200);
    const editedItems = [
      { name: "Fižol za veliko solato", quantity: "0.15", unit: "KGM", existingArticleId: null },
      { name: "Olje sončnično", quantity: "0.01", unit: "LTR", existingArticleId: oil!.id },
      { name: "Sol", quantity: "0.003", unit: "KGM", existingArticleId: null },
    ];
    const classifications = [
      { index: 0, taxCategory: "food", addedSugar: false, rawConfirmed: true },
      { index: 2, taxCategory: "food", addedSugar: false, rawConfirmed: true },
    ];
    const url = `/artikli/${salad!.id}/normativi/pametni-predlog/uporabi`;
    const invalid = await supertest(app).post(url).set(headers()).send({
      token: suggested.body.token, confirmed: true, editedItems,
      classifications: [{ ...classifications[0], index: 1 }, classifications[1]],
    });
    expect(invalid.status).toBe(400);
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id))).toEqual([]);
    const applied = await supertest(app).post(url).set(headers()).send({
      token: suggested.body.token, confirmed: true, editedItems, classifications,
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.createdArticleIds).toHaveLength(2);
    expect(applied.body.createdArticleIds).not.toContain(oil!.id);
    const norm = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id));
    expect(norm).toHaveLength(3);
    expect(norm.find(row => row.vhodniArtikelId === oil!.id)?.kolicina).toBe("0.0100");
    expect(norm.some(row => row.vhodniArtikelId === oil!.id)).toBe(true);
  });

  it("allows a food article in a legacy category without a tip, but still rejects an explicitly drink category", async () => {
    currentIngredient = "Puranji file";
    const [legacyCategory, drinkCategory] = await db.insert(kategorijeTable).values([
      { enotaId: enotaA, ime: `${run}-legacy-salad`, tip: null },
      { enotaId: enotaA, ime: `${run}-drinks`, tip: "pijaca" },
    ]).returning({ id: kategorijeTable.id });
    const [salad, drink] = await db.insert(artikliTable).values([
      {
        enotaId: enotaA, ime: "Krožnik s puranjimi trakci", cena: "10",
        davek: "9.5", taxCategory: "food", kategorijaId: legacyCategory!.id, prodajniArtikel: true,
      },
      {
        enotaId: enotaA, ime: "Hladna pijača", cena: "3",
        davek: "9.5", taxCategory: "food", kategorijaId: drinkCategory!.id, prodajniArtikel: true,
      },
    ]).returning({ id: artikliTable.id });
    mockCreate.mockClear();
    const response = await preview(salad!.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.items).toEqual([expect.objectContaining({ name: "Puranji file", quantity: 0.1, unit: "KGM" })]);
    const applied = await applyWithClassifications(salad!.id, response.body.token, [
      { index: 0, taxCategory: "food", addedSugar: false, rawConfirmed: true },
    ]);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, salad!.id))).toHaveLength(1);
    const blocked = await preview(drink!.id);
    expect(blocked.status).toBe(422);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("previews without DB writes and atomically creates raw purchase ingredients and norms on confirmation", async () => {
    currentIngredient = "čista Water";
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
      ime: "Čista Water",
      imeZaNabavo: "Čista Water",
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

  it("matches a uniquely reordered ingredient name before proposing a new purchase article", async () => {
    currentIngredient = "Rastlinsko olje";
    const [parent] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Jed z rastlinskim oljem", cena: "6", davek: "9.5",
      kategorijaId: categoryId, prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const [existing] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Olje rastlinsko", cena: "2", davek: "9.5",
      enotaMere: "GRM", nabavniArtikel: true, prodajniArtikel: false,
      vrstaArtikla: "material",
    }).returning({ id: artikliTable.id });
    const response = await preview(parent!.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.items[0]).toMatchObject({ existingArticleId: existing!.id, willCreate: false });
    const applied = await applyWithClassifications(parent!.id, response.body.token, []);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.createdArticleIds).toEqual([]);
  });

  it("researches a named alcoholic serving online, converts its unit, and writes its norm on confirmation", async () => {
    const [serving] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Borovničevec 0,05 l", cena: "3.20", davek: "22",
      taxCategory: "alcoholic", prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    const [smallServing] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Borovničevec 0,03 l", cena: "2.70", davek: "22",
      taxCategory: "alcoholic", prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockClear();
    mockCreate.mockImplementation(async () => makeCatalogResponse("Borovničevec"));

    const response = await preview(serving!.id);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.items).toEqual([expect.objectContaining({
      name: "Borovničevec", quantity: 0.05, unit: "LTR", willCreate: true,
      sourceUrls: ["https://example-shop.com/drinks/product"],
    })]);
    expect(response.body.sources).toEqual([{ url: "https://example-shop.com/drinks/product", title: "Borovničevec – alcoholic drink" }]);
    expect(response.body.warnings[0]).toContain("Količina in merska enota sta razbrani iz naziva");
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const applied = await applyWithClassifications(serving!.id, response.body.token, [{
      index: 0, taxCategory: "alcoholic", addedSugar: false, rawConfirmed: true,
    }]);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const [raw] = await db.select().from(artikliTable).where(eq(artikliTable.id, applied.body.createdArticleIds[0]));
    expect(raw).toMatchObject({ ime: "Borovničevec", nabavniArtikel: true, prodajniArtikel: false, enotaMere: "LTR" });
    const [norm] = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, serving!.id));
    expect(norm!.kolicina).toBe("0.0500");

    const small = await preview(smallServing!.id);
    expect(small.status, JSON.stringify(small.body)).toBe(200);
    expect(small.body.items).toEqual([expect.objectContaining({
      name: "Borovničevec", quantity: 0.03, unit: "LTR", existingArticleId: raw!.id, willCreate: false,
    })]);
    const smallApplied = await applyWithClassifications(smallServing!.id, small.body.token, []);
    expect(smallApplied.status, JSON.stringify(smallApplied.body)).toBe(200);
    expect(smallApplied.body.createdArticleIds).toEqual([]);
    expect((await db.select().from(normativiTable).where(eq(normativiTable.artikelId, smallServing!.id)))[0]!.kolicina).toBe("0.0300");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("does not create a Ballantine's norm without a typed web source, then writes the confirmed 30 ml norm", async () => {
    const [serving] = await db.insert(artikliTable).values({
      enotaId: enotaA, ime: "Ballantine's 0,03 l", cena: "3", davek: "22",
      taxCategory: "alcoholic", prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    mockCreate.mockImplementationOnce(async () => makeCatalogResponse("Ballantine's", false));
    const unverified = await preview(serving!.id);
    expect(unverified.status).toBe(422);
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, serving!.id))).toEqual([]);
    mockCreate.mockImplementationOnce(async () => makeCatalogResponse("Ballantine's"));
    const verified = await preview(serving!.id);
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.items).toEqual([expect.objectContaining({
      name: "Ballantine's", quantity: 0.03, unit: "LTR", willCreate: true,
    })]);
    const applied = await applyWithClassifications(serving!.id, verified.body.token, [{
      index: 0, taxCategory: "alcoholic", addedSugar: false, rawConfirmed: true,
    }]);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const [norm] = await db.select().from(normativiTable).where(eq(normativiTable.artikelId, serving!.id));
    expect(norm?.kolicina).toBe("0.0300");
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