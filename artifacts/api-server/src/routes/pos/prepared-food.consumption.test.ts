import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  normativiTable,
  pool,
  preparedFoodDailyLedgersTable,
  preparedFoodStocksTable,
  zalogaGibiTable,
} from "@workspace/db";
import preparedFoodRouter from "./prepared-food";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const PREVIEW_DATE = "2097-02-01";
const ACTUAL_DATE = "2097-02-02";
const ZERO_DATE = "2097-02-03";
const EMPTY_NORM_DATE = "2097-02-04";
const FIXTURE_DATES = [PREVIEW_DATE, ACTUAL_DATE, ZERO_DATE, EMPTY_NORM_DATE];

let enotaId: number;
let otherEnotaId: number;
let companyId: string;
let articleId: number;
let otherArticleId: number;
let regularArticleId: number;
let ingredientId: number;
let otherIngredientId: number;

function buildApp(activeEnotaId = enotaId) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).enotaId = activeEnotaId;
    next();
  });
  app.use(preparedFoodRouter);
  return app;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_PFC_${RUN_ID}`,
    naziv: `Prepared food consumption ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const units = await db.insert(enoteTable).values([
    { companyId, ime: `Enota porabe ${RUN_ID}` },
    { companyId, ime: `Druga enota porabe ${RUN_ID}` },
  ]).returning({ id: enoteTable.id });
  enotaId = units[0]!.id;
  otherEnotaId = units[1]!.id;

  const articles = await db.insert(artikliTable).values([
    { enotaId, ime: `Juha kg ${RUN_ID}`, cena: "0", enotaMere: "KGM", mealType: "prepared", prodajniArtikel: false },
    { enotaId: otherEnotaId, ime: `Tuja jed ${RUN_ID}`, cena: "0", mealType: "prepared", prodajniArtikel: false },
    { enotaId, ime: `Navaden artikel ${RUN_ID}`, cena: "1", mealType: "ala_carte" },
    { enotaId, ime: `Arhivirana sestavina ${RUN_ID}`, cena: "1", enotaMere: "kg", aktiven: false },
    { enotaId: otherEnotaId, ime: `Zasebna tuja sestavina ${RUN_ID}`, cena: "1", enotaMere: "l" },
  ]).returning({ id: artikliTable.id });
  [articleId, otherArticleId, regularArticleId, ingredientId, otherIngredientId] = articles.map((row) => row.id);
});

afterEach(async () => {
  const ledgers = await db.select({ id: preparedFoodDailyLedgersTable.id })
    .from(preparedFoodDailyLedgersTable)
    .where(and(
      eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
      eq(preparedFoodDailyLedgersTable.artikelId, articleId),
      inArray(preparedFoodDailyLedgersTable.businessDate, FIXTURE_DATES),
    ));
  if (ledgers.length > 0) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
      await tx.delete(zalogaGibiTable).where(and(
        eq(zalogaGibiTable.sourceSnapshot, "prepared_food_daily_close"),
        inArray(zalogaGibiTable.referencaId, ledgers.map((row) => row.id)),
      ));
      await tx.delete(preparedFoodDailyLedgersTable)
        .where(inArray(preparedFoodDailyLedgersTable.id, ledgers.map((row) => row.id)));
    });
  }
  await db.delete(normativiTable).where(eq(normativiTable.artikelId, articleId));
  await db.update(artikliTable).set({ ime: `Arhivirana sestavina ${RUN_ID}`, enotaMere: "kg" })
    .where(eq(artikliTable.id, ingredientId));
});

