import { randomUUID } from "node:crypto";
import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  db,
  enoteTable,
  mizeTable,
  narocilaTable,
  narocnikiTable,
  prostoriTable,
  rezervacijeMizTable,
  rezervacijeMizZgodovinaTable,
} from "@workspace/db";
import mizeRouter from "./mize";
import narocilaRouter from "./narocila";
import { sprostiPotekleRezervacije } from "../../lib/rezervacijeMizScheduler";
import { assertOpenOrderCanChange } from "../../lib/rezervacijeMiz";

const broadcastMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/pos-sse", () => ({
  broadcastToUnit: broadcastMock,
  broadcastToDevice: vi.fn(),
}));

const RUN_ID = randomUUID().slice(0, 8);
let companyId: string;
let enotaId: number;
let drugaEnotaId: number;
let telefonZaporedna = 100_000;

function appZaEnoto(izbranaEnotaId: number, vloga = "admin", companyContext: string | null = companyId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = izbranaEnotaId;
    (req as any).companyId = companyContext;
    (req as any).jeDdvZavezanec = true;
    (req as any).vloga = vloga;
    (req as any).log = { warn: vi.fn() };
    next();
  });
  app.use(mizeRouter);
  app.use(narocilaRouter);
  return app;
}

async function ustvariMizo(enota: number, stevilka: number) {
  const [miza] = await db.insert(mizeTable).values({ enotaId: enota, stevilka }).returning();
  return miza!;
}

function termin(ureOdZdaj: number) {
  return new Date(Date.now() + ureOdZdaj * 60 * 60 * 1000);
}

function podatkiRezervacije(ime: string, zacetek: Date) {
  return {
    strankaIme: ime,
    telefon: `040 ${telefonZaporedna++}`,
    zacetek: zacetek.toISOString(),
    opomba: `${ime} opomba`,
  };
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_REZ_${RUN_ID}`,
    naziv: `Rezervacije ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [enota] = await db.insert(enoteTable).values({
    companyId, ime: `Glavna enota ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;
  const [drugaEnota] = await db.insert(enoteTable).values({
    companyId, ime: `Druga enota ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  drugaEnotaId = drugaEnota!.id;
});

beforeEach(() => {
  broadcastMock.mockClear();
});

afterAll(async () => {
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("rezervacije miz", () => {
  it("arhivira mizo in ohrani zgodovinsko rezervacijo v koledarju", async () => {
    const miza = await ustvariMizo(enotaId, 901);
    const create = await supertest(appZaEnoto(enotaId))
      .post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Arhivska stranka", termin(12)));
    expect(create.status).toBe(201);

    expect((await supertest(appZaEnoto(enotaId)).delete(`/mize/${miza.id}`)).status).toBe(204);
    const [archived] = await db.select().from(mizeTable).where(eq(mizeTable.id, miza.id));
    expect(archived).toMatchObject({ arhivirana: true });
    expect((await supertest(appZaEnoto(enotaId)).get("/mize")).body.map((row: any) => row.id)).not.toContain(miza.id);

    const calendar = await supertest(appZaEnoto(enotaId)).get("/rezervacije");
    expect(calendar.status).toBe(200);
    expect(calendar.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: create.body.reservations?.[0]?.id ?? create.body.id, mizaId: miza.id, mizaStevilka: 901, arhiviranaMiza: true }),
    ]));
  });

  it("adminu prepreči IDOR koledarja z enoto drugega podjetja", async () => {
    const [otherCompany] = await db.insert(companiesTable).values({
      podjetjeDavcna: `SI_OTHER_${RUN_ID}`, naziv: `Drugo podjetje ${RUN_ID}`,
    }).returning();
    const [otherUnit] = await db.insert(enoteTable).values({
      companyId: otherCompany!.id, ime: `Tuja enota ${RUN_ID}`,
    }).returning();
    const response = await supertest(appZaEnoto(enotaId, "admin")).get(`/rezervacije?enotaId=${otherUnit!.id}`);
    expect(response.status).toBe(403);
    await db.delete(companiesTable).where(eq(companiesTable.id, otherCompany!.id));
  });

  it("adminu istega podjetja dovoli zgodovino druge enote, brez companyId pa ne", async () => {
    const miza = await ustvariMizo(drugaEnotaId, 904);
    const [reservation] = await db.insert(rezervacijeMizTable).values({
      enotaId: drugaEnotaId, mizaId: miza.id, strankaIme: "Druga enota", telefon: "040 999 999", zacetek: termin(24),
    }).returning();
    await db.insert(rezervacijeMizZgodovinaTable).values({
      enotaId: drugaEnotaId, mizaId: miza.id, rezervacijaId: reservation!.id, dogodek: "ustvarjena", podatki: {},
    });
    const path = `/mize/${miza.id}/rezervacije/${reservation!.id}/zgodovina`;
    expect((await supertest(appZaEnoto(enotaId, "admin")).get(path)).status).toBe(200);
    expect((await supertest(appZaEnoto(enotaId, "admin", null)).get(path)).status).toBe(403);
    expect((await supertest(appZaEnoto(enotaId, "admin", null)).get("/rezervacije")).status).toBe(403);
    expect((await supertest(appZaEnoto(enotaId, "admin", null)).get(`/rezervacije?enotaId=${drugaEnotaId}`)).status).toBe(403);
  });

  it("ne arhivira mize, če je odprto naročilo nastalo pred arhiviranjem", async () => {
    const miza = await ustvariMizo(enotaId, 903);
    await db.insert(narocilaTable).values({ enotaId, mizaId: miza.id, status: "odprto" });
    const response = await supertest(appZaEnoto(enotaId)).delete(`/mize/${miza.id}`);
    expect(response.status).toBe(409);
    const [unchanged] = await db.select({ arhivirana: mizeTable.arhivirana }).from(mizeTable).where(eq(mizeTable.id, miza.id));
    expect(unchanged!.arhivirana).toBe(false);
  });

  it("zapiše create/update/cancel zgodovino, ki je na ravni baze append-only", async () => {
    const miza = await ustvariMizo(enotaId, 902);
    const app = appZaEnoto(enotaId);
    const create = await supertest(app).post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Revizijska stranka", termin(16)));
    expect(create.status).toBe(201);
    const rezervacijaId = create.body.id;
    const update = await supertest(app).put(`/mize/${miza.id}/rezervacije/${rezervacijaId}`)
      .send(podatkiRezervacije("Revizijska stranka 2", termin(20)));
    expect(update.status).toBe(200);
    expect((await supertest(app).delete(`/mize/${miza.id}/rezervacije/${rezervacijaId}`)).status).toBe(204);

    const history = await supertest(app).get(`/mize/${miza.id}/rezervacije/${rezervacijaId}/zgodovina`);
    expect(history.status).toBe(200);
    expect(history.body.map((row: any) => row.dogodek)).toEqual(["ustvarjena", "posodobljena", "preklicana"]);
    const historyId = history.body[0].id;
    await expect(db.update(rezervacijeMizZgodovinaTable).set({ actorClerkUserId: "tamper" }).where(eq(rezervacijeMizZgodovinaTable.id, historyId))).rejects.toThrow();
    await expect(db.delete(rezervacijeMizZgodovinaTable).where(eq(rezervacijeMizZgodovinaTable.id, historyId))).rejects.toThrow();
  });
  it("zavrne zastarelo množično spreminjanje geometrije miz", async () => {
    const [izbraniProstor] = await db.insert(prostoriTable).values({
      enotaId,
      ime: `Tloris ${RUN_ID}`,
      vrstniRed: 20,
    }).returning();
    const [drugiProstor] = await db.insert(prostoriTable).values({
      enotaId,
      ime: `Drugi tloris ${RUN_ID}`,
      vrstniRed: 21,
    }).returning();
    const [mizaA, mizaB, mizaDrugje, mizaDrugeEnote] = await db.insert(mizeTable).values([
      { enotaId, stevilka: 180, prostorId: izbraniProstor!.id, posX: 25, posY: 50 },
      { enotaId, stevilka: 181, prostorId: izbraniProstor!.id, posX: 75, posY: 100 },
      { enotaId, stevilka: 182, prostorId: drugiProstor!.id, posX: 125, posY: 150 },
      { enotaId: drugaEnotaId, stevilka: 183, prostorId: izbraniProstor!.id, posX: 175, posY: 200 },
    ]).returning();

    const response = await supertest(appZaEnoto(enotaId))
      .patch("/mize/bulk-pozicija")
      .send({ reset: true, prostorId: izbraniProstor!.id });

    expect(response.status).toBe(409);
    const rows = await db.select({
      id: mizeTable.id,
      posX: mizeTable.posX,
      posY: mizeTable.posY,
    }).from(mizeTable).where(inArray(mizeTable.id, [
      mizaA!.id, mizaB!.id, mizaDrugje!.id, mizaDrugeEnote!.id,
    ]));
    const byId = new Map(rows.map(row => [row.id, row]));
    expect(byId.get(mizaA!.id)).toMatchObject({ posX: 25, posY: 50 });
    expect(byId.get(mizaB!.id)).toMatchObject({ posX: 75, posY: 100 });
    expect(byId.get(mizaDrugje!.id)).toMatchObject({ posX: 125, posY: 150 });
    expect(byId.get(mizaDrugeEnote!.id)).toMatchObject({ posX: 175, posY: 200 });
    expect(broadcastMock).not.toHaveBeenCalled();
  });

  it("navadnemu uporabniku ne dovoli ponastaviti tlorisa", async () => {
    const [prostor] = await db.insert(prostoriTable).values({
      enotaId,
      ime: `Zaščiten tloris ${RUN_ID}`,
      vrstniRed: 22,
    }).returning();
    const [miza] = await db.insert(mizeTable).values({
      enotaId,
      stevilka: 184,
      prostorId: prostor!.id,
      posX: 50,
      posY: 75,
    }).returning();

    const response = await supertest(appZaEnoto(enotaId, "uporabnik"))
      .patch("/mize/bulk-pozicija")
      .send({ reset: true, prostorId: prostor!.id });

    expect(response.status).toBe(403);
    const [unchanged] = await db.select({ posX: mizeTable.posX, posY: mizeTable.posY })
      .from(mizeTable)
      .where(eq(mizeTable.id, miza!.id));
    expect(unchanged).toMatchObject({ posX: 50, posY: 75 });
  });

  it.each([
    {},
    { reset: true },
    { reset: true, prostorId: 0 },
    { reset: false },
    { pozicije: [] },
  ])("zavrne neveljavno telo za tloris: %j", async (body) => {
    const response = await supertest(appZaEnoto(enotaId))
      .patch("/mize/bulk-pozicija")
      .send(body);
    expect(response.status).toBe(400);
  });

  it("vrne razpoložljivost po kapaciteti in prostorih ter označi rezervirane in zasedene mize", async () => {
    const [notranji] = await db.insert(prostoriTable).values({
      enotaId,
      ime: `Notranji ${RUN_ID}`,
      vrstniRed: 1,
    }).returning();
    const [terasa] = await db.insert(prostoriTable).values({
      enotaId,
      ime: `Terasa ${RUN_ID}`,
      vrstniRed: 2,
    }).returning();
    const [premajhna, rezervirana, zasedena] = await db.insert(mizeTable).values([
      { enotaId, stevilka: 200, kapaciteta: 4, prostorId: notranji!.id },
      { enotaId, stevilka: 201, kapaciteta: 6, prostorId: notranji!.id },
      { enotaId, stevilka: 202, kapaciteta: 8, prostorId: terasa!.id },
    ]).returning();
    const api = supertest(appZaEnoto(enotaId));
    const izbraniTermin = termin(6);

    expect((await api.post(`/mize/${rezervirana!.id}/rezervacije`)
      .send(podatkiRezervacije("Rezervirana skupina", izbraniTermin))).status).toBe(201);
    expect((await api.post("/narocila").send({ mizaId: zasedena!.id })).status).toBe(201);

    const response = await api.get("/mize/razpolozljivost").query({
      zacetek: izbraniTermin.toISOString(),
      steviloOseb: 6,
    });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        miza: expect.objectContaining({ id: rezervirana!.id, kapaciteta: 6 }),
        prostorIme: notranji!.ime,
        stanje: "rezervirana",
        naVoljo: false,
        konfliktnaRezervacija: expect.objectContaining({ strankaIme: "Rezervirana skupina" }),
        steviloOdprtihNarocil: 0,
      }),
      expect.objectContaining({
        miza: expect.objectContaining({ id: zasedena!.id, kapaciteta: 8 }),
        prostorIme: terasa!.ime,
        stanje: "zasedena",
        naVoljo: true,
        konfliktnaRezervacija: null,
        steviloOdprtihNarocil: 1,
      }),
    ]));
    expect(response.body.some((row: { miza: { id: number } }) => row.miza.id === premajhna!.id)).toBe(false);

    const samoTerasa = await api.get("/mize/razpolozljivost").query({
      zacetek: izbraniTermin.toISOString(),
      steviloOseb: 6,
      prostorId: terasa!.id,
    });
    expect(samoTerasa.body).toHaveLength(1);
    expect(samoTerasa.body[0].miza.id).toBe(zasedena!.id);

    const brezDovoljVelike = await api.get("/mize/razpolozljivost").query({
      zacetek: izbraniTermin.toISOString(),
      steviloOseb: 99,
    });
    expect(brezDovoljVelike.status).toBe(200);
    expect(brezDovoljVelike.body).toEqual([]);
  });

  it("pri razpoložljivosti dovoli točno trurni razmik in zavrne krajši razmik", async () => {
    const mejaDovoljena = await ustvariMizo(enotaId, 203);
    const preblizu = await ustvariMizo(enotaId, 204);
    const api = supertest(appZaEnoto(enotaId));
    const izbraniTermin = termin(8);
    await db.insert(rezervacijeMizTable).values([
      {
        enotaId,
        mizaId: mejaDovoljena.id,
        strankaIme: "Točno tri ure",
        telefon: "040 203 203",
        zacetek: new Date(izbraniTermin.getTime() + 3 * 60 * 60 * 1000),
      },
      {
        enotaId,
        mizaId: preblizu.id,
        strankaIme: "Dve uri in 59 minut",
        telefon: "040 204 204",
        zacetek: new Date(izbraniTermin.getTime() + 3 * 60 * 60 * 1000 - 60_000),
      },
    ]);

    const response = await api.get("/mize/razpolozljivost").query({
      zacetek: izbraniTermin.toISOString(),
      steviloOseb: 4,
    });
    const poId = new Map(response.body.map((row: { miza: { id: number } }) => [row.miza.id, row]));
    expect(poId.get(mejaDovoljena.id)).toMatchObject({
      stanje: "prosta",
      naVoljo: true,
      konfliktnaRezervacija: null,
    });
    expect(poId.get(preblizu.id)).toMatchObject({
      stanje: "rezervirana",
      naVoljo: false,
      konfliktnaRezervacija: expect.objectContaining({ strankaIme: "Dve uri in 59 minut" }),
    });
  });

  it("ob sočasnem shranjevanju istega termina sprejme samo eno rezervacijo", async () => {
    const miza = await ustvariMizo(enotaId, 205);
    const api = supertest(appZaEnoto(enotaId));
    const zacetek = termin(10);
    const [prva, druga] = await Promise.all([
      api.post(`/mize/${miza.id}/rezervacije`).send(podatkiRezervacije("Sočasna A", zacetek)),
      api.post(`/mize/${miza.id}/rezervacije`).send(podatkiRezervacije("Sočasna B", zacetek)),
    ]);

    expect([prva.status, druga.status].sort()).toEqual([201, 409]);
    const aktivne = await db.select().from(rezervacijeMizTable).where(and(
      eq(rezervacijeMizTable.mizaId, miza.id),
      eq(rezervacijeMizTable.status, "aktivna"),
    ));
    expect(aktivne).toHaveLength(1);
  });

  it("ohrani singularni API kot pogled na najbližjo aktivno rezervacijo", async () => {
    const miza = await ustvariMizo(enotaId, 100);
    const api = supertest(appZaEnoto(enotaId));
    const prva = await api.put(`/mize/${miza.id}/rezervacija`)
      .send(podatkiRezervacije("Legacy gost", termin(4)));
    expect(prva.status).toBe(200);
    expect(prva.body).toMatchObject({
      rezervacijaStrankaIme: "Legacy gost",
      rezervacijaTelefon: expect.any(String),
      rezervacijaNaslednja: expect.objectContaining({ strankaIme: "Legacy gost" }),
    });

    const posodobitev = await api.put(`/mize/${miza.id}/rezervacija`)
      .send(podatkiRezervacije("Legacy gost posodobljen", termin(5)));
    expect(posodobitev.status).toBe(200);
    expect(posodobitev.body.rezervacijaStrankaIme).toBe("Legacy gost posodobljen");
    const aktivne = await db.select().from(rezervacijeMizTable).where(and(
      eq(rezervacijeMizTable.mizaId, miza.id),
      eq(rezervacijeMizTable.status, "aktivna"),
    ));
    expect(aktivne).toHaveLength(1);

    const sprostitev = await api.delete(`/mize/${miza.id}/rezervacija`);
    expect(sprostitev.status).toBe(204);
    const [sproscena] = await db.select().from(rezervacijeMizTable)
      .where(eq(rezervacijeMizTable.id, aktivne[0]!.id));
    expect(sproscena.status).toBe("sprostena");
  });

  it("shrani, izpiše, posodobi in sprosti točne vrstice več rezervacij iste mize", async () => {
    const miza = await ustvariMizo(enotaId, 101);
    const api = supertest(appZaEnoto(enotaId));
    const prva = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Ana", termin(4)));
    const druga = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Bine", termin(8)));
    expect(prva.status).toBe(201);
    expect(druga.status).toBe(201);
    expect(prva.body).toMatchObject({ mizaId: miza.id, status: "aktivna", strankaIme: "Ana" });
    expect(druga.body).toMatchObject({ mizaId: miza.id, status: "aktivna", strankaIme: "Bine" });

    const seznam = await api.get(`/mize/${miza.id}/rezervacije`);
    expect(seznam.status).toBe(200);
    expect(seznam.body).toHaveLength(2);
    expect(seznam.body.map((r: { id: number }) => r.id)).toEqual([prva.body.id, druga.body.id]);

    const posodobljena = await api.put(`/mize/${miza.id}/rezervacije/${prva.body.id}`)
      .send(podatkiRezervacije("Ana posodobljena", termin(4.5)));
    expect(posodobljena.status).toBe(200);
    expect(posodobljena.body).toMatchObject({
      id: prva.body.id, strankaIme: "Ana posodobljena", status: "aktivna",
    });

    const sprostitev = await api.delete(`/mize/${miza.id}/rezervacije/${druga.body.id}`);
    expect(sprostitev.status).toBe(204);
    const poSprostitvi = await api.get(`/mize/${miza.id}/rezervacije`);
    expect(poSprostitvi.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: prva.body.id, status: "aktivna" }),
      expect.objectContaining({ id: druga.body.id, status: "sprostena" }),
    ]));
    expect(broadcastMock).toHaveBeenCalledWith(
      enotaId,
      "update",
      { type: "miza", id: miza.id },
    );

    const izDrugeEnote = await supertest(appZaEnoto(drugaEnotaId))
      .get(`/mize/${miza.id}/rezervacije`);
    expect(izDrugeEnote.status).toBe(404);
  });

  it("zahteva triurni razmik in pri posodobitvi izključi samo posodobljeno rezervacijo", async () => {
    const miza = await ustvariMizo(enotaId, 102);
    const api = supertest(appZaEnoto(enotaId));
    const prva = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Prva", termin(4)));
    expect(prva.status).toBe(201);

    const preblizu = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Preblizu", termin(6.99)));
    expect(preblizu.status).toBe(409);
    expect(preblizu.body.code).toBe("REZERVACIJA_PREBLIZU");

    const lastnaPosodobitev = await api.put(`/mize/${miza.id}/rezervacije/${prva.body.id}`)
      .send(podatkiRezervacije("Prva premaknjena", termin(4.5)));
    expect(lastnaPosodobitev.status).toBe(200);

    const druga = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Druga", termin(8)));
    expect(druga.status).toBe(201);
    const konfliktPriPosodobitvi = await api.put(`/mize/${miza.id}/rezervacije/${prva.body.id}`)
      .send(podatkiRezervacije("Konflikt", termin(7)));
    expect(konfliktPriPosodobitvi.status).toBe(409);
  });

  it("izpelje rumeno stanje v eni uri in blokado novih naročil v dveh urah", async () => {
    const blokiranaMiza = await ustvariMizo(enotaId, 103);
    const rumenaMiza = await ustvariMizo(enotaId, 104);
    const api = supertest(appZaEnoto(enotaId));
    expect((await api.post(`/mize/${blokiranaMiza.id}/rezervacije`)
      .send(podatkiRezervacije("Čez devetdeset minut", termin(1.5)))).status).toBe(201);
    expect((await api.post(`/mize/${rumenaMiza.id}/rezervacije`)
      .send(podatkiRezervacije("Čez trideset minut", termin(0.5)))).status).toBe(201);

    const mize = await api.get("/mize");
    const poId = new Map(mize.body.map((m: { id: number }) => [m.id, m]));
    expect(poId.get(blokiranaMiza.id)).toMatchObject({
      status: "prosta", novaNarocilaBlokirana: true, noviNarocilaBlokirani: true,
    });
    expect(poId.get(rumenaMiza.id)).toMatchObject({
      status: "rezervirana", novaNarocilaBlokirana: true, noviNarocilaBlokirani: true,
    });
  });

  it("dovoli bodočo rezervacijo zasedene mize z odprtim naročilom", async () => {
    const miza = await ustvariMizo(enotaId, 105);
    const api = supertest(appZaEnoto(enotaId));
    const narocilo = await api.post("/narocila").send({ mizaId: miza.id });
    expect(narocilo.status).toBe(201);

    const rezervacija = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Poznejši gost", termin(4)));
    expect(rezervacija.status).toBe(201);
    expect(rezervacija.body).toMatchObject({ mizaId: miza.id, status: "aktivna" });
  });

  it("porabi izrecno izbrano rezervacijo le v oknu prihoda in le njeno vrstico oziroma stranko", async () => {
    const miza = await ustvariMizo(enotaId, 106);
    const api = supertest(appZaEnoto(enotaId));
    const obPrihodu = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Gost zdaj", termin(0.5)));
    const prihodnja = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Gost kasneje", termin(4)));
    expect(obPrihodu.status).toBe(201);
    expect(prihodnja.status).toBe(201);

    const prezgodaj = await api.post("/narocila").send({ mizaId: miza.id, rezervacijaId: prihodnja.body.id });
    expect(prezgodaj.status).toBe(409);
    const poraba = await api.post("/narocila").send({ mizaId: miza.id, rezervacijaId: obPrihodu.body.id });
    expect(poraba.status).toBe(201);
    expect(poraba.body).toMatchObject({
      narocnikId: obPrihodu.body.narocnikId,
    });

    const [porabljena, seAktivna] = await db.select().from(rezervacijeMizTable)
      .where(and(eq(rezervacijeMizTable.mizaId, miza.id), eq(rezervacijeMizTable.enotaId, enotaId)))
      .orderBy(rezervacijeMizTable.zacetek);
    expect(porabljena).toMatchObject({
      id: obPrihodu.body.id, status: "porabljena", narociloId: poraba.body.id,
    });
    expect(seAktivna).toMatchObject({ id: prihodnja.body.id, status: "aktivna" });
  });

  it("nepovezano naročilo pred rokom ne odstrani rezervacije", async () => {
    const miza = await ustvariMizo(enotaId, 107);
    const api = supertest(appZaEnoto(enotaId));
    const rezervacija = await api.post(`/mize/${miza.id}/rezervacije`)
      .send(podatkiRezervacije("Bližnji gost", termin(0.5)));
    expect(rezervacija.status).toBe(201);

    const narocilo = await api.post("/narocila").send({ mizaId: miza.id });
    expect(narocilo.status).toBe(409);
    const [neporabljena] = await db.select().from(rezervacijeMizTable)
      .where(eq(rezervacijeMizTable.id, rezervacija.body.id));
    expect(neporabljena).toMatchObject({ status: "aktivna", narociloId: null });
  });

  it("blokira spremembe starega naročila, vendar dovoli njegov prenos in šele nato prihod rezerviranega gosta", async () => {
    const izvornaMiza = await ustvariMizo(enotaId, 109);
    const ciljnaMiza = await ustvariMizo(enotaId, 110);
    const api = supertest(appZaEnoto(enotaId));
    const staroNarocilo = await api.post("/narocila").send({ mizaId: izvornaMiza.id });
    expect(staroNarocilo.status).toBe(201);
    const rezervacija = await api.post(`/mize/${izvornaMiza.id}/rezervacije`)
      .send(podatkiRezervacije("Rezervirani gost", termin(0.5)));
    expect(rezervacija.status).toBe(201);

    await expect(db.transaction((tx) =>
      assertOpenOrderCanChange(tx, staroNarocilo.body.id, enotaId)
    )).rejects.toThrow("REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA");

    const prezgodnjiPrihod = await api.post("/narocila")
      .send({ mizaId: izvornaMiza.id, rezervacijaId: rezervacija.body.id });
    expect(prezgodnjiPrihod.status).toBe(409);
    expect(prezgodnjiPrihod.body.code).toBe("REZERVACIJA_MIZA_SE_ZASEDENA");

    const prenos = await api.put(`/narocila/${staroNarocilo.body.id}`)
      .send({ mizaId: ciljnaMiza.id });
    expect(prenos.status).toBe(200);
    expect(prenos.body.mizaId).toBe(ciljnaMiza.id);

    const prihod = await api.post("/narocila")
      .send({ mizaId: izvornaMiza.id, rezervacijaId: rezervacija.body.id });
    expect(prihod.status).toBe(201);
    const [porabljena] = await db.select().from(rezervacijeMizTable)
      .where(eq(rezervacijeMizTable.id, rezervacija.body.id));
    expect(porabljena).toMatchObject({
      status: "porabljena",
      narociloId: prihod.body.id,
    });
  });

  it("urnik označi potekle vrstice in jih ne izbriše", async () => {
    const miza = await ustvariMizo(enotaId, 108);
    const zdaj = new Date();
    const [potekla] = await db.insert(rezervacijeMizTable).values({
      enotaId, mizaId: miza.id, strankaIme: "Potekla", telefon: "040 123 456",
      zacetek: new Date(zdaj.getTime() - 3 * 60 * 60 * 1000 - 60_000),
    }).returning();
    const [bodoca] = await db.insert(rezervacijeMizTable).values({
      enotaId, mizaId: miza.id, strankaIme: "Bodoča", telefon: "040 123 457",
      zacetek: termin(4),
    }).returning();

    expect(await sprostiPotekleRezervacije(zdaj)).toContain(miza.id);
    const rows = await db.select().from(rezervacijeMizTable)
      .where(and(eq(rezervacijeMizTable.mizaId, miza.id), eq(rezervacijeMizTable.enotaId, enotaId)));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: potekla!.id, status: "potekla", potekla: expect.any(Date) }),
      expect.objectContaining({ id: bodoca!.id, status: "aktivna" }),
    ]));
  });
});