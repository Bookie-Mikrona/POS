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
import { and, eq, inArray } from "drizzle-orm";
import { artikliTable, companiesTable, db, enoteTable, normativiTable, pool } from "@workspace/db";
import router from "./artikli";

const app = express();
app.use(express.json(), (req, _res, next) => { (req as any).enotaId = context.enotaId; next(); }, router);
const run = Math.random().toString(36).slice(2, 9);
let companyId: string;
let unitId: number;
let otherUnitId: number;
const sale = (ime: string, overrides: Record<string, unknown> = {}) => ({
  ime, cena: 3, davek: 22, taxCategory: "alcoholic", enotaMere: "kos",
  nabavniArtikel: false, prodajniArtikel: true, mealType: "ala_carte",
  normativItems: [], ...overrides,
});

async function purchase(ime: string, enotaMere: string | null = "LTR", enotaId = unitId, overrides: Record<string, unknown> = {}) {
  const [article] = await db.insert(artikliTable).values({
    enotaId, ime, enotaMere, cena: "0", davek: "22", taxCategory: "alcoholic",
    nabavniArtikel: true, prodajniArtikel: false, ...overrides,
  }).returning();
  return article;
}

async function normative(artikelId: number) {
  return db.select().from(normativiTable).where(eq(normativiTable.artikelId, artikelId));
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `AUTO_DRINK_${run}`, naziv: "Automatic drink norms",
  }).returning();
  companyId = company.id;
  const units = await db.insert(enoteTable).values([
    { companyId, ime: "Automatic drink norm unit" }, { companyId, ime: "Other drink norm unit" },
  ]).returning();
  [unitId, otherUnitId] = units.map(unit => unit.id);
  context.enotaId = unitId;
});

