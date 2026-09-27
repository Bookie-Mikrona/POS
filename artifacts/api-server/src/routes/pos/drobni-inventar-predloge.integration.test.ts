import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const requestContext = vi.hoisted(() => ({ enotaId: 0, vloga: "admin" }));
vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: any, _res: unknown, next: () => void) => {
    req.enotaId = requestContext.enotaId;
    req.vloga = requestContext.vloga;
    req.companyId = "scope-is-enforced-by-requireEnota";
    next();
  },
}));

import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  pool,
} from "@workspace/db";
import { vsiDrobniInventarPredlogi, OS_PREDLOGI } from "../../lib/drobni-inventar-catalog";
import artikliRouter from "./artikli";

const RUN_ID = Math.random().toString(36).slice(2, 9);
let companyId: string;
let otherCompanyId: string;
let enotaId: number;
let otherEnotaId: number;

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(artikliRouter);
  return instance;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_DI_${RUN_ID}`,
    naziv: `Test drobni inventar ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  const [otherCompany] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_DIO_${RUN_ID}`,
    naziv: `Drugo podjetje drobni inventar ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  otherCompanyId = otherCompany!.id;
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: `Enota A ${RUN_ID}`, aktiven: true })
    .returning({ id: enoteTable.id });
  const [otherUnit] = await db.insert(enoteTable).values({ companyId: otherCompanyId, ime: `Enota B ${RUN_ID}`, aktiven: true })
    .returning({ id: enoteTable.id });
  enotaId = unit!.id;
  otherEnotaId = otherUnit!.id;
});

afterAll(async () => {
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaId, otherEnotaId]));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, otherCompanyId]));
  await pool.end();
});

describe("POST/GET /artikli/drobni-inventar-predloge", () => {
  it("uvozi idempotentno v izbrano enoto in ohrani izolacijo med podjetji/enotami", async () => {
    requestContext.enotaId = enotaId;
    requestContext.vloga = "admin";
    const [first, second] = await Promise.all([
      supertest(app()).post("/artikli/drobni-inventar-predloge").send({}),
      supertest(app()).post("/artikli/drobni-inventar-predloge").send({}),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect([first.body.insertedCount, second.body.insertedCount].sort((a, b) => a - b))
      .toEqual([0, vsiDrobniInventarPredlogi().length]);
    expect([first.body.skippedCount, second.body.skippedCount].sort((a, b) => a - b))
      .toEqual([0, vsiDrobniInventarPredlogi().length]);
    const repeated = await supertest(app()).post("/artikli/drobni-inventar-predloge").send({});
    expect(repeated.body).toEqual({ insertedCount: 0, skippedCount: vsiDrobniInventarPredlogi().length });

    const articleRows = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
    expect(articleRows).toHaveLength(vsiDrobniInventarPredlogi().length);
    expect(articleRows.every((article) => article.drobniInventar && article.nabavniArtikel
      && !article.prodajniArtikel && article.vrstaArtikla === "material"
      && Number(article.davek) === 22 && article.taxCategory === "other")).toBe(true);
    expect(articleRows.find(a => a.drobniInventarPredlogaKljuc === "01-espresso-skodelica-podstavek")?.skupina).toBe("02 - Porcelan");
    expect(articleRows.find(a => a.drobniInventarPredlogaKljuc === "02-deska-lesena-narezek-zar")?.skupina).toBe("05 - Kuhinjska orodja");
    expect(new Set(articleRows.map(a => a.skupina))).toEqual(new Set([
      "01 - Steklovina", "02 - Porcelan", "03 - Jedilni pribor",
      "04 - Kuhinjska posoda & GN", "05 - Kuhinjska orodja",
      "06 - Šank pripomočki", "07 - Tekstil & Ostalo",
    ]));

    requestContext.enotaId = otherEnotaId;
    const other = await supertest(app()).post("/artikli/drobni-inventar-predloge").send({});
    expect(other.status).toBe(200);
    expect(other.body.insertedCount).toBe(vsiDrobniInventarPredlogi().length);
    expect(await db.select({ id: artikliTable.id }).from(artikliTable)
      .where(eq(artikliTable.enotaId, otherEnotaId))).toHaveLength(vsiDrobniInventarPredlogi().length);
    expect(await db.select({ id: artikliTable.id }).from(artikliTable)
      .where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.drobniInventar, false)))).toHaveLength(0);
  });

  it("vrne OS ločeno in ne ustvari nobenega OS predloga kot artikel", async () => {
    requestContext.enotaId = enotaId;
    const response = await supertest(app()).get("/artikli/drobni-inventar-predloge");
    expect(response.status).toBe(200);
    expect(response.body.skupine).toHaveLength(7);
    expect(response.body.osPredlogi).toEqual(expect.arrayContaining(Array.from(OS_PREDLOGI)));
    const insertedNames = new Set((await db.select({ ime: artikliTable.ime }).from(artikliTable)
      .where(eq(artikliTable.enotaId, enotaId))).map((article) => article.ime));
    expect(OS_PREDLOGI.some((proposal) => insertedNames.has(proposal.ime))).toBe(false);
  });

  it("zahteva admin ali admin_enote pravice za uvoz", async () => {
    requestContext.enotaId = enotaId;
    requestContext.vloga = "natakar";
    const response = await supertest(app()).post("/artikli/drobni-inventar-predloge").send({});
    expect(response.status).toBe(403);
  });

  it("tudi ročno dodan drobni inventar ob napačno poslani kategoriji uporablja 22 %", async () => {
    requestContext.enotaId = enotaId;
    requestContext.vloga = "admin";
    const created = await supertest(app()).post("/artikli").send({
      ime: `Ročni kozarec ${RUN_ID}`, cena: 0, davek: 9.5,
      enotaMere: "kos", nabavniArtikel: true, prodajniArtikel: false,
      vrstaArtikla: "material", drobniInventar: true, taxCategory: "food",
    });
    expect(created.status).toBe(201);
    const [article] = await db.select().from(artikliTable).where(eq(artikliTable.id, created.body.id));
    expect(Number(article?.davek)).toBe(22);
    expect(article?.taxCategory).toBe("other");

    const updated = await supertest(app()).put(`/artikli/${created.body.id}`).send({
      ime: `Ročni kozarec ${RUN_ID}`, davek: 9.5, taxCategory: "food",
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const [afterEdit] = await db.select().from(artikliTable).where(eq(artikliTable.id, created.body.id));
    expect(Number(afterEdit?.davek)).toBe(22);
    expect(afterEdit?.taxCategory).toBe("other");
  });
});