import { afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { and, eq, inArray, like, ne } from "drizzle-orm";
import {
  db,
  enoteTable,
  narocilaTable,
  narocnikiTable,
  naseljaTable,
} from "@workspace/db";
import narocnikiRouter from "./narocniki";
import naseljaRouter from "./naselja";

let enotaId: number;
let drugiEnotaId: number;
const testPrefix = `DOSTAVA_TEST_${process.pid}_${Date.now()}`;
let sequence = 0;
let narociloIds: number[] = [];

function testPhone() {
  sequence += 1;
  return `041${String((Date.now() + sequence) % 1_000_000).padStart(6, "0")}`;
}

function app(activeEnotaId = enotaId) {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as any).enotaId = activeEnotaId;
    next();
  });
  result.use(naseljaRouter);
  result.use(narocnikiRouter);
  return result;
}

async function cleanup() {
  if (narociloIds.length) {
    await db.delete(narocilaTable).where(inArray(narocilaTable.id, narociloIds));
    narociloIds = [];
  }
  await db.delete(narocnikiTable).where(and(
    eq(narocnikiTable.enotaId, enotaId),
    like(narocnikiTable.ime, `${testPrefix}%`),
  ));
  await db.delete(naseljaTable).where(and(
    eq(naseljaTable.enotaId, enotaId),
    like(naseljaTable.naziv, `${testPrefix}%`),
  ));
}

beforeAll(async () => {
  const [enota] = await db.select({ id: enoteTable.id }).from(enoteTable).orderBy(enoteTable.id).limit(1);
  if (!enota) throw new Error("Testna baza nima POS enote");
  enotaId = enota.id;
  const [druga] = await db.select({ id: enoteTable.id }).from(enoteTable)
    .where(ne(enoteTable.id, enotaId)).orderBy(enoteTable.id).limit(1);
  drugiEnotaId = druga?.id ?? 999_999_999;
});

afterEach(cleanup);