afterAll(async () => {
  if (unitId && otherUnitId) {
    const ids = (await db.select({ id: artikliTable.id }).from(artikliTable)
      .where(inArray(artikliTable.enotaId, [unitId, otherUnitId]))).map(article => article.id);
    if (ids.length) {
      await db.delete(normativiTable).where(inArray(normativiTable.artikelId, ids));
      await db.delete(artikliTable).where(inArray(artikliTable.id, ids));
    }
    await db.delete(enoteTable).where(inArray(enoteTable.id, [unitId, otherUnitId]));
  }
  if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("automatic drink normative creation", () => {
  it("creates a one-liter spirit input and shares it between 3 cl and 5 cl servings", async () => {
    const small = await supertest(app).post("/artikli").send(sale("Žganje 3 cl"));
    expect(small.status, JSON.stringify(small.body)).toBe(201);
    const [smallNorm] = await normative(small.body.id);
    expect(smallNorm.kolicina).toBe("0.0300");
    const [source] = await db.select().from(artikliTable).where(eq(artikliTable.id, smallNorm.vhodniArtikelId));
    expect(source).toMatchObject({
      ime: "Žganje 1 liter", enotaMere: "LTR", taxCategory: "alcoholic",
      nabavniArtikel: true, prodajniArtikel: false,
    });
    const large = await supertest(app).post("/artikli").send(sale("Žganje pet centilitrov"));
    expect(large.status, JSON.stringify(large.body)).toBe(201);
    expect((await normative(large.body.id))[0]).toMatchObject({
      vhodniArtikelId: source.id, kolicina: "0.0500",
    });
  });

  it("reuses the bare purchase name, assumes one liter, and exposes the persisted recipe", async () => {
    const source = await purchase("Dingač", "kos");
    const response = await supertest(app).post("/artikli").send(sale("Dingač en deciliter"));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.hasNormativ).toBe(true);
    expect(await normative(response.body.id)).toEqual([
      expect.objectContaining({ vhodniArtikelId: source.id, kolicina: "0.1000" }),
    ]);
    const detail = await supertest(app).get(`/artikli/${response.body.id}/normativi`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(JSON.stringify(detail.body)).toContain("Dingač");
  });

  it("uses the bottle volume when purchases are stocked in pieces", async () => {
    const source = await purchase("Rum 7,5 decilitrov", "kos");
    const response = await supertest(app).post("/artikli").send(sale("Rum 0,1 litra"));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await normative(response.body.id)).toEqual([
      expect.objectContaining({ vhodniArtikelId: source.id, kolicina: "0.1333" }),
    ]);
  });

  it("does not divide a liter-based stock quantity by the labelled bottle size", async () => {
    const source = await purchase("Vino 0,7 l", "l");
    const response = await supertest(app).post("/artikli").send(sale("Vino 1 dl"));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(await normative(response.body.id)).toEqual([
      expect.objectContaining({ vhodniArtikelId: source.id, kolicina: "0.1000" }),
    ]);
  });

  it("assumes one liter when a purchase name contains ambiguous volume information", async () => {
    const source = await purchase("Nejasna pijača 0,7 l / 0,75 l", "kos");
    const response = await supertest(app).post("/artikli").send(sale("Nejasna pijača en deciliter"));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await normative(response.body.id))[0]).toMatchObject({ vhodniArtikelId: source.id, kolicina: "0.1000" });
  });

  it("creates one-liter purchase stock with matching VAT metadata, in the same unit", async () => {
    await purchase("Sok 1 liter", "LTR", otherUnitId, { taxCategory: "cold_beverage" });
    const response = await supertest(app).post("/artikli").send(sale("Sok 200 ml", {
      taxCategory: "cold_beverage", addedSugar: true,
    }));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const [norm] = await normative(response.body.id);
    expect(norm.kolicina).toBe("0.2000");
    const [created] = await db.select().from(artikliTable).where(eq(artikliTable.id, norm.vhodniArtikelId));
    expect(created).toMatchObject({
      ime: "Sok 1 liter", enotaId: unitId, nabavniArtikel: true, prodajniArtikel: false,
      enotaMere: "LTR", taxCategory: "cold_beverage", addedSugar: true, davek: "22.00",
    });
    const again = await supertest(app).post("/artikli").send(sale("Sok 0,1 l", { taxCategory: "cold_beverage", addedSugar: true }));
    expect(again.status).toBe(201);
    expect((await normative(again.body.id))[0].vhodniArtikelId).toBe(created.id);
  });

  it("preserves the distinction between cold-drink sales VAT and purchase VAT", async () => {
    const response = await supertest(app).post("/artikli").send(sale("Mineralna voda 0,25 l", {
      taxCategory: "cold_beverage", addedSugar: false, davek: 9.5,
    }));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const [norm] = await normative(response.body.id);
    const [created] = await db.select().from(artikliTable).where(eq(artikliTable.id, norm.vhodniArtikelId));
    expect(created).toMatchObject({ taxCategory: "cold_beverage", addedSugar: false, davek: "9.50" });
  });

  it("does not replace an explicitly supplied normative", async () => {
    const manual = await purchase("Ročno izbran vhod");
    const response = await supertest(app).post("/artikli").send(sale("Ročna pijača 0,1 l", {
      normativItems: [{ vhodniArtikelId: manual.id, kolicina: 0.2 }],
    }));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await normative(response.body.id))[0]).toMatchObject({ vhodniArtikelId: manual.id, kolicina: "0.2000" });
  });

  it("does not apply to hot drinks, food, dual-role articles or names without volume", async () => {
    for (const data of [
      sale("Kava 0,1 l", { taxCategory: "hot_beverage" }),
      sale("Juha 0,1 l", { taxCategory: "food" }),
      sale("Pivo 0,5 l", { nabavniArtikel: true }),
      sale("Vino brez prostornine"),
    ]) {
      const response = await supertest(app).post("/artikli").send(data);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(response.body.hasNormativ).toBe(false);
      expect(await normative(response.body.id)).toHaveLength(0);
    }
  });

  it("does not choose between duplicate matching purchases or leave an orphan sale", async () => {
    await purchase("Več zadetkov 0,7 l");
    await purchase("Več zadetkov 0,75 l");
    const response = await supertest(app).post("/artikli").send(sale("Več zadetkov 0,1 l"));
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("AUTOMATIC_DRINK_NORMATIVE");
    const remaining = await db.select().from(artikliTable).where(and(
      eq(artikliTable.enotaId, unitId), eq(artikliTable.ime, "Več zadetkov 0,1 l"),
    ));
    expect(remaining).toHaveLength(0);
  });

  it("serializes simultaneous creates so they share one purchase source", async () => {
    const responses = await Promise.all(["0,1 l", "1 dl"].map(volume =>
      supertest(app).post("/artikli").send(sale(`Sočasna pijača ${volume}`))));
    for (const response of responses) expect(response.status, JSON.stringify(response.body)).toBe(201);
    const norms = await Promise.all(responses.map(response => normative(response.body.id)));
    expect(norms[0][0].vhodniArtikelId).toBe(norms[1][0].vhodniArtikelId);
    const sources = await db.select().from(artikliTable).where(and(
      eq(artikliTable.enotaId, unitId), eq(artikliTable.ime, "Sočasna pijača 1 liter"),
    ));
    expect(sources).toHaveLength(1);
  });
});