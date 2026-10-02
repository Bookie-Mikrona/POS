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
import { eq } from "drizzle-orm";
import { artikliTable, companiesTable, db, enoteTable, normativiTable, pool } from "@workspace/db";
import router from "./artikli";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).enotaId = context.enotaId;
  next();
});
app.use(router);

let companyId: string;
let unitId: number;
let pizzaId: number;
let ingredientId: number;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_PIZZA_${Math.random().toString(36).slice(2, 9)}`,
    naziv: "Test tipa pice",
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId, ime: "Testna picerija", aktiven: true,
  }).returning({ id: enoteTable.id });
  unitId = unit!.id;
  context.enotaId = unitId;
  const [pizza] = await db.insert(artikliTable).values({
    enotaId: unitId,
    ime: "Testna pica",
    cena: "12",
    davek: "9.5",
    jePica: true,
    pripravaVrsta: "pica",
    prodajniArtikel: true,
    mealType: "composite",
  }).returning({ id: artikliTable.id });
  pizzaId = pizza!.id;
  const [ingredient] = await db.insert(artikliTable).values({
    enotaId: unitId, ime: "Testna sestavina", cena: "1", davek: "9.5",
  }).returning({ id: artikliTable.id });
  ingredientId = ingredient!.id;
  await db.insert(normativiTable).values({
    artikelId: pizzaId, vhodniArtikelId: ingredientId, kolicina: "1",
  });
});

afterAll(async () => {
  if (pizzaId) await db.delete(artikliTable).where(eq(artikliTable.id, pizzaId));
  if (ingredientId) await db.delete(artikliTable).where(eq(artikliTable.id, ingredientId));
  if (unitId) await db.delete(enoteTable).where(eq(enoteTable.id, unitId));
  if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("PUT /artikli/:id — tip pice", () => {
  it("shrani izključitev KDS, jo vrne v seznamu in pri drugih spremembah ohrani", async () => {
    const update = await supertest(app).put(`/artikli/${pizzaId}`).send({ ime: "Testna pica", kdsIzkljucen: true });
    expect(update.status, JSON.stringify(update.body)).toBe(200);
    expect(update.body.kdsIzkljucen).toBe(true);
    const list = await supertest(app).get("/artikli");
    expect(list.status).toBe(200);
    expect(list.body.find((a: any) => a.id === pizzaId).kdsIzkljucen).toBe(true);
    const unchanged = await supertest(app).put(`/artikli/${pizzaId}`).send({ ime: "Testna pica" });
    expect(unchanged.body.kdsIzkljucen).toBe(true);
    const invalid = await supertest(app).put(`/artikli/${pizzaId}`).send({ ime: "Testna pica", kdsIzkljucen: "false" });
    expect(invalid.status).toBe(400);
    const reset = await supertest(app).put(`/artikli/${pizzaId}`).send({ ime: "Testna pica", kdsIzkljucen: false });
    expect(reset.status).toBe(200);
    expect(reset.body.kdsIzkljucen).toBe(false);
  });
  it("ob spremembi To Go ignorira napačen tip iz odjemalca", async () => {
    const response = await supertest(app).put(`/artikli/${pizzaId}`).send({
      ime: "Testna pica",
      toGo: true,
      mealType: "ala_carte",
      normativUpdate: {
        expectedRevision: 1,
        items: [{ vhodniArtikelId: ingredientId, kolicina: 1 }],
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.mealType).toBe("composite");
    const [saved] = await db.select().from(artikliTable).where(eq(artikliTable.id, pizzaId));
    expect(saved?.mealType).toBe("composite");
    expect(saved?.toGo).toBe(true);
  });
});