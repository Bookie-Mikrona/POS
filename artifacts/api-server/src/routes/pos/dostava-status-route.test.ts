import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  dostavaStatusZgodovinaTable,
  dostavniKurirjiTable,
  enoteTable,
  narocilaTable,
} from "@workspace/db";
import dostavaRouter from "./dostava";

let enotaId: number;
let drugaEnotaId: number;
let ustvarjenaDrugaEnota = false;
const narociloIds: number[] = [];
const kurirIds: number[] = [];

function app(vloga = "admin") {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    (req as any).vloga = vloga;
    next();
  });
  result.use(dostavaRouter);
  return result;
}

beforeAll(async () => {
  const [enota] = await db.select({ id: enoteTable.id, companyId: enoteTable.companyId }).from(enoteTable).orderBy(enoteTable.id).limit(1);
  if (!enota) throw new Error("Testna baza nima POS enote");
  enotaId = enota.id;
  const [obstojecaDrugaEnota] = await db.select({ id: enoteTable.id }).from(enoteTable)
    .where(eq(enoteTable.companyId, enota.companyId))
    .orderBy(enoteTable.id)
    .offset(1)
    .limit(1);
  if (obstojecaDrugaEnota) {
    drugaEnotaId = obstojecaDrugaEnota.id;
  } else {
    const [novaEnota] = await db.insert(enoteTable).values({
      companyId: enota.companyId,
      ime: `Dostava izolacija ${process.pid}`,
    }).returning({ id: enoteTable.id });
    if (!novaEnota) throw new Error("Za test ni bilo mogoče ustvariti druge enote");
    drugaEnotaId = novaEnota.id;
    ustvarjenaDrugaEnota = true;
  }
});

afterEach(async () => {
  for (const id of narociloIds.splice(0)) {
    await db.delete(dostavaStatusZgodovinaTable).where(eq(dostavaStatusZgodovinaTable.narociloId, id));
    await db.delete(narocilaTable).where(eq(narocilaTable.id, id));
  }
  for (const id of kurirIds.splice(0)) {
    await db.delete(dostavniKurirjiTable).where(eq(dostavniKurirjiTable.id, id));
  }
});

afterAll(async () => {
  if (ustvarjenaDrugaEnota) {
    await db.delete(enoteTable).where(eq(enoteTable.id, drugaEnotaId));
  }
});

