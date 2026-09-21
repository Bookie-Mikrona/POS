/**
 * Integracijski testi: canonical POS /partnerji rute + legacy /kupec/shranjeni aliasi
 *
 * Pokrivajo:
 * 1. GET /partnerji — seznam partnerjev podjetja (samo aktivni, iz counterparties)
 * 2. POST /partnerji — ustvari partnerja v skupni tabeli counterparties
 * 3. PUT /partnerji/:id — posodobi partnerja
 * 4. DELETE /partnerji/:id — soft-delete (isActive=false)
 * 5. Legacy alias GET /kupec/shranjeni vrne iste podatke
 * 6. Resolver: POS uporabnik svojega podjetja sme brati/pisati
 * 7. Resolver: uporabnik brez vloge v podjetju dobi 403
 * 8. Cenik: PUT + GET + DELETE /partnerji/:id/cenik/:artikelId
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import express from "express";
import supertest from "supertest";

import {
  db,
  pool,
  companiesTable,
  counterpartiesTable,
  posUporabnikiTable,
  enoteTable,
  artikliTable,
  partnerCenikiTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import kupecRouter from "./kupec";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const POS_USER = `test-partnerji-${RUN_ID}`;
const TUJI_USER = `test-partnerji-tuji-${RUN_ID}`;

let companyId: string;
let enotaId: number;
let artikelId: number;
let drugoPodjetjeId: string;
let drugaEnotaId: number;
let tujArtikelId: number;
const createdCounterpartyIds: string[] = [];

/** Express app z injiciranim POS kontekstom (kot requireEnota middleware). */
function buildApp(clerkUserId: string, cid: string, eid: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).clerkUserId = clerkUserId;
    (req as any).companyId = cid;
    (req as any).enotaId = eid;
    next();
  });
  app.use(kupecRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status ?? err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

beforeAll(async () => {
  const [c] = await db
    .insert(companiesTable)
    .values({ podjetjeDavcna: `SI_TST_PART_${RUN_ID}`, naziv: `Test partnerji ${RUN_ID}` })
    .returning({ id: companiesTable.id });
  companyId = c!.id;

  const [enota] = await db
    .insert(enoteTable)
    .values({ companyId, ime: `Enota ${RUN_ID}` })
    .returning({ id: enoteTable.id });
  enotaId = enota!.id;

  // POS uporabnik z vlogo admin — resolver mu mora dati write dostop do partnerjev
  await db.insert(posUporabnikiTable).values({
    clerkUserId: POS_USER,
    companyId,
    vloga: "admin",
    ime: "Test",
    priimek: "Partnerji",
  });

  // Artikel za cenik teste
  const [art] = await db
    .insert(artikliTable)
    .values({ enotaId, ime: `Cenik artikel ${RUN_ID}`, cena: "10.00", davek: "22", vrstniRed: 1 })
    .returning({ id: artikliTable.id });
  artikelId = art!.id;

  const [drugoPodjetje] = await db
    .insert(companiesTable)
    .values({ podjetjeDavcna: `SI_TST_PART_X_${RUN_ID}`, naziv: `Drugo podjetje ${RUN_ID}` })
    .returning({ id: companiesTable.id });
  drugoPodjetjeId = drugoPodjetje!.id;

  const [drugaEnota] = await db
    .insert(enoteTable)
    .values({ companyId: drugoPodjetjeId, ime: `Druga enota ${RUN_ID}` })
    .returning({ id: enoteTable.id });
  drugaEnotaId = drugaEnota!.id;

  const [tujArtikel] = await db
    .insert(artikliTable)
    .values({ enotaId: drugaEnotaId, ime: `Tuj cenik artikel ${RUN_ID}`, cena: "12.00", davek: "22", vrstniRed: 1 })
    .returning({ id: artikliTable.id });
  tujArtikelId = tujArtikel!.id;
});

afterAll(async () => {
  if (createdCounterpartyIds.length) {
    await db.delete(partnerCenikiTable).where(inArray(partnerCenikiTable.kupecId, createdCounterpartyIds));
    await db.delete(counterpartiesTable).where(inArray(counterpartiesTable.id, createdCounterpartyIds));
  }
  await db.delete(artikliTable).where(inArray(artikliTable.id, [artikelId, tujArtikelId]));
  await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.clerkUserId, POS_USER));
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaId, drugaEnotaId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, drugoPodjetjeId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("canonical /partnerji", () => {
  it("POST /partnerji ustvari partnerja v counterparties; GET ga vrne", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(app)
      .post("/partnerji")
      .send({ naziv: `Partner A ${RUN_ID}`, davcnaStevilka: "11111111", zavezanecDdv: true });
    expect(create.status).toBe(201);
    expect(typeof create.body.id).toBe("string"); // UUID iz counterparties
    createdCounterpartyIds.push(create.body.id);

    // preveri, da je res v skupni tabeli
    const [row] = await db
      .select()
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, create.body.id));
    expect(row).toBeDefined();
    expect(row!.companyId).toBe(companyId);
    expect(row!.name).toBe(`Partner A ${RUN_ID}`);

    const list = await supertest(app).get("/partnerji");
    expect(list.status).toBe(200);
    expect(list.body.some((k: any) => k.id === create.body.id)).toBe(true);
  });

  it("PUT /partnerji/:id posodobi partnerja", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(app)
      .post("/partnerji")
      .send({ naziv: `Partner B ${RUN_ID}` });
    expect(create.status).toBe(201);
    createdCounterpartyIds.push(create.body.id);

    const update = await supertest(app)
      .put(`/partnerji/${create.body.id}`)
      .send({ naziv: `Partner B2 ${RUN_ID}`, email: "b@example.com" });
    expect(update.status).toBe(200);
    expect(update.body.naziv).toBe(`Partner B2 ${RUN_ID}`);
    expect(update.body.email).toBe("b@example.com");
  });

  it("DELETE /partnerji/:id naredi soft-delete (isActive=false), seznam ga več ne vrne", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(app)
      .post("/partnerji")
      .send({ naziv: `Partner C ${RUN_ID}` });
    createdCounterpartyIds.push(create.body.id);

    const del = await supertest(app).delete(`/partnerji/${create.body.id}`);
    expect(del.status).toBe(204);

    const [row] = await db
      .select({ isActive: counterpartiesTable.isActive })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, create.body.id));
    expect(row!.isActive).toBe(false);

    const list = await supertest(app).get("/partnerji");
    expect(list.body.some((k: any) => k.id === create.body.id)).toBe(false);
  });

  it("uporabnik brez vloge v podjetju dobi 403", async () => {
    const app = buildApp(TUJI_USER, companyId, enotaId);
    const r = await supertest(app).get("/partnerji");
    expect(r.status).toBe(403);
  });

  it("PUT /partnerji/:id za partnerja drugega podjetja vrne 404", async () => {
    // partner v testnem podjetju, klic iz DRUGEGA podjetja
    const appMoje = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(appMoje)
      .post("/partnerji")
      .send({ naziv: `Partner D ${RUN_ID}` });
    createdCounterpartyIds.push(create.body.id);

    const [c2] = await db
      .insert(companiesTable)
      .values({ podjetjeDavcna: `SI_TST_PART2_${RUN_ID}`, naziv: "Drugo podjetje" })
      .returning({ id: companiesTable.id });
    await db.insert(posUporabnikiTable).values({
      clerkUserId: `${POS_USER}-c2`,
      companyId: c2!.id,
      vloga: "admin",
      ime: "T",
      priimek: "C2",
    });
    try {
      const appDrugo = buildApp(`${POS_USER}-c2`, c2!.id, enotaId);
      const upd = await supertest(appDrugo)
        .put(`/partnerji/${create.body.id}`)
        .send({ naziv: "Hack" });
      expect(upd.status).toBe(404);
    } finally {
      await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.clerkUserId, `${POS_USER}-c2`));
      await db.delete(companiesTable).where(eq(companiesTable.id, c2!.id));
    }
  });
});

describe("legacy alias /kupec/shranjeni", () => {
  it("GET /kupec/shranjeni vrne iste partnerje kot /partnerji", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const canonical = await supertest(app).get("/partnerji");
    const legacy = await supertest(app).get("/kupec/shranjeni");
    expect(legacy.status).toBe(200);
    expect(legacy.body.map((k: any) => k.id).sort()).toEqual(
      canonical.body.map((k: any) => k.id).sort(),
    );
  });

  it("POST /kupec/shranjeni še vedno ustvari partnerja v counterparties", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(app)
      .post("/kupec/shranjeni")
      .send({ naziv: `Legacy partner ${RUN_ID}` });
    expect(create.status).toBe(201);
    createdCounterpartyIds.push(create.body.id);

    const [row] = await db
      .select({ name: counterpartiesTable.name })
      .from(counterpartiesTable)
      .where(eq(counterpartiesTable.id, create.body.id));
    expect(row!.name).toBe(`Legacy partner ${RUN_ID}`);
  });
});

describe("canonical cenik /partnerji/:id/cenik", () => {
  it("PUT nastavi ceno, GET jo vrne, DELETE jo odstrani", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(app)
      .post("/partnerji")
      .send({ naziv: `Cenik partner ${RUN_ID}` });
    createdCounterpartyIds.push(create.body.id);
    const pid = create.body.id;

    const put = await supertest(app)
      .put(`/partnerji/${pid}/cenik/${artikelId}`)
      .send({ cena: 8.5 });
    expect(put.status).toBe(200);
    expect(put.body.cena).toBe(8.5);
    expect(put.body.artikelId).toBe(artikelId);

    const get = await supertest(app).get(`/partnerji/${pid}/cenik`);
    expect(get.status).toBe(200);
    expect(get.body.length).toBe(1);
    expect(Number(get.body[0].cena)).toBe(8.5);

    const del = await supertest(app).delete(`/partnerji/${pid}/cenik/${artikelId}`);
    expect(del.status).toBe(204);

    const get2 = await supertest(app).get(`/partnerji/${pid}/cenik`);
    expect(get2.body.length).toBe(0);
  });

  it("PUT z negativno ceno vrne 400", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(app)
      .post("/partnerji")
      .send({ naziv: `Cenik partner 2 ${RUN_ID}` });
    createdCounterpartyIds.push(create.body.id);
    const r = await supertest(app)
      .put(`/partnerji/${create.body.id}/cenik/${artikelId}`)
      .send({ cena: -1 });
    expect(r.status).toBe(400);
  });

  it("zavrne tuj artikel in ga tudi ob obstoječi zlonamerni povezavi ne razkrije ali izbriše", async () => {
    const app = buildApp(POS_USER, companyId, enotaId);
    const create = await supertest(app)
      .post("/partnerji")
      .send({ naziv: `Cenik izolacija ${RUN_ID}` });
    expect(create.status).toBe(201);
    createdCounterpartyIds.push(create.body.id);
    const partnerId = create.body.id;

    const put = await supertest(app)
      .put(`/partnerji/${partnerId}/cenik/${tujArtikelId}`)
      .send({ cena: 9.5 });
    expect(put.status).toBe(404);

    // Simulira obstoječo zgodovinsko poškodovano povezavo, ki jo GET ne sme
    // razkriti in DELETE iz konteksta prvega podjetja ne sme upravljati.
    await db.insert(partnerCenikiTable).values({
      enotaId,
      kupecId: partnerId,
      artikelId: tujArtikelId,
      cena: "9.50",
    });

    const get = await supertest(app).get(`/partnerji/${partnerId}/cenik`);
    expect(get.status).toBe(200);
    expect(get.body).toEqual([]);

    const del = await supertest(app).delete(`/partnerji/${partnerId}/cenik/${tujArtikelId}`);
    expect(del.status).toBe(404);

    const [stillLinked] = await db
      .select({ id: partnerCenikiTable.id })
      .from(partnerCenikiTable)
      .where(and(eq(partnerCenikiTable.kupecId, partnerId), eq(partnerCenikiTable.artikelId, tujArtikelId)));
    expect(stillLinked).toBeDefined();
  });
});
