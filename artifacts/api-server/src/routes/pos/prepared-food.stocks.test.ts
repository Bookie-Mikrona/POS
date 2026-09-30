import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  modNormativiTable,
  modifikatorjiTable,
  modSkupineTable,
  narocilaTable,
  normativiTable,
  pool,
  postavkeTable,
  preparedFoodDailyLedgersTable,
  preparedFoodStocksTable,
  zalogaGibiTable,
  zalogeTable,
} from "@workspace/db";
import preparedFoodRouter from "./prepared-food";
import { preparedMaterialQuantityForProduction } from "../../lib/prepared-food-costing";

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
    { enotaId, ime: `Prva jed ${RUN_ID}`, cena: "8.00", mealType: "prepared", enotaMere: "KGM", prodajniArtikel: false },
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
    expect(response.body[0].unitOfMeasure).toBe("kg");
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

describe("meje odtajanja pripravljene hrane", () => {
  it("zavrne več od zamrznjene zaloge in negativno količino, dovoli pa nič in celotno zalogo", async () => {
    const date = "2098-05-01";
    await supertest(buildApp()).put(`/prepared-food/stocks/${YEAR}/${firstArticleId}`)
      .send({ openingQuantity: 10, openingCostPerPortion: 1.25 })
      .expect(200);
    const url = `/prepared-food/daily/${date}/${firstArticleId}`;
    const payload = (thawedQuantity: number) => ({
      thawedQuantity, preparedQuantity: 0, correctionQuantity: 0, frozenAtEndQuantity: 0,
    });
    try {
      const excessive = await supertest(buildApp()).put(url).send(payload(20));
      expect(excessive.status).toBe(422);
      expect(excessive.body.error).toMatch(/presega razpoložljivo/);
      await supertest(buildApp()).put(url).send(payload(-1)).expect(400);
      await supertest(buildApp()).put(url).send(payload(0)).expect(200);
      await supertest(buildApp()).put(url).send(payload(10)).expect(200);
      const [ledger] = await db.select({ thawedQuantity: preparedFoodDailyLedgersTable.thawedQuantity })
        .from(preparedFoodDailyLedgersTable).where(and(
          eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
          eq(preparedFoodDailyLedgersTable.businessDate, date),
          eq(preparedFoodDailyLedgersTable.artikelId, firstArticleId),
        ));
      expect(ledger?.thawedQuantity).toBe("10.0000");
    } finally {
      await db.delete(preparedFoodDailyLedgersTable).where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        eq(preparedFoodDailyLedgersTable.businessDate, date),
      ));
    }
  });
});

