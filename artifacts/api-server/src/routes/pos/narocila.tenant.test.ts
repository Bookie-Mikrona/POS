import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  artModSkupineTable,
  kdsDogodkiTable,
  kdsIzdajaDogodkiTable,
  kdsNalogiTable,
  kategorijeTable,
  modNormativiTable,
  modifikatorjiTable,
  modSkupineTable,
  nastavitveTable,
  narocilaTable,
  normativiTable,
  pool,
  postavkeTable,
} from "@workspace/db";
import narocilaRouter from "./narocila";
import { buildZalogaMovementPlan } from "./racuni";
import { buildInvoiceXML } from "../../lib/pos-furs";
import { faktorNormativaPodModifikatorja } from "../../lib/pica-poraba";

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

  await db.insert(artModSkupineTable).values({ artikelId, skupinaId: modSkupinaId });
});

afterAll(async () => {
  await pool.query("ALTER TABLE kds_dogodki DISABLE TRIGGER kds_dogodki_append_only");
  await pool.query("ALTER TABLE kds_izdaja_dogodki DISABLE TRIGGER kds_izdaja_dogodki_append_only");
  try {
    if (narociloIds.length) {
      const tickets = await db.select({ id: kdsNalogiTable.id })
        .from(kdsNalogiTable).where(inArray(kdsNalogiTable.narociloId, narociloIds));
      const ticketIds = tickets.map((ticket) => ticket.id);
      if (ticketIds.length) {
        await db.delete(kdsDogodkiTable).where(inArray(kdsDogodkiTable.nalogId, ticketIds));
      }
      await db.delete(kdsIzdajaDogodkiTable)
        .where(inArray(kdsIzdajaDogodkiTable.narociloId, narociloIds));
      await db.delete(kdsNalogiTable).where(inArray(kdsNalogiTable.narociloId, narociloIds));
    }
    if (postavkaIds.length) {
      await db.delete(postavkeTable).where(inArray(postavkeTable.id, postavkaIds));
    }
    if (narociloIds.length) {
      await db.delete(narocilaTable).where(inArray(narocilaTable.id, narociloIds));
    }
  } finally {
    await pool.query("ALTER TABLE kds_dogodki ENABLE TRIGGER kds_dogodki_append_only");
    await pool.query("ALTER TABLE kds_izdaja_dogodki ENABLE TRIGGER kds_izdaja_dogodki_append_only");
  }
  await db.delete(artModSkupineTable).where(and(
    eq(artModSkupineTable.artikelId, artikelId),
    eq(artModSkupineTable.skupinaId, modSkupinaId),
  ));
  await db.delete(modifikatorjiTable).where(eq(modifikatorjiTable.id, modifikatorId));
  await db.delete(modSkupineTable).where(eq(modSkupineTable.id, modSkupinaId));
  await db.delete(nastavitveTable).where(eq(nastavitveTable.enotaId, enotaId));
  await db.delete(artikliTable).where(inArray(artikliTable.id, [artikelId, tujArtikelId]));
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
  it("označi samo povezano embalažo pod To Go staršem", async () => {
    const narociloId = await ustvariNarocilo();
    const [packagingCategory] = await db.insert(kategorijeTable).values({
      enotaId,
      ime: "eMbAlAžA",
    }).returning({ id: kategorijeTable.id });
    const [foodCategory] = await db.insert(kategorijeTable).values({
      enotaId,
      ime: "Hrana",
    }).returning({ id: kategorijeTable.id });
    const [packagingArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Embalaža ${RUN_ID}`,
      cena: "0.30",
      davek: "22",
      kategorijaId: packagingCategory!.id,
    }).returning({ id: artikliTable.id });
    const [unlistedPackagingArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Druga embalaža ${RUN_ID}`,
      cena: "0.40",
      davek: "22",
      kategorijaId: packagingCategory!.id,
    }).returning({ id: artikliTable.id });
    const [ordinaryArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Dodatek ${RUN_ID}`,
      cena: "0.50",
      davek: "22",
      kategorijaId: foodCategory!.id,
    }).returning({ id: artikliTable.id });
    const [parentArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `To Go obrok ${RUN_ID}`,
      cena: "10.00",
      davek: "22",
      toGo: true,
      toGoArtikli: [packagingArticle!.id, ordinaryArticle!.id],
    }).returning({ id: artikliTable.id });

    const parentResponse = await supertest(app())
      .post(`/narocila/${narociloId}/postavke`)
      .send({ artikelId: parentArticle!.id, kolicina: 1, toGo: true });
    expect(parentResponse.status).toBe(201);
    const [parentLine] = await db.select({ id: postavkeTable.id }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(postavkeTable.artikelId, parentArticle!.id),
    ));

    for (const childArticleId of [packagingArticle!.id, unlistedPackagingArticle!.id, ordinaryArticle!.id]) {
      const childResponse = await supertest(app())
        .post(`/narocila/${narociloId}/postavke`)
        .send({
          artikelId: childArticleId,
          kolicina: 1,
          parentPostavkaId: parentLine!.id,
        });
      expect(childResponse.status).toBe(201);
      expect(childResponse.body.postavke.find((line: { artikelId: number }) => line.artikelId === childArticleId)?.jeEmbalaza)
        .toBe(childArticleId === packagingArticle!.id);
    }

    const childLines = await db.select({
      artikelId: postavkeTable.artikelId,
      jeEmbalaza: postavkeTable.jeEmbalaza,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(postavkeTable.parentPostavkaId, parentLine!.id),
    ));
    expect(childLines.find(line => line.artikelId === packagingArticle!.id)?.jeEmbalaza).toBe(true);
    expect(childLines.find(line => line.artikelId === unlistedPackagingArticle!.id)?.jeEmbalaza).toBe(false);
    expect(childLines.find(line => line.artikelId === ordinaryArticle!.id)?.jeEmbalaza).toBe(false);

    const dineInOrderId = await ustvariNarocilo();
    await supertest(app())
      .post(`/narocila/${dineInOrderId}/postavke`)
      .send({ artikelId: parentArticle!.id, kolicina: 1, toGo: false });
    const [dineInParent] = await db.select({ id: postavkeTable.id }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, dineInOrderId),
      eq(postavkeTable.artikelId, parentArticle!.id),
    ));
    await supertest(app())
      .post(`/narocila/${dineInOrderId}/postavke`)
      .send({
        artikelId: packagingArticle!.id,
        kolicina: 1,
        parentPostavkaId: dineInParent!.id,
      });
    const [dineInChild] = await db.select({ jeEmbalaza: postavkeTable.jeEmbalaza }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, dineInOrderId),
      eq(postavkeTable.parentPostavkaId, dineInParent!.id),
      eq(postavkeTable.artikelId, packagingArticle!.id),
    ));
    expect(dineInChild?.jeEmbalaza).toBe(false);
  });

  it("shrani enonivojske izbire po pozitivnem izvornem artiklu z ulomljeno količino", async () => {
    const narociloId = await ustvariNarocilo();
    const [sourceArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Normativni izvor ${RUN_ID}`,
      cena: "99.00",
      davek: "22",
      vrstniRed: 50,
    }).returning({ id: artikliTable.id });
    const [secondSourceArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Drugi normativni izvor ${RUN_ID}`,
      cena: "88.00",
      davek: "22",
      vrstniRed: 51,
      enotaMere: "kg",
    }).returning({ id: artikliTable.id });
    const [ingredientArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Normativna sestavina ${RUN_ID}`,
      cena: "77.00",
      davek: "22",
      vrstniRed: 52,
      enotaMere: "kg",
    }).returning({ id: artikliTable.id });
    const [garlicArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Česen ${RUN_ID}`,
      cena: "4.00",
      davek: "22",
      vrstniRed: 53,
      enotaMere: "kg",
    }).returning({ id: artikliTable.id });
    const [saladIngredientArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Sestavina solate ${RUN_ID}`,
      cena: "5.00",
      davek: "22",
      vrstniRed: 54,
      enotaMere: "kg",
    }).returning({ id: artikliTable.id });
    const [sourceGroup] = await db.insert(modSkupineTable).values({
      enotaId,
      ime: `Izvorne izbire ${RUN_ID}`,
      obvezna: true,
      minIzbir: 1,
      maxIzbir: 2,
    }).returning({ id: modSkupineTable.id });
    const [parentModifier] = await db.insert(modifikatorjiTable).values({
      skupinaId: modSkupinaId,
      ime: `Izbirni dodatek ${RUN_ID}`,
      cenaDodatek: "2.00",
    }).returning({ id: modifikatorjiTable.id });
    const [nestedModifier] = await db.insert(modifikatorjiTable).values({
      skupinaId: sourceGroup!.id,
      ime: `Vhodna izbira ${RUN_ID}`,
      cenaDodatek: "1.50",
    }).returning({ id: modifikatorjiTable.id });
    const [noGarlicModifier] = await db.insert(modifikatorjiTable).values({
      skupinaId: sourceGroup!.id,
      ime: `Brez česna ${RUN_ID}`,
      cenaDodatek: "0.00",
    }).returning({ id: modifikatorjiTable.id });
    const [secondSourceGroup] = await db.insert(modSkupineTable).values({
      enotaId,
      ime: `Druge izvorne izbire ${RUN_ID}`,
      obvezna: true,
      minIzbir: 1,
      maxIzbir: 1,
    }).returning({ id: modSkupineTable.id });
    const [secondNestedModifier] = await db.insert(modifikatorjiTable).values({
      skupinaId: secondSourceGroup!.id,
      ime: `Druga vhodna izbira ${RUN_ID}`,
      cenaDodatek: "0.75",
    }).returning({ id: modifikatorjiTable.id });
    try {
      await db.insert(artModSkupineTable).values({ artikelId: sourceArticle!.id, skupinaId: sourceGroup!.id });
      await db.insert(artModSkupineTable).values({ artikelId: secondSourceArticle!.id, skupinaId: secondSourceGroup!.id });
      await db.insert(modNormativiTable).values({ modifikatorId: parentModifier!.id, vhodniArtikelId: sourceArticle!.id, kolicina: "0.375" });
      await db.insert(modNormativiTable).values({ modifikatorId: parentModifier!.id, vhodniArtikelId: secondSourceArticle!.id, kolicina: "0.25" });
      await db.insert(modNormativiTable).values({ modifikatorId: nestedModifier!.id, vhodniArtikelId: ingredientArticle!.id, kolicina: "0.2" });
      await db.insert(modNormativiTable).values({ modifikatorId: noGarlicModifier!.id, vhodniArtikelId: garlicArticle!.id, kolicina: "-0.001" });
      await db.insert(modNormativiTable).values({ modifikatorId: secondNestedModifier!.id, vhodniArtikelId: ingredientArticle!.id, kolicina: "0.4" });

      const invalid = await supertest(app())
        .post(`/narocila/${narociloId}/postavke`)
        .send({
          artikelId,
          kolicina: 1,
          izbranModifikatorji: [{
            modifikatorId: parentModifier!.id,
            podIzbire: [{ artikelId, modifikatorIds: [nestedModifier!.id] }],
          }],
        });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error).toContain("ni pozitiven vhodni artikel normativa");

      const response = await supertest(app())
        .post(`/narocila/${narociloId}/postavke`)
        .send({
          artikelId,
          kolicina: 2,
          izbranModifikatorji: [{
            modifikatorId: parentModifier!.id,
            podIzbire: [
              { artikelId: sourceArticle!.id, modifikatorIds: [nestedModifier!.id, noGarlicModifier!.id] },
              { artikelId: secondSourceArticle!.id, modifikatorIds: [secondNestedModifier!.id] },
            ],
          }],
        });
      expect(response.status).toBe(201);

      const replaced = await supertest(app())
        .post(`/narocila/${narociloId}/postavke/${response.body.postavke.find((line: { artikelId: number | null }) => line.artikelId === artikelId).id}/modifikatorji`)
        .send({
          modifikatorji: [{
            modifikatorId: parentModifier!.id,
            podIzbire: [
              { artikelId: sourceArticle!.id, modifikatorIds: [nestedModifier!.id, noGarlicModifier!.id] },
              { artikelId: secondSourceArticle!.id, modifikatorIds: [secondNestedModifier!.id] },
            ],
          }],
          skupineIds: [modSkupinaId],
        });
      expect(replaced.status).toBe(201);

      const lines = await db.select({
        id: postavkeTable.id,
        artikelId: postavkeTable.artikelId,
        modifikatorId: postavkeTable.modifikatorId,
        parentPostavkaId: postavkeTable.parentPostavkaId,
        modifierSourceArticleId: postavkeTable.modifierSourceArticleId,
        kolicina: postavkeTable.kolicina,
        skupaj: postavkeTable.skupaj,
        normativFaktor: postavkeTable.normativFaktor,
        availabilityRequirements: postavkeTable.availabilityRequirements,
      }).from(postavkeTable).where(eq(postavkeTable.narociloId, narociloId));
      expect(lines).toHaveLength(5);
      const saleLine = lines.find((line) => line.artikelId === artikelId)!;
      const parentLine = lines.find((line) => line.modifikatorId === parentModifier!.id)!;
      const nestedLine = lines.find((line) => line.modifikatorId === nestedModifier!.id)!;
      const noGarlicLine = lines.find((line) => line.modifikatorId === noGarlicModifier!.id)!;
      const secondNestedLine = lines.find((line) => line.modifikatorId === secondNestedModifier!.id)!;
      expect(parentLine.parentPostavkaId).toBe(saleLine.id);
      expect(nestedLine).toMatchObject({
        parentPostavkaId: parentLine.id,
        modifierSourceArticleId: sourceArticle!.id,
        kolicina: 2,
        skupaj: "3.00",
        normativFaktor: "0.375000",
      });
      const nestedRequirements = nestedLine.availabilityRequirements ?? [];
      expect(nestedRequirements).toHaveLength(1);
      expect(nestedRequirements[0]).toMatchObject({ articleId: ingredientArticle!.id });
      expect(nestedRequirements[0]!.quantity).toBeCloseTo(0.075, 12);
      expect(noGarlicLine).toMatchObject({
        parentPostavkaId: parentLine.id,
        modifierSourceArticleId: sourceArticle!.id,
        kolicina: 2,
        skupaj: "0.00",
        normativFaktor: "0.375000",
      });
      expect(secondNestedLine).toMatchObject({
        parentPostavkaId: parentLine.id,
        modifierSourceArticleId: secondSourceArticle!.id,
        kolicina: 2,
        skupaj: "1.50",
        normativFaktor: "0.250000",
      });
      const secondNestedRequirements = secondNestedLine.availabilityRequirements ?? [];
      expect(secondNestedRequirements).toHaveLength(1);
      expect(secondNestedRequirements[0]).toMatchObject({ articleId: ingredientArticle!.id });
      expect(secondNestedRequirements[0]!.quantity).toBeCloseTo(0.1, 12);
      expect(lines.some((line) => [sourceArticle!.id, secondSourceArticle!.id].includes(line.artikelId ?? -1))).toBe(false);

      await db.insert(normativiTable).values([
        { artikelId: sourceArticle!.id, vhodniArtikelId: garlicArticle!.id, kolicina: "0.001" },
        { artikelId: sourceArticle!.id, vhodniArtikelId: saladIngredientArticle!.id, kolicina: "0.01" },
      ]);
      const movementLines = [
        {
          id: -10,
          artikelId: null,
          modifikatorId: parentModifier!.id,
          modifierSourceArticleId: null,
          parentPostavkaId: null,
          kolicina: 2,
          normativFaktor: 1,
        },
        {
          id: -11,
          artikelId: null,
          modifikatorId: nestedModifier!.id,
          modifierSourceArticleId: sourceArticle!.id,
          parentPostavkaId: -10,
          kolicina: 2,
          normativFaktor: 0.375,
        },
        {
          id: -12,
          artikelId: null,
          modifikatorId: noGarlicModifier!.id,
          modifierSourceArticleId: sourceArticle!.id,
          parentPostavkaId: -10,
          kolicina: 2,
          normativFaktor: 0.375,
        },
      ];
      const paidMovements = await buildZalogaMovementPlan(movementLines, `NESTED-${RUN_ID}`, new Date());
      expect(paidMovements.find((movement) => movement.artikelId === ingredientArticle!.id)?.kolicina)
        .toBeCloseTo(-0.15, 12);
      expect(paidMovements.find((movement) => movement.artikelId === saladIngredientArticle!.id)?.kolicina)
        .toBeCloseTo(-0.0075, 12);
      expect(paidMovements.find((movement) => movement.artikelId === secondSourceArticle!.id)?.kolicina)
        .toBeCloseTo(-0.5, 12);
      expect(paidMovements.some((movement) => movement.artikelId === sourceArticle!.id)).toBe(false);
      expect(paidMovements.some((movement) => movement.artikelId === garlicArticle!.id)).toBe(false);
      expect(paidMovements).toHaveLength(3);

      await db.update(modifikatorjiTable).set({ cenaDodatek: "0.00" })
        .where(eq(modifikatorjiTable.id, nestedModifier!.id));
      const freeMovements = await buildZalogaMovementPlan(movementLines, `NESTED-FREE-${RUN_ID}`, new Date());
      expect(freeMovements.find((movement) => movement.artikelId === ingredientArticle!.id)?.kolicina)
        .toBeCloseTo(-0.15, 12);
      expect(freeMovements.some((movement) => movement.artikelId === garlicArticle!.id)).toBe(false);
      await db.update(modifikatorjiTable).set({ cenaDodatek: "1.50" })
        .where(eq(modifikatorjiTable.id, nestedModifier!.id));

      const nestedFactor = faktorNormativaPodModifikatorja(0.375, 0.75);
      expect(nestedFactor).toBeCloseTo(0.28125, 12);
      const resized = await supertest(app())
        .patch(`/narocila/${narociloId}/postavke/${saleLine.id}`)
        .send({ kolicina: 3 });
      expect(resized.status).toBe(200);
      const resizedLines = await db.select({
        kolicina: postavkeTable.kolicina,
        skupaj: postavkeTable.skupaj,
      }).from(postavkeTable).where(eq(postavkeTable.narociloId, narociloId));
      expect(resizedLines).toHaveLength(5);
      expect(resizedLines.every((line) => line.kolicina === 3)).toBe(true);
      expect(resizedLines.reduce((sum, line) => sum + Number(line.skupaj), 0)).toBe(42.75);

      const removed = await supertest(app()).delete(`/narocila/${narociloId}/postavke/${saleLine.id}`);
      expect(removed.status).toBe(200);
      expect(await db.select({ id: postavkeTable.id }).from(postavkeTable)
        .where(eq(postavkeTable.narociloId, narociloId))).toEqual([]);
    } finally {
      await db.delete(normativiTable).where(eq(normativiTable.artikelId, sourceArticle!.id));
      await db.delete(modNormativiTable).where(inArray(modNormativiTable.modifikatorId, [
        parentModifier!.id, nestedModifier!.id, noGarlicModifier!.id, secondNestedModifier!.id,
      ]));
      await db.delete(artModSkupineTable).where(and(
        inArray(artModSkupineTable.artikelId, [sourceArticle!.id, secondSourceArticle!.id]),
        inArray(artModSkupineTable.skupinaId, [sourceGroup!.id, secondSourceGroup!.id]),
      ));
      await db.delete(modifikatorjiTable).where(inArray(modifikatorjiTable.id, [
        parentModifier!.id, nestedModifier!.id, noGarlicModifier!.id, secondNestedModifier!.id,
      ]));
      await db.delete(modSkupineTable).where(inArray(modSkupineTable.id, [sourceGroup!.id, secondSourceGroup!.id]));
      await db.delete(artikliTable).where(inArray(artikliTable.id, [
        sourceArticle!.id, secondSourceArticle!.id, ingredientArticle!.id, garlicArticle!.id, saladIngredientArticle!.id,
      ]));
    }
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