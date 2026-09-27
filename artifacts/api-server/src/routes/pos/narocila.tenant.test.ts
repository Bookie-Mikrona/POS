import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  artModSkupineTable,
  modifikatorjiTable,
  modNormativiTable,
  modSkupineTable,
  nastavitveTable,
  narocilaTable,
  pool,
  postavkeTable,
} from "@workspace/db";
vi.mock("./kds", () => ({
  materializirajKdsNaloge: vi.fn().mockResolvedValue(undefined),
}));

import narocilaRouter from "./narocila";
import { buildInvoiceXML } from "../../lib/pos-furs";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let drugaEnotaId: number;
let artikelId: number;
let cajArtikelId: number;
let meniArtikelId: number;
let alkoholMeniArtikelId: number;
let samostojniArtikelId: number;
let tujArtikelId: number;
let modSkupinaId: number;
let modifikatorId: number;
let nestedArtikelId: number;
let nestedSkupinaId: number;
let nestedModifikatorId: number;
let nestedAlternateModifikatorId: number;
let nestedNormativId: number;
let unchangedSkupinaId: number;
let unchangedModifikatorId: number;
const narociloIds: number[] = [];
const postavkaIds: number[] = [];

function app() {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    (req as any).jeDdvZavezanec = true;
    next();
  });
  result.use(narocilaRouter);
  return result;
}

async function ustvariNarocilo() {
  const [narocilo] = await db.insert(narocilaTable).values({
    enotaId,
    stevilkaNarocila: narociloIds.length + 1,
  }).returning({ id: narocilaTable.id });
  narociloIds.push(narocilo!.id);
  return narocilo!.id;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TENANT_${RUN_ID}`,
    naziv: `Tenant test ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Enota A ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;

  const [drugaEnota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Enota B ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  drugaEnotaId = drugaEnota!.id;

  const [artikel] = await db.insert(artikliTable).values({
    enotaId,
    ime: `Artikel A ${RUN_ID}`,
    cena: "10.00",
    davek: "22",
    vrstniRed: 1,
  }).returning({ id: artikliTable.id });
  artikelId = artikel!.id;

  const [tujArtikel] = await db.insert(artikliTable).values({
    enotaId: drugaEnotaId,
    ime: `Artikel B ${RUN_ID}`,
    cena: "12.00",
    davek: "9.5",
    vrstniRed: 1,
  }).returning({ id: artikliTable.id });
  tujArtikelId = tujArtikel!.id;

  const [skupina] = await db.insert(modSkupineTable).values({
    enotaId,
    ime: `Izbire ${RUN_ID}`,
  }).returning({ id: modSkupineTable.id });
  modSkupinaId = skupina!.id;

  const [modifikator] = await db.insert(modifikatorjiTable).values({
    skupinaId: modSkupinaId,
    ime: `Brez čebule ${RUN_ID}`,
  }).returning({ id: modifikatorjiTable.id });
  modifikatorId = modifikator!.id;

  const [nestedArtikel] = await db.insert(artikliTable).values({
    enotaId,
    ime: `Vhodni artikel ${RUN_ID}`,
    cena: "1.00",
    davek: "22",
    vrstniRed: 2,
  }).returning({ id: artikliTable.id });
  nestedArtikelId = nestedArtikel!.id;

  const [nestedSkupina] = await db.insert(modSkupineTable).values({
    enotaId,
    ime: `Obvezna podizbira ${RUN_ID}`,
    obvezna: true,
    minIzbir: 1,
    maxIzbir: 1,
  }).returning({ id: modSkupineTable.id });
  nestedSkupinaId = nestedSkupina!.id;

  const [nestedOption] = await db.insert(modifikatorjiTable).values({
    skupinaId: nestedSkupinaId,
    ime: `Podizbira A ${RUN_ID}`,
  }).returning({ id: modifikatorjiTable.id });
  nestedModifikatorId = nestedOption!.id;
  const [nestedAlternate] = await db.insert(modifikatorjiTable).values({
    skupinaId: nestedSkupinaId,
    ime: `Podizbira B ${RUN_ID}`,
  }).returning({ id: modifikatorjiTable.id });
  nestedAlternateModifikatorId = nestedAlternate!.id;

  await db.insert(artModSkupineTable).values([
    { artikelId, skupinaId: modSkupinaId },
    { artikelId: nestedArtikelId, skupinaId: nestedSkupinaId },
  ]);
  const [norm] = await db.insert(modNormativiTable).values({
    modifikatorId,
    vhodniArtikelId: nestedArtikelId,
    kolicina: "2",
  }).returning({ id: modNormativiTable.id });
  nestedNormativId = norm!.id;

  const [unchangedGroup] = await db.insert(modSkupineTable).values({
    enotaId,
    ime: `Nespremenjena skupina ${RUN_ID}`,
  }).returning({ id: modSkupineTable.id });
  unchangedSkupinaId = unchangedGroup!.id;
  const [unchangedOption] = await db.insert(modifikatorjiTable).values({
    skupinaId: unchangedSkupinaId,
    ime: `Ohrani me ${RUN_ID}`,
  }).returning({ id: modifikatorjiTable.id });
  unchangedModifikatorId = unchangedOption!.id;
  await db.insert(artModSkupineTable).values({ artikelId, skupinaId: unchangedSkupinaId });
});

afterAll(async () => {
  if (postavkaIds.length) {
    await db.delete(postavkeTable).where(inArray(postavkeTable.id, postavkaIds));
  }
  if (narociloIds.length) {
    await db.delete(narocilaTable).where(inArray(narocilaTable.id, narociloIds));
  }
  await db.delete(artModSkupineTable).where(and(
    eq(artModSkupineTable.artikelId, artikelId),
    inArray(artModSkupineTable.skupinaId, [modSkupinaId, unchangedSkupinaId]),
  ));
  await db.delete(modifikatorjiTable).where(inArray(modifikatorjiTable.id, [
    modifikatorId, nestedModifikatorId, nestedAlternateModifikatorId, unchangedModifikatorId,
  ]));
  await db.delete(modNormativiTable).where(eq(modNormativiTable.id, nestedNormativId));
  await db.delete(artModSkupineTable).where(and(
    eq(artModSkupineTable.artikelId, nestedArtikelId),
    eq(artModSkupineTable.skupinaId, nestedSkupinaId),
  ));
  await db.delete(modSkupineTable).where(inArray(modSkupineTable.id, [
    modSkupinaId, nestedSkupinaId, unchangedSkupinaId,
  ]));
  await db.delete(nastavitveTable).where(eq(nastavitveTable.enotaId, enotaId));
  await db.delete(artikliTable).where(inArray(artikliTable.id, [artikelId, tujArtikelId, nestedArtikelId]));
  if (cajArtikelId) {
    await db.delete(artikliTable).where(eq(artikliTable.id, cajArtikelId));
  }
  if (meniArtikelId) {
    await db.delete(artikliTable).where(eq(artikliTable.id, meniArtikelId));
  }
  if (alkoholMeniArtikelId) {
    await db.delete(artikliTable).where(eq(artikliTable.id, alkoholMeniArtikelId));
  }
  if (samostojniArtikelId) {
    await db.delete(artikliTable).where(eq(artikliTable.id, samostojniArtikelId));
  }
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaId, drugaEnotaId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("naročila — obramba med naročili in enotami", () => {
  it("ob dodajanju zahteva podizbiro ter shrani njeno ceno in normativni faktor", async () => {
    const narociloId = await ustvariNarocilo();
    const withoutNested = await supertest(app()).post(`/narocila/${narociloId}/postavke`)
      .send({
        artikelId, kolicina: 2,
        izbranModifikatorji: [{ modifikatorId, ime: "Dodatek", cenaDodatek: 0 }],
      });
    expect(withoutNested.status).toBe(400);

    await db.update(modifikatorjiTable).set({ cenaDodatek: "1.25" })
      .where(eq(modifikatorjiTable.id, nestedModifikatorId));
    const response = await supertest(app()).post(`/narocila/${narociloId}/postavke`)
      .send({
        artikelId, kolicina: 2,
        izbranModifikatorji: [{
          modifikatorId, ime: "Dodatek", cenaDodatek: 0,
          podIzbire: [{ normativId: nestedNormativId, modifikatorji: [nestedModifikatorId] }],
        }],
      });
    expect(response.status).toBe(201);
    const direct = response.body.postavke.find((line: { modifikatorId: number | null }) =>
      line.modifikatorId === modifikatorId);
    const nested = response.body.postavke.find((line: { modifikatorId: number | null }) =>
      line.modifikatorId === nestedModifikatorId);
    expect(direct?.podIzbire).toEqual([
      { normativId: nestedNormativId, modifikatorji: [nestedModifikatorId] },
    ]);
    expect(nested).toMatchObject({
      parentPostavkaId: direct.parentPostavkaId,
      izvorniModifikatorId: modifikatorId,
      izvorniNormativId: nestedNormativId,
      cenaKos: 2.5,
      skupaj: 5,
    });
    await db.update(modifikatorjiTable).set({ cenaDodatek: "0" })
      .where(eq(modifikatorjiTable.id, nestedModifikatorId));
  });

  it("zamenja samo izbrane skupine ter ohrani enonivojske podizbire in njihov normativ", async () => {
    const narociloId = await ustvariNarocilo();
    const [parent] = await db.insert(postavkeTable).values({
      narociloId,
      artikelId,
      ime: "Postavka za podizbire",
      kolicina: 1,
      cenaKos: "10.00",
      skupaj: "10.00",
      davek: "22",
    }).returning({ id: postavkeTable.id });
    postavkaIds.push(parent!.id);
    await db.insert(postavkeTable).values([
      {
        narociloId,
        artikelId: null,
        modifikatorId,
        ime: `Brez čebule ${RUN_ID}`,
        kolicina: 1,
        cenaKos: "0.00",
        skupaj: "0.00",
        davek: "22",
        parentPostavkaId: parent!.id,
        podIzbire: [{ normativId: nestedNormativId, modifikatorji: [nestedModifikatorId] }],
      },
      {
        narociloId,
        artikelId: null,
        modifikatorId: nestedModifikatorId,
        izvorniModifikatorId: modifikatorId,
        izvorniNormativId: nestedNormativId,
        izvorniNormativFaktor: "2",
        ime: `Podizbira A ${RUN_ID}`,
        kolicina: 1,
        cenaKos: "0.00",
        skupaj: "0.00",
        davek: "22",
        parentPostavkaId: parent!.id,
      },
      {
        narociloId,
        artikelId: null,
        modifikatorId: unchangedModifikatorId,
        ime: `Ohrani me ${RUN_ID}`,
        kolicina: 1,
        cenaKos: "0.00",
        skupaj: "0.00",
        davek: "22",
        parentPostavkaId: parent!.id,
      },
    ]);

    const missingRequired = await supertest(app())
      .post(`/narocila/${narociloId}/postavke/${parent!.id}/modifikatorji`)
      .send({
        skupineIds: [modSkupinaId],
        modifikatorji: [{ modifikatorId }],
      });
    expect(missingRequired.status).toBe(400);

    await db.update(modifikatorjiTable).set({ aktiven: false }).where(inArray(
      modifikatorjiTable.id,
      [nestedModifikatorId, nestedAlternateModifikatorId],
    ));
    const emptyMandatoryGroup = await supertest(app())
      .post(`/narocila/${narociloId}/postavke/${parent!.id}/modifikatorji`)
      .send({
        skupineIds: [modSkupinaId],
        modifikatorji: [{ modifikatorId }],
      });
    expect(emptyMandatoryGroup.status).toBe(409);
    await db.update(modifikatorjiTable).set({ aktiven: true }).where(inArray(
      modifikatorjiTable.id,
      [nestedModifikatorId, nestedAlternateModifikatorId],
    ));

    const response = await supertest(app())
      .post(`/narocila/${narociloId}/postavke/${parent!.id}/modifikatorji`)
      .send({
        skupineIds: [modSkupinaId],
        modifikatorji: [{
          modifikatorId,
          podIzbire: [{ normativId: nestedNormativId, modifikatorji: [nestedAlternateModifikatorId] }],
        }],
      });
    expect(response.status).toBe(201);
    expect(response.body.postavke.find((row: { modifikatorId: number | null }) =>
      row.modifikatorId === modifikatorId)?.podIzbire).toEqual([
      { normativId: nestedNormativId, modifikatorji: [nestedAlternateModifikatorId] },
    ]);

    const children = await db.select({
      modifikatorId: postavkeTable.modifikatorId,
      izvorniModifikatorId: postavkeTable.izvorniModifikatorId,
      izvorniNormativId: postavkeTable.izvorniNormativId,
      izvorniNormativFaktor: postavkeTable.izvorniNormativFaktor,
      podIzbire: postavkeTable.podIzbire,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(postavkeTable.parentPostavkaId, parent!.id),
    ));
    expect(children).toHaveLength(3);
    expect(children.some((row) => row.modifikatorId === unchangedModifikatorId)).toBe(true);
    expect(children.some((row) => row.modifikatorId === nestedModifikatorId)).toBe(false);
    expect(children.find((row) => row.modifikatorId === nestedAlternateModifikatorId)).toMatchObject({
      izvorniModifikatorId: modifikatorId,
      izvorniNormativId: nestedNormativId,
      izvorniNormativFaktor: "2.000000",
    });
    expect(children.find((row) => row.modifikatorId === modifikatorId)?.podIzbire)
      .toEqual([{ normativId: nestedNormativId, modifikatorji: [nestedAlternateModifikatorId] }]);
  });

  it("zavrne parentPostavkaId iz drugega naročila pred vstavljanjem", async () => {
    const ciljnoNarociloId = await ustvariNarocilo();
    const drugoNarociloId = await ustvariNarocilo();
    const [parent] = await db.insert(postavkeTable).values({
      narociloId: drugoNarociloId,
      artikelId,
      ime: "Starš iz drugega naročila",
      kolicina: 1,
      cenaKos: "10.00",
      skupaj: "10.00",
      davek: "22",
    }).returning({ id: postavkeTable.id });
    postavkaIds.push(parent!.id);

    const response = await supertest(app())
      .post(`/narocila/${ciljnoNarociloId}/postavke`)
      .send({ artikelId, kolicina: 1, parentPostavkaId: parent!.id });

    expect(response.status).toBe(404);

    const rows = await db.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(eq(postavkeTable.narociloId, ciljnoNarociloId));
    expect(rows).toEqual([]);
  });

  it("pri DDV preračunu ne uporabi artikla druge enote", async () => {
    const narociloId = await ustvariNarocilo();
    const [postavka] = await db.insert(postavkeTable).values({
      narociloId,
      artikelId: tujArtikelId,
      ime: "Zgodovinska tuja referenca",
      kolicina: 1,
      cenaKos: "12.00",
      skupaj: "12.00",
      davek: "5.00",
      toGo: false,
    }).returning({ id: postavkeTable.id });
    postavkaIds.push(postavka!.id);

    const response = await supertest(app())
      .patch(`/narocila/${narociloId}/postavke/${postavka!.id}`)
      .send({ kolicina: 1, toGo: true });

    expect(response.status).toBe(200);

    const [saved] = await db.select({
      davek: postavkeTable.davek,
      toGo: postavkeTable.toGo,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.id, postavka!.id),
      eq(postavkeTable.narociloId, narociloId),
    ));
    expect(saved).toMatchObject({ davek: "5.00", toGo: true });
  });

  it("prenese razrešeni DDV v FURS davčno skupino za To Go in za mizo", async () => {
    const [caj] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Nesladkan čaj ${RUN_ID}`,
      cena: "3.00",
      davek: "22.00",
      taxCategory: "hot_beverage",
      addedSugar: false,
      vrstniRed: 2,
    }).returning({ id: artikliTable.id });
    cajArtikelId = caj!.id;

    await db.insert(nastavitveTable).values({
      enotaId,
      kljuc: "toGoTopliNapitekStopnja",
      vrednost: "liberalno",
    });

    const toGoNarociloId = await ustvariNarocilo();
    const toGoResponse = await supertest(app())
      .post(`/narocila/${toGoNarociloId}/postavke`)
      .send({ artikelId: cajArtikelId, kolicina: 1, toGo: true });
    expect(toGoResponse.status).toBe(201);

    const [toGoPostavka] = await db.select({
      davek: postavkeTable.davek,
      appliedRuleId: postavkeTable.appliedRuleId,
      toGo: postavkeTable.toGo,
      cenaKos: postavkeTable.cenaKos,
      kolicina: postavkeTable.kolicina,
      skupaj: postavkeTable.skupaj,
      ime: postavkeTable.ime,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, toGoNarociloId),
      eq(postavkeTable.artikelId, cajArtikelId),
    ));
    expect(toGoPostavka).toMatchObject({
      davek: "9.50",
      toGo: true,
      ime: `Nesladkan čaj ${RUN_ID}`,
    });
    expect(toGoPostavka?.appliedRuleId).not.toBeNull();

    const toGoXml = buildInvoiceXML({
      stevilkaRacuna: `FURS-TOGO-${RUN_ID}`,
      datumCas: new Date("2026-08-31T10:00:00.000Z"),
      skupaj: 3,
      ddv: 0.26,
      placilnaNacin: "gotovina",
      postavke: [{
        ime: toGoPostavka!.ime,
        kolicina: Number(toGoPostavka!.kolicina),
        cenaKos: Number(toGoPostavka!.cenaKos),
        skupaj: Number(toGoPostavka!.skupaj),
        davek: Number(toGoPostavka!.davek),
      }],
    });
    expect(toGoXml).toContain("<fu:TaxRate>9.50</fu:TaxRate>");
    expect(toGoXml).toContain("<fu:TaxableAmount>2.74</fu:TaxableAmount>");
    expect(toGoXml).toContain("<fu:TaxAmount>0.26</fu:TaxAmount>");
    expect(toGoXml).not.toContain("<fu:TaxRate>22.00</fu:TaxRate>");

    const eatInNarociloId = await ustvariNarocilo();
    const eatInResponse = await supertest(app())
      .post(`/narocila/${eatInNarociloId}/postavke`)
      .send({ artikelId: cajArtikelId, kolicina: 1, toGo: false });
    expect(eatInResponse.status).toBe(201);

    const [eatInPostavka] = await db.select({
      davek: postavkeTable.davek,
      appliedRuleId: postavkeTable.appliedRuleId,
      toGo: postavkeTable.toGo,
      cenaKos: postavkeTable.cenaKos,
      kolicina: postavkeTable.kolicina,
      skupaj: postavkeTable.skupaj,
      ime: postavkeTable.ime,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, eatInNarociloId),
      eq(postavkeTable.artikelId, cajArtikelId),
    ));
    expect(eatInPostavka).toMatchObject({ davek: "22.00", toGo: false });
    expect(eatInPostavka?.appliedRuleId).not.toBeNull();

    const eatInXml = buildInvoiceXML({
      stevilkaRacuna: `FURS-EATIN-${RUN_ID}`,
      datumCas: new Date("2026-08-31T10:00:00.000Z"),
      skupaj: 3,
      ddv: 0.54,
      placilnaNacin: "gotovina",
      postavke: [{
        ime: eatInPostavka!.ime,
        kolicina: Number(eatInPostavka!.kolicina),
        cenaKos: Number(eatInPostavka!.cenaKos),
        skupaj: Number(eatInPostavka!.skupaj),
        davek: Number(eatInPostavka!.davek),
      }],
    });
    expect(eatInXml).toContain("<fu:TaxRate>22.00</fu:TaxRate>");
    expect(eatInXml).toContain("<fu:TaxableAmount>2.46</fu:TaxableAmount>");
    expect(eatInXml).toContain("<fu:TaxAmount>0.54</fu:TaxAmount>");
    expect(eatInXml).not.toContain("<fu:TaxRate>9.50</fu:TaxRate>");
  });

  it("shrani menijski revizijski kontekst, alkohol pa pusti na 22 %", async () => {
    const [meniArtikel] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Menijska pijača ${RUN_ID}`,
      cena: "2.00",
      davek: "22.00",
      taxCategory: "hot_beverage",
      jeDelMenija: true,
    }).returning({ id: artikliTable.id });
    meniArtikelId = meniArtikel!.id;

    const [alkohol] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Menijsko pivo ${RUN_ID}`,
      cena: "4.00",
      davek: "22.00",
      taxCategory: "alcoholic",
      jeDelMenija: true,
    }).returning({ id: artikliTable.id });
    alkoholMeniArtikelId = alkohol!.id;

    const [samostojni] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Samostojna pijača ${RUN_ID}`,
      cena: "2.50",
      davek: "22.00",
      taxCategory: "hot_beverage",
      jeDelMenija: false,
    }).returning({ id: artikliTable.id });
    samostojniArtikelId = samostojni!.id;

    const narociloId = await ustvariNarocilo();
    const meniResponse = await supertest(app())
      .post(`/narocila/${narociloId}/postavke`)
      .send({ artikelId: meniArtikelId, kolicina: 1 });
    expect(meniResponse.status).toBe(201);

    const alkoholResponse = await supertest(app())
      .post(`/narocila/${narociloId}/postavke`)
      .send({ artikelId: alkoholMeniArtikelId, kolicina: 1 });
    expect(alkoholResponse.status).toBe(201);
    const samostojniResponse = await supertest(app())
      .post(`/narocila/${narociloId}/postavke`)
      .send({ artikelId: samostojniArtikelId, kolicina: 1 });
    expect(samostojniResponse.status).toBe(201);

    const rows = await db.select({
      artikelId: postavkeTable.artikelId,
      davek: postavkeTable.davek,
      jeDelMenija: postavkeTable.jeDelMenija,
    }).from(postavkeTable).where(eq(postavkeTable.narociloId, narociloId));

    expect(rows.find((row) => row.artikelId === meniArtikelId))
      .toMatchObject({ davek: "9.50", jeDelMenija: true });
    expect(rows.find((row) => row.artikelId === alkoholMeniArtikelId))
      .toMatchObject({ davek: "22.00", jeDelMenija: false });

    const returnedMenuItem = meniResponse.body.postavke.find(
      (row: { artikelId: number }) => row.artikelId === meniArtikelId,
    );
    expect(returnedMenuItem).toMatchObject({ davek: 9.5, jeDelMenija: true });

    await db.update(artikliTable)
      .set({ jeDelMenija: false })
      .where(eq(artikliTable.id, meniArtikelId));
    const recalculated = await supertest(app())
      .patch(`/narocila/${narociloId}/postavke/${returnedMenuItem.id}`)
      .send({ kolicina: 1, toGo: true });
    expect(recalculated.status).toBe(200);

    const [afterArticleChange] = await db.select({
      davek: postavkeTable.davek,
      jeDelMenija: postavkeTable.jeDelMenija,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(postavkeTable.artikelId, meniArtikelId),
    ));
    expect(afterArticleChange).toMatchObject({ davek: "9.50", jeDelMenija: true });

    const returnedStandalone = samostojniResponse.body.postavke.find(
      (row: { artikelId: number }) => row.artikelId === samostojniArtikelId,
    );
    await db.update(artikliTable)
      .set({ taxCategory: "menu_item" })
      .where(eq(artikliTable.id, samostojniArtikelId));
    const standaloneRecalculated = await supertest(app())
      .patch(`/narocila/${narociloId}/postavke/${returnedStandalone.id}`)
      .send({ kolicina: 1, toGo: true });
    expect(standaloneRecalculated.status).toBe(200);

    const [standaloneAfterCategoryChange] = await db.select({
      davek: postavkeTable.davek,
      jeDelMenija: postavkeTable.jeDelMenija,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(postavkeTable.artikelId, samostojniArtikelId),
    ));
    expect(standaloneAfterCategoryChange).toMatchObject({ davek: "22.00", jeDelMenija: false });
  });

  it("zamenjava modifikatorjev ne bere ali izbriše otroka iz drugega naročila", async () => {
    const ciljnoNarociloId = await ustvariNarocilo();
    const drugoNarociloId = await ustvariNarocilo();
    const [parent] = await db.insert(postavkeTable).values({
      narociloId: ciljnoNarociloId,
      artikelId,
      ime: "Ciljni starš",
      kolicina: 1,
      cenaKos: "10.00",
      skupaj: "10.00",
      davek: "22",
    }).returning({ id: postavkeTable.id });
    const [tujOtrok] = await db.insert(postavkeTable).values({
      narociloId: drugoNarociloId,
      artikelId: null,
      modifikatorId,
      ime: "Tuji otrok",
      kolicina: 1,
      cenaKos: "0.00",
      skupaj: "0.00",
      davek: "22",
      parentPostavkaId: parent!.id,
    }).returning({ id: postavkeTable.id });
    postavkaIds.push(parent!.id, tujOtrok!.id);

    const response = await supertest(app())
      .post(`/narocila/${ciljnoNarociloId}/postavke/${parent!.id}/modifikatorji`)
      .send({ modifikatorji: [], skupineIds: [modSkupinaId] });

    expect(response.status).toBe(201);
    const [saved] = await db.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(eq(postavkeTable.id, tujOtrok!.id));
    expect(saved).toBeDefined();
  });

  it("brisanje starša ne kaskadira v otroka z drugega naročila", async () => {
    const ciljnoNarociloId = await ustvariNarocilo();
    const drugoNarociloId = await ustvariNarocilo();
    const [parent] = await db.insert(postavkeTable).values({
      narociloId: ciljnoNarociloId,
      artikelId,
      ime: "Starš za brisanje",
      kolicina: 1,
      cenaKos: "10.00",
      skupaj: "10.00",
      davek: "22",
    }).returning({ id: postavkeTable.id });
    const [tujOtrok] = await db.insert(postavkeTable).values({
      narociloId: drugoNarociloId,
      artikelId: null,
      modifikatorId,
      ime: "Otrok drugega naročila",
      kolicina: 1,
      cenaKos: "0.00",
      skupaj: "0.00",
      davek: "22",
      parentPostavkaId: parent!.id,
    }).returning({ id: postavkeTable.id });
    postavkaIds.push(parent!.id, tujOtrok!.id);

    const response = await supertest(app())
      .delete(`/narocila/${ciljnoNarociloId}/postavke/${parent!.id}`);

    expect(response.status).toBe(200);
    const [saved] = await db.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(eq(postavkeTable.id, tujOtrok!.id));
    expect(saved).toBeDefined();
  });
});