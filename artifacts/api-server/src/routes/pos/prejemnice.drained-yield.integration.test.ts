import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  companyId: "",
  enotaId: 0,
  userId: "drained-yield-route-test",
}));
const anthropicMock = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../middlewares/pos", () => {
  const attachContext = (req: any, _res: any, next: any) => {
    req.companyId = context.companyId;
    req.enotaId = context.enotaId;
    req.clerkUserId = context.userId;
    next();
  };
  return { requireEnota: attachContext, requireIzbranaEnota: attachContext };
});
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: anthropicMock.create } },
}));

import express from "express";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { createCanvas } from "@napi-rs/canvas";
import {
  artikliTable,
  companiesTable,
  counterpartiesTable,
  db,
  enoteTable,
  prejemnicePostavkeTable,
  prejemniceTable,
  purchaseSourceDocumentsTable,
  uvozSejaTable,
  zalogaGibiTable,
} from "@workspace/db";
import prejemniceRouter from "./prejemnice";
import uvozPrejemnicRouter from "./uvoz-prejemnic";

const app = express();
app.use(express.json());
app.use(prejemniceRouter);
app.use(uvozPrejemnicRouter);
app.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));

const run = Math.random().toString(36).slice(2, 9);
let companyId: string;
let enotaId: number;
let supplierId: string;
let articleId: number;
const createdReceiptIds: number[] = [];
const createdArticleIds: number[] = [];
const createdImportSessionIds: string[] = [];

describe("drained-yield POS receipt routes", () => {
  beforeAll(async () => {
    const [company] = await db.insert(companiesTable).values({
      naziv: `Drained yield route ${run}`,
      podjetjeDavcna: `SI${run}44`,
    }).returning({ id: companiesTable.id });
    companyId = company.id;
    context.companyId = companyId;

    const [unit] = await db.insert(enoteTable).values({
      companyId,
      ime: `Drained unit ${run}`,
    }).returning({ id: enoteTable.id });
    enotaId = unit.id;
    context.enotaId = enotaId;

    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId,
      type: "supplier",
      name: `Drained supplier ${run}`,
    }).returning({ id: counterpartiesTable.id });
    supplierId = supplier.id;

    const [article] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Drained jars ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "kg",
      nabavniArtikel: true,
      prodajniArtikel: false,
      brutoTezaG: "500",
      netoDelezOdst: "96",
    }).returning({ id: artikliTable.id });
    articleId = article.id;
  });

  afterAll(async () => {
    if (!companyId) return;
    await db.execute(sql.raw("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_history_append_only"));
    try {
      await db.delete(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId));
    } finally {
      await db.execute(sql.raw("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_history_append_only"));
    }
    if (createdImportSessionIds.length) {
      await db.delete(uvozSejaTable).where(inArray(uvozSejaTable.id, createdImportSessionIds));
    }
    if (createdReceiptIds.length) {
      await db.delete(prejemniceTable).where(inArray(prejemniceTable.id, createdReceiptIds));
    }
    if (supplierId) {
      await db.delete(purchaseSourceDocumentsTable)
        .where(eq(purchaseSourceDocumentsTable.counterpartyId, supplierId));
    }
    if (createdArticleIds.length) {
      await db.delete(artikliTable).where(inArray(artikliTable.id, createdArticleIds));
    }
    await db.delete(artikliTable).where(eq(artikliTable.id, articleId));
    await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, supplierId));
    await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("requires explicit source quantity/unit and stores drained stock with its full purchase value", async () => {
    const response = await request(app).post("/prejemnice").send({
      datum: "2026-03-01",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 50,
      postavke: [{
        artikelId: articleId,
        kolicina: 10,
        cenaKos: 5,
        ddvStopnja: 0,
      }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("odcejeni zalogi");

    const created = await request(app).post("/prejemnice").send({
      datum: "2026-03-01",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 50,
      postavke: [{
        artikelId: articleId,
        kolicina: 10,
        cenaKos: 5,
        izvKolicina: 10,
        izvCena: 5,
        izvEnota: "KOM",
        ddvStopnja: 0,
        netoDelezOdst: 70,
      }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    createdReceiptIds.push(created.body.id);
    const [receipt] = await db.select().from(prejemniceTable)
      .where(eq(prejemniceTable.id, created.body.id));
    const [line] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, created.body.id));
    expect(Number(receipt.skupajVrednost)).toBe(50);
    expect(Number(line.kolicina)).toBeCloseTo(3.5, 6);
    expect(Number(line.skupaj)).toBe(50);
    expect(Number(line.cenaKos)).toBeCloseTo(50 / 3.5, 4);
    expect(Number(line.netoTezaG)).toBe(350);
    expect(Number(line.izvKolicina)).toBe(10);
    expect(line.izvEnota).toBe("KOM");

    const noOpEdit = await request(app).put(`/prejemnice/${created.body.id}`).send({
      postavke: [{
        id: line.id,
        artikelId: articleId,
        kolicina: Number(line.kolicina),
        cenaKos: Number(line.cenaKos),
        skupaj: Number(line.skupaj),
        netoZnesek: Number(line.netoZnesek),
        ddvStopnja: 0,
        izvKolicina: Number(line.izvKolicina),
        izvCena: Number(line.izvCena),
        izvEnota: line.izvEnota,
        brutoTezaG: null,
        netoTezaG: null,
        netoDelezOdst: null,
      }],
    });
    expect(noOpEdit.status).toBe(200);
    const [unchanged] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, created.body.id));
    expect(Number(unchanged.kolicina)).toBeCloseTo(3.5, 6);
    expect(Number(unchanged.skupaj)).toBe(50);
    expect(Number(unchanged.netoTezaG)).toBe(350);
    expect(Number(unchanged.netoDelezOdst)).toBe(70);
    expect(Number(unchanged.izvKolicina)).toBe(10);
  });

  it("capitalizes gross VAT for a non-VAT buyer while preserving the invoice base", async () => {
    const response = await request(app).post("/prejemnice").send({
      datum: "2026-03-02",
      vrstaCen: "bruto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 50,
      postavke: [{
        artikelId: articleId,
        kolicina: 10,
        cenaKos: 5,
        izvKolicina: 10,
        izvCena: 5,
        izvEnota: "KOM",
        ddvStopnja: 22,
      }],
    });
    expect(response.status).toBe(201);
    createdReceiptIds.push(response.body.id);
    const [receipt] = await db.select().from(prejemniceTable)
      .where(eq(prejemniceTable.id, response.body.id));
    const [line] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, response.body.id));
    expect(Number(receipt.skupajVrednost)).toBe(50);
    expect(Number(receipt.ddvOsnova)).toBe(40.98);
    expect(Number(receipt.ddvZnesek)).toBe(9.02);
    expect(Number(line.skupaj)).toBe(50);
    expect(Number(line.netoZnesek)).toBe(40.98);
  });

  it("persists and edits manual gross source price and discount semantics", async () => {
    const response = await request(app).post("/prejemnice").send({
      datum: "2026-03-05",
      vrstaCen: "bruto",
      vrstaDokumenta: "RACUN",
      brutoSkupaj: 45,
      postavke: [{
        artikelId: articleId,
        kolicina: 10,
        cenaKos: 5,
        izvKolicina: 10,
        izvCena: 5,
        izvEnota: "KOM",
        izvCenaVrsta: "bruto",
        rabat1Odst: 10,
        rabatVkljucenVCeni: false,
        ddvStopnja: 22,
        brutoTezaG: 500,
        netoDelezOdst: 70,
      }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    createdReceiptIds.push(response.body.id);

    const detail = await request(app).get(`/prejemnice/${response.body.id}`);
    expect(detail.status).toBe(200);
    const sourceLine = detail.body.postavke[0];
    expect(sourceLine).toMatchObject({
      izvCenaVrsta: "bruto",
      rabatVkljucenVCeni: false,
      brutoTezaG: 500,
      netoDelezOdst: 70,
    });
    expect(sourceLine.rabat1Odst).toBe(10);
    expect(sourceLine.izvKolicina).toBe(10);
    expect(sourceLine.izvCena).toBe(5);
    expect(sourceLine.kolicina).toBeCloseTo(3.5, 6);
    expect(sourceLine.skupaj).toBe(45);
    expect(sourceLine.netoZnesek).toBe(36.89);
    expect(sourceLine.ddvZnesek).toBe(8.11);

    const edited = await request(app).put(`/prejemnice/${response.body.id}`).send({
      postavke: [{
        id: sourceLine.id,
        artikelId: articleId,
        kolicina: sourceLine.kolicina,
        cenaKos: sourceLine.cenaKos,
        skupaj: sourceLine.skupaj,
        izvKolicina: sourceLine.izvKolicina,
        izvCena: sourceLine.izvCena,
        izvEnota: sourceLine.izvEnota,
        izvCenaVrsta: sourceLine.izvCenaVrsta,
        rabat1Odst: sourceLine.rabat1Odst,
        rabatVkljucenVCeni: sourceLine.rabatVkljucenVCeni,
        ddvStopnja: sourceLine.ddvStopnja,
        netoZnesek: sourceLine.netoZnesek,
        ddvOsnova: sourceLine.ddvOsnova,
        ddvZnesek: sourceLine.ddvZnesek,
        brutoTezaG: sourceLine.brutoTezaG,
        netoTezaG: sourceLine.netoTezaG,
        netoDelezOdst: sourceLine.netoDelezOdst,
      }],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const [unchanged] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, response.body.id));
    expect(Number(unchanged.kolicina)).toBeCloseTo(3.5, 6);
    expect(Number(unchanged.skupaj)).toBe(45);
    expect(Number(unchanged.netoZnesek)).toBe(36.89);
    expect(Number(unchanged.ddvZnesek)).toBe(8.11);
    expect(unchanged.izvCenaVrsta).toBe("bruto");
    expect(unchanged.rabatVkljucenVCeni).toBe(false);
    expect(Number(unchanged.rabat1Odst)).toBe(10);

    const repriced = await request(app).put(`/prejemnice/${response.body.id}`).send({
      postavke: [{
        // Edits replace rows and therefore issue a new line ID. Reuse the
        // current persisted ID so this request exercises an edit, not a new line.
        id: unchanged.id,
        artikelId: articleId,
        izvKolicina: sourceLine.izvKolicina,
        izvCena: 6,
        izvEnota: sourceLine.izvEnota,
        izvCenaVrsta: sourceLine.izvCenaVrsta,
        rabat1Odst: sourceLine.rabat1Odst,
        rabatVkljucenVCeni: sourceLine.rabatVkljucenVCeni,
        ddvStopnja: sourceLine.ddvStopnja,
        netoZnesek: sourceLine.netoZnesek,
        ddvOsnova: sourceLine.ddvOsnova,
        ddvZnesek: sourceLine.ddvZnesek,
        brutoTezaG: sourceLine.brutoTezaG,
        netoTezaG: sourceLine.netoTezaG,
        netoDelezOdst: sourceLine.netoDelezOdst,
      }],
    });
    expect(repriced.status, JSON.stringify(repriced.body)).toBe(200);
    const [repricedLine] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, response.body.id));
    expect(Number(repricedLine.izvCena)).toBe(6);
    expect(Number(repricedLine.rabat1Odst)).toBe(10);
    expect(Number(repricedLine.kolicina)).toBeCloseTo(3.5, 6);
    expect(Number(repricedLine.skupaj)).toBe(54);
    expect(Number(repricedLine.netoZnesek)).toBe(44.26);
    expect(Number(repricedLine.ddvZnesek)).toBe(9.74);
  });

  it("keeps OCR net unit prices net on gross-mode documents and reprices them without VAT division", async () => {
    const [simpleArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Internal net-price article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
    }).returning({ id: artikliTable.id });
    createdArticleIds.push(simpleArticle.id);

    const canvas = createCanvas(1, 1);
    const context2d = canvas.getContext("2d");
    context2d.fillStyle = "#123456";
    context2d.fillRect(0, 0, 1, 1);
    const slika = canvas.toBuffer("image/png").toString("base64");
    anthropicMock.create.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          dobaviteljNaziv: `Drained supplier ${run}`,
          stDokumenta: `OCR-NET-${run}`,
          datumDokumenta: "2026-03-07",
          vrstaDokumenta: "RACUN",
          ceneBruto: true,
          skupajNeto: "50",
          postavke: [{
            naziv: `Imported oyster source line ${run}`,
            kolicina: "10",
            cena: "5",
            izvCenaVrsta: null,
            vrednost: "50",
            davek: 22,
            enota: "KOM",
            vrsticaTip: "artikel",
          }],
        }),
      }],
    });

    const imported = await request(app).post("/ocr").send({
      slika,
      mimeTip: "image/png",
      dobaviteljId: supplierId,
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    const receiptId = imported.body.prejemnicaId as number;
    createdReceiptIds.push(receiptId);
    createdImportSessionIds.push(imported.body.sejaId);

    let [line] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, receiptId));
    expect(line.izvCenaVrsta).toBe("neto");
    expect(Number(line.izvCena)).toBe(5);
    expect(Number(line.netoZnesek)).toBe(50);
    expect(Number(line.ddvZnesek), JSON.stringify({ line, imported: imported.body })).toBe(11);

    await db.update(prejemnicePostavkeTable)
      .set({ artikelId: simpleArticle.id })
      .where(eq(prejemnicePostavkeTable.id, line.id));
    const edited = await request(app).put(`/prejemnice/${receiptId}`).send({
      postavke: [{
        id: line.id,
        artikelId: simpleArticle.id,
        izvKolicina: Number(line.izvKolicina),
        izvCena: 6,
        izvEnota: line.izvEnota,
        izvCenaVrsta: line.izvCenaVrsta,
        rabat1Odst: Number(line.rabat1Odst),
        rabat2Odst: Number(line.rabat2Odst),
        rabatVkljucenVCeni: line.rabatVkljucenVCeni,
        ddvStopnja: Number(line.ddvStopnja),
        netoZnesek: Number(line.netoZnesek),
        ddvOsnova: Number(line.ddvOsnova),
        ddvZnesek: Number(line.ddvZnesek),
      }],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    [line] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, receiptId));
    expect(Number(line.izvCena)).toBe(6);
    expect(line.izvCenaVrsta).toBe("neto");
    expect(Number(line.netoZnesek)).toBe(60);
    expect(Number(line.ddvZnesek)).toBe(13.2);
    expect(Number(line.skupaj)).toBe(73.2);
  });

  it("preserves an OCR/file-imported gross-priced drained line on a no-op edit", async () => {
    const [receipt] = await db.insert(prejemniceTable).values({
      enotaId,
      dobaviteljId: supplierId,
      stevilka: `DY-OCR-${run}`,
      datum: new Date("2026-03-06T00:00:00Z"),
      vrstaCen: "bruto",
      skupajVrednost: "45",
      ddvOsnova: "36.89",
      ddvZnesek: "8.11",
      vrstaDokumenta: "RACUN",
      prejemnikNaziv: "Non-VAT buyer",
    }).returning({ id: prejemniceTable.id });
    createdReceiptIds.push(receipt.id);
    const [line] = await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: receipt.id,
      artikelId: articleId,
      kolicina: "3.5",
      cenaKos: "12.8571",
      skupaj: "45",
      izvKolicina: "10",
      izvCena: "5",
      izvEnota: "KOM",
      izvCenaVrsta: "bruto",
      rabatVkljucenVCeni: false,
      rabat1Odst: "10",
      rabat2Odst: "0",
      brutoTezaG: "500",
      netoTezaG: "350",
      netoDelezOdst: "70",
      ddvStopnja: "22",
      ddvOsnova: "36.89",
      ddvZnesek: "8.11",
      netoCena: "10.54",
      netoZnesek: "36.89",
    }).returning();

    const detail = await request(app).get(`/prejemnice/${receipt.id}`);
    expect(detail.status).toBe(200);
    const sourceLine = detail.body.postavke[0];
    expect(sourceLine).toMatchObject({
      izvCenaVrsta: "bruto",
      rabatVkljucenVCeni: false,
      rabat1Odst: 10,
      rabat2Odst: 0,
    });
    const edited = await request(app).put(`/prejemnice/${receipt.id}`).send({
      postavke: [{
        id: line.id,
        artikelId: articleId,
        kolicina: sourceLine.kolicina,
        cenaKos: sourceLine.cenaKos,
        skupaj: sourceLine.skupaj,
        izvKolicina: sourceLine.izvKolicina,
        izvCena: sourceLine.izvCena,
        izvEnota: sourceLine.izvEnota,
        izvCenaVrsta: sourceLine.izvCenaVrsta,
        rabat1Odst: sourceLine.rabat1Odst,
        rabat2Odst: sourceLine.rabat2Odst,
        rabatVkljucenVCeni: sourceLine.rabatVkljucenVCeni,
        ddvStopnja: sourceLine.ddvStopnja,
        netoZnesek: sourceLine.netoZnesek,
        ddvOsnova: sourceLine.ddvOsnova,
        ddvZnesek: sourceLine.ddvZnesek,
        brutoTezaG: sourceLine.brutoTezaG,
        netoTezaG: sourceLine.netoTezaG,
        netoDelezOdst: sourceLine.netoDelezOdst,
      }],
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const [unchanged] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, receipt.id));
    expect(Number(unchanged.kolicina)).toBeCloseTo(3.5, 6);
    expect(Number(unchanged.skupaj)).toBe(45);
    expect(Number(unchanged.netoZnesek)).toBe(36.89);
    expect(Number(unchanged.ddvZnesek)).toBe(8.11);
    expect(Number(unchanged.izvCena)).toBe(5);
    expect(Number(unchanged.rabat1Odst)).toBe(10);
  });

  it("excludes recoverable VAT from stock cost for a VAT-registered buyer", async () => {
    await db.update(companiesTable)
      .set({ idZaDdv: `SI${run}44` })
      .where(eq(companiesTable.id, companyId));
    const response = await request(app).post("/prejemnice").send({
      datum: "2026-03-04",
      vrstaCen: "bruto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 50,
      postavke: [{
        artikelId: articleId,
        kolicina: 10,
        cenaKos: 5,
        izvKolicina: 10,
        izvCena: 5,
        izvEnota: "KOM",
        ddvStopnja: 22,
      }],
    });
    await db.update(companiesTable).set({ idZaDdv: null })
      .where(eq(companiesTable.id, companyId));
    expect(response.status).toBe(201);
    createdReceiptIds.push(response.body.id);
    const [receipt] = await db.select().from(prejemniceTable)
      .where(eq(prejemniceTable.id, response.body.id));
    const [line] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, response.body.id));
    expect(Number(receipt.skupajVrednost)).toBe(40.98);
    expect(Number(line.skupaj)).toBe(40.98);
    expect(Number(line.netoZnesek)).toBe(40.98);
    expect(Number(line.ddvZnesek)).toBe(9.02);
  });

  it("returns the yield snapshot and applies it through manual import matching", async () => {
    const [receipt] = await db.insert(prejemniceTable).values({
      enotaId,
      dobaviteljId: supplierId,
      stevilka: `DY-MATCH-${run}`,
      datum: new Date("2026-03-03T00:00:00Z"),
      skupajVrednost: "50",
      prejemnikNaziv: "Non-VAT buyer",
    }).returning({ id: prejemniceTable.id });
    createdReceiptIds.push(receipt.id);
    const [line] = await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: receipt.id,
      artikelId: null,
      kolicina: "10",
      cenaKos: "5",
      skupaj: "50",
      izvKolicina: "10",
      izvCena: "5",
      izvEnota: "KOM",
      izvCenaVrsta: "bruto",
      rabatVkljucenVCeni: false,
      rabat1Odst: "0",
      rabat2Odst: "0",
      ddvOsnova: "50",
      netoZnesek: "50",
      ddvZnesek: "0",
      brutoTezaG: "500",
      netoDelezOdst: "96",
      vrsticaTip: "zaloga",
    }).returning({ id: prejemnicePostavkeTable.id });

    const unmatched = await request(app).get(`/prejemnice/${receipt.id}/neuparjeno`);
    expect(unmatched.status).toBe(200);
    expect(unmatched.body.vsebina[0]).toMatchObject({
      id: line.id,
      brutoTezaG: 500,
      netoTezaG: null,
      netoDelezOdst: 96,
      izvCenaVrsta: "bruto",
      rabatVkljucenVCeni: false,
      rabat1Odst: 0,
      rabat2Odst: 0,
    });

    const matched = await request(app).post(`/postavke/${line.id}/upari`).send({
      artikelId: articleId,
      enotVPaketu: 1,
      zapomni: false,
      brutoTezaG: null,
      netoTezaG: null,
      netoDelezOdst: null,
    });
    expect(matched.status).toBe(200);
    const [updated] = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.id, line.id));
    expect(updated.artikelId).toBe(articleId);
    expect(Number(updated.kolicina)).toBeCloseTo(4.8, 6);
    expect(Number(updated.skupaj)).toBe(50);
    expect(Number(updated.brutoTezaG)).toBe(500);
    expect(Number(updated.netoTezaG)).toBe(480);
    expect(Number(updated.netoDelezOdst)).toBe(96);
  });
});