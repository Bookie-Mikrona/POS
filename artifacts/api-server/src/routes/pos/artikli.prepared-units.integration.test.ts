import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ enotaId: 0 }));
vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: { enotaId?: number }, _res: unknown, next: () => void) => {
    req.enotaId = context.enotaId;
    next();
  },
}));

import express from "express";
import supertest from "supertest";
import { and, eq } from "drizzle-orm";
import {
  artikliTable, companiesTable, db, enoteTable, narocilaTable, normativiTable, pool,
  pizzaDoughSettingsTable, postavkeTable, preparedFoodStocksTable,
} from "@workspace/db";
import router from "./artikli";

const app = express();
app.use(express.json());
app.use((req, _res, next) => { Object.assign(req, { enotaId: context.enotaId }); next(); });
app.use(router);

let companyId: string;
let enotaId: number;
let bulkArticleId: number;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_PFU_${Math.random().toString(36).slice(2, 9)}`,
    naziv: "Prepared unit rules",
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId, ime: "Prepared unit test unit", aktiven: true,
  }).returning({ id: enoteTable.id });
  enotaId = unit!.id;
  context.enotaId = enotaId;
});

afterAll(async () => {
  if (bulkArticleId) {
    await db.delete(preparedFoodStocksTable).where(eq(preparedFoodStocksTable.artikelId, bulkArticleId));
    await db.delete(artikliTable).where(eq(artikliTable.id, bulkArticleId));
  }
  if (enotaId) await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("prepared kg/l article rules", () => {
  it("rejects direct prepared sales in kg/l and normalizes a valid semi-product unit", async () => {
    const rejectKg = await supertest(app).post("/artikli").send({
      ime: "Prodajni golaž kg", cena: 0, davek: 0, mealType: "prepared",
      enotaMere: "kg", nabavniArtikel: false, prodajniArtikel: true,
    });
    expect(rejectKg.status).toBe(400);
    expect(rejectKg.body.error).toContain("neprodajni");

    const rejectPurchasedLiter = await supertest(app).post("/artikli").send({
      ime: "Kupljena juha l", cena: 0, davek: 0, mealType: "prepared",
      enotaMere: "l", nabavniArtikel: true, prodajniArtikel: false,
    });
    expect(rejectPurchasedLiter.status).toBe(400);

    const created = await supertest(app).post("/artikli").send({
      ime: "Polizdelek golaž kg", cena: 0, davek: 0, mealType: "prepared",
      enotaMere: "kg", nabavniArtikel: false, prodajniArtikel: false,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    bulkArticleId = created.body.id;
    expect(created.body.enotaMere).toBe("KGM");
  });

  it("blocks unit reinterpretation after prepared stock exists", async () => {
    await db.insert(preparedFoodStocksTable).values({
      enotaId, artikelId: bulkArticleId, year: 2099,
      openingQuantity: "10", openingCostPerPortion: "2",
      frozenQuantity: "10", frozenCostPerPortion: "2",
    });
    const response = await supertest(app).put(`/artikli/${bulkArticleId}`).send({
      ime: "Polizdelek golaž kg", enotaMere: "H87",
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("zaloga");
    const [article] = await db.select({ unit: artikliTable.enotaMere }).from(artikliTable)
      .where(and(eq(artikliTable.id, bulkArticleId), eq(artikliTable.enotaId, enotaId)));
    expect(article?.unit).toBe("KGM");

    const typeChange = await supertest(app).put(`/artikli/${bulkArticleId}`).send({
      ime: "Polizdelek golaž kg", mealType: "ala_carte",
    });
    expect(typeChange.status).toBe(409);
  });

  it("shrani normalno porcijo 400 g brez omogočanja prodaje ali spreminjanja kg zaloge", async () => {
    const response = await supertest(app).put(`/artikli/${bulkArticleId}`).send({
      ime: "Polizdelek golaž kg", preparedNormPortionQuantity: 0.4,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.preparedNormPortionQuantity).toBe(0.4);
    expect(response.body.enotaMere).toBe("KGM");
    expect(response.body.prodajniArtikel).toBe(false);
    expect(response.body.nabavniArtikel).toBe(false);
    expect(Number(response.body.cena)).toBe(0);
    const [stock] = await db.select().from(preparedFoodStocksTable)
      .where(eq(preparedFoodStocksTable.artikelId, bulkArticleId));
    expect(Number(stock?.frozenQuantity)).toBe(10);
    const list = await supertest(app).get("/artikli");
    expect(list.body.find((article: { id: number }) => article.id === bulkArticleId).preparedNormPortionQuantity).toBe(0.4);
    const sale = await supertest(app).put(`/artikli/${bulkArticleId}`).send({ ime: "Polizdelek golaž kg", prodajniArtikel: true });
    expect(sale.status).toBe(400);
    const zero = await supertest(app).put(`/artikli/${bulkArticleId}`).send({ ime: "Polizdelek golaž kg", preparedNormPortionQuantity: 0 });
    expect(zero.status).toBe(400);
  });

  it("blocks unit reinterpretation after dough, direct-sale, or modifier-snapshot references", async () => {
    await db.delete(preparedFoodStocksTable).where(eq(preparedFoodStocksTable.artikelId, bulkArticleId));
    await db.insert(pizzaDoughSettingsTable).values({
      enotaId, normalDoughArticleId: bulkArticleId, smallDoughArticleId: bulkArticleId,
    });
    const doughReference = await supertest(app).put(`/artikli/${bulkArticleId}`).send({
      ime: "Polizdelek golaž kg", enotaMere: "H87",
    });
    expect(doughReference.status).toBe(409);
    await db.delete(pizzaDoughSettingsTable).where(eq(pizzaDoughSettingsTable.enotaId, enotaId));

    const [order] = await db.insert(narocilaTable).values({
      enotaId, status: "zakljuceno",
    }).returning({ id: narocilaTable.id });
    try {
      const [directSale] = await db.insert(postavkeTable).values({
        narociloId: order!.id, artikelId: bulkArticleId, ime: "Legacy kg line",
        kolicina: 1, cenaKos: "1", skupaj: "1", davek: "0",
      }).returning({ id: postavkeTable.id });
      const saleReference = await supertest(app).put(`/artikli/${bulkArticleId}`).send({
        ime: "Polizdelek golaž kg", enotaMere: "H87",
      });
      expect(saleReference.status).toBe(409);
      await db.delete(postavkeTable).where(eq(postavkeTable.id, directSale!.id));

      await db.insert(postavkeTable).values({
        narociloId: order!.id, ime: "Legacy modifier snapshot", kolicina: 1,
        cenaKos: "0", skupaj: "0", davek: "0",
        availabilityRequirements: [{ articleId: bulkArticleId, quantity: 0.2, mealType: "prepared" }],
      });
      const snapshotReference = await supertest(app).put(`/artikli/${bulkArticleId}`).send({
        ime: "Polizdelek golaž kg", enotaMere: "H87",
      });
      expect(snapshotReference.status).toBe(409);
    } finally {
      await db.delete(postavkeTable).where(eq(postavkeTable.narociloId, order!.id));
      await db.delete(narocilaTable).where(eq(narocilaTable.id, order!.id));
    }
  });

  it("allows raw kg recipe inputs while restricting prepared kg ingredients to composite sales", async () => {
    const [rawIngredient] = await db.insert(artikliTable).values({
      enotaId, ime: "Moka v kg", cena: "1", davek: "9.5", enotaMere: "KG",
      nabavniArtikel: true, prodajniArtikel: false, mealType: "ala_carte",
    }).returning({ id: artikliTable.id });

    const rawRecipe = await supertest(app).post("/artikli").send({
      ime: "Sestavljena jed iz surovine", cena: 8, davek: 9.5, mealType: "composite",
      normativItems: [{ vhodniArtikelId: rawIngredient!.id, kolicina: 0.4 }],
    });
    expect(rawRecipe.status, JSON.stringify(rawRecipe.body)).toBe(201);
    const ownerId = rawRecipe.body.id as number;
    try {
      const invalidPreparedRecipe = await supertest(app).post("/artikli").send({
        ime: "Priprava iz goleža kg", cena: 0, davek: 0, mealType: "prepared",
        nabavniArtikel: false, prodajniArtikel: false,
        normativItems: [{ vhodniArtikelId: bulkArticleId, kolicina: 0.2 }],
      });
      expect(invalidPreparedRecipe.status).toBe(422);
    } finally {
      await db.delete(normativiTable).where(eq(normativiTable.artikelId, ownerId));
      await db.delete(artikliTable).where(eq(artikliTable.id, ownerId));
      await db.delete(artikliTable).where(eq(artikliTable.id, rawIngredient!.id));
    }
  });
});