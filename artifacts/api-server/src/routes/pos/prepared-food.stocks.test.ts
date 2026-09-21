import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  pool,
  preparedFoodStocksTable,
} from "@workspace/db";
import preparedFoodRouter from "./prepared-food";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const YEAR = 2098;

let companyId: string;
let enotaId: number;
let firstArticleId: number;
let secondArticleId: number;
let regularArticleId: number;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    next();
  });
  app.use(preparedFoodRouter);
  return app;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_PFS_${RUN_ID}`,
    naziv: `Prepared food stocks ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Enota ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;

  const articles = await db.insert(artikliTable).values([
    { enotaId, ime: `Prva jed ${RUN_ID}`, cena: "8.00", mealType: "prepared" },
    { enotaId, ime: `Druga jed ${RUN_ID}`, cena: "9.00", mealType: "prepared" },
    { enotaId, ime: `Navaden artikel ${RUN_ID}`, cena: "3.00", mealType: "ala_carte" },
  ]).returning({ id: artikliTable.id, mealType: artikliTable.mealType });
  [firstArticleId, secondArticleId, regularArticleId] = articles.map((article) => article.id);
});

afterAll(async () => {
  await db.delete(preparedFoodStocksTable).where(and(
    eq(preparedFoodStocksTable.enotaId, enotaId),
    eq(preparedFoodStocksTable.year, YEAR),
  ));
  await db.delete(artikliTable).where(inArray(artikliTable.id, [firstArticleId, secondArticleId, regularArticleId]));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("PUT /prepared-food/stocks/:year", () => {
  it("prazen paket ne spremeni ničesar", async () => {
    const response = await supertest(buildApp())
      .put(`/prepared-food/stocks/${YEAR}`)
      .send({ items: [] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("atomsko shrani eno ali več spremenjenih vrstic", async () => {
    const response = await supertest(buildApp())
      .put(`/prepared-food/stocks/${YEAR}`)
      .send({
        items: [
          { articleId: firstArticleId, openingQuantity: 5, openingCostPerPortion: 1.25 },
          { articleId: secondArticleId, openingQuantity: 7, openingCostPerPortion: 2.5 },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.map((row: { openingQuantity: number }) => row.openingQuantity)).toEqual([5, 7]);
  });

  it("ob eni neveljavni vrstici ne shrani nobene spremembe", async () => {
    const response = await supertest(buildApp())
      .put(`/prepared-food/stocks/${YEAR}`)
      .send({
        items: [
          { articleId: firstArticleId, openingQuantity: 99, openingCostPerPortion: 9.99 },
          { articleId: regularArticleId, openingQuantity: 3, openingCostPerPortion: 1 },
        ],
      });

    expect(response.status).toBe(422);
    const [unchanged] = await db.select({
      openingQuantity: preparedFoodStocksTable.openingQuantity,
      openingCostPerPortion: preparedFoodStocksTable.openingCostPerPortion,
    }).from(preparedFoodStocksTable).where(and(
      eq(preparedFoodStocksTable.enotaId, enotaId),
      eq(preparedFoodStocksTable.artikelId, firstArticleId),
      eq(preparedFoodStocksTable.year, YEAR),
    ));
    expect(unchanged).toMatchObject({ openingQuantity: "5.0000", openingCostPerPortion: "1.250000" });
  });
});