describe("status dostave — idempotentni odgovor", () => {
  it("običajnemu uporabniku ne dovoli dodajanja kurirja", async () => {
    const response = await request(app("uporabnik"))
      .post("/dostava/kurirji")
      .send({ ime: `Nedovoljen kurir ${process.pid}`, telefon: null });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Upravljanje kurirjev zahteva skrbniško vlogo.",
      code: "KURIRJI_ADMIN_REQUIRED",
    });
  });

  it("običajnemu uporabniku dovoli branje seznama kurirjev", async () => {
    const response = await request(app("uporabnik"))
      .get("/dostava/kurirji");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.any(Array));
  });

  it("admin enote lahko doda kurirja", async () => {
    const response = await request(app("admin_enote"))
      .post("/dostava/kurirji")
      .send({ ime: `Kurir admin enote ${process.pid}`, telefon: null });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      ime: `Kurir admin enote ${process.pid}`,
      aktiven: true,
      enotaId,
    });
    kurirIds.push(response.body.id);
  });

  it("običajnemu uporabniku ne dovoli deaktivacije kurirja", async () => {
    const [kurir] = await db.insert(dostavniKurirjiTable).values({
      enotaId,
      ime: `Zaščiten kurir ${process.pid}`,
      telefon: null,
      aktiven: true,
    }).returning({ id: dostavniKurirjiTable.id });
    kurirIds.push(kurir!.id);

    const response = await request(app("uporabnik"))
      .patch(`/dostava/kurirji/${kurir!.id}`)
      .send({ aktiven: false });

    expect(response.status).toBe(403);
    const [nespremenjeno] = await db.select({
      aktiven: dostavniKurirjiTable.aktiven,
    }).from(dostavniKurirjiTable).where(eq(dostavniKurirjiTable.id, kurir!.id));
    expect(nespremenjeno?.aktiven).toBe(true);
  });

  it("ob ponovljenem ključu vrne prvotno shranjeni status, ne novega zahtevka", async () => {
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId,
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      status: "odprto",
      dostavaStatus: "prejeto",
      skupaj: "0",
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);

    const idempotencyKey = `dostava-test-${narocilo!.id}`;
    const prvi = await request(app())
      .post(`/narocila/${narocilo!.id}/dostava-status`)
      .send({ status: "potrjeno", kurirId: null, idempotencyKey });

    expect(prvi.status).toBe(200);
    expect(prvi.body).toEqual({ id: narocilo!.id, status: "potrjeno", idempotent: false });

    const ponovitevZDrugimStatusom = await request(app())
      .post(`/narocila/${narocilo!.id}/dostava-status`)
      .send({ status: "v_pripravi", kurirId: null, idempotencyKey });

    expect(ponovitevZDrugimStatusom.status).toBe(200);
    expect(ponovitevZDrugimStatusom.body).toEqual({
      id: narocilo!.id,
      status: "potrjeno",
      idempotent: true,
    });

    const [shranjeno] = await db.select({
      status: narocilaTable.dostavaStatus,
    }).from(narocilaTable).where(eq(narocilaTable.id, narocilo!.id));
    expect(shranjeno?.status).toBe("potrjeno");

    const zgodovina = await db.select().from(dostavaStatusZgodovinaTable)
      .where(eq(dostavaStatusZgodovinaTable.narociloId, narocilo!.id));
    expect(zgodovina).toHaveLength(1);
    expect(zgodovina[0]?.status).toBe("potrjeno");
  });

  it("sočasna zahtevka z istim ključem oba vrneta isti rezultat", async () => {
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId,
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      status: "odprto",
      dostavaStatus: "prejeto",
      skupaj: "0",
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);

    const testApp = app();
    const idempotencyKey = `dostava-concurrent-${narocilo!.id}`;
    const zahtevek = () => request(testApp)
      .post(`/narocila/${narocilo!.id}/dostava-status`)
      .send({ status: "potrjeno", kurirId: null, idempotencyKey });

    const [prvi, drugi] = await Promise.all([zahtevek(), zahtevek()]);

    expect([prvi.status, drugi.status]).toEqual([200, 200]);
    expect([prvi.body, drugi.body]).toEqual(expect.arrayContaining([
      { id: narocilo!.id, status: "potrjeno", idempotent: false },
      { id: narocilo!.id, status: "potrjeno", idempotent: true },
    ]));

    const zgodovina = await db.select().from(dostavaStatusZgodovinaTable)
      .where(eq(dostavaStatusZgodovinaTable.narociloId, narocilo!.id));
    expect(zgodovina).toHaveLength(1);
    expect(zgodovina[0]?.status).toBe("potrjeno");
  });

  it("zavrne spremembo naročila iz druge enote brez vpisa v zgodovino", async () => {
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId: drugaEnotaId,
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      status: "odprto",
      dostavaStatus: "prejeto",
      skupaj: "0",
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);

    const response = await request(app())
      .post(`/narocila/${narocilo!.id}/dostava-status`)
      .send({
        status: "potrjeno",
        kurirId: null,
        idempotencyKey: `tuj-status-${narocilo!.id}`,
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "Dostavno naročilo ni najdeno.",
      code: "DOSTAVA_NI_NAJDENA",
    });

    const [nespremenjeno] = await db.select({
      status: narocilaTable.dostavaStatus,
    }).from(narocilaTable).where(eq(narocilaTable.id, narocilo!.id));
    expect(nespremenjeno?.status).toBe("prejeto");

    const zgodovina = await db.select().from(dostavaStatusZgodovinaTable)
      .where(eq(dostavaStatusZgodovinaTable.narociloId, narocilo!.id));
    expect(zgodovina).toHaveLength(0);
  });

  it("omogoči preklic tudi, če je prej dodeljeni kurir medtem deaktiviran", async () => {
    const [kurir] = await db.insert(dostavniKurirjiTable).values({
      enotaId,
      ime: `Deaktiviran kurir ${process.pid}`,
      telefon: null,
      aktiven: true,
    }).returning({ id: dostavniKurirjiTable.id });
    kurirIds.push(kurir!.id);

    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId,
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      status: "odprto",
      dostavaStatus: "pripravljeno",
      dostavaKurirId: kurir!.id,
      skupaj: "0",
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);
    await db.update(dostavniKurirjiTable)
      .set({ aktiven: false })
      .where(eq(dostavniKurirjiTable.id, kurir!.id));

    const response = await request(app())
      .post(`/narocila/${narocilo!.id}/dostava-status`)
      .send({
        status: "preklicano",
        kurirId: kurir!.id,
        idempotencyKey: `preklic-neaktiven-${narocilo!.id}`,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: narocilo!.id,
      status: "preklicano",
      idempotent: false,
    });

    const [shranjeno] = await db.select({
      status: narocilaTable.dostavaStatus,
      kurirId: narocilaTable.dostavaKurirId,
    }).from(narocilaTable).where(eq(narocilaTable.id, narocilo!.id));
    expect(shranjeno).toEqual({ status: "preklicano", kurirId: kurir!.id });
  });

  it("ob dostavi ohrani glavno naročilo odprto za ločeno zaključevanje", async () => {
    const [kurir] = await db.insert(dostavniKurirjiTable).values({
      enotaId,
      ime: `Dostavljen kurir ${process.pid}`,
      telefon: null,
      aktiven: true,
    }).returning({ id: dostavniKurirjiTable.id });
    kurirIds.push(kurir!.id);

    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId,
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      status: "odprto",
      dostavaStatus: "prevzel_kurir",
      dostavaKurirId: kurir!.id,
      skupaj: "0",
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);

    const response = await request(app())
      .post(`/narocila/${narocilo!.id}/dostava-status`)
      .send({
        status: "dostavljeno",
        kurirId: null,
        idempotencyKey: `dostavljeno-odprto-${narocilo!.id}`,
      });

    expect(response.status).toBe(200);
    const [shranjeno] = await db.select({
      status: narocilaTable.status,
      dostavaStatus: narocilaTable.dostavaStatus,
    }).from(narocilaTable).where(eq(narocilaTable.id, narocilo!.id));
    expect(shranjeno).toEqual({ status: "odprto", dostavaStatus: "dostavljeno" });
  });

  it("v zgodovini vrne ime kurirja ob prevzemu naročila", async () => {
    const [kurir] = await db.insert(dostavniKurirjiTable).values({
      enotaId,
      ime: `Testni kurir ${process.pid}`,
      telefon: null,
      aktiven: true,
    }).returning({ id: dostavniKurirjiTable.id });
    kurirIds.push(kurir!.id);

    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId,
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      status: "odprto",
      dostavaStatus: "pripravljeno",
      skupaj: "0",
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);

    const response = await request(app())
      .post(`/narocila/${narocilo!.id}/dostava-status`)
      .send({
        status: "prevzel_kurir",
        kurirId: kurir!.id,
        idempotencyKey: `kurir-test-${narocilo!.id}`,
      });
    expect(response.status).toBe(200);

    const history = await request(app()).get(`/narocila/${narocilo!.id}/dostava-zgodovina`);
    expect(history.status).toBe(200);
    expect(history.body).toEqual([
      expect.objectContaining({
        status: "prevzel_kurir",
        kurirId: kurir!.id,
        kurirIme: `Testni kurir ${process.pid}`,
      }),
    ]);
  });
});