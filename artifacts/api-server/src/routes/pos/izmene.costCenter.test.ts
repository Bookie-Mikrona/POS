/**
 * Integracijski testi: snapshot stroškovnega mesta ob odprtju POS izmene.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  blagajneTable,
  companiesTable,
  costCentersTable,
  db,
  enoteTable,
  izmeneTable,
  narocilaTable,
  natakariTable,
  pool,
} from "@workspace/db";
import izmeneRouter, { splitShiftByLjubljanaCalendarDays } from "./izmene";
import { getCurrentPosBusinessDate, getBusinessDayBounds } from "../../lib/pos-business-day";
import { getSimDatumOrNow } from "../../lib/sim-datum";
import { hashPosPin } from "../../lib/posPin";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const LINKED_CLERK_ID = `clerk-izmena-${RUN_ID}`;
const originalActorSecret = process.env.POS_ACTOR_SESSION_SECRET;

let companyId: string;
let costCenterId: string;
let historyCostCenterId: string;
let natakariId: number;
let drugiNatakariId: number;
let enotaSStroskovnimMestomId: number;
let enotaBrezStroskovnegaMestaId: number;
const createdIzmenaIds: number[] = [];

function buildApp(enotaId: number, vloga = "admin", actorNatakarId?: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).companyId = companyId;
    (req as any).enotaId = enotaId;
    (req as any).vloga = vloga;
    (req as any).clerkUserId = LINKED_CLERK_ID;
    (req as any).posActorNatakarId = actorNatakarId;
    next();
  });
  app.use(izmeneRouter);
  return app;
}

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_TST_IZMENE_STM_${RUN_ID}`,
      naziv: `Test izmene STM ${RUN_ID}`,
    })
    .returning({ id: companiesTable.id });
  companyId = company!.id;

  const [costCenter] = await db
    .insert(costCentersTable)
    .values({ companyId, code: `STM-IZM-${RUN_ID}`, name: `Testno SM izmene ${RUN_ID}` })
    .returning({ id: costCentersTable.id });
  costCenterId = costCenter!.id;

  const [historyCostCenter] = await db
    .insert(costCentersTable)
    .values({ companyId, code: `STM-ZGO-${RUN_ID}`, name: `Zgodovinsko SM ${RUN_ID}` })
    .returning({ id: costCentersTable.id });
  historyCostCenterId = historyCostCenter!.id;

  const [enotaSStroskovnimMestom] = await db
    .insert(enoteTable)
    .values({
      companyId,
      ime: `Enota s STM ${RUN_ID}`,
      costCenterId,
    })
    .returning({ id: enoteTable.id });
  enotaSStroskovnimMestomId = enotaSStroskovnimMestom!.id;

  const [enotaBrezStroskovnegaMesta] = await db
    .insert(enoteTable)
    .values({ companyId, ime: `Enota brez STM ${RUN_ID}` })
    .returning({ id: enoteTable.id });
  enotaBrezStroskovnegaMestaId = enotaBrezStroskovnegaMesta!.id;

  const [natakar] = await db
    .insert(natakariTable)
    .values({ companyId, ime: "Test", priimek: `Natakar ${RUN_ID}` })
    .returning({ id: natakariTable.id });
  natakariId = natakar!.id;

  const [drugiNatakar] = await db
    .insert(natakariTable)
    .values({ companyId, ime: "Drugi", priimek: `Natakar ${RUN_ID}` })
    .returning({ id: natakariTable.id });
  drugiNatakariId = drugiNatakar!.id;
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM pos_actor_audit WHERE enota_id IN (${enotaSStroskovnimMestomId}, ${enotaBrezStroskovnegaMestaId})`);
  if (createdIzmenaIds.length) {
    await db.delete(izmeneTable).where(inArray(izmeneTable.id, createdIzmenaIds));
  }
  await db.delete(natakariTable).where(inArray(natakariTable.id, [natakariId, drugiNatakariId]));
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaSStroskovnimMestomId, enotaBrezStroskovnegaMestaId]));
  await db.delete(costCentersTable).where(inArray(costCentersTable.id, [costCenterId, historyCostCenterId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  if (originalActorSecret === undefined) delete process.env.POS_ACTOR_SESSION_SECRET;
  else process.env.POS_ACTOR_SESSION_SECRET = originalActorSecret;
  await pool.end();
});

describe("POST /izmene — snapshot stroškovnega mesta", () => {
  it("enota s stroškovnim mestom ga shrani na izmeno", async () => {
    const response = await supertest(buildApp(enotaSStroskovnimMestomId))
      .post("/izmene")
      .send({ natakariId });

    expect(response.status).toBe(201);
    expect(response.body.costCenterId).toBe(costCenterId);
    expect(response.body.warning).toBeNull();
    createdIzmenaIds.push(response.body.id);

    const [izmena] = await db
      .select({ costCenterId: izmeneTable.costCenterId })
      .from(izmeneTable)
      .where(eq(izmeneTable.id, response.body.id));
    expect(izmena?.costCenterId).toBe(costCenterId);
  });

  it("enota brez stroškovnega mesta odpre izmeno z opozorilom", async () => {
    const response = await supertest(buildApp(enotaBrezStroskovnegaMestaId))
      .post("/izmene")
      .send({ natakariId });

    expect(response.status).toBe(201);
    expect(response.body.costCenterId).toBeNull();
    expect(response.body.warning).toBe("Poslovna enota nima nastavljenega stroškovnega mesta.");
    createdIzmenaIds.push(response.body.id);

    const [izmena] = await db
      .select({ costCenterId: izmeneTable.costCenterId })
      .from(izmeneTable)
      .where(eq(izmeneTable.id, response.body.id));
    expect(izmena?.costCenterId).toBeNull();
  });

  it("osebni tok odprtja izmene v istem odgovoru izda actor sejo tudi pri skupnem POS računu", async () => {
    process.env.POS_ACTOR_SESSION_SECRET = "linked-shift-actor-test-secret";
    await db.update(natakariTable)
      .set({ posPinHash: hashPosPin("2468"), posPinFailedAttempts: 0, posPinLockedUntil: null })
      .where(eq(natakariTable.id, drugiNatakariId));
    const response = await supertest(buildApp(enotaSStroskovnimMestomId, "uporabnik"))
      .post("/izmene")
      .send({ natakariId: drugiNatakariId, aktivirajNatakarja: true, pin: "2468" });

    expect(response.status).toBe(201);
    createdIzmenaIds.push(response.body.id);
    expect(response.body.actorSession).toMatchObject({
      natakarId: drugiNatakariId,
      izmenaId: response.body.id,
    });
    const encoded = String(response.body.actorSession.token).split(".")[0]!;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    expect(payload).toMatchObject({
      n: drugiNatakariId,
      s: response.body.id,
      u: enotaSStroskovnimMestomId,
      c: companyId,
    });
    await db.delete(izmeneTable).where(eq(izmeneTable.id, response.body.id));
  });

  it("pri mojaIzmena uporabi natakarja iz actor seje in ignorira poslani ID", async () => {
    const response = await supertest(buildApp(enotaSStroskovnimMestomId, "admin", drugiNatakariId))
      .post("/izmene")
      .send({ mojaIzmena: true, natakariId });

    expect(response.status).toBe(201);
    expect(response.body.natakariId).toBe(drugiNatakariId);
    await db.delete(izmeneTable).where(eq(izmeneTable.id, response.body.id));
  });

  it("lastne izmene ne odpre brez actor seje", async () => {
    const response = await supertest(buildApp(enotaSStroskovnimMestomId))
      .post("/izmene")
      .send({ mojaIzmena: true });

    expect(response.status).toBe(401);
  });

  it("ne odpre današnje izmene, dokler prejšnji poslovni dan nima Z-poročila", async () => {
    const now = await getSimDatumOrNow(enotaSStroskovnimMestomId);
    const currentBusinessDate = await getCurrentPosBusinessDate(enotaSStroskovnimMestomId, now, db);
    const previousBusinessDate = new Date(`${currentBusinessDate}T12:00:00.000Z`);
    previousBusinessDate.setUTCDate(previousBusinessDate.getUTCDate() - 1);
    const previousDate = previousBusinessDate.toISOString().slice(0, 10);
    const bounds = await getBusinessDayBounds(enotaSStroskovnimMestomId, previousDate, db);

    const [register] = await db.insert(blagajneTable).values({
      enotaId: enotaSStroskovnimMestomId,
      ppId: `PREV-Z-PP-${RUN_ID}`,
      bId: `PREV-Z-B-${RUN_ID}`,
      ime: `Blagajna brez Z ${RUN_ID}`,
      aktivna: true,
    }).returning({ id: blagajneTable.id });
    const [order] = await db.insert(narocilaTable).values({
      enotaId: enotaSStroskovnimMestomId,
      status: "zakljuceno",
      skupaj: "0",
      ustvarjeno: new Date(bounds.start.getTime() + 60_000),
    }).returning({ id: narocilaTable.id });

    try {
      const response = await supertest(buildApp(enotaSStroskovnimMestomId))
        .post("/izmene")
        .send({ natakariId: drugiNatakariId });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        code: "PREJSNJI_POSLOVNI_DAN_NI_ZAKLJUCEN",
        previousBusinessDate: previousDate,
        missingRegisters: [{ id: register!.id, name: `Blagajna brez Z ${RUN_ID}` }],
      });
      const [created] = await db.select({ id: izmeneTable.id }).from(izmeneTable)
        .where(and(eq(izmeneTable.natakariId, drugiNatakariId), eq(izmeneTable.enotaId, enotaSStroskovnimMestomId)));
      expect(created).toBeUndefined();
    } finally {
      await db.delete(narocilaTable).where(eq(narocilaTable.id, order!.id));
      await db.delete(blagajneTable).where(eq(blagajneTable.id, register!.id));
    }
  });
});

describe("GET /izmene/obracun-ur", () => {
  it("agregira samo zaprte izmene po snapshotu SM in posebej prikaže Brez SM", async () => {
    const [prva, druga, brezSm, odprta] = await db
      .insert(izmeneTable)
      .values([
        {
          enotaId: enotaSStroskovnimMestomId,
          natakariId,
          costCenterId: historyCostCenterId,
          zacetek: new Date("2026-08-14T08:00:00.000Z"),
          konec: new Date("2026-08-14T11:30:00.000Z"),
        },
        {
          enotaId: enotaSStroskovnimMestomId,
          natakariId,
          costCenterId: historyCostCenterId,
          zacetek: new Date("2026-08-14T12:00:00.000Z"),
          konec: new Date("2026-08-14T14:15:00.000Z"),
        },
        {
          enotaId: enotaSStroskovnimMestomId,
          natakariId: drugiNatakariId,
          costCenterId: null,
          zacetek: new Date("2026-08-15T09:00:00.000Z"),
          konec: new Date("2026-08-15T10:30:00.000Z"),
        },
        {
          enotaId: enotaSStroskovnimMestomId,
          natakariId,
          costCenterId: historyCostCenterId,
          zacetek: new Date("2026-08-16T09:00:00.000Z"),
          konec: null,
        },
      ])
      .returning({ id: izmeneTable.id });
    createdIzmenaIds.push(prva!.id, druga!.id, brezSm!.id, odprta!.id);

    const response = await supertest(buildApp(enotaSStroskovnimMestomId))
      .get("/izmene/obracun-ur?od=2026-08-01&do=2026-08-31");

    expect(response.status).toBe(200);
    expect(response.body.skupajUr).toBe(7.25);
    expect(response.body.vrstice).toHaveLength(3);

    const historyGroup = response.body.skupine.find((group: any) => group.costCenterId === historyCostCenterId);
    expect(historyGroup).toMatchObject({
      natakariId,
      enotaId: enotaSStroskovnimMestomId,
      smKoda: `STM-ZGO-${RUN_ID}`,
      steviloIzmen: 2,
      skupajUr: 5.75,
    });
    expect(historyGroup.costCenterId).not.toBe(costCenterId);

    const noCostCenterGroup = response.body.skupine.find((group: any) => group.costCenterId === null);
    expect(noCostCenterGroup).toMatchObject({
      natakariId: drugiNatakariId,
      smNaziv: "Brez SM",
      steviloIzmen: 1,
      skupajUr: 1.5,
    });
    expect(response.body.poSM).toEqual(expect.arrayContaining([
      expect.objectContaining({ costCenterId: historyCostCenterId, ur: 5.75, steviloIzmen: 2 }),
      expect.objectContaining({ costCenterId: null, sm: "Brez SM", ur: 1.5, steviloIzmen: 1 }),
    ]));
  });

  it("zavrne uporabnika brez administratorske POS vloge", async () => {
    const response = await supertest(buildApp(enotaSStroskovnimMestomId, "uporabnik"))
      .get("/izmene/obracun-ur?od=2026-08-01&do=2026-08-31");

    expect(response.status).toBe(403);
  });

  it("izmeno čez mejo meseca razdeli med lokalna koledarska dneva", async () => {
    const [izmena] = await db
      .insert(izmeneTable)
      .values({
        enotaId: enotaSStroskovnimMestomId,
        natakariId,
        costCenterId: historyCostCenterId,
        // 31. 8. 22:00–1. 9. 06:00 po poletnem času v Ljubljani.
        zacetek: new Date("2026-08-31T20:00:00.000Z"),
        konec: new Date("2026-09-01T04:00:00.000Z"),
      })
      .returning({ id: izmeneTable.id });
    createdIzmenaIds.push(izmena!.id);

    const [avgust, september] = await Promise.all([
      supertest(buildApp(enotaSStroskovnimMestomId))
        .get("/izmene/obracun-ur?od=2026-08-01&do=2026-08-31"),
      supertest(buildApp(enotaSStroskovnimMestomId))
        .get("/izmene/obracun-ur?od=2026-09-01&do=2026-09-30"),
    ]);

    expect(avgust.status).toBe(200);
    expect(september.status).toBe(200);
    expect(avgust.body.vrstice).toContainEqual(expect.objectContaining({
      izmenaId: izmena!.id,
      datum: "2026-08-31",
      zacetek: "2026-08-31T20:00:00.000Z",
      konec: "2026-08-31T22:00:00.000Z",
      ureTrajanja: 2,
    }));
    expect(september.body.vrstice).toContainEqual(expect.objectContaining({
      izmenaId: izmena!.id,
      datum: "2026-09-01",
      zacetek: "2026-08-31T22:00:00.000Z",
      konec: "2026-09-01T04:00:00.000Z",
      ureTrajanja: 6,
    }));
    expect(september.body.skupine).toContainEqual(expect.objectContaining({
      steviloIzmen: 1,
      skupajUr: 6,
    }));
    expect(september.body.poSM).toContainEqual(expect.objectContaining({
      steviloIzmen: 1,
      ur: 6,
    }));
  });

  it("ob premiku ure upošteva dejansko pretečeni čas tudi skozi API", async () => {
    const [pomladnaIzmena, jesenskaIzmena] = await db
      .insert(izmeneTable)
      .values([
        {
          enotaId: enotaSStroskovnimMestomId,
          natakariId,
          costCenterId: historyCostCenterId,
          zacetek: new Date("2026-03-28T23:00:00.000Z"),
          konec: new Date("2026-03-29T03:00:00.000Z"),
        },
        {
          enotaId: enotaSStroskovnimMestomId,
          natakariId,
          costCenterId: historyCostCenterId,
          zacetek: new Date("2026-10-24T22:00:00.000Z"),
          konec: new Date("2026-10-25T04:00:00.000Z"),
        },
      ])
      .returning({ id: izmeneTable.id });
    createdIzmenaIds.push(pomladnaIzmena!.id, jesenskaIzmena!.id);

    const pomlad = splitShiftByLjubljanaCalendarDays(
      new Date("2026-03-28T23:00:00.000Z"),
      new Date("2026-03-29T03:00:00.000Z"),
      "2026-03-29",
      "2026-03-29",
    );
    const jesen = splitShiftByLjubljanaCalendarDays(
      new Date("2026-10-24T22:00:00.000Z"),
      new Date("2026-10-25T04:00:00.000Z"),
      "2026-10-25",
      "2026-10-25",
    );

    expect(pomlad).toEqual([expect.objectContaining({ datum: "2026-03-29", ureTrajanja: 4 })]);
    expect(jesen).toEqual([expect.objectContaining({ datum: "2026-10-25", ureTrajanja: 6 })]);

    const [pomladResponse, jesenResponse] = await Promise.all([
      supertest(buildApp(enotaSStroskovnimMestomId))
        .get("/izmene/obracun-ur?od=2026-03-29&do=2026-03-29"),
      supertest(buildApp(enotaSStroskovnimMestomId))
        .get("/izmene/obracun-ur?od=2026-10-25&do=2026-10-25"),
    ]);
    expect(pomladResponse.body.vrstice).toContainEqual(expect.objectContaining({
      izmenaId: pomladnaIzmena!.id,
      datum: "2026-03-29",
      ureTrajanja: 4,
    }));
    expect(jesenResponse.body.vrstice).toContainEqual(expect.objectContaining({
      izmenaId: jesenskaIzmena!.id,
      datum: "2026-10-25",
      ureTrajanja: 6,
    }));
  });

  it("zavrne nerazumno dolgo obdobje obračuna", async () => {
    const response = await supertest(buildApp(enotaSStroskovnimMestomId))
      .get("/izmene/obracun-ur?od=1900-01-01&do=2900-01-01");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("največ 366 dni");
  });
});