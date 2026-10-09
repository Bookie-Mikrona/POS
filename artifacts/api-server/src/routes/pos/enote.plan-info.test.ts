import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, companiesTable, companyPosPlansTable, enoteTable, HOSPITALITY_PROFILE_DEFAULTS } from "@workspace/db";
import enoteRouter from "./enote";
import { CreateEnotaResponse, ListEnoteResponseItem, UpdateEnotaResponse } from "@workspace/api-zod";

const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
const companyIds: string[] = [];
const unitIds: number[] = [];

function app(companyId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { companyId, vloga: "admin" });
    next();
  });
  app.use(enoteRouter);
  return app;
}

beforeAll(async () => {
  const rows = await db.insert(companiesTable).values(
    ["lite", "standard", "extended"].map((plan, i) => ({
      naziv: `Paket enote ${plan} ${suffix}`, podjetjeDavcna: `PLI${i}${suffix}`,
    })),
  ).returning({ id: companiesTable.id });
  companyIds.push(...rows.map(row => row.id));
  await db.insert(companyPosPlansTable).values([
    { companyId: companyIds[1]!, plan: "standard", enabledBy: "test" },
    { companyId: companyIds[2]!, plan: "extended", enabledBy: "test" },
  ]);
});

afterAll(async () => {
  if (unitIds.length) await db.delete(enoteTable).where(inArray(enoteTable.id, unitIds));
  if (companyIds.length) await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
});

describe("informativni POS paket v odgovorih enot", () => {
  it.each([
    [0, "lite", ["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "delivery", "phone_orders", "qr_menu"]],
    [1, "standard", ["reservations", "delivery", "qr_menu"]],
    [2, "extended", []],
  ] as const)("GET/POST/PUT za podjetje %i vrne paket %s in pravilne blokade", async (index, plan, blocked) => {
    const companyId = companyIds[index]!;
    const api = app(companyId);
    const created = await request(api).post("/").send({
      ime: `Restavracija ${suffix}`, hospitalityProfile: "restaurant",
    });
    expect(created.status).toBe(201);
    unitIds.push(created.body.id);
    const listed = await request(api).get("/");
    const edited = await request(api).put(`/${created.body.id}`).send({ opis: "Nov opis" });
    expect(listed.status).toBe(200);
    expect(edited.status).toBe(200);
    const listedUnit = listed.body.find((row: { id: number }) => row.id === created.body.id);
    for (const unit of [
      CreateEnotaResponse.parse(created.body),
      ListEnoteResponseItem.parse(listedUnit),
      UpdateEnotaResponse.parse(edited.body),
    ]) {
      expect(unit.posPaket).toBe(plan);
      expect(unit.blockedByPlan).toEqual([...blocked]);
      expect(unit.capabilities).toEqual(HOSPITALITY_PROFILE_DEFAULTS.restaurant.capabilities);
    }
    const [stored] = await db.select().from(enoteTable).where(eq(enoteTable.id, created.body.id));
    expect(stored!.capabilities).toEqual(HOSPITALITY_PROFILE_DEFAULTS.restaurant.capabilities);
  });
});