describe("dnevna prodaja pripravljenih prilog", () => {
  it("upošteva shranjeno izbiro in starejšo izbiro brez posnetka, brez podvajanja", async () => {
    const date = "2098-06-09";
    const [group] = await db.insert(modSkupineTable).values({
      enotaId, ime: `Priloge ${RUN_ID}`,
    }).returning({ id: modSkupineTable.id });
    const mods = await db.insert(modifikatorjiTable).values([
      { skupinaId: group!.id, ime: `Pražen ${RUN_ID}` },
      { skupinaId: group!.id, ime: `Riž ${RUN_ID}` },
    ]).returning({ id: modifikatorjiTable.id });
    let orderId: number | undefined;
    try {
      await db.insert(modNormativiTable).values([
        { modifikatorId: mods[0]!.id, vhodniArtikelId: firstArticleId, kolicina: "1" },
        { modifikatorId: mods[1]!.id, vhodniArtikelId: secondArticleId, kolicina: "1" },
      ]);
      await db.insert(preparedFoodDailyLedgersTable).values([
        { enotaId, businessDate: date, artikelId: firstArticleId, preparedQuantity: "10" },
        { enotaId, businessDate: date, artikelId: secondArticleId, preparedQuantity: "10" },
      ]);
      const [order] = await db.insert(narocilaTable).values({
        enotaId, status: "zakljuceno", ustvarjeno: new Date(`${date}T12:00:00Z`),
      }).returning({ id: narocilaTable.id });
      orderId = order!.id;
      const [parent] = await db.insert(postavkeTable).values({
        narociloId: orderId, artikelId: regularArticleId, ime: "Kosilo",
        cenaKos: "10", skupaj: "10", davek: "9.5",
      }).returning({ id: postavkeTable.id });
      await db.insert(postavkeTable).values([
        {
          narociloId: orderId, parentPostavkaId: parent!.id, modifikatorId: mods[0]!.id,
          ime: "Pražen", kolicina: 2, cenaKos: "0", skupaj: "0", davek: "9.5",
          availabilityRequirements: [{ articleId: firstArticleId, quantity: 0.35, mealType: "prepared" }],
        },
        {
          narociloId: orderId, parentPostavkaId: parent!.id, modifikatorId: mods[1]!.id,
          ime: "Riž", cenaKos: "0", skupaj: "0", davek: "9.5",
        },
        {
          narociloId: orderId, parentPostavkaId: parent!.id, modifikatorId: mods[0]!.id,
          ime: "Razveljavljena priloga", kolicina: -1, cenaKos: "0", skupaj: "0", davek: "9.5",
          availabilityRequirements: [{ articleId: firstArticleId, quantity: 0.35, mealType: "prepared" }],
        },
      ]);
      const response = await supertest(buildApp()).get(`/prepared-food/daily/${date}`);
      expect(response.status).toBe(200);
      expect(response.body.find((row: { artikelId: number }) => row.artikelId === firstArticleId).soldQuantity).toBeCloseTo(0.7);
      expect(response.body.find((row: { artikelId: number }) => row.artikelId === secondArticleId).soldQuantity).toBe(1);
    } finally {
      if (orderId) {
        await db.delete(postavkeTable).where(eq(postavkeTable.narociloId, orderId));
        await db.delete(narocilaTable).where(eq(narocilaTable.id, orderId));
      }
      await db.delete(preparedFoodDailyLedgersTable).where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        eq(preparedFoodDailyLedgersTable.businessDate, date),
      ));
      await db.delete(modifikatorjiTable).where(inArray(modifikatorjiTable.id, mods.map(mod => mod.id)));
      await db.delete(modSkupineTable).where(eq(modSkupineTable.id, group!.id));
    }
  });

  it("porabi normativ na kilogram priprave in evidentira decimalno prodajo prek sestavljene jedi", async () => {
    const date = "2098-07-01";
    const [bulk] = await db.insert(artikliTable).values({
      enotaId, ime: `Golaž kg ${RUN_ID}`, cena: "0", davek: "0", enotaMere: "KGM",
      nabavniArtikel: false, prodajniArtikel: false, mealType: "prepared",
    }).returning({ id: artikliTable.id });
    const [dish] = await db.insert(artikliTable).values({
      enotaId, ime: `Porcija golaža ${RUN_ID}`, cena: "8", davek: "9.5", mealType: "composite",
    }).returning({ id: artikliTable.id });
    const [ingredient] = await db.insert(artikliTable).values({
      enotaId, ime: `Meso ${RUN_ID}`, cena: "1", davek: "9.5", enotaMere: "kos",
    }).returning({ id: artikliTable.id });
    const [order] = await db.insert(narocilaTable).values({
      enotaId, status: "zakljuceno", ustvarjeno: new Date(`${date}T12:00:00Z`),
    }).returning({ id: narocilaTable.id });
    try {
      await db.insert(normativiTable).values([
        { artikelId: bulk!.id, vhodniArtikelId: ingredient!.id, kolicina: "3" },
        { artikelId: dish!.id, vhodniArtikelId: bulk!.id, kolicina: "0.35" },
      ]);
      await db.insert(preparedFoodDailyLedgersTable).values({
        enotaId, businessDate: date, artikelId: bulk!.id, preparedQuantity: "10",
      });
      await db.insert(postavkeTable).values({
        narociloId: order!.id, artikelId: dish!.id, ime: "Porcija golaža",
        mealType: "composite", kolicina: 2, normativFaktor: "0.5",
        cenaKos: "8", skupaj: "16", davek: "9.5",
      });

      const daily = await supertest(buildApp()).get(`/prepared-food/daily/${date}`).expect(200);
      expect(daily.body.find((row: { artikelId: number }) => row.artikelId === bulk!.id).soldQuantity).toBeCloseTo(0.35);
      expect(daily.body.find((row: { artikelId: number }) => row.artikelId === bulk!.id).unitOfMeasure).toBe("kg");
      const close = await supertest(buildApp())
        .post(`/prepared-food/daily/${date}/${bulk!.id}/close`).send({});
      expect(close.status, JSON.stringify(close.body)).toBe(200);
      const consumption = await db.select({ quantity: zalogaGibiTable.kolicina }).from(zalogaGibiTable)
        .where(and(
          eq(zalogaGibiTable.artikelId, ingredient!.id),
          eq(zalogaGibiTable.sourceSnapshot, "prepared_food_daily_close"),
        ));
      expect(consumption.map(row => Number(row.quantity))).toContain(-30);
      expect(preparedMaterialQuantityForProduction(3, 10)).toBe(30);
    } finally {
      await db.delete(postavkeTable).where(eq(postavkeTable.narociloId, order!.id));
      await db.delete(narocilaTable).where(eq(narocilaTable.id, order!.id));
      await db.delete(preparedFoodDailyLedgersTable).where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        eq(preparedFoodDailyLedgersTable.businessDate, date),
      ));
      await db.delete(preparedFoodStocksTable).where(and(
        eq(preparedFoodStocksTable.enotaId, enotaId),
        eq(preparedFoodStocksTable.artikelId, bulk!.id),
      ));
      await db.transaction(async tx => {
        await tx.execute(sql`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
        await tx.delete(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, ingredient!.id));
        await tx.delete(zalogeTable).where(eq(zalogeTable.artikelId, ingredient!.id));
        await tx.delete(preparedFoodStocksTable).where(and(
          eq(preparedFoodStocksTable.enotaId, enotaId),
          eq(preparedFoodStocksTable.artikelId, bulk!.id),
        ));
        await tx.delete(normativiTable).where(inArray(normativiTable.artikelId, [bulk!.id, dish!.id]));
        await tx.delete(artikliTable).where(inArray(artikliTable.id, [bulk!.id, dish!.id, ingredient!.id]));
      });
    }
  });
});