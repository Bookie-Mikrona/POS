import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: any, _res: unknown, next: () => void) => {
    req.enotaId = Number(req.header("x-test-enota"));
    req.vloga = req.header("x-test-role") ?? "admin_enote";
    next();
  },
}));

import { artikliTable, companiesTable, db, enoteTable, normativiTable, pizzaDoughSettingsTable, pool } from "@workspace/db";
import router from "./artikli";

const app = express();
app.use(express.json());
app.use(router);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});
const run = `pizza-dough-edit-${Math.random().toString(36).slice(2)}`;
let companyId = "";
let unitId = 0;
let otherUnitId = 0;
let pizzaId = 0;
let secondPizzaId = 0;
let normalId = 0;
let smallId = 0;
let replacementId = 0;
let foreignId = 0;
let salesId = 0;
const headers = () => ({ "x-enota-id": String(unitId), "x-test-enota": String(unitId), "x-test-role": "admin_enote" });
const change = (normalDoughArticleId: number, smallDoughArticleId: number) => ({
  normalDoughArticleId,
  smallDoughArticleId,
  expectedNormalDoughArticleId: normalId,
  expectedSmallDoughArticleId: smallId,
});

describe("editing size-specific pizza dough in the normative editor", () => {
  beforeAll(async () => {
    const [company] = await db.insert(companiesTable).values({ podjetjeDavcna: run, naziv: run }).returning({ id: companiesTable.id });
    companyId = company!.id;
    const units = await db.insert(enoteTable).values([
      { companyId, ime: `${run}-a` }, { companyId, ime: `${run}-b` },
    ]).returning({ id: enoteTable.id });
    unitId = units[0]!.id;
    otherUnitId = units[1]!.id;
    const articles = await db.insert(artikliTable).values([
      { enotaId: unitId, ime: `${run}-pizza`, cena: "10", jePica: true, prodajniArtikel: true },
      { enotaId: unitId, ime: `${run}-pizza-2`, cena: "10", jePica: true, prodajniArtikel: true },
      { enotaId: unitId, ime: `${run}-normal`, cena: "0", enotaMere: "kos", mealType: "prepared", prodajniArtikel: false },
      { enotaId: unitId, ime: `${run}-small`, cena: "0", enotaMere: "kos", mealType: "prepared", prodajniArtikel: false },
      { enotaId: unitId, ime: `${run}-replacement`, cena: "0", enotaMere: "H87", mealType: "prepared", prodajniArtikel: false },
      { enotaId: otherUnitId, ime: `${run}-foreign`, cena: "0", enotaMere: "kos", mealType: "prepared", prodajniArtikel: false },
      { enotaId: unitId, ime: `${run}-sale`, cena: "1", enotaMere: "kos", mealType: "prepared", prodajniArtikel: true },
    ]).returning({ id: artikliTable.id });
    [pizzaId, secondPizzaId, normalId, smallId, replacementId, foreignId, salesId] = articles.map(article => article.id);
    await db.insert(pizzaDoughSettingsTable).values({ enotaId: unitId, normalDoughArticleId: normalId, smallDoughArticleId: smallId });
  });
  afterAll(async () => {
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await pool.end();
  });

  it("updates the shared size mapping without inserting dough into the ordinary pizza norm", async () => {
    const path = `/artikli/${pizzaId}/pizza-dough-norms`;
    expect((await supertest(app).put(path).set({ ...headers(), "x-test-role": "natakar" }).send(change(replacementId, smallId))).status).toBe(403);
    expect((await supertest(app).put(path).set(headers()).send(change(foreignId, smallId))).status).toBe(422);
    expect((await supertest(app).put(path).set(headers()).send(change(salesId, smallId))).status).toBe(422);
    expect((await supertest(app).put(path).set(headers()).send(change(smallId, smallId))).status).toBe(422);

    const updated = await supertest(app).put(path).set(headers()).send(change(replacementId, smallId));
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const otherPizza = await supertest(app).get(`/artikli/${secondPizzaId}/pizza-dough-norms`).set(headers());
    expect(otherPizza.status).toBe(200);
    expect(otherPizza.body).toEqual([
      expect.objectContaining({ size: "normalna", ingredient: expect.objectContaining({ id: replacementId }), quantity: 1 }),
      expect.objectContaining({ size: "mala", ingredient: expect.objectContaining({ id: smallId }), quantity: 1 }),
    ]);
    expect(await db.select().from(normativiTable).where(eq(normativiTable.artikelId, pizzaId))).toEqual([]);
    expect((await supertest(app).put(path).set(headers()).send(change(normalId, smallId))).status).toBe(409);
  });
});