describe("naselja in naročniki za dostavo", () => {
  it("normalizira telefon, prepreči dvojnik in poišče naročnika z naslovi", async () => {
    const telefon = testPhone();
    const created = await request(app()).post("/narocniki").send({
      ime: `${testPrefix}_Ana`,
      telefon: "040 123 456",
      email: "ana@example.com",
    });
    expect(created.status).toBe(201);
    expect(created.body.telefonNormaliziran).toBe("+38640123456");

    const duplicate = await request(app()).post("/narocniki").send({
      ime: `${testPrefix}_Ana2`,
      telefon: "+38640123456",
    });
    expect(duplicate.status).toBe(409);

    const lookup = await request(app()).get("/narocniki/po-telefonu")
      .query({ telefon: "0038640123456" });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toMatchObject({
      ime: `${testPrefix}_Ana`,
      telefonNormaliziran: "+38640123456",
      naslovi: [],
    });

    // Uporabi še drug ključ telefona, da test ne temelji samo na fiksnem vzorcu.
    const second = await request(app()).post("/narocniki").send({
      ime: `${testPrefix}_Bojan`,
      telefon,
    });
    expect(second.status).toBe(201);
  });

  it("izvede naselja CRUD, naslove CRUD in vrne naselje pri iskanju naročnika", async () => {
    const naselje = await request(app()).post("/naselja").send({
      naziv: `${testPrefix}_Center`,
      oddaljenostKm: 3.5,
      cenaDostave: 4.2,
      casDostaveMin: 12,
    });
    expect(naselje.status).toBe(201);
    expect(naselje.body.cenaDostave).toBe(4.2);
    expect(naselje.body.aktivno).toBe(true);

    const naseljeId = naselje.body.id;
    const listed = await request(app()).get("/naselja");
    expect(listed.status).toBe(200);
    expect(listed.body.some((row: { id: number }) => row.id === naseljeId)).toBe(true);

    const updatedNaselje = await request(app()).put(`/naselja/${naseljeId}`).send({
      cenaDostave: 5.5,
      casDostaveMin: 15,
    });
    expect(updatedNaselje.status).toBe(200);
    expect(updatedNaselje.body.cenaDostave).toBe(5.5);
    expect(updatedNaselje.body.casDostaveMin).toBe(15);

    const narocnik = await request(app()).post("/narocniki").send({
      ime: `${testPrefix}_Cilka`,
      telefon: testPhone(),
    });
    expect(narocnik.status).toBe(201);
    const narocnikId = narocnik.body.id;

    const naslov = await request(app()).post(`/narocniki/${narocnikId}/naslovi`).send({
      ulica: "Glavna ulica",
      hisnaStevilka: "12A",
      vhod: "B",
      nadstropje: "2",
      naseljeId,
      navodilo: "Pokliči ob prihodu",
      privzet: true,
    });
    expect(naslov.status).toBe(201);
    expect(naslov.body.naselje).toMatchObject({ id: naseljeId, naziv: `${testPrefix}_Center` });

    const byPhone = await request(app()).get("/narocniki/po-telefonu")
      .query({ telefon: narocnik.body.telefon });
    expect(byPhone.status).toBe(200);
    expect(byPhone.body.naslovi).toHaveLength(1);
    expect(byPhone.body.naslovi[0]).toMatchObject({
      ulica: "Glavna ulica",
      hisnaStevilka: "12A",
      privzet: true,
      naseljeId,
    });

    const addressId = naslov.body.id;
    const addresses = await request(app()).get(`/narocniki/${narocnikId}/naslovi`);
    expect(addresses.status).toBe(200);
    expect(addresses.body[0].id).toBe(addressId);

    const updatedAddress = await request(app()).put(`/narocniki/${narocnikId}/naslovi/${addressId}`).send({
      hisnaStevilka: "14",
      navodilo: null,
    });
    expect(updatedAddress.status).toBe(200);
    expect(updatedAddress.body.hisnaStevilka).toBe("14");
    expect(updatedAddress.body.navodilo).toBeNull();

    const deletedAddress = await request(app()).delete(`/narocniki/${narocnikId}/naslovi/${addressId}`);
    expect(deletedAddress.status).toBe(204);
    expect((await request(app()).get(`/narocniki/${narocnikId}/naslovi`)).body).toEqual([]);

    const deletedNaselje = await request(app()).delete(`/naselja/${naseljeId}`);
    expect(deletedNaselje.status).toBe(204);
    expect((await request(app()).get("/naselja")).body.some((row: { id: number }) => row.id === naseljeId)).toBe(false);
    expect((await request(app()).get("/naselja").query({ vse: "true" })).body)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: naseljeId, aktivno: false })]));
  });

  it("ne izpostavi naročnikov in naselij drugi enoti", async () => {
    const naselje = await request(app()).post("/naselja").send({
      naziv: `${testPrefix}_Scoping`,
      cenaDostave: 2,
      casDostaveMin: 5,
    });
    const narocnik = await request(app()).post("/narocniki").send({
      ime: `${testPrefix}_ScopingKupec`,
      telefon: testPhone(),
    });
    expect(naselje.status).toBe(201);
    expect(narocnik.status).toBe(201);

    const otherNaselja = await request(app(drugiEnotaId)).get("/naselja");
    const otherNarocniki = await request(app(drugiEnotaId)).get("/narocniki");
    expect(otherNaselja.status).toBe(200);
    expect(otherNarocniki.status).toBe(200);
    expect(otherNaselja.body.some((row: { id: number }) => row.id === naselje.body.id)).toBe(false);
    expect(otherNarocniki.body.some((row: { id: number }) => row.id === narocnik.body.id)).toBe(false);

    const hiddenCustomer = await request(app(drugiEnotaId)).get(`/narocniki/${narocnik.body.id}`);
    const hiddenNaselje = await request(app(drugiEnotaId)).get(`/naselja/${naselje.body.id}`);
    expect(hiddenCustomer.status).toBe(404);
    expect(hiddenNaselje.status).toBe(404);
  });

  it("vrne zgodovino naročil naročnika samo znotraj njegove enote", async () => {
    const narocnik = await request(app()).post("/narocniki").send({
      ime: `${testPrefix}_Zgodovina`,
      telefon: testPhone(),
    });
    expect(narocnik.status).toBe(201);

    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId,
      narocnikId: narocnik.body.id,
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      stevilkaNarocila: 211,
      status: "zakljuceno",
      skupaj: "16.40",
      strankaIme: `${testPrefix}_Zgodovina`,
      strankaTelefon: narocnik.body.telefon,
      predvidenaDostava: new Date("2026-08-25T12:35:00.000Z"),
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);

    const history = await request(app()).get(`/narocniki/${narocnik.body.id}/narocila`);
    expect(history.status).toBe(200);
    expect(history.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: narocilo!.id,
        stevilkaNarocila: 211,
        status: "zakljuceno",
        skupaj: 16.4,
        nacin: "telefon",
        nacinIzpolnitve: "dostava",
        predvidenaDostava: "2026-08-25T12:35:00.000Z",
      }),
    ]));

    const otherUnit = await request(app(drugiEnotaId)).get(`/narocniki/${narocnik.body.id}/narocila`);
    expect(otherUnit.status).toBe(404);
  });
});