afterAll(async () => {
  await db.delete(normativiTable).where(eq(normativiTable.artikelId, articleId));
  await db.delete(artikliTable).where(inArray(artikliTable.id, [
    articleId, otherArticleId, regularArticleId, ingredientId, otherIngredientId,
  ]));
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaId, otherEnotaId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("GET /prepared-food/daily/:date/:articleId/consumption", () => {
  it("scopes prepared articles to the active business unit", async () => {
    await supertest(buildApp()).get(`/prepared-food/daily/${PREVIEW_DATE}/${otherArticleId}/consumption`).expect(404);
    await supertest(buildApp()).get(`/prepared-food/daily/${PREVIEW_DATE}/${regularArticleId}/consumption`).expect(404);
  });

  it("rejects invalid, non-finite, negative and out-of-range preview quantities", async () => {
    const app = buildApp();
    for (const quantity of ["-0.1", "NaN", "Infinity", "1000000", ""]) {
      await supertest(app)
        .get(`/prepared-food/daily/${PREVIEW_DATE}/${articleId}/consumption?quantity=${quantity}`)
        .expect(400);
    }
    const [rows] = await Promise.all([
      db.select({ id: preparedFoodDailyLedgersTable.id }).from(preparedFoodDailyLedgersTable)
        .where(and(
          eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
          eq(preparedFoodDailyLedgersTable.businessDate, PREVIEW_DATE),
          eq(preparedFoodDailyLedgersTable.artikelId, articleId),
        )),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("previews decimal kg quantities from the current recipe and accepts archived local ingredients", async () => {
    await db.insert(normativiTable).values({
      artikelId: articleId,
      vhodniArtikelId: ingredientId,
      kolicina: "0.35",
    });
    const [savedLedger] = await db.insert(preparedFoodDailyLedgersTable).values({
      enotaId, businessDate: PREVIEW_DATE, artikelId: articleId, preparedQuantity: "0.5",
    }).returning({ id: preparedFoodDailyLedgersTable.id });

    const response = await supertest(buildApp())
      .get(`/prepared-food/daily/${PREVIEW_DATE}/${articleId}/consumption?quantity=0.4`)
      .expect(200);
    expect(response.body).toMatchObject({
      articleId,
      articleName: `Juha kg ${RUN_ID}`,
      preparedQuantity: 0.4,
      unitOfMeasure: "kg",
      source: "normative",
      items: [{
        ingredientId,
        ingredientName: `Arhivirana sestavina ${RUN_ID}`,
        unitOfMeasure: "kg",
        quantity: expect.closeTo(0.14, 10),
        quantityPerUnit: 0.35,
      }],
    });
    const [ledgerAfterPreview] = await db.select({
      preparedQuantity: preparedFoodDailyLedgersTable.preparedQuantity,
    }).from(preparedFoodDailyLedgersTable).where(eq(preparedFoodDailyLedgersTable.id, savedLedger!.id));
    const movementsAfterPreview = await db.select({ id: zalogaGibiTable.id })
      .from(zalogaGibiTable).where(and(
        eq(zalogaGibiTable.referencaId, savedLedger!.id),
        eq(zalogaGibiTable.sourceSnapshot, "prepared_food_daily_close"),
      ));
    expect(ledgerAfterPreview?.preparedQuantity).toBe("0.5000");
    expect(movementsAfterPreview).toEqual([]);
  });

  it("uses preserved movement amounts for closed ledgers after the recipe changes", async () => {
    const [ledger] = await db.insert(preparedFoodDailyLedgersTable).values({
      enotaId,
      businessDate: ACTUAL_DATE,
      artikelId: articleId,
      preparedQuantity: "4",
      closedAt: new Date("2097-02-02T22:00:00.000Z"),
    }).returning({ id: preparedFoodDailyLedgersTable.id });
    await db.insert(normativiTable).values({
      artikelId: articleId,
      vhodniArtikelId: ingredientId,
      kolicina: "0.25",
    });
    await db.insert(zalogaGibiTable).values([
      {
        artikelId: ingredientId, tip: "poraba", kolicina: "-0.75", cenaKos: "1",
        vrednost: "-0.75", referencaId: ledger!.id, sourceSnapshot: "prepared_food_daily_close",
      },
      {
        artikelId: ingredientId, tip: "poraba", kolicina: "-0.25", cenaKos: "1",
        vrednost: "-0.25", referencaId: ledger!.id, sourceSnapshot: "prepared_food_daily_close",
      },
      {
        artikelId: otherIngredientId, tip: "poraba", kolicina: "-0.5", cenaKos: "1",
        vrednost: "-0.5", referencaId: ledger!.id, sourceSnapshot: "prepared_food_daily_close",
      },
    ]);
    await db.update(normativiTable).set({ kolicina: "99" }).where(and(
      eq(normativiTable.artikelId, articleId),
      eq(normativiTable.vhodniArtikelId, ingredientId),
    ));
    await db.update(artikliTable).set({ ime: `Posodobljena sestavina ${RUN_ID}`, enotaMere: "g" })
      .where(eq(artikliTable.id, ingredientId));

    const response = await supertest(buildApp())
      .get(`/prepared-food/daily/${ACTUAL_DATE}/${articleId}/consumption?quantity=500`)
      .expect(200);
    expect(response.body).toMatchObject({
      articleId,
      preparedQuantity: 4,
      unitOfMeasure: "kg",
      source: "actual",
      items: expect.arrayContaining([
        {
          ingredientId,
          ingredientName: `Posodobljena sestavina ${RUN_ID}`,
          unitOfMeasure: "g",
          quantity: 1,
          quantityPerUnit: null,
        },
        {
          ingredientId: otherIngredientId,
          ingredientName: "Sestavina ni na voljo v tej poslovni enoti",
          unitOfMeasure: null,
          quantity: 0.5,
          quantityPerUnit: null,
        },
      ]),
    });
  });

  it("reports missing actual evidence explicitly and ignores the query for a zero closed ledger", async () => {
    await db.insert(preparedFoodDailyLedgersTable).values({
      enotaId,
      businessDate: ZERO_DATE,
      artikelId: articleId,
      preparedQuantity: "0",
      closedAt: new Date("2097-02-03T22:00:00.000Z"),
    });
    await db.insert(normativiTable).values({
      artikelId: articleId,
      vhodniArtikelId: ingredientId,
      kolicina: "10",
    });

    const response = await supertest(buildApp())
      .get(`/prepared-food/daily/${ZERO_DATE}/${articleId}/consumption?quantity=7`)
      .expect(200);
    expect(response.body).toMatchObject({
      articleId,
      preparedQuantity: 0,
      source: "actual",
      items: [],
      message: expect.stringMatching(/dokaznih premikov/),
    });
  });

  it("reports an empty open recipe and leaves daily and stock ledgers untouched", async () => {
    const response = await supertest(buildApp())
      .get(`/prepared-food/daily/${EMPTY_NORM_DATE}/${articleId}/consumption?quantity=0.25`)
      .expect(200);
    expect(response.body).toMatchObject({
      articleId,
      preparedQuantity: 0.25,
      source: "normative",
      items: [],
      message: expect.stringMatching(/ni določenih sestavin/),
    });
    const [dailyRows, stockRows] = await Promise.all([
      db.select({ id: preparedFoodDailyLedgersTable.id }).from(preparedFoodDailyLedgersTable)
        .where(and(
          eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
          eq(preparedFoodDailyLedgersTable.businessDate, EMPTY_NORM_DATE),
          eq(preparedFoodDailyLedgersTable.artikelId, articleId),
        )),
      db.select({ id: preparedFoodStocksTable.id }).from(preparedFoodStocksTable)
        .where(and(
          eq(preparedFoodStocksTable.enotaId, enotaId),
          eq(preparedFoodStocksTable.artikelId, articleId),
        )),
    ]);
    expect(dailyRows).toEqual([]);
    expect(stockRows).toEqual([]);
  });

  it("does not reveal catalog details for a foreign-unit ingredient reference", async () => {
    await db.insert(normativiTable).values({
      artikelId: articleId,
      vhodniArtikelId: otherIngredientId,
      kolicina: "0.5",
    });

    const response = await supertest(buildApp())
      .get(`/prepared-food/daily/${PREVIEW_DATE}/${articleId}/consumption?quantity=2`)
      .expect(200);
    expect(response.body.items).toEqual([{
      ingredientId: otherIngredientId,
      ingredientName: "Sestavina ni na voljo v tej poslovni enoti",
      unitOfMeasure: null,
      quantity: 1,
      quantityPerUnit: 0.5,
    }]);
    expect(response.body.message).toMatch(/ni mogoče razpoznati/);
    expect(JSON.stringify(response.body)).not.toContain(`Zasebna tuja sestavina ${RUN_ID}`);
  });
});