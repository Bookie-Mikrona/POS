import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  companyId: "",
  enotaId: 0,
  userId: "supplier-order-route-test",
  role: "admin",
}));

vi.mock("../../middlewares/pos", () => ({
  requireEnota(req: any, _res: any, next: any) {
    req.companyId = context.companyId;
    req.enotaId = context.enotaId;
    req.clerkUserId = context.userId;
    req.vloga = context.role;
    next();
  },
}));

import express from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  artikelDobaviteljTable,
  artikliTable,
  companiesTable,
  counterpartiesTable,
  db,
  enoteTable,
  posSupplierOrderLinesTable,
  posSupplierOrdersTable,
  posSupplierReorderSettingsTable,
  prejemnicePostavkeTable,
  prejemniceTable,
  purchaseSourceDocumentsTable,
  zalogeTable,
  zalogaGibiTable,
} from "@workspace/db";
import prejemniceRouter from "./prejemnice";
import supplierOrdersRouter from "./narocila-dobaviteljem";

const app = express();
app.use(express.json());
app.use(prejemniceRouter);
app.use(supplierOrdersRouter);
app.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));

const run = Math.random().toString(36).slice(2, 9);
let companyId = "";
let enotaId = 0;
let supplierId = "";
let articleId = 0;
let mappingId = 0;
const orderIds: number[] = [];
const receiptIds: number[] = [];

describe("POS supplier ordering and linked receipt flow", () => {
  beforeAll(async () => {
    const [company] = await db.insert(companiesTable).values({
      naziv: `Supplier order ${run}`,
      podjetjeDavcna: `SI${run}78`,
    }).returning({ id: companiesTable.id });
    companyId = company.id;
    context.companyId = companyId;

    const [unit] = await db.insert(enoteTable).values({
      companyId,
      ime: `Supplier order unit ${run}`,
    }).returning({ id: enoteTable.id });
    enotaId = unit.id;
    context.enotaId = enotaId;

    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId,
      type: "supplier",
      name: `Supplier ${run}`,
    }).returning({ id: counterpartiesTable.id });
    supplierId = supplier.id;

    const [article] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Order article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleId = article.id;

    const [mapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: articleId,
      dobaviteljId: supplierId,
      sifraDobavitelja: `SUP-${run}`,
      nazivDobavitelja: `Supplier pack ${run}`,
      enotVPaketu: "6",
      nazivPaketa: "zaboj",
      zadnjaCenaPaket: "18",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingId = mapping.id;

    await db.insert(zalogeTable).values({ artikelId: articleId, kolicina: "2" });
    await db.insert(zalogaGibiTable).values({
      artikelId: articleId,
      tip: "prejemnica",
      kolicina: "2",
      cenaKos: "5",
      vrednost: "10",
      opomba: "Začetne zaloge — supplier order test",
      actorSnapshot: context.userId,
      effectiveAtSnapshot: new Date("2026-10-16T10:00:00.000Z"),
      sourceSnapshot: "test_supplier_order_opening_stock",
    });
  });

  afterAll(async () => {
    if (!companyId) return;

    await db.execute(sql.raw("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_history_append_only"));
    try {
      if (articleId) await db.delete(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId));
    } finally {
      await db.execute(sql.raw("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_history_append_only"));
    }

    if (receiptIds.length) {
      await db.delete(prejemniceTable).where(inArray(prejemniceTable.id, receiptIds));
    }
    if (orderIds.length) {
      await db.delete(posSupplierOrdersTable).where(inArray(posSupplierOrdersTable.id, orderIds));
    }
    if (mappingId) await db.delete(artikelDobaviteljTable).where(eq(artikelDobaviteljTable.id, mappingId));
    if (articleId) {
      await db.delete(posSupplierReorderSettingsTable).where(eq(posSupplierReorderSettingsTable.artikelId, articleId));
      await db.delete(zalogeTable).where(eq(zalogeTable.artikelId, articleId));
      await db.delete(artikliTable).where(eq(artikliTable.id, articleId));
    }
    if (supplierId) {
      await db.delete(purchaseSourceDocumentsTable)
        .where(eq(purchaseSourceDocumentsTable.counterpartyId, supplierId));
    }
    if (supplierId) await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, supplierId));
    await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("keeps order drafts out of stock, rounds suggestions to packs, and tracks confirmed partial receipts", async () => {
    const settings = await request(app)
      .put(`/narocila-dobaviteljem/artikli/${articleId}/nastavitve`)
      .send({ reorderPoint: 5, targetStock: 17, preferredMappingId: mappingId });
    expect(settings.status, JSON.stringify(settings.body)).toBe(200);
    expect(settings.body).toMatchObject({
      articleId,
      reorderPoint: 5,
      targetStock: 17,
      preferredMappingId: mappingId,
    });

    const initial = await request(app).get("/narocila-dobaviteljem/pregled");
    expect(initial.status).toBe(200);
    expect(initial.body.articles.find((row: any) => row.articleId === articleId)).toMatchObject({
      onHand: 2,
      openOrderQuantity: 0,
      suggestedBaseQuantity: 15,
      suggestedPackageQuantity: 3,
      hasSuggestion: true,
    });

    const created = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-05",
      notes: "Prvo naročilo",
      lines: [{ supplierMappingId: mappingId, packageQuantity: 2, unitPrice: 18 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    orderIds.push(created.body.id);
    expect(created.body).toMatchObject({
      status: "draft",
      supplierId,
      lineCount: 1,
      lines: [{
        supplierMappingId: mappingId,
        packageQuantity: 2,
        packageFactor: 6,
        orderedBaseQuantity: 12,
        receivedBaseQuantity: 0,
        openBaseQuantity: 12,
      }],
    });
    const [stockBeforeSend] = await db.select().from(zalogeTable).where(eq(zalogeTable.artikelId, articleId));
    expect(Number(stockBeforeSend.kolicina)).toBe(2);

    const sent = await request(app).post(`/narocila-dobaviteljem/${created.body.id}/send`).send({});
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe("sent");

    const withOpenOrder = await request(app).get("/narocila-dobaviteljem/pregled");
    expect(withOpenOrder.body.articles.find((row: any) => row.articleId === articleId)).toMatchObject({
      onHand: 2,
      openOrderQuantity: 12,
      hasSuggestion: false,
      suggestedBaseQuantity: null,
    });

    const lineId = created.body.lines[0].id as number;
    const createReceipt = async () => {
      const response = await request(app).post("/prejemnice").send({
        dobaviteljId: supplierId,
        datum: "2026-10-17",
        vrstaCen: "neto",
        vrstaDokumenta: "DOBAVNICA",
        brutoSkupaj: 18,
        postavke: [{
          artikelId: articleId,
          supplierOrderLineId: lineId,
          kolicina: 6,
          cenaKos: 3,
          skupaj: 18,
          enotVPaketu: 1,
          izvKolicina: 6,
          izvCena: 3,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        }],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      receiptIds.push(response.body.id);
      expect(response.body.postavke[0].supplierOrderLineId).toBe(lineId);
      return response.body.id as number;
    };

    const firstReceiptId = await createReceipt();
    const [stockWithDraftReceipt] = await db.select().from(zalogeTable).where(eq(zalogeTable.artikelId, articleId));
    expect(Number(stockWithDraftReceipt.kolicina)).toBe(2);
    const firstReceiptDetail = await request(app).get(`/prejemnice/${firstReceiptId}`);
    expect(firstReceiptDetail.status).toBe(200);
    const originalReceiptLine = firstReceiptDetail.body.postavke[0];
    expect(originalReceiptLine.supplierOrderLineId).toBe(lineId);
    const noOpEdit = await request(app).put(`/prejemnice/${firstReceiptId}`).send({
      postavke: [{
        id: originalReceiptLine.id,
        artikelId: articleId,
        kolicina: originalReceiptLine.kolicina,
        cenaKos: originalReceiptLine.cenaKos,
        skupaj: originalReceiptLine.skupaj,
        enotVPaketu: originalReceiptLine.enotVPaketu,
        izvKolicina: originalReceiptLine.izvKolicina,
        izvCena: originalReceiptLine.izvCena,
        izvEnota: originalReceiptLine.izvEnota,
        izvCenaVrsta: originalReceiptLine.izvCenaVrsta,
        ddvStopnja: originalReceiptLine.ddvStopnja,
      }],
    });
    expect(noOpEdit.status, JSON.stringify(noOpEdit.body)).toBe(200);
    const editedReceipt = await request(app).get(`/prejemnice/${firstReceiptId}`);
    expect(editedReceipt.body.postavke[0].supplierOrderLineId).toBe(lineId);
    const firstConfirmation = await request(app).post(`/prejemnice/${firstReceiptId}/confirm`).send({});
    expect(firstConfirmation.status, JSON.stringify(firstConfirmation.body)).toBe(200);
    const partial = await request(app).get(`/narocila-dobaviteljem/${created.body.id}`);
    expect(partial.body).toMatchObject({
      status: "partially_received",
      lines: [{ orderedBaseQuantity: 12, receivedBaseQuantity: 6, openBaseQuantity: 6 }],
    });

    const secondReceiptId = await createReceipt();
    const secondConfirmation = await request(app).post(`/prejemnice/${secondReceiptId}/confirm`).send({});
    expect(secondConfirmation.status, JSON.stringify(secondConfirmation.body)).toBe(200);
    const completed = await request(app).get(`/narocila-dobaviteljem/${created.body.id}`);
    expect(completed.body).toMatchObject({
      status: "received",
      lines: [{ orderedBaseQuantity: 12, receivedBaseQuantity: 12, openBaseQuantity: 0 }],
    });
    const [stockAfterReceipts] = await db.select().from(zalogeTable).where(eq(zalogeTable.artikelId, articleId));
    expect(Number(stockAfterReceipts.kolicina)).toBe(14);
  });

  it("does not let a non-administrator manage purchase orders", async () => {
    context.role = "uporabnik";
    const denied = await request(app).get("/narocila-dobaviteljem");
    expect(denied.status).toBe(403);
    context.role = "admin";
  });
});
