import express from "express";
import supertest from "supertest";
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  counterpartiesTable,
  db,
  embalazniPrometiTable,
  enoteTable,
  normativiTable,
  zalogeTable,
} from "@workspace/db";

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.header("x-test-user") ?? null }),
}));

const run = `catalog-export-${Math.random().toString(36).slice(2)}`;
const previousSuperAdmins = process.env.SUPER_ADMIN_IDS;
let companyA = "";
let companyB = "";
let unitA = 0;
let unitB = 0;
let parentArticle = 0;
let localIngredient = 0;
let semiFinished = 0;
let foreignIngredient = 0;
let packagingArticle = 0;
let packagingWithoutMovement = 0;
let supplierOne = "";
let supplierTwo = "";
let app: express.Express;
const hasPdfToText = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

function requestPdf(path: string) {
  return supertest(app).get(path).buffer(true).parse((response, callback) => {
    const chunks: Buffer[] = [];
    response.on("data", chunk => chunks.push(Buffer.from(chunk)));
    response.on("end", () => callback(null, Buffer.concat(chunks)));
  });
}

describe("POS catalog PDF route", () => {
  beforeAll(async () => {
    vi.stubEnv("SUPER_ADMIN_IDS", `${run}-admin`);
    const [{ default: posRouter }] = await Promise.all([import("./index")]);
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).log = { error: () => undefined };
      next();
    });
    app.use(posRouter);

    const companies = await db.insert(companiesTable).values([
      { podjetjeDavcna: `${run}-a`, naziv: `${run}-a` },
      { podjetjeDavcna: `${run}-b`, naziv: `${run}-b` },
    ]).returning({ id: companiesTable.id });
    companyA = companies[0]!.id;
    companyB = companies[1]!.id;
    const units = await db.insert(enoteTable).values([
      { companyId: companyA, ime: `${run}-unit-a` },
      { companyId: companyB, ime: `${run}-unit-b` },
    ]).returning({ id: enoteTable.id });
    unitA = units[0]!.id;
    unitB = units[1]!.id;
    const articles = await db.insert(artikliTable).values([
      { enotaId: unitA, ime: `${run}-sale`, cena: "3.25", davek: "9.5", prodajniArtikel: true, nabavniArtikel: false },
      { enotaId: unitA, ime: `${run}-local-ingredient`, cena: "1", davek: "9.5", enotaMere: "kg", nabavniArtikel: true, prodajniArtikel: false },
      { enotaId: unitB, ime: `${run}-other-tenant`, cena: "2", davek: "9.5", prodajniArtikel: true, nabavniArtikel: false },
      { enotaId: unitA, ime: `${run}-semi`, cena: "0", davek: "0", nabavniArtikel: false, prodajniArtikel: false, vrstaArtikla: null },
      { enotaId: unitB, ime: `${run}-foreign-ingredient`, cena: "1", davek: "9.5", enotaMere: "l", nabavniArtikel: true, prodajniArtikel: false },
      { enotaId: unitA, ime: `${run}-packaging`, cena: "1", davek: "22", povratnaEmbalaza: true, vrstaEmbalaze: "steklenica", enotaMere: "kos" },
      { enotaId: unitA, ime: `${run}-packaging-no-movement`, cena: "1", davek: "22", povratnaEmbalaza: true, enotaMere: "kos" },
    ]).returning({ id: artikliTable.id });
    [parentArticle, localIngredient, , semiFinished, foreignIngredient, packagingArticle, packagingWithoutMovement] =
      articles.map(article => article.id);
    await db.insert(normativiTable).values([
      { artikelId: parentArticle, vhodniArtikelId: localIngredient, kolicina: "0.2500" },
      { artikelId: semiFinished, vhodniArtikelId: foreignIngredient, kolicina: "1.0000" },
    ]);
    const suppliers = await db.insert(counterpartiesTable).values([
      { companyId: companyA, type: "supplier", name: `${run}-supplier-one`, kratkiNaziv: `${run}-supplier-one-short` },
      { companyId: companyA, type: "supplier", name: `${run}-supplier-two`, kratkiNaziv: `${run}-supplier-two-short` },
    ]).returning({ id: counterpartiesTable.id });
    supplierOne = suppliers[0]!.id;
    supplierTwo = suppliers[1]!.id;
    await db.insert(embalazniPrometiTable).values([
      { enotaId: unitA, artikelId: packagingArticle, dobaviteljId: supplierOne, kolicina: "5", vrsta: "prejem" },
      { enotaId: unitA, artikelId: packagingArticle, dobaviteljId: supplierOne, kolicina: "-5", vrsta: "vracilo" },
      { enotaId: unitA, artikelId: packagingArticle, dobaviteljId: supplierTwo, kolicina: "3", vrsta: "prejem" },
    ]);
    await db.insert(zalogeTable).values({
      artikelId: packagingWithoutMovement,
      kolicina: "77",
    });
  }, 60_000);

  afterAll(async () => {
    if (unitA) {
      await db.delete(embalazniPrometiTable).where(eq(embalazniPrometiTable.enotaId, unitA));
    }
    if (companyA) await db.delete(companiesTable).where(eq(companiesTable.id, companyA));
    if (companyB) await db.delete(companiesTable).where(eq(companiesTable.id, companyB));
    if (previousSuperAdmins === undefined) vi.stubEnv("SUPER_ADMIN_IDS", "");
    else vi.stubEnv("SUPER_ADMIN_IDS", previousSuperAdmins);
  });

  it("requires authentication and rejects unsupported catalog scope", async () => {
    const unauthorized = await supertest(app).get("/artikli/izvozi-katalog.pdf?scope=prodajni");
    expect(unauthorized.status).toBe(401);

    const invalid = await supertest(app)
      .get("/artikli/izvozi-katalog.pdf?scope=other")
      .set("x-test-user", `${run}-admin`)
      .set("x-enota-id", String(unitA));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toContain("scope");
  });

  it("exports only the selected unit and resolves recipe ingredients in that unit", async () => {
    const response = await requestPdf("/artikli/izvozi-katalog.pdf?scope=prodajni")
      .set("x-test-user", `${run}-admin`)
      .set("x-enota-id", String(unitA));
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain('filename="katalog-prodajni.pdf"');
    expect(response.body.length).toBeGreaterThan(100);
    if (hasPdfToText) {
      const text = execFileSync("pdftotext", ["-", "-"], { input: response.body, encoding: "utf8" });
      // A deliberately cross-unit normative for the semi-finished item must not
      // enter the sales export or disclose the ingredient owned by unit B.
      expect(text).toContain(`${run}-sale`);
      expect(text).toContain(`${run}-local-ingredient`);
      expect(text).not.toContain(`${run}-other-tenant`);
      expect(text).not.toContain(`${run}-foreign-ingredient`);
    }

    const invalidNormative = await supertest(app)
      .get("/artikli/izvozi-katalog.pdf?scope=polizdelki")
      .set("x-test-user", `${run}-admin`)
      .set("x-enota-id", String(unitA));
    expect(invalidNormative.status).toBe(500);
    expect(invalidNormative.body.error).toContain("normativov");

    // The distinct unit is selected only through the authenticated unit context.
    const otherUnit = await requestPdf("/artikli/izvozi-katalog.pdf?scope=prodajni")
      .set("x-test-user", `${run}-admin`)
      .set("x-enota-id", String(unitB));
    expect(otherUnit.status).toBe(200);
    if (hasPdfToText) {
      const otherText = execFileSync("pdftotext", ["-", "-"], { input: otherUnit.body, encoding: "utf8" });
      expect(otherText).toContain(`${run}-other-tenant`);
      expect(otherText).not.toContain(`${run}-sale`);
    }
  });

  it("prints movement-derived supplier balances, net zero, and clearly labels missing movement", async () => {
    const response = await requestPdf("/artikli/izvozi-katalog.pdf?scope=embalaza")
      .set("x-test-user", `${run}-admin`)
      .set("x-enota-id", String(unitA));
    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toContain('filename="katalog-embalaza.pdf"');
    if (hasPdfToText) {
      const text = execFileSync("pdftotext", ["-", "-"], { input: response.body, encoding: "utf8" });
      expect(text).toContain(`${run}-supplier-one-short: 0 kos`);
      expect(text).toContain(`${run}-supplier-two-short: 3 kos`);
      expect(text).toContain("Skupni knjižni saldo (vsota evidentiranih prometov): 3 kos");
      expect(text).toContain(`${run}-packaging-no-movement`);
      expect(text).toContain("Dobaviteljski saldo: ni zabeleženega prometa.");
      expect(text).not.toContain("77");
    }
  });
});