import { afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, enoteTable, narocilaTable } from "@workspace/db";
import narocilaRouter from "./narocila";

let enotaId: number;
const narociloIds: number[] = [];

function app() {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    next();
  });
  result.use(narocilaRouter);
  return result;
}

beforeAll(async () => {
  const [enota] = await db.select({ id: enoteTable.id }).from(enoteTable).orderBy(enoteTable.id).limit(1);
  if (!enota) throw new Error("Testna baza nima POS enote");
  enotaId = enota.id;
});

afterEach(async () => {
  for (const id of narociloIds.splice(0)) {
    await db.delete(narocilaTable).where(eq(narocilaTable.id, id));
  }
});

describe("GET /narocila/aktivna — zaključena dostava", () => {
  it("preklicane in dostavljene dostave ne vrne, odprti prevzem pa ostane aktiven", async () => {
    const vstavljeni = await db.insert(narocilaTable).values([
      {
        enotaId,
        nacin: "telefon",
        nacinIzpolnitve: "dostava",
        status: "odprto",
        dostavaStatus: "preklicano",
        skupaj: "0",
      },
      {
        enotaId,
        nacin: "telefon",
        nacinIzpolnitve: "dostava",
        status: "odprto",
        dostavaStatus: "dostavljeno",
        skupaj: "0",
      },
      {
        enotaId,
        nacin: "telefon",
        nacinIzpolnitve: "prevzem",
        status: "odprto",
        dostavaStatus: null,
        skupaj: "0",
      },
    ]).returning({ id: narocilaTable.id });
    narociloIds.push(...vstavljeni.map((narocilo) => narocilo.id));

    const response = await request(app()).get("/narocila/aktivna");
    expect(response.status).toBe(200);

    const ids = response.body.map((narocilo: { id: number }) => narocilo.id);
    expect(ids).not.toContain(vstavljeni[0]!.id);
    expect(ids).not.toContain(vstavljeni[1]!.id);
    expect(ids).toContain(vstavljeni[2]!.id);
  });
});