import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  normativiTable,
  pool,
} from "@workspace/db";

vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { enotaId: number }).enotaId = Number(req.header("x-test-enota"));
    next();
  },
}));

import router, { setNormativRevisionLockTestHook } from "./artikli";

const run = `normativ-revision-${Math.random().toString(36).slice(2)}`;
let companyId = "";
let enotaId = 0;
let artikelId = 0;
let firstIngredientId = 0;
let secondIngredientId = 0;
let compositeIngredientId = 0;
let cycleAId = 0;
let cycleBId = 0;
let concurrentCompositeId = 0;
let concurrentTypeIngredientId = 0;
let mixedUpdateArticleId = 0;
let concurrentCombinedArticleId = 0;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as express.Request & { enotaId: number }).enotaId = Number(req.header("x-test-enota"));
  next();
});
app.use(router);

const request = () => supertest(app).get(`/artikli/${artikelId}/normativi`).set("x-test-enota", String(enotaId));
const save = (body: object) => supertest(app)
  .put(`/artikli/${artikelId}/normativi`)
  .set("x-test-enota", String(enotaId))
  .send(body);
const saveNormativFor = (id: number, body: object) => supertest(app)
  .put(`/artikli/${id}/normativi`)
  .set("x-test-enota", String(enotaId))
  .send(body);
const saveArticleFor = (id: number, body: object) => supertest(app)
  .put(`/artikli/${id}`)
  .set("x-test-enota", String(enotaId))
  .send(body);
const saveArticleAndNormativ = (body: object) => supertest(app)
  .put(`/artikli/${artikelId}`)
  .set("x-test-enota", String(enotaId))
  .send(body);
const deleteArticle = (id: number) => supertest(app)
  .delete(`/artikli/${id}`)
  .set("x-test-enota", String(enotaId));
const createArticleAndNormativ = (body: object) => supertest(app)
  .post("/artikli")
  .set("x-test-enota", String(enotaId))
  .send(body);

function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    await allArrived;
  };
}

describe("optimistični zaklep običajnega normativa (HTTP + PostgreSQL)", () => {
  beforeAll(async () => {
    const [company] = await db.insert(companiesTable)
      .values({ podjetjeDavcna: run, naziv: run })
      .returning({ id: companiesTable.id });
    companyId = company.id;
    const [unit] = await db.insert(enoteTable)
      .values({ companyId, ime: run })
      .returning({ id: enoteTable.id });
    enotaId = unit.id;
    const articles = await db.insert(artikliTable).values([
      { enotaId, ime: `${run}-owner`, cena: "10", davek: "9.5" },
      { enotaId, ime: `${run}-first`, cena: "1", davek: "9.5", nabavniArtikel: true },
      { enotaId, ime: `${run}-second`, cena: "1", davek: "9.5", nabavniArtikel: true },
      { enotaId, ime: `${run}-composite`, cena: "1", davek: "9.5", mealType: "composite" },
      { enotaId, ime: `${run}-cycle-a`, cena: "1", davek: "9.5" },
      { enotaId, ime: `${run}-cycle-b`, cena: "1", davek: "9.5" },
      { enotaId, ime: `${run}-concurrent-composite`, cena: "1", davek: "9.5", mealType: "composite" },
      { enotaId, ime: `${run}-concurrent-type-ingredient`, cena: "1", davek: "9.5" },
      { enotaId, ime: `${run}-mixed-update`, cena: "1", davek: "9.5" },
      { enotaId, ime: `${run}-concurrent-combined`, cena: "1", davek: "9.5" },
    ]).returning({ id: artikliTable.id });
    artikelId = articles[0].id;
    firstIngredientId = articles[1].id;
    secondIngredientId = articles[2].id;
    compositeIngredientId = articles[3].id;
    cycleAId = articles[4].id;
    cycleBId = articles[5].id;
    concurrentCompositeId = articles[6].id;
    concurrentTypeIngredientId = articles[7].id;
    mixedUpdateArticleId = articles[8].id;
    concurrentCombinedArticleId = articles[9].id;
    await db.insert(normativiTable).values({
      artikelId,
      vhodniArtikelId: firstIngredientId,
      kolicina: "1",
      vrstniRed: 0,
    });
  });

  afterAll(async () => {
    if (enotaId) {
      await db.execute(sql`
        DELETE FROM normativi
        WHERE artikel_id IN (SELECT id FROM artikli WHERE enota_id = ${enotaId})
           OR vhodni_artikel_id IN (SELECT id FROM artikli WHERE enota_id = ${enotaId})
      `);
    }
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await pool.end();
  });

  it("drugi dolgo odprti urejevalnik dobi 409 in ne prepiše prvega", async () => {
    const firstEditor = await request();
    const secondEditor = await request();
    expect(firstEditor.status).toBe(200);
    expect(secondEditor.body.normativRevision).toBe(firstEditor.body.normativRevision);
    expect(firstEditor.body.normativi).toHaveLength(1);

    const revision = firstEditor.body.normativRevision as number;
    const firstSave = await save({
      expectedRevision: revision,
      items: [{ vhodniArtikelId: secondIngredientId, kolicina: 2 }],
    });
    expect(firstSave.status).toBe(204);

    const staleSave = await save({
      expectedRevision: revision,
      items: [{ vhodniArtikelId: firstIngredientId, kolicina: 3 }],
    });
    expect(staleSave.status).toBe(409);
    expect(staleSave.body.code).toBe("NORMATIVE_STALE");

    const stored = await db.select({
      vhodniArtikelId: normativiTable.vhodniArtikelId,
      kolicina: normativiTable.kolicina,
    }).from(normativiTable).where(eq(normativiTable.artikelId, artikelId));
    expect(stored).toEqual([{ vhodniArtikelId: secondIngredientId, kolicina: "2.0000" }]);

    const refreshed = await request();
    expect(refreshed.body.normativRevision).toBe(revision + 1);
    expect(refreshed.body.normativi[0].vhodniArtikelId).toBe(secondIngredientId);
  });

  it("pri dveh dejansko sočasnih PUT zahtevkih uspe natanko eden", async () => {
    const opened = await request();
    const revision = opened.body.normativRevision as number;
    const candidates = [
      { vhodniArtikelId: firstIngredientId, kolicina: 11 },
      { vhodniArtikelId: secondIngredientId, kolicina: 12 },
    ];
    setNormativRevisionLockTestHook(createBarrier(2));

    let responses: Awaited<ReturnType<typeof save>>[];
    try {
      responses = await Promise.all(candidates.map(item => save({
        expectedRevision: revision,
        items: [item],
      })));
    } finally {
      setNormativRevisionLockTestHook();
    }

    expect(responses.map(response => response.status).sort()).toEqual([204, 409]);
    const winnerIndex = responses.findIndex(response => response.status === 204);
    const loser = responses.find(response => response.status === 409);
    expect(loser?.body).toEqual(expect.objectContaining({ code: "NORMATIVE_STALE" }));

    const finalState = await request();
    expect(finalState.status).toBe(200);
    expect(finalState.body.normativRevision).toBe(revision + 1);
    expect(finalState.body.normativi).toEqual([
      expect.objectContaining(candidates[winnerIndex]),
    ]);
  });

  it("sočasna A proti B in B proti A ne moreta ustvariti krožnega normativa", async () => {
    const barrier = createBarrier(2);
    setNormativRevisionLockTestHook(barrier);

    let responses: Awaited<ReturnType<typeof saveNormativFor>>[];
    try {
      responses = await Promise.all([
        saveNormativFor(cycleAId, {
          expectedRevision: 1,
          items: [{ vhodniArtikelId: cycleBId, kolicina: 1 }],
        }),
        saveNormativFor(cycleBId, {
          expectedRevision: 1,
          items: [{ vhodniArtikelId: cycleAId, kolicina: 1 }],
        }),
      ]);
    } finally {
      setNormativRevisionLockTestHook();
    }

    expect(responses.map(response => response.status).sort()).toEqual([204, 400]);
    expect(responses.find(response => response.status === 400)?.body).toEqual({
      error: "Normativ bi ustvaril krožno sestavo artiklov.",
    });
    const edges = await db.select({
      artikelId: normativiTable.artikelId,
      vhodniArtikelId: normativiTable.vhodniArtikelId,
    }).from(normativiTable)
      .where(inArray(normativiTable.artikelId, [cycleAId, cycleBId]));
    expect(edges).toHaveLength(1);
    expect([
      [cycleAId, cycleBId],
      [cycleBId, cycleAId],
    ]).toContainEqual([edges[0]!.artikelId, edges[0]!.vhodniArtikelId]);
  });

  it("sočasna sprememba tipa sestavine ne ustvari neveljavnega composite normativa", async () => {
    const barrier = createBarrier(2);
    const arrivals: string[] = [];
    setNormativRevisionLockTestHook(async ({ artikelId: arrivedId, operation }) => {
      arrivals.push(`${operation}:${arrivedId}`);
      await barrier();
    });

    let responses: [
      Awaited<ReturnType<typeof saveNormativFor>>,
      Awaited<ReturnType<typeof saveArticleFor>>,
    ];
    try {
      responses = await Promise.all([
        saveNormativFor(concurrentCompositeId, {
          expectedRevision: 1,
          items: [{ vhodniArtikelId: concurrentTypeIngredientId, kolicina: 1 }],
        }),
        saveArticleFor(concurrentTypeIngredientId, {
          ime: `${run}-concurrent-type-ingredient`,
          mealType: "composite",
          normativUpdate: {
            expectedRevision: 1,
            items: [{ vhodniArtikelId: firstIngredientId, kolicina: 1 }],
          },
        }),
      ]);
    } finally {
      setNormativRevisionLockTestHook();
    }

    expect(responses.map(response => response.status).sort()).toEqual([204, 422]);
    expect(arrivals.sort()).toEqual([
      `article-update:${concurrentTypeIngredientId}`,
      `normativ-update:${concurrentCompositeId}`,
    ]);
    const [ingredient] = await db.select({
      mealType: artikliTable.mealType,
    }).from(artikliTable).where(eq(artikliTable.id, concurrentTypeIngredientId));
    const edges = await db.select({
      vhodniArtikelId: normativiTable.vhodniArtikelId,
    }).from(normativiTable).where(eq(normativiTable.artikelId, concurrentCompositeId));
    expect(
      ingredient!.mealType === "composite"
      && edges.some(edge => edge.vhodniArtikelId === concurrentTypeIngredientId),
    ).toBe(false);
  });

  it("grafovni in navadni popravek istega artikla zaključita brez deadlocka", async () => {
    const barrier = createBarrier(2);
    const arrivals: string[] = [];
    setNormativRevisionLockTestHook(async ({ artikelId: arrivedId, operation }) => {
      arrivals.push(`${operation}:${arrivedId}`);
      await barrier();
    });

    let responses: Awaited<ReturnType<typeof saveArticleFor>>[];
    try {
      responses = await Promise.all([
        saveArticleFor(mixedUpdateArticleId, {
          ime: `${run}-mixed-update`,
          mealType: "prepared",
          normativUpdate: {
            expectedRevision: 1,
            items: [{ vhodniArtikelId: firstIngredientId, kolicina: 1 }],
          },
        }),
        saveArticleFor(mixedUpdateArticleId, {
          ime: `${run}-mixed-update-renamed`,
        }),
      ]);
    } finally {
      setNormativRevisionLockTestHook();
    }

    expect(arrivals).toEqual([
      `article-update:${mixedUpdateArticleId}`,
      `article-update:${mixedUpdateArticleId}`,
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
  });

  it("pri dveh sočasnih celovitih PUT zahtevkih se podatki in normativ shranijo samo zmagovalcu", async () => {
    const candidates = [
      {
        ime: `${run}-combined-first`,
        vhodniArtikelId: firstIngredientId,
        kolicina: 21,
      },
      {
        ime: `${run}-combined-second`,
        vhodniArtikelId: secondIngredientId,
        kolicina: 22,
      },
    ];
    const barrier = createBarrier(2);
    setNormativRevisionLockTestHook(barrier);

    let responses: Awaited<ReturnType<typeof saveArticleFor>>[];
    try {
      responses = await Promise.all(candidates.map(candidate =>
        saveArticleFor(concurrentCombinedArticleId, {
          ime: candidate.ime,
          normativUpdate: {
            expectedRevision: 1,
            items: [{
              vhodniArtikelId: candidate.vhodniArtikelId,
              kolicina: candidate.kolicina,
            }],
          },
        }),
      ));
    } finally {
      setNormativRevisionLockTestHook();
    }

    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const winnerIndex = responses.findIndex(response => response.status === 200);
    expect(responses.find(response => response.status === 409)?.body).toEqual(
      expect.objectContaining({ code: "NORMATIVE_STALE" }),
    );

    const [storedArticle] = await db.select({
      ime: artikliTable.ime,
      normativRevision: artikliTable.normativRevision,
    }).from(artikliTable).where(eq(artikliTable.id, concurrentCombinedArticleId));
    expect(storedArticle).toEqual({
      ime: candidates[winnerIndex]!.ime,
      normativRevision: 2,
    });
    const storedNormativ = await db.select({
      vhodniArtikelId: normativiTable.vhodniArtikelId,
      kolicina: normativiTable.kolicina,
    }).from(normativiTable).where(eq(normativiTable.artikelId, concurrentCombinedArticleId));
    expect(storedNormativ).toEqual([{
      vhodniArtikelId: candidates[winnerIndex]!.vhodniArtikelId,
      kolicina: `${candidates[winnerIndex]!.kolicina}.0000`,
    }]);
  });

  it("zavrne PUT brez revizije odjemalca", async () => {
    const response = await save({ items: [] });
    expect(response.status).toBe(400);
  });

  it("ob 409 atomarnega popravka ne shrani niti imena niti normativa", async () => {
    const opened = await request();
    const staleRevision = opened.body.normativRevision as number;
    const concurrentSave = await save({
      expectedRevision: staleRevision,
      items: [{ vhodniArtikelId: secondIngredientId, kolicina: 4 }],
    });
    expect(concurrentSave.status).toBe(204);

    const staleCombinedSave = await saveArticleAndNormativ({
      ime: `${run}-ime-ki-se-ne-sme-shraniti`,
      normativUpdate: {
        expectedRevision: staleRevision,
        items: [{ vhodniArtikelId: firstIngredientId, kolicina: 7 }],
      },
    });
    expect(staleCombinedSave.status).toBe(409);
    expect(staleCombinedSave.body).toEqual(expect.objectContaining({
      code: "NORMATIVE_STALE",
      error: expect.stringContaining("nista bila shranjena"),
    }));

    const [storedArticle] = await db.select({
      ime: artikliTable.ime,
      normativRevision: artikliTable.normativRevision,
    }).from(artikliTable).where(eq(artikliTable.id, artikelId));
    expect(storedArticle.ime).toBe(`${run}-owner`);
    expect(storedArticle.normativRevision).toBe(staleRevision + 1);

    const storedNormativ = await db.select({
      vhodniArtikelId: normativiTable.vhodniArtikelId,
      kolicina: normativiTable.kolicina,
    }).from(normativiTable).where(eq(normativiTable.artikelId, artikelId));
    expect(storedNormativ).toEqual([{ vhodniArtikelId: secondIngredientId, kolicina: "4.0000" }]);
  });

  it("normativ validira proti predlaganemu končnemu stanju artikla", async () => {
    const opened = await request();
    const response = await saveArticleAndNormativ({
      ime: `${run}-neveljavna-sestava`,
      mealType: "composite",
      normativUpdate: {
        expectedRevision: opened.body.normativRevision,
        items: [{ vhodniArtikelId: compositeIngredientId, kolicina: 1 }],
      },
    });
    expect(response.status).toBe(422);

    const [storedArticle] = await db.select({
      ime: artikliTable.ime,
      mealType: artikliTable.mealType,
    }).from(artikliTable).where(eq(artikliTable.id, artikelId));
    expect(storedArticle).toEqual({
      ime: `${run}-owner`,
      mealType: "ala_carte",
    });
    const storedNormativ = await db.select({
      vhodniArtikelId: normativiTable.vhodniArtikelId,
      kolicina: normativiTable.kolicina,
    }).from(normativiTable).where(eq(normativiTable.artikelId, artikelId));
    expect(storedNormativ).toEqual([{ vhodniArtikelId: secondIngredientId, kolicina: "4.0000" }]);
  });

  it("uspešno ustvari artikel in normativ v eni zahtevi", async () => {
    const ime = `${run}-atomic-create`;
    const response = await createArticleAndNormativ({
      ime,
      mealType: "prepared",
      normativItems: [{ vhodniArtikelId: firstIngredientId, kolicina: 2 }],
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      ime,
      normativRevision: 2,
    }));

    const storedNormativ = await db.select({
      vhodniArtikelId: normativiTable.vhodniArtikelId,
      kolicina: normativiTable.kolicina,
    }).from(normativiTable).where(eq(normativiTable.artikelId, response.body.id));
    expect(storedNormativ).toEqual([{ vhodniArtikelId: firstIngredientId, kolicina: "2.0000" }]);
  });

  it("pri ustvarjanju razreši dovoljeno lastno 1 : 1 sestavino na novi ID", async () => {
    const response = await createArticleAndNormativ({
      ime: `${run}-self-create`,
      nabavniArtikel: true,
      prodajniArtikel: true,
      mealType: "ala_carte",
      normativItems: [{ vhodniArtikelId: -1, kolicina: 1 }],
    });
    expect(response.status).toBe(201);

    const storedNormativ = await db.select({
      artikelId: normativiTable.artikelId,
      vhodniArtikelId: normativiTable.vhodniArtikelId,
      kolicina: normativiTable.kolicina,
    }).from(normativiTable).where(eq(normativiTable.artikelId, response.body.id));
    expect(storedNormativ).toEqual([{
      artikelId: response.body.id,
      vhodniArtikelId: response.body.id,
      kolicina: "1.0000",
    }]);
  });

  it("ob neveljavnem normativu ne ustvari novega artikla", async () => {
    const ime = `${run}-rolled-back-create`;
    const response = await createArticleAndNormativ({
      ime,
      mealType: "composite",
      normativItems: [{ vhodniArtikelId: compositeIngredientId, kolicina: 1 }],
    });
    expect(response.status).toBe(422);

    const stored = await db.select({ id: artikliTable.id })
      .from(artikliTable)
      .where(eq(artikliTable.ime, ime));
    expect(stored).toHaveLength(0);
  });

  it("prazen normativ še vedno vrne revizijo, no-op shranjevanje pa je ne poveča", async () => {
    await db.delete(normativiTable).where(eq(normativiTable.artikelId, artikelId));
    const empty = await request();
    expect(empty.status).toBe(200);
    expect(empty.body.normativi).toEqual([]);
    expect(empty.body.normativRevision).toEqual(expect.any(Number));

    const noOp = await save({
      expectedRevision: empty.body.normativRevision,
      items: [],
    });
    expect(noOp.status).toBe(204);
    const afterNoOp = await request();
    expect(afterNoOp.body.normativRevision).toBe(empty.body.normativRevision);
    expect(afterNoOp.body.normativi).toEqual([]);
  });

  it("izbriše prodajno-nabavni artikel, ki je uporabljen samo v lastnem normativu", async () => {
    const [selfArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `${run}-self-delete`,
      cena: "1",
      davek: "9.5",
      nabavniArtikel: true,
      prodajniArtikel: true,
    }).returning({ id: artikliTable.id });
    await db.insert(normativiTable).values({
      artikelId: selfArticle.id,
      vhodniArtikelId: selfArticle.id,
      kolicina: "1",
      vrstniRed: 0,
    });

    const response = await deleteArticle(selfArticle.id);

    expect(response.status).toBe(204);
    expect(await db.select({ id: artikliTable.id }).from(artikliTable)
      .where(eq(artikliTable.id, selfArticle.id))).toHaveLength(0);
  });

  it("lastnega normativa ne spregleda pri artiklu, ki ni hkrati prodajni in nabavni", async () => {
    const [selfArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `${run}-self-delete-blocked`,
      cena: "1",
      davek: "9.5",
      nabavniArtikel: true,
      prodajniArtikel: false,
    }).returning({ id: artikliTable.id });
    await db.insert(normativiTable).values({
      artikelId: selfArticle.id,
      vhodniArtikelId: selfArticle.id,
      kolicina: "1",
      vrstniRed: 0,
    });

    const response = await deleteArticle(selfArticle.id);

    expect(response.status).toBe(409);
    expect(response.body.vpNormativi).toEqual([
      expect.objectContaining({ id: selfArticle.id }),
    ]);
  });

  it("ne dovoli brisanja, ko prodajno-nabavni artikel uporablja tudi drug normativ", async () => {
    const [target, otherOwner] = await db.insert(artikliTable).values([
      {
        enotaId,
        ime: `${run}-self-and-other-target`,
        cena: "1",
        davek: "9.5",
        nabavniArtikel: true,
        prodajniArtikel: true,
      },
      {
        enotaId,
        ime: `${run}-self-and-other-owner`,
        cena: "1",
        davek: "9.5",
      },
    ]).returning({ id: artikliTable.id });
    await db.insert(normativiTable).values([
      { artikelId: target.id, vhodniArtikelId: target.id, kolicina: "1", vrstniRed: 0 },
      { artikelId: otherOwner.id, vhodniArtikelId: target.id, kolicina: "1", vrstniRed: 0 },
    ]);

    const response = await deleteArticle(target.id);

    expect(response.status).toBe(409);
    expect(response.body.vpNormativi.map((row: { id: number }) => row.id))
      .toEqual(expect.arrayContaining([target.id, otherOwner.id]));
  });
});