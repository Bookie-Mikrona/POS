/**
 * Integracijski testi: STM (costCenterId) na POS poslovnih enotah
 *
 * Pokrivajo:
 * 1. POST /enote z veljavnim costCenterId (istega podjetja) → 201 z costCenterId
 * 2. POST /enote s costCenterId tujega podjetja → 400
 * 3. PUT /enote/:id s costCenterId tujega podjetja → 400
 * 4. PUT /enote/:id brez costCenterId → 200 (obstoječe enote se ne zlomijo)
 * 5. PUT /enote/:id s costCenterId: null → 200 (odstranitev SM je dovoljena)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import express from "express";
import supertest from "supertest";

import {
  db,
  pool,
  companiesTable,
  costCentersTable,
  enoteTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import enoteRouter from "./enote";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let tujeCompanyId: string;
let costCenterId: string;
let tujiCostCenterId: string;
const createdEnotaIds: number[] = [];

/** Express app z injiciranim POS kontekstom (kot requirePosCompany middleware). */
function buildApp(cid: string, vloga: string = "admin") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).companyId = cid;
    (req as any).vloga = vloga;
    next();
  });
  app.use(enoteRouter);
  return app;
}

beforeAll(async () => {
  const [c] = await db
    .insert(companiesTable)
    .values({ podjetjeDavcna: `SI_TST_ENSTM_${RUN_ID}`, naziv: `Test enote STM ${RUN_ID}` })
    .returning({ id: companiesTable.id });
  companyId = c!.id;

  const [tc] = await db
    .insert(companiesTable)
    .values({ podjetjeDavcna: `SI_TST_ENSTM2_${RUN_ID}`, naziv: `Tuje podjetje ${RUN_ID}` })
    .returning({ id: companiesTable.id });
  tujeCompanyId = tc!.id;

  const [cc] = await db
    .insert(costCentersTable)
    .values({ companyId, code: `STM-${RUN_ID}`, name: `Testno SM ${RUN_ID}` })
    .returning({ id: costCentersTable.id });
  costCenterId = cc!.id;

  const [tcc] = await db
    .insert(costCentersTable)
    .values({ companyId: tujeCompanyId, code: `STM-T-${RUN_ID}`, name: `Tuje SM ${RUN_ID}` })
    .returning({ id: costCentersTable.id });
  tujiCostCenterId = tcc!.id;
});

afterAll(async () => {
  if (createdEnotaIds.length) {
    await db.delete(enoteTable).where(inArray(enoteTable.id, createdEnotaIds));
  }
  await db.delete(costCentersTable).where(inArray(costCentersTable.id, [costCenterId, tujiCostCenterId]));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, tujeCompanyId]));
  await pool.end();
});

describe("POST /enote — costCenterId", () => {
  it("veljaven costCenterId istega podjetja → 201 z costCenterId", async () => {
    const app = buildApp(companyId);
    const res = await supertest(app)
      .post("/")
      .send({ ime: `Enota STM ${RUN_ID}`, aktiven: true, costCenterId });
    expect(res.status).toBe(201);
    expect(res.body.costCenterId).toBe(costCenterId);
    const [stored] = await db
      .select({ costCenterId: enoteTable.costCenterId })
      .from(enoteTable)
      .where(eq(enoteTable.id, res.body.id));
    expect(stored?.costCenterId).toBe(costCenterId);
    createdEnotaIds.push(res.body.id);
  });

  it("costCenterId tujega podjetja → 400", async () => {
    const app = buildApp(companyId);
    const res = await supertest(app)
      .post("/")
      .send({ ime: `Enota tuja STM ${RUN_ID}`, aktiven: true, costCenterId: tujiCostCenterId });
    expect(res.status).toBe(400);
    expect(res.body.napaka).toBe("Stroškovno mesto ni iz tega podjetja");
  });

  it("brez costCenterId → 201 (nullable)", async () => {
    const app = buildApp(companyId);
    const res = await supertest(app)
      .post("/")
      .send({ ime: `Enota brez STM ${RUN_ID}`, aktiven: true });
    expect(res.status).toBe(201);
    expect(res.body.costCenterId).toBeNull();
    const [stored] = await db
      .select({ costCenterId: enoteTable.costCenterId })
      .from(enoteTable)
      .where(eq(enoteTable.id, res.body.id));
    expect(stored?.costCenterId).toBeNull();
    createdEnotaIds.push(res.body.id);
  });
});

describe("PUT /enote/:id — costCenterId", () => {
  it("costCenterId tujega podjetja → 400", async () => {
    const app = buildApp(companyId);
    const enotaId = createdEnotaIds[0];
    const res = await supertest(app)
      .put(`/${enotaId}`)
      .send({ costCenterId: tujiCostCenterId });
    expect(res.status).toBe(400);
    expect(res.body.napaka).toBe("Stroškovno mesto ni iz tega podjetja");
  });

  it("brez costCenterId → 200 (obstoječe enote nespremenjene)", async () => {
    const app = buildApp(companyId);
    const enotaId = createdEnotaIds[0];
    const res = await supertest(app)
      .put(`/${enotaId}`)
      .send({ ime: `Enota STM preimenovano ${RUN_ID}` });
    expect(res.status).toBe(200);
    expect(res.body.costCenterId).toBe(costCenterId); // ostane nespremenjeno
  });

  it("costCenterId: null → 200 (odstranitev SM)", async () => {
    const app = buildApp(companyId);
    const enotaId = createdEnotaIds[1];
    // najprej nastavi
    const set = await supertest(app).put(`/${enotaId}`).send({ costCenterId });
    expect(set.status).toBe(200);
    expect(set.body.costCenterId).toBe(costCenterId);
    // nato odstrani
    const res = await supertest(app).put(`/${enotaId}`).send({ costCenterId: null });
    expect(res.status).toBe(200);
    expect(res.body.costCenterId).toBeNull();
  });
});

describe("admin_enote — omejitve na API meji", () => {
  it("POST /enote kot admin_enote → 403 (ne sme ustvarjati)", async () => {
    const app = buildApp(companyId, "admin_enote");
    const res = await supertest(app)
      .post("/")
      .send({ ime: `Enota admin_enote ${RUN_ID}`, aktiven: true });
    expect(res.status).toBe(403);
    expect(res.body.napaka).toBe("Ustvarjanje enot zahteva vlogo admin");
  });

  it("DELETE /enote/:id kot admin_enote → 403 (ne sme brisati)", async () => {
    const app = buildApp(companyId, "admin_enote");
    const res = await supertest(app).delete(`/${createdEnotaIds[0]}`);
    expect(res.status).toBe(403);
    expect(res.body.napaka).toBe("Brisanje enot zahteva vlogo admin");
  });

  it("PUT /enote/:id kot admin_enote → 200 (urejanje dovoljeno)", async () => {
    const app = buildApp(companyId, "admin_enote");
    const res = await supertest(app)
      .put(`/${createdEnotaIds[0]}`)
      .send({ opis: `Uredil admin_enote ${RUN_ID}` });
    expect(res.status).toBe(200);
    expect(res.body.opis).toBe(`Uredil admin_enote ${RUN_ID}`);
  });

  it("admin_enote lahko omogoči in izklopi študentski bon za enoto", async () => {
    const app = buildApp(companyId, "admin_enote");
    const enotaId = createdEnotaIds[0];

    const enabled = await supertest(app)
      .put(`/${enotaId}`)
      .send({ studentskiBonAktiven: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.studentskiBonAktiven).toBe(true);

    const list = await supertest(app).get("/");
    expect(list.status).toBe(200);
    expect(list.body.find((enota: { id: number }) => enota.id === enotaId))
      .toMatchObject({ studentskiBonAktiven: true });
    expect(list.body.find((enota: { id: number }) => enota.id === createdEnotaIds[1]))
      .toMatchObject({ studentskiBonAktiven: false });

    const disabled = await supertest(app)
      .put(`/${enotaId}`)
      .send({ studentskiBonAktiven: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.studentskiBonAktiven).toBe(false);
  });

  it("PUT /enote/:id z admin vlogo brez costCenterId ostane 200 (regresija)", async () => {
    const app = buildApp(companyId, "admin");
    const res = await supertest(app)
      .put(`/${createdEnotaIds[0]}`)
      .send({ opis: `Uredil admin ${RUN_ID}` });
    expect(res.status).toBe(200);
  });

  it("shrani Wi-Fi AP in geslo, navadnemu uporabniku pa gesla ne razkrije", async () => {
    const enotaId = createdEnotaIds[0];
    const adminApp = buildApp(companyId, "admin_enote");
    const saved = await supertest(adminApp)
      .put(`/${enotaId}`)
      .send({ qrWifiSsid: "Gostilna-Gosti", qrWifiPassword: "DoberTek2026" });

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      qrWifiSsid: "Gostilna-Gosti",
      qrWifiPassword: "DoberTek2026",
    });

    const adminList = await supertest(adminApp).get("/");
    expect(adminList.status).toBe(200);
    expect(adminList.body.find((enota: { id: number }) => enota.id === enotaId)).toMatchObject({
      qrWifiSsid: "Gostilna-Gosti",
      qrWifiPassword: "DoberTek2026",
    });

    const uporabnikList = await supertest(buildApp(companyId, "uporabnik")).get("/");
    expect(uporabnikList.status).toBe(200);
    const uporabnikovaEnota = uporabnikList.body.find((enota: { id: number }) => enota.id === enotaId);
    expect(uporabnikovaEnota.qrWifiSsid).toBe("Gostilna-Gosti");
    expect(uporabnikovaEnota).not.toHaveProperty("qrWifiPassword");
  });

  it("zavrne predolgo ime ali geslo Wi-Fi omrežja", async () => {
    const app = buildApp(companyId, "admin");
    const enotaId = createdEnotaIds[0];

    const predolgSsid = await supertest(app)
      .put(`/${enotaId}`)
      .send({ qrWifiSsid: "S".repeat(65) });
    expect(predolgSsid.status).toBe(400);
    expect(predolgSsid.body.napaka).toContain("največ 64");

    const predolgoGeslo = await supertest(app)
      .put(`/${enotaId}`)
      .send({ qrWifiPassword: "G".repeat(129) });
    expect(predolgoGeslo.status).toBe(400);
    expect(predolgoGeslo.body.napaka).toContain("največ 128");
  });

  it("navadnemu uporabniku ne dovoli urejanja enote ali razkritja Wi-Fi gesla", async () => {
    const enotaId = createdEnotaIds[0];
    const response = await supertest(buildApp(companyId, "uporabnik"))
      .put(`/${enotaId}`)
      .send({ qrWifiSsid: "Nedovoljena-sprememba", qrWifiPassword: "NeSmeBitiVrnjeno" });

    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty("qrWifiPassword");

    const [row] = await db
      .select({
        qrWifiSsid: enoteTable.qrWifiSsid,
        qrWifiPassword: enoteTable.qrWifiPassword,
      })
      .from(enoteTable)
      .where(eq(enoteTable.id, enotaId));
    expect(row).toMatchObject({
      qrWifiSsid: "Gostilna-Gosti",
      qrWifiPassword: "DoberTek2026",
    });
  });
});
