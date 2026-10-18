import { execFileSync } from "node:child_process";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Keep middleware, queries, resolver and renderer real, but roll back all fixtures.
const isolation = vi.hoisted(() => ({ root: null as any, tx: null as any }));
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  isolation.root = actual.db;
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(_target, key) {
        const executor = isolation.tx ?? actual.db;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.header("x-test-user") ?? null }),
}));

import {
  artikliTable, companiesTable, db, documentsTable, enoteTable,
  normativiTable, posUporabnikiTable,
} from "@workspace/db";
import { requireEnota, requireUnitCapability } from "../../middlewares/pos";
import artikliRouter from "./artikli";

const run = `allergen-pdf-${Math.random().toString(36).slice(2)}`;
const userId = `${run}-unit-admin`;
const names = {
  own: `${run}-own-dish`,
  ownIngredient: `${run}-own-ingredient`,
  foreign: `${run}-foreign-dish`,
  foreignIngredient: `${run}-foreign-ingredient`,
  ownVerifier: `${run}-own-verifier`,
  foreignVerifier: `${run}-foreign-verifier`,
};
let companyId = "";
let ownUnit = 0;
let foreignUnit = 0;
let ownArticle = 0;
let foreignArticle = 0;
let ownDocument = "";
let foreignDocument = "";
let finishTransaction: (() => void) | undefined;
let transactionFinished: Promise<void> | undefined;
const rollback = new Error("Allergen PDF fixture rollback");

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
  next();
});
// Match the production mount's requireEnota and requireUnitCapability chain.
// In particular, do not inject req.enotaId or rely on the route's legacy unit 1.
app.use("/api/pos", requireEnota, requireUnitCapability, artikliRouter);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

function download(id: number | string, unitSelection: "header" | "query" = "header") {
  const req = request(app)
    .get(`/api/pos/artikli/${id}/alergeni-normativ.pdf`)
    .set("x-test-user", userId)
    .set("x-company-id", companyId);
  return unitSelection === "header"
    ? req.set("x-enota-id", String(ownUnit))
    : req.query({ enota_id: ownUnit });
}

function expectNoForeignData(response: request.Response, content: string) {
  // Also check headers (especially Content-Disposition) and raw response bytes.
  const all = `${JSON.stringify(response.headers)}\n${content}\n${
    Buffer.isBuffer(response.body) ? response.body.toString("latin1") : JSON.stringify(response.body)
  }`;
  // PDF extraction can wrap an identifier between lines. Compare without
  // whitespace so a wrapped foreign name or evidence UUID cannot evade detection.
  const compact = all.replace(/\s/g, "");
  for (const secret of [
    names.foreign, names.foreignIngredient, names.foreignVerifier, foreignDocument,
  ]) {
    expect(secret).not.toBe("");
    expect(compact).not.toContain(secret.replace(/\s/g, ""));
  }
}

describe("GET /api/pos/artikli/:id/alergeni-normativ.pdf — HTTP in izolacija enot", () => {
  beforeAll(async () => {
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    transactionFinished = isolation.root.transaction(async (tx: any) => {
      isolation.tx = tx;
      ready();
      await new Promise<void>(resolve => { finishTransaction = resolve; });
      throw rollback;
    }).catch((error: unknown) => { if (error !== rollback) throw error; });
    await Promise.race([started, transactionFinished]);

    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: run, naziv: run,
    }).returning({ id: companiesTable.id });
    companyId = company!.id;
    const units = await db.insert(enoteTable).values([
      { companyId, ime: `${run}-a` },
      { companyId, ime: `${run}-b` },
    ]).returning({ id: enoteTable.id });
    ownUnit = units[0]!.id;
    foreignUnit = units[1]!.id;
    await db.insert(posUporabnikiTable).values({
      companyId, clerkUserId: userId, vloga: "admin_enote", enotaId: ownUnit,
      ime: "PDF", priimek: run,
    });
    const documents = await db.insert(documentsTable).values(
      ["own", "foreign"].map(scope => ({
        companyId, fileName: `${run}-${scope}-evidence.pdf`,
        mimeType: "application/pdf", objectPath: `/test/${run}/${scope}-evidence.pdf`,
      })),
    ).returning({ id: documentsTable.id });
    ownDocument = documents[0]!.id;
    foreignDocument = documents[1]!.id;
    const articles = await db.insert(artikliTable).values([
      { enotaId: ownUnit, ime: names.own, alergeniVir: "normativ" as const },
      {
        enotaId: ownUnit, ime: names.ownIngredient, alergeniVir: "etiketa" as const,
        alergeniDocumentId: ownDocument, alergeniVerifiedBy: names.ownVerifier,
      },
      { enotaId: foreignUnit, ime: names.foreign, alergeniVir: "normativ" as const },
      {
        enotaId: foreignUnit, ime: names.foreignIngredient, alergeniVir: "specifikacija" as const,
        alergeniDocumentId: foreignDocument, alergeniVerifiedBy: names.foreignVerifier,
      },
    ].map(article => ({
      ...article, cena: "1", davek: "9.5", alergeniStatus: "potrjeno_brez" as const,
    }))).returning({ id: artikliTable.id });
    ownArticle = articles[0]!.id;
    foreignArticle = articles[2]!.id;
    await db.insert(normativiTable).values([
      { artikelId: ownArticle, vhodniArtikelId: articles[1]!.id, kolicina: "0.125" },
      // Independent FKs permit a corrupt/legacy cross-unit link. Even an
      // authorized dish must not disclose that ingredient or its evidence.
      { artikelId: ownArticle, vhodniArtikelId: articles[3]!.id, kolicina: "0.875" },
      { artikelId: foreignArticle, vhodniArtikelId: articles[3]!.id, kolicina: "0.375" },
    ]);
  });

  afterAll(async () => {
    try {
      finishTransaction?.();
      await transactionFinished;
    } finally {
      isolation.tx = null;
    }
    if (companyId) {
      expect(await db.select({ id: companiesTable.id }).from(companiesTable)
        .where(eq(companiesTable.id, companyId))).toEqual([]);
    }
  });

  it.each(["header", "query"] as const)("lasten artikel vrne pravi PDF (enota prek %s)", async selection => {
    const response = await download(ownArticle, selection);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf\b/);
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="normativ-alergeni-${ownArticle}.pdf"`,
    );
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 5).toString()).toBe("%PDF-");
    const text = execFileSync("pdftotext", ["-layout", "-", "-"], {
      input: response.body, encoding: "utf8",
    });
    for (const value of [
      `Enota: ${ownUnit}`, names.own, names.ownIngredient, "0.125", ownDocument, "etiketa",
    ]) expect(text.replace(/\s/g, "")).toContain(value.replace(/\s/g, ""));
    expect(text).not.toContain("0.875");
    expectNoForeignData(response, text);
  });

  it.each(["header", "query"] as const)("artikel druge enote vrne 404 brez tujih podatkov (%s)", async selection => {
    const foreign = await download(foreignArticle, selection);
    const missing = await download(2147483647, selection);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: "Artikel ni najden." });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(foreign.body);
    for (const response of [foreign, missing]) {
      expect(response.headers["content-type"]).toMatch(/^application\/json\b/);
      expect(response.headers["content-disposition"]).toBeUndefined();
      expectNoForeignData(response, response.text);
    }
  });

  it.each(["abc", "0", "-1", "1.5", "12abc"])("neveljaven ID %s vrne 400 brez podatkov artiklov", async id => {
    const response = await download(id);
    expect(response.status).toBe(400);
    expect(response.headers["content-type"]).toMatch(/^application\/json\b/);
    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(response.body).toEqual({ error: "Neveljaven ID artikla." });
    expectNoForeignData(response, response.text);
  });
});
