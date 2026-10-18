import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const context = vi.hoisted(() => ({
  companyId: "",
  enotaId: 0,
  userId: "supplier-order-route-test",
  role: "admin",
  actorNatakarId: 731,
}));

vi.mock("../../middlewares/pos", () => ({
  requireEnota(req: any, _res: any, next: any) {
    req.companyId = context.companyId;
    req.enotaId = context.enotaId;
    req.clerkUserId = context.userId;
    req.vloga = context.role;
    req.posActorNatakarId = context.actorNatakarId;
    next();
  },

  requireIzbranaEnota(req: any, res: any, next: any) {
    const selectedUnitId = req.headers["x-enota-id"] ?? req.query.enota_id;
    if (typeof selectedUnitId !== "string" || !/^[1-9]\d*$/.test(selectedUnitId)) {
      return res.status(400).json({
        napaka: "Izberite aktivno POS enoto z glavo X-Enota-Id",
        koda: "ENOTA_OBVEZNA",
      });
    }
    req.companyId = context.companyId;
    req.enotaId = Number(selectedUnitId);
    req.clerkUserId = context.userId;
    req.vloga = context.role;
    req.posActorNatakarId = context.actorNatakarId;
    return next();
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
  posSupplierPackageChangeReviewsTable,
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
import { getLatestSupplierPriceReceipts } from "../../lib/pos-supplier-orders";

const app = express();
app.use(express.json());
app.use(prejemniceRouter);
app.use(supplierOrdersRouter);
app.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));

const run = randomUUID().replace(/-/g, "").slice(0, 12);
let companyId = "";
let enotaId = 0;
let supplierId = "";
let articleId = 0;
let mappingId = 0;
const extraCompanyIds: string[] = [];
const extraSupplierIds: string[] = [];
const unitIds: number[] = [];
const articleIds: number[] = [];
const mappingIds: number[] = [];
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
    unitIds.push(enotaId);
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
    articleIds.push(articleId);

    const [mapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: articleId,
      dobaviteljId: supplierId,
      sifraDobavitelja: `SUP-${run}`,
      nazivDobavitelja: `Supplier pack ${run}`,
      enotVPaketu: "6",
      nazivPaketa: "zaboj",
      zadnjaCenaPaket: "18",
      zadnjaCenaEnota: "3",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingId = mapping.id;
    mappingIds.push(mappingId);

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

    await db.execute(sql.raw(
      "ALTER TABLE pos_supplier_package_change_reviews DISABLE TRIGGER pos_supplier_package_change_reviews_append_only",
    ));
    try {
      if (receiptIds.length) {
        await db.delete(posSupplierPackageChangeReviewsTable)
          .where(inArray(posSupplierPackageChangeReviewsTable.prejemnicaId, receiptIds));
      }
    } finally {
      await db.execute(sql.raw(
        "ALTER TABLE pos_supplier_package_change_reviews ENABLE TRIGGER pos_supplier_package_change_reviews_append_only",
      ));
    }

    await db.execute(sql.raw("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_history_append_only"));
    try {
      if (articleIds.length) {
        await db.delete(zalogaGibiTable).where(inArray(zalogaGibiTable.artikelId, articleIds));
      }
    } finally {
      await db.execute(sql.raw("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_history_append_only"));
    }

    if (receiptIds.length) {
      await db.delete(prejemniceTable).where(inArray(prejemniceTable.id, receiptIds));
    }
    if (orderIds.length) {
      await db.delete(posSupplierOrdersTable).where(inArray(posSupplierOrdersTable.id, orderIds));
    }
    if (mappingIds.length) {
      await db.delete(artikelDobaviteljTable).where(inArray(artikelDobaviteljTable.id, mappingIds));
    }
    if (articleIds.length) {
      await db.delete(posSupplierReorderSettingsTable).where(inArray(posSupplierReorderSettingsTable.artikelId, articleIds));
      await db.delete(zalogeTable).where(inArray(zalogeTable.artikelId, articleIds));
      await db.delete(artikliTable).where(inArray(artikliTable.id, articleIds));
    }
    const supplierIdsToCleanup = [supplierId, ...extraSupplierIds].filter(Boolean);
    if (supplierIdsToCleanup.length) {
      await db.delete(purchaseSourceDocumentsTable)
        .where(inArray(purchaseSourceDocumentsTable.counterpartyId, supplierIdsToCleanup));
    }
    if (supplierIdsToCleanup.length) {
      await db.delete(counterpartiesTable)
        .where(inArray(counterpartiesTable.id, supplierIdsToCleanup));
    }
    if (unitIds.length) await db.delete(enoteTable).where(inArray(enoteTable.id, unitIds));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    if (extraCompanyIds.length) {
      await db.delete(companiesTable).where(inArray(companiesTable.id, extraCompanyIds));
    }
  });

  it("keeps order price snapshots when the supplier changes package size before receipt confirmation", async () => {
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
      internalNotes: "Prvo naročilo",
      supplierNotes: null,
      lines: [{ supplierMappingId: mappingId, packageQuantity: 2, unitPrice: 20 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    orderIds.push(created.body.id);
    expect(created.body).toMatchObject({
      status: "draft",
      supplierId,
      internalNotes: "Prvo naročilo",
      supplierNotes: null,
      lineCount: 1,
      lines: [{
        supplierMappingId: mappingId,
        packageQuantity: 2,
        packageFactor: 6,
        currentPackageFactor: 6,
        orderedBaseQuantity: 12,
        receivedBaseQuantity: 0,
        openBaseQuantity: 12,
        unitPrice: 20,
      }],
    });
    const getMappingPrice = async () => {
      const [mapping] = await db.select({
        packagePrice: artikelDobaviteljTable.zadnjaCenaPaket,
        unitPrice: artikelDobaviteljTable.zadnjaCenaEnota,
      }).from(artikelDobaviteljTable).where(eq(artikelDobaviteljTable.id, mappingId));
      return {
        packagePrice: Number(mapping.packagePrice),
        unitPrice: Number(mapping.unitPrice),
      };
    };
    expect(await getMappingPrice()).toEqual({ packagePrice: 18, unitPrice: 3 });
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
    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "8", nazivPaketa: "zaboj 8" })
      .where(eq(artikelDobaviteljTable.id, mappingId));
    const orderAfterPackageChange = await request(app).get(`/narocila-dobaviteljem/${created.body.id}`);
    expect(orderAfterPackageChange.status).toBe(200);
    expect(orderAfterPackageChange.body.lines[0]).toMatchObject({
      packageFactor: 6,
      currentPackageFactor: 8,
      packageName: "zaboj",
      unitPrice: 20,
    });

    const createReceipt = async (
      pricePerBaseUnit = 3,
      linkedSupplierOrderLineId: number | null = lineId,
    ) => {
      const lineAmount = pricePerBaseUnit * 6;
      const response = await request(app).post("/prejemnice").send({
        dobaviteljId: supplierId,
        datum: "2026-10-17",
        vrstaCen: "neto",
        vrstaDokumenta: "DOBAVNICA",
        brutoSkupaj: lineAmount,
        postavke: [{
          artikelId: articleId,
          ...(linkedSupplierOrderLineId == null ? {} : { supplierOrderLineId: linkedSupplierOrderLineId }),
          kolicina: 6,
          cenaKos: pricePerBaseUnit,
          skupaj: lineAmount,
          enotVPaketu: 1,
          izvKolicina: 6,
          izvCena: pricePerBaseUnit,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        }],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      receiptIds.push(response.body.id);
      expect(response.body.postavke[0].supplierOrderLineId)
        .toBe(linkedSupplierOrderLineId);
      return response.body.id as number;
    };

    const firstReceiptId = await createReceipt(3.5);
    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "10", nazivPaketa: "zaboj 10" })
      .where(eq(artikelDobaviteljTable.id, mappingId));
    const receiptAfterMappingChange = await request(app).get(`/prejemnice/${firstReceiptId}`);
    expect(receiptAfterMappingChange.status).toBe(200);
    expect(receiptAfterMappingChange.body.postavke[0]).toMatchObject({
      kolicina: 6,
      enotVPaketu: 1,
    });
    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "8", nazivPaketa: "zaboj 8" })
      .where(eq(artikelDobaviteljTable.id, mappingId));
    const [stockWithDraftReceipt] = await db.select().from(zalogeTable).where(eq(zalogeTable.artikelId, articleId));
    expect(Number(stockWithDraftReceipt.kolicina)).toBe(2);
    expect(await getMappingPrice()).toEqual({ packagePrice: 18, unitPrice: 3 });
    const dashboardWithDraftReceipt = await request(app).get("/narocila-dobaviteljem/pregled");
    const mappingWithDraftReceipt = dashboardWithDraftReceipt.body.articles
      .find((row: any) => row.articleId === articleId).mappings
      .find((mapping: any) => mapping.id === mappingId);
    expect(mappingWithDraftReceipt.lastPriceReceipt).toBeNull();
    expect(mappingWithDraftReceipt.priceHistory).toEqual([]);
    expect(mappingWithDraftReceipt).toMatchObject({
      packageFactor: 8,
      lastPackagePrice: 18,
      lastUnitPrice: 3,
    });

    const draftHistoryExport = await request(app)
      .get(`/narocila-dobaviteljem/preslikave/${mappingId}/zgodovina.csv`);
    expect(draftHistoryExport.status, JSON.stringify(draftHistoryExport.body)).toBe(200);
    expect(draftHistoryExport.text.replace(/^\uFEFF/, "").trim().split("\r\n")).toHaveLength(1);
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
    expect(await getMappingPrice()).toEqual({ packagePrice: 18, unitPrice: 3 });
    const packageFactorWarning = await request(app)
      .post(`/prejemnice/${firstReceiptId}/confirm`)
      .send({});
    expect(packageFactorWarning.status, JSON.stringify(packageFactorWarning.body)).toBe(409);
    expect(packageFactorWarning.body).toMatchObject({
      code: "SUPPLIER_ORDER_PACKAGE_FACTOR_CHANGED",
      packageFactorChanges: [{
        supplierOrderLineId: lineId,
        articleName: `Order article ${run}`,
        orderPackageName: "zaboj",
        orderFactor: 6,
        orderBaseUnit: "KOS",
        currentPackageName: "zaboj 8",
        currentFactor: 8,
        currentBaseUnit: "KOS",
      }],
    });
    const receiptAfterFactorWarning = await request(app).get(`/prejemnice/${firstReceiptId}`);
    expect(receiptAfterFactorWarning.body.status).toBe("draft");
    expect(receiptAfterFactorWarning.body.postavke[0]).toMatchObject({
      supplierOrderLineId: lineId,
      kolicina: 6,
      enotVPaketu: 1,
    });
    const orderAfterFactorWarning = await request(app).get(`/narocila-dobaviteljem/${created.body.id}`);
    expect(orderAfterFactorWarning.body).toMatchObject({
      status: "sent",
      lines: [{ packageFactor: 6, currentPackageFactor: 8 }],
    });
    const [stockAfterFactorWarning] = await db.select().from(zalogeTable)
      .where(eq(zalogeTable.artikelId, articleId));
    expect(Number(stockAfterFactorWarning.kolicina)).toBe(2);
    expect(await getMappingPrice()).toEqual({ packagePrice: 18, unitPrice: 3 });

    const firstConfirmation = await request(app).post(`/prejemnice/${firstReceiptId}/confirm`).send({
      reviewedPackageFactorChanges: packageFactorWarning.body.packageFactorChanges,
    });
    expect(firstConfirmation.status, JSON.stringify(firstConfirmation.body)).toBe(200);
    expect(await getMappingPrice()).toEqual({ packagePrice: 28, unitPrice: 3.5 });
    const dashboardAfterFirstReceipt = await request(app).get("/narocila-dobaviteljem/pregled");
    const mappingAfterFirstReceipt = dashboardAfterFirstReceipt.body.articles
      .find((row: any) => row.articleId === articleId).mappings
      .find((mapping: any) => mapping.id === mappingId);
    expect(mappingAfterFirstReceipt.lastPackagePrice).toBe(28);
    expect(mappingAfterFirstReceipt.lastPriceReceipt).toEqual({
      receiptId: firstReceiptId,
      date: "2026-10-17",
      receiptNumber: firstReceiptDetail.body.stevilka,
    });
    const firstOrderAfterPartialReceipt = await request(app).get(`/narocila-dobaviteljem/${created.body.id}`);
    expect(firstOrderAfterPartialReceipt.body.lines[0]).toMatchObject({
      packageFactor: 6,
      packageName: "zaboj",
      unitPrice: 20,
    });
    const [firstReceiptLineSnapshot] = await db.select({
      invoiceUnitPrice: prejemnicePostavkeTable.izvCena,
      inventoryUnitPrice: prejemnicePostavkeTable.netoCena,
      supplierOrderLineId: prejemnicePostavkeTable.supplierOrderLineId,
      packageFactor: prejemnicePostavkeTable.enotVPaketu,
      stockQuantity: prejemnicePostavkeTable.kolicina,
    }).from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, firstReceiptId));
    expect(Number(firstReceiptLineSnapshot.invoiceUnitPrice)).toBe(3.5);
    expect(Number(firstReceiptLineSnapshot.inventoryUnitPrice)).toBe(3.5);
    expect(firstReceiptLineSnapshot.supplierOrderLineId).toBe(lineId);
    expect(Number(firstReceiptLineSnapshot.packageFactor)).toBe(1);
    expect(Number(firstReceiptLineSnapshot.stockQuantity)).toBe(6);
    const partial = await request(app).get(`/narocila-dobaviteljem/${created.body.id}`);
    expect(partial.body).toMatchObject({
      status: "partially_received",
      lines: [{ orderedBaseQuantity: 12, receivedBaseQuantity: 6, openBaseQuantity: 6 }],
    });
    expect(partial.body.lines[0].receipts).toEqual([{
      receiptId: firstReceiptId,
      receiptNumber: firstReceiptDetail.body.stevilka,
      supplierDocumentNumber: null,
      receiptDate: "2026-10-17",
      receivedBaseQuantity: 6,
    }]);
    expect(partial.body.lines[0].receipts.reduce(
      (sum: number, receipt: { receivedBaseQuantity: number }) => sum + receipt.receivedBaseQuantity,
      0,
    )).toBe(partial.body.lines[0].receivedBaseQuantity);

    const secondReceiptId = await createReceipt(3.75);
    expect(await getMappingPrice()).toEqual({ packagePrice: 28, unitPrice: 3.5 });
    const secondFactorWarning = await request(app).post(`/prejemnice/${secondReceiptId}/confirm`).send({});
    expect(secondFactorWarning.status, JSON.stringify(secondFactorWarning.body)).toBe(409);
    expect(secondFactorWarning.body.packageFactorChanges).toMatchObject([{
      supplierOrderLineId: lineId,
      orderFactor: 6,
      currentFactor: 8,
    }]);
    const secondConfirmation = await request(app).post(`/prejemnice/${secondReceiptId}/confirm`).send({
      reviewedPackageFactorChanges: secondFactorWarning.body.packageFactorChanges,
    });
    expect(secondConfirmation.status, JSON.stringify(secondConfirmation.body)).toBe(200);
    expect(await getMappingPrice()).toEqual({ packagePrice: 30, unitPrice: 3.75 });
    const dashboardAfterSecondReceipt = await request(app).get("/narocila-dobaviteljem/pregled");
    const mappingAfterSecondReceipt = dashboardAfterSecondReceipt.body.articles
      .find((row: any) => row.articleId === articleId).mappings
      .find((mapping: any) => mapping.id === mappingId);
    expect(mappingAfterSecondReceipt.lastPackagePrice).toBe(30);
    const secondReceiptDetail = await request(app).get(`/prejemnice/${secondReceiptId}`);
    expect(mappingAfterSecondReceipt.lastPriceReceipt).toEqual({
      receiptId: secondReceiptId,
      date: "2026-10-17",
      receiptNumber: secondReceiptDetail.body.stevilka,
    });
    const completed = await request(app).get(`/narocila-dobaviteljem/${created.body.id}`);
    expect(completed.body).toMatchObject({
      status: "received",
      lines: [{
        orderedBaseQuantity: 12,
        receivedBaseQuantity: 12,
        openBaseQuantity: 0,
        packageFactor: 6,
        packageName: "zaboj",
        unitPrice: 20,
      }],
    });
    expect(completed.body.lines[0].receipts).toEqual([
      {
        receiptId: firstReceiptId,
        receiptNumber: firstReceiptDetail.body.stevilka,
        supplierDocumentNumber: null,
        receiptDate: "2026-10-17",
        receivedBaseQuantity: 6,
      },
      {
        receiptId: secondReceiptId,
        receiptNumber: secondReceiptDetail.body.stevilka,
        supplierDocumentNumber: null,
        receiptDate: "2026-10-17",
        receivedBaseQuantity: 6,
      },
    ]);
    expect(completed.body.lines[0].receipts.reduce(
      (sum: number, receipt: { receivedBaseQuantity: number }) => sum + receipt.receivedBaseQuantity,
      0,
    )).toBe(completed.body.lines[0].receivedBaseQuantity);
    const [firstReceiptLineAfterSecondPrice] = await db.select({
      invoiceUnitPrice: prejemnicePostavkeTable.izvCena,
      inventoryUnitPrice: prejemnicePostavkeTable.netoCena,
    }).from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, firstReceiptId));
    expect(Number(firstReceiptLineAfterSecondPrice.invoiceUnitPrice)).toBe(3.5);
    expect(Number(firstReceiptLineAfterSecondPrice.inventoryUnitPrice)).toBe(3.5);
    const [stockAfterReceipts] = await db.select().from(zalogeTable).where(eq(zalogeTable.artikelId, articleId));
    expect(Number(stockAfterReceipts.kolicina)).toBe(14);

    const updatedSettings = await request(app)
      .put(`/narocila-dobaviteljem/artikli/${articleId}/nastavitve`)
      .send({ reorderPoint: 15, targetStock: 30, preferredMappingId: mappingId });
    expect(updatedSettings.status, JSON.stringify(updatedSettings.body)).toBe(200);
    const nextSuggestionResponse = await request(app).get("/narocila-dobaviteljem/pregled");
    const nextArticleSuggestion = nextSuggestionResponse.body.articles
      .find((row: any) => row.articleId === articleId);
    const nextMappingSuggestion = nextArticleSuggestion.mappings
      .find((mapping: any) => mapping.id === mappingId);
    expect(nextArticleSuggestion).toMatchObject({
      hasSuggestion: true,
      suggestedPackageQuantity: 2,
    });
    expect(nextMappingSuggestion).toMatchObject({
      packageFactor: 8,
      lastPackagePrice: 30,
    });
    const nextSuggestedOrder = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-06",
      lines: [{
        supplierMappingId: mappingId,
        packageQuantity: nextArticleSuggestion.suggestedPackageQuantity,
        unitPrice: nextMappingSuggestion.lastPackagePrice,
      }],
    });
    expect(nextSuggestedOrder.status, JSON.stringify(nextSuggestedOrder.body)).toBe(201);
    orderIds.push(nextSuggestedOrder.body.id);
    expect(nextSuggestedOrder.body.lines[0]).toMatchObject({
      packageQuantity: 2,
      packageFactor: 8,
      packageName: "zaboj 8",
      unitPrice: 30,
    });

    const unlinkedReceiptId = await createReceipt(5, null);
    const unlinkedConfirmation = await request(app).post(`/prejemnice/${unlinkedReceiptId}/confirm`).send({});
    expect(unlinkedConfirmation.status, JSON.stringify(unlinkedConfirmation.body)).toBe(200);
    expect(await getMappingPrice()).toEqual({ packagePrice: 30, unitPrice: 3.75 });
  });

  it("excludes draft and other-unit receipts from the order's received history", async () => {
    const [historyArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Receipt history article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(historyArticle.id);
    await db.insert(zalogeTable).values({ artikelId: historyArticle.id, kolicina: "0" });

    const [historyMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: historyArticle.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `HISTORY-${run}`,
      nazivDobavitelja: `History pack ${run}`,
      enotVPaketu: "6",
      nazivPaketa: "zaboj",
      zadnjaCenaPaket: "18",
      zadnjaCenaEnota: "3",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(historyMapping.id);

    const createdOrder = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-07",
      lines: [{ supplierMappingId: historyMapping.id, packageQuantity: 1, unitPrice: 18 }],
    });
    expect(createdOrder.status, JSON.stringify(createdOrder.body)).toBe(201);
    orderIds.push(createdOrder.body.id);
    const orderLineId = createdOrder.body.lines[0].id as number;
    const sentOrder = await request(app).post(`/narocila-dobaviteljem/${createdOrder.body.id}/send`).send({});
    expect(sentOrder.status, JSON.stringify(sentOrder.body)).toBe(200);

    const [confirmedReceipt] = await db.insert(prejemniceTable).values({
      enotaId,
      dobaviteljId: supplierId,
      stevilka: `CONFIRMED-HISTORY-${run}`,
      datum: new Date("2026-10-17T10:00:00.000Z"),
      status: "confirmed",
    }).returning({ id: prejemniceTable.id });
    receiptIds.push(confirmedReceipt.id);
    await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: confirmedReceipt.id,
      supplierOrderLineId: orderLineId,
      artikelId: historyArticle.id,
      kolicina: "2",
    });

    const [otherUnit] = await db.insert(enoteTable).values({
      companyId,
      ime: `Other receipt history unit ${run}`,
    }).returning({ id: enoteTable.id });
    unitIds.push(otherUnit.id);

    const [draftReceipt] = await db.insert(prejemniceTable).values({
      enotaId,
      dobaviteljId: supplierId,
      stevilka: `DRAFT-HISTORY-${run}`,
      datum: new Date("2026-10-18T10:00:00.000Z"),
      status: "draft",
    }).returning({ id: prejemniceTable.id });
    receiptIds.push(draftReceipt.id);
    await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: draftReceipt.id,
      supplierOrderLineId: orderLineId,
      artikelId: historyArticle.id,
      kolicina: "3",
    });

    const [otherUnitReceipt] = await db.insert(prejemniceTable).values({
      enotaId: otherUnit.id,
      dobaviteljId: supplierId,
      stevilka: `OTHER-UNIT-HISTORY-${run}`,
      datum: new Date("2026-10-18T11:00:00.000Z"),
      status: "confirmed",
    }).returning({ id: prejemniceTable.id });
    receiptIds.push(otherUnitReceipt.id);
    await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: otherUnitReceipt.id,
      supplierOrderLineId: orderLineId,
      artikelId: historyArticle.id,
      kolicina: "4",
    });

    const orderDetail = await request(app).get(`/narocila-dobaviteljem/${createdOrder.body.id}`);
    expect(orderDetail.status, JSON.stringify(orderDetail.body)).toBe(200);
    const line = orderDetail.body.lines.find((entry: any) => entry.id === orderLineId);
    expect(line).toMatchObject({
      receivedBaseQuantity: 2,
      receipts: [{
        receiptId: confirmedReceipt.id,
        receivedBaseQuantity: 2,
      }],
    });
    expect(line.receipts).toHaveLength(1);
    expect(line.receipts.map((receipt: any) => receipt.receiptId))
      .not.toContain(draftReceipt.id);
    expect(line.receipts.map((receipt: any) => receipt.receiptId))
      .not.toContain(otherUnitReceipt.id);
    expect(line.receipts.reduce(
      (sum: number, receipt: { receivedBaseQuantity: number }) => sum + receipt.receivedBaseQuantity,
      0,
    )).toBe(line.receivedBaseQuantity);
  });

  it("warns only for changed packaging on open lines and prepares no duplicate receipt lines", async () => {
    const fullArticleName = `Fully received ${run}`;
    const openArticleName = `Open receipt ${run}`;
    const [fullArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: fullArticleName,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(fullArticle.id);
    const [openArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: openArticleName,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(openArticle.id);

    const [fullMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: fullArticle.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `FULL-${run}`,
      nazivDobavitelja: `Full pack ${run}`,
      enotVPaketu: "6",
      nazivPaketa: "zaboj 6",
      zadnjaCenaPaket: "18",
      zadnjaCenaEnota: "3",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(fullMapping.id);
    const [openMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: openArticle.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `OPEN-${run}`,
      nazivDobavitelja: `Open pack ${run}`,
      enotVPaketu: "4",
      nazivPaketa: "paket 4",
      zadnjaCenaPaket: "12",
      zadnjaCenaEnota: "3",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(openMapping.id);

    await db.insert(zalogeTable).values([
      { artikelId: fullArticle.id, kolicina: "0" },
      { artikelId: openArticle.id, kolicina: "0" },
    ]);

    const createdOrder = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-07",
      lines: [
        { supplierMappingId: fullMapping.id, packageQuantity: 1, unitPrice: 18 },
        { supplierMappingId: openMapping.id, packageQuantity: 1, unitPrice: 12 },
      ],
    });
    expect(createdOrder.status, JSON.stringify(createdOrder.body)).toBe(201);
    orderIds.push(createdOrder.body.id);
    const fullOrderLine = createdOrder.body.lines.find((line: any) => line.articleId === fullArticle.id);
    const openOrderLine = createdOrder.body.lines.find((line: any) => line.articleId === openArticle.id);
    expect(fullOrderLine).toMatchObject({ packageFactor: 6, orderedBaseQuantity: 6 });
    expect(openOrderLine).toMatchObject({ packageFactor: 4, orderedBaseQuantity: 4 });

    const sentOrder = await request(app).post(`/narocila-dobaviteljem/${createdOrder.body.id}/send`).send({});
    expect(sentOrder.status, JSON.stringify(sentOrder.body)).toBe(200);

    const fullReceipt = await request(app).post("/prejemnice").send({
      dobaviteljId: supplierId,
      datum: "2026-10-17",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 18,
      postavke: [{
        artikelId: fullArticle.id,
        supplierOrderLineId: fullOrderLine.id,
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
    expect(fullReceipt.status, JSON.stringify(fullReceipt.body)).toBe(201);
    receiptIds.push(fullReceipt.body.id);
    const fullConfirmation = await request(app)
      .post(`/prejemnice/${fullReceipt.body.id}/confirm`)
      .send({});
    expect(fullConfirmation.status, JSON.stringify(fullConfirmation.body)).toBe(200);

    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "8", nazivPaketa: "zaboj 8" })
      .where(eq(artikelDobaviteljTable.id, fullMapping.id));
    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "7", nazivPaketa: "paket 7" })
      .where(eq(artikelDobaviteljTable.id, openMapping.id));

    const orderAfterFullLineReceipt = await request(app)
      .get(`/narocila-dobaviteljem/${createdOrder.body.id}`);
    expect(orderAfterFullLineReceipt.status).toBe(200);
    expect(orderAfterFullLineReceipt.body.status).toBe("partially_received");
    const fullLineState = orderAfterFullLineReceipt.body.lines
      .find((line: any) => line.id === fullOrderLine.id);
    const openLineState = orderAfterFullLineReceipt.body.lines
      .find((line: any) => line.id === openOrderLine.id);
    expect(fullLineState).toMatchObject({
      packageFactor: 6,
      currentPackageFactor: 8,
      receivedBaseQuantity: 6,
      openBaseQuantity: 0,
    });
    expect(openLineState).toMatchObject({
      packageFactor: 4,
      currentPackageFactor: 7,
      receivedBaseQuantity: 0,
      openBaseQuantity: 4,
    });

    const openLines = orderAfterFullLineReceipt.body.lines
      .filter((line: any) => line.openBaseQuantity > 0);
    expect(openLines.map((line: any) => line.id)).toEqual([openOrderLine.id]);
    const openReceipt = await request(app).post("/prejemnice").send({
      dobaviteljId: supplierId,
      datum: "2026-10-17",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 12,
      postavke: openLines.map((line: any) => ({
        artikelId: line.articleId,
        supplierOrderLineId: line.id,
        kolicina: line.openBaseQuantity,
        cenaKos: 3,
        skupaj: 12,
        enotVPaketu: 1,
        izvKolicina: line.openBaseQuantity,
        izvCena: 3,
        izvEnota: line.baseUnit,
        izvCenaVrsta: "neto",
        ddvStopnja: 0,
      })),
    });
    expect(openReceipt.status, JSON.stringify(openReceipt.body)).toBe(201);
    receiptIds.push(openReceipt.body.id);
    expect(openReceipt.body.postavke).toHaveLength(1);
    expect(openReceipt.body.postavke.map((line: any) => line.supplierOrderLineId))
      .toEqual([openOrderLine.id]);
    expect(openReceipt.body.postavke.map((line: any) => line.artikelId))
      .toEqual([openArticle.id]);
    expect(Number(openReceipt.body.postavke[0].kolicina)).toBe(4);

    const packageWarning = await request(app)
      .post(`/prejemnice/${openReceipt.body.id}/confirm`)
      .send({});
    expect(packageWarning.status, JSON.stringify(packageWarning.body)).toBe(409);
    expect(packageWarning.body.packageFactorChanges.map((change: any) => change.supplierOrderLineId))
      .toEqual([openOrderLine.id]);
    expect(packageWarning.body.packageFactorChanges[0]).toMatchObject({
      articleName: openArticleName,
      orderFactor: 4,
      currentFactor: 7,
    });

    const confirmedOpenReceipt = await request(app)
      .post(`/prejemnice/${openReceipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: packageWarning.body.packageFactorChanges });
    expect(confirmedOpenReceipt.status, JSON.stringify(confirmedOpenReceipt.body)).toBe(200);
    const finalOrder = await request(app).get(`/narocila-dobaviteljem/${createdOrder.body.id}`);
    expect(finalOrder.body.status).toBe("received");
    expect(finalOrder.body.lines.find((line: any) => line.id === fullOrderLine.id)).toMatchObject({
      receivedBaseQuantity: 6,
      openBaseQuantity: 0,
    });
    expect(finalOrder.body.lines.find((line: any) => line.id === openOrderLine.id)).toMatchObject({
      receivedBaseQuantity: 4,
      openBaseQuantity: 0,
    });

    const nameOnlyOrder = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-08",
      lines: [{ supplierMappingId: openMapping.id, packageQuantity: 1, unitPrice: 21 }],
    });
    expect(nameOnlyOrder.status, JSON.stringify(nameOnlyOrder.body)).toBe(201);
    orderIds.push(nameOnlyOrder.body.id);
    const nameOnlyLineId = nameOnlyOrder.body.lines[0].id as number;
    await request(app).post(`/narocila-dobaviteljem/${nameOnlyOrder.body.id}/send`).send({});

    const nameOnlyReceipt = await request(app).post("/prejemnice").send({
      dobaviteljId: supplierId,
      datum: "2026-10-17",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 21,
      postavke: [{
        artikelId: openArticle.id,
        supplierOrderLineId: nameOnlyLineId,
        kolicina: 7,
        cenaKos: 3,
        skupaj: 21,
        enotVPaketu: 1,
        izvKolicina: 7,
        izvCena: 3,
        izvEnota: "KOS",
        izvCenaVrsta: "neto",
        ddvStopnja: 0,
      }],
    });
    expect(nameOnlyReceipt.status, JSON.stringify(nameOnlyReceipt.body)).toBe(201);
    receiptIds.push(nameOnlyReceipt.body.id);

    await db.update(artikelDobaviteljTable)
      .set({ nazivPaketa: "transportni zaboj 7" })
      .where(eq(artikelDobaviteljTable.id, openMapping.id));
    const nameOnlyWarning = await request(app)
      .post(`/prejemnice/${nameOnlyReceipt.body.id}/confirm`)
      .send({});
    expect(nameOnlyWarning.status).toBe(409);
    expect(nameOnlyWarning.body).toMatchObject({
      code: "SUPPLIER_ORDER_PACKAGE_FACTOR_CHANGED",
      packageFactorChanges: [{
        supplierOrderLineId: nameOnlyLineId,
        orderPackageName: "paket 7",
        orderFactor: 7,
        orderBaseUnit: "KOS",
        currentPackageName: "transportni zaboj 7",
        currentFactor: 7,
        currentBaseUnit: "KOS",
      }],
    });

    await db.update(artikelDobaviteljTable)
      .set({ nazivPaketa: "transportni zaboj 7 - nova oznaka" })
      .where(eq(artikelDobaviteljTable.id, openMapping.id));
    const latestNameWarning = await request(app)
      .post(`/prejemnice/${nameOnlyReceipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: nameOnlyWarning.body.packageFactorChanges });
    expect(latestNameWarning.status).toBe(409);
    expect(latestNameWarning.body.packageFactorChanges).toMatchObject([{
      orderPackageName: "paket 7",
      orderFactor: 7,
      orderBaseUnit: "KOS",
      currentPackageName: "transportni zaboj 7 - nova oznaka",
      currentFactor: 7,
      currentBaseUnit: "KOS",
    }]);
    const unapprovedPackageReviews = await db.select()
      .from(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.prejemnicaId, nameOnlyReceipt.body.id));
    expect(unapprovedPackageReviews).toHaveLength(0);

    const [savedOrderSnapshot] = await db.select({
      packageName: posSupplierOrderLinesTable.nazivPakiranja,
      packageFactor: posSupplierOrderLinesTable.faktorPakiranja,
      baseUnit: posSupplierOrderLinesTable.osnovnaEnota,
    }).from(posSupplierOrderLinesTable)
      .where(eq(posSupplierOrderLinesTable.id, nameOnlyLineId));
    const [savedReceiptSnapshot] = await db.select({
      supplierOrderLineId: prejemnicePostavkeTable.supplierOrderLineId,
      packageFactor: prejemnicePostavkeTable.enotVPaketu,
    }).from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, nameOnlyReceipt.body.id));
    expect(savedOrderSnapshot).toMatchObject({
      packageName: "paket 7",
      baseUnit: "KOS",
    });
    expect(Number(savedOrderSnapshot.packageFactor)).toBe(7);
    expect(savedReceiptSnapshot.supplierOrderLineId).toBe(nameOnlyLineId);
    expect(Number(savedReceiptSnapshot.packageFactor)).toBe(1);

    const confirmedNameOnlyReceipt = await request(app)
      .post(`/prejemnice/${nameOnlyReceipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: latestNameWarning.body.packageFactorChanges });
    expect(confirmedNameOnlyReceipt.status, JSON.stringify(confirmedNameOnlyReceipt.body)).toBe(200);
    const packageReviews = await db.select()
      .from(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.prejemnicaId, nameOnlyReceipt.body.id));
    expect(packageReviews).toHaveLength(1);
    expect(packageReviews[0]).toMatchObject({
      enotaId,
      prejemnicaId: nameOnlyReceipt.body.id,
      supplierOrderLineId: nameOnlyLineId,
      orderPackageName: "paket 7",
      orderBaseUnit: "KOS",
      currentPackageName: "transportni zaboj 7 - nova oznaka",
      currentBaseUnit: "KOS",
      actorClerkUserId: context.userId,
      actorNatakarId: 731,
    });
    expect(Number(packageReviews[0]!.orderFactor)).toBe(7);
    expect(Number(packageReviews[0]!.currentFactor)).toBe(7);
    expect(packageReviews[0]!.reviewedAt).toBeInstanceOf(Date);

    const receiptDetail = await request(app).get(`/prejemnice/${nameOnlyReceipt.body.id}`);
    expect(receiptDetail.status, JSON.stringify(receiptDetail.body)).toBe(200);
    expect(receiptDetail.body.packageChangeReviews).toHaveLength(1);
    expect(receiptDetail.body.packageChangeReviews[0]).toMatchObject({
      receiptId: nameOnlyReceipt.body.id,
      supplierOrderLineId: nameOnlyLineId,
      orderPackageName: "paket 7",
      currentPackageName: "transportni zaboj 7 - nova oznaka",
      actorClerkUserId: context.userId,
      actorNatakarId: 731,
      reviewedAt: expect.any(String),
    });
    const updateReviewError = await db.update(posSupplierPackageChangeReviewsTable)
      .set({ currentPackageName: "spremenjeno" })
      .where(eq(posSupplierPackageChangeReviewsTable.id, packageReviews[0]!.id))
      .then(() => null, error => error as Error & { cause?: unknown });
    expect(updateReviewError).toBeTruthy();
    expect(`${updateReviewError?.message} ${(updateReviewError?.cause as Error | undefined)?.message ?? updateReviewError?.cause ?? ""}`)
      .toContain("append-only");
    const deleteReviewError = await db.delete(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.id, packageReviews[0]!.id))
      .then(() => null, error => error as Error & { cause?: unknown });
    expect(deleteReviewError).toBeTruthy();
    expect(`${deleteReviewError?.message} ${(deleteReviewError?.cause as Error | undefined)?.message ?? deleteReviewError?.cause ?? ""}`)
      .toContain("append-only");

    const repeatedConfirmation = await request(app)
      .post(`/prejemnice/${nameOnlyReceipt.body.id}/confirm`)
      .send({});
    expect(repeatedConfirmation.status).toBe(200);
    const packageReviewsAfterReplay = await db.select()
      .from(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.prejemnicaId, nameOnlyReceipt.body.id));
    expect(packageReviewsAfterReplay).toHaveLength(1);

    const [orderSnapshotAfterConfirmation] = await db.select({
      packageName: posSupplierOrderLinesTable.nazivPakiranja,
      packageFactor: posSupplierOrderLinesTable.faktorPakiranja,
      baseUnit: posSupplierOrderLinesTable.osnovnaEnota,
    }).from(posSupplierOrderLinesTable)
      .where(eq(posSupplierOrderLinesTable.id, nameOnlyLineId));
    const [receiptSnapshotAfterConfirmation] = await db.select({
      supplierOrderLineId: prejemnicePostavkeTable.supplierOrderLineId,
      packageFactor: prejemnicePostavkeTable.enotVPaketu,
    }).from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, nameOnlyReceipt.body.id));
    expect(orderSnapshotAfterConfirmation).toEqual(savedOrderSnapshot);
    expect(receiptSnapshotAfterConfirmation).toEqual(savedReceiptSnapshot);

    const unitChangeOrder = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-08",
      lines: [{ supplierMappingId: openMapping.id, packageQuantity: 1, unitPrice: 21 }],
    });
    expect(unitChangeOrder.status, JSON.stringify(unitChangeOrder.body)).toBe(201);
    orderIds.push(unitChangeOrder.body.id);
    const unitChangeLine = unitChangeOrder.body.lines[0];
    const unitChangeSentOrder = await request(app)
      .post(`/narocila-dobaviteljem/${unitChangeOrder.body.id}/send`)
      .send({});
    expect(unitChangeSentOrder.status, JSON.stringify(unitChangeSentOrder.body)).toBe(200);

    const unitChangeReceipt = await request(app).post("/prejemnice").send({
      dobaviteljId: supplierId,
      datum: "2026-10-17",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 21,
      postavke: [{
        artikelId: openArticle.id,
        supplierOrderLineId: unitChangeLine.id,
        kolicina: 7,
        cenaKos: 3,
        skupaj: 21,
        enotVPaketu: 1,
        izvKolicina: 7,
        izvCena: 3,
        izvEnota: "KOS",
        izvCenaVrsta: "neto",
        ddvStopnja: 0,
      }],
    });

    expect(unitChangeReceipt.status, JSON.stringify(unitChangeReceipt.body)).toBe(201);
    receiptIds.push(unitChangeReceipt.body.id);
    const [unitChangeOrderSnapshot] = await db.select({
      packageName: posSupplierOrderLinesTable.nazivPakiranja,
      packageFactor: posSupplierOrderLinesTable.faktorPakiranja,
      baseUnit: posSupplierOrderLinesTable.osnovnaEnota,
    }).from(posSupplierOrderLinesTable)
      .where(eq(posSupplierOrderLinesTable.id, unitChangeLine.id));
    const [unitChangeReceiptSnapshot] = await db.select({
      supplierOrderLineId: prejemnicePostavkeTable.supplierOrderLineId,
      packageFactor: prejemnicePostavkeTable.enotVPaketu,
      baseUnit: prejemnicePostavkeTable.izvEnota,
      quantity: prejemnicePostavkeTable.kolicina,
    }).from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, unitChangeReceipt.body.id));
    await db.update(artikliTable)
      .set({ enotaMere: "L" })
      .where(eq(artikliTable.id, openArticle.id));

    const unitChangeBlock = await request(app)
      .post(`/prejemnice/${unitChangeReceipt.body.id}/confirm`)
      .send({});
    expect(unitChangeBlock.status).toBe(409);
    expect(unitChangeBlock.body).toMatchObject({
      code: "SUPPLIER_ORDER_BASE_UNIT_CHANGED",
      packageFactorChanges: [{
        supplierOrderLineId: unitChangeLine.id,
        orderPackageName: "transportni zaboj 7 - nova oznaka",
        orderFactor: 7,
        orderBaseUnit: "KOS",
        currentPackageName: "transportni zaboj 7 - nova oznaka",
        currentFactor: 7,
        currentBaseUnit: "L",
      }],
    });

    const acknowledgedUnitMismatch = await request(app)
      .post(`/prejemnice/${unitChangeReceipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: unitChangeBlock.body.packageFactorChanges });
    expect(acknowledgedUnitMismatch.status).toBe(409);
    expect(acknowledgedUnitMismatch.body.code).toBe("SUPPLIER_ORDER_BASE_UNIT_CHANGED");

    await db.update(artikliTable)
      .set({ enotaMere: "ML" })
      .where(eq(artikliTable.id, openArticle.id));
    const latestUnitWarning = await request(app)
      .post(`/prejemnice/${unitChangeReceipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: unitChangeBlock.body.packageFactorChanges });
    expect(latestUnitWarning.status).toBe(409);
    expect(latestUnitWarning.body).toMatchObject({
      code: "SUPPLIER_ORDER_BASE_UNIT_CHANGED",
      packageFactorChanges: [{
        orderBaseUnit: "KOS",
        currentBaseUnit: "ML",
      }],
    });

    const [draftAfterMismatch] = await db.select({
      status: prejemniceTable.status,
    }).from(prejemniceTable)
      .where(eq(prejemniceTable.id, unitChangeReceipt.body.id));
    expect(draftAfterMismatch.status).toBe("draft");
    const [orderSnapshotAfterMismatch] = await db.select({
      packageName: posSupplierOrderLinesTable.nazivPakiranja,
      packageFactor: posSupplierOrderLinesTable.faktorPakiranja,
      baseUnit: posSupplierOrderLinesTable.osnovnaEnota,
    }).from(posSupplierOrderLinesTable)
      .where(eq(posSupplierOrderLinesTable.id, unitChangeLine.id));
    const [receiptSnapshotAfterMismatch] = await db.select({
      supplierOrderLineId: prejemnicePostavkeTable.supplierOrderLineId,
      packageFactor: prejemnicePostavkeTable.enotVPaketu,
      baseUnit: prejemnicePostavkeTable.izvEnota,
      quantity: prejemnicePostavkeTable.kolicina,
    }).from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, unitChangeReceipt.body.id));
    expect(orderSnapshotAfterMismatch).toEqual(unitChangeOrderSnapshot);
    expect(receiptSnapshotAfterMismatch).toEqual(unitChangeReceiptSnapshot);
    const movementsBeforeResolution = await db.select({ id: zalogaGibiTable.id })
      .from(zalogaGibiTable)
      .where(and(
        eq(zalogaGibiTable.referencaId, unitChangeReceipt.body.id),
        eq(zalogaGibiTable.tip, "prejemnica"),
      ));
    expect(movementsBeforeResolution).toHaveLength(0);

    await db.update(artikliTable)
      .set({ enotaMere: "KOS" })
      .where(eq(artikliTable.id, openArticle.id));
    const resolvedUnitReceipt = await request(app)
      .post(`/prejemnice/${unitChangeReceipt.body.id}/confirm`)
      .send({});
    expect(resolvedUnitReceipt.status, JSON.stringify(resolvedUnitReceipt.body)).toBe(200);
    const movementsAfterResolution = await db.select({ id: zalogaGibiTable.id })
      .from(zalogaGibiTable)
      .where(and(
        eq(zalogaGibiTable.referencaId, unitChangeReceipt.body.id),
        eq(zalogaGibiTable.tip, "prejemnica"),
      ));
    expect(movementsAfterResolution).toHaveLength(1);
  });

  it("requires current approval for every changed package line and records all approvals with confirmation", async () => {
    const [firstArticle, secondArticle] = await db.insert(artikliTable).values([
      {
        enotaId,
        ime: `Package approval first ${run}`,
        cena: "5",
        davek: "22",
        enotaMere: "KOS",
        nabavniArtikel: true,
        prodajniArtikel: false,
        aktiven: true,
      },
      {
        enotaId,
        ime: `Package approval second ${run}`,
        cena: "5",
        davek: "22",
        enotaMere: "KOS",
        nabavniArtikel: true,
        prodajniArtikel: false,
        aktiven: true,
      },
    ]).returning({ id: artikliTable.id });
    articleIds.push(firstArticle.id, secondArticle.id);

    const [firstMapping, secondMapping] = await db.insert(artikelDobaviteljTable).values([
      {
        enotaId,
        artikelId: firstArticle.id,
        dobaviteljId: supplierId,
        sifraDobavitelja: `APPROVAL-FIRST-${run}`,
        nazivDobavitelja: `First approval pack ${run}`,
        enotVPaketu: "6",
        nazivPaketa: "prvi paket",
        zadnjaCenaPaket: "18",
        zadnjaCenaEnota: "3",
        aktivno: true,
      },
      {
        enotaId,
        artikelId: secondArticle.id,
        dobaviteljId: supplierId,
        sifraDobavitelja: `APPROVAL-SECOND-${run}`,
        nazivDobavitelja: `Second approval pack ${run}`,
        enotVPaketu: "4",
        nazivPaketa: "drugi paket",
        zadnjaCenaPaket: "12",
        zadnjaCenaEnota: "3",
        aktivno: true,
      },
    ]).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(firstMapping.id, secondMapping.id);
    await db.insert(zalogeTable).values([
      { artikelId: firstArticle.id, kolicina: "0" },
      { artikelId: secondArticle.id, kolicina: "0" },
    ]);

    const createdOrder = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-09",
      lines: [
        { supplierMappingId: firstMapping.id, packageQuantity: 1, unitPrice: 18 },
        { supplierMappingId: secondMapping.id, packageQuantity: 1, unitPrice: 12 },
      ],
    });
    expect(createdOrder.status, JSON.stringify(createdOrder.body)).toBe(201);
    orderIds.push(createdOrder.body.id);
    const firstOrderLine = createdOrder.body.lines.find((line: any) => line.articleId === firstArticle.id);
    const secondOrderLine = createdOrder.body.lines.find((line: any) => line.articleId === secondArticle.id);
    const sentOrder = await request(app).post(`/narocila-dobaviteljem/${createdOrder.body.id}/send`).send({});
    expect(sentOrder.status, JSON.stringify(sentOrder.body)).toBe(200);

    const receipt = await request(app).post("/prejemnice").send({
      dobaviteljId: supplierId,
      datum: "2026-10-30",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 30,
      postavke: [
        {
          artikelId: firstArticle.id,
          supplierOrderLineId: firstOrderLine.id,
          kolicina: 6,
          cenaKos: 3,
          skupaj: 18,
          enotVPaketu: 1,
          izvKolicina: 6,
          izvCena: 3,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        },
        {
          artikelId: secondArticle.id,
          supplierOrderLineId: secondOrderLine.id,
          kolicina: 4,
          cenaKos: 3,
          skupaj: 12,
          enotVPaketu: 1,
          izvKolicina: 4,
          izvCena: 3,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        },
      ],
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    receiptIds.push(receipt.body.id);

    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "8", nazivPaketa: "prvi paket 8" })
      .where(eq(artikelDobaviteljTable.id, firstMapping.id));
    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "5", nazivPaketa: "drugi paket 5" })
      .where(eq(artikelDobaviteljTable.id, secondMapping.id));

    const initialWarning = await request(app)
      .post(`/prejemnice/${receipt.body.id}/confirm`)
      .send({});
    expect(initialWarning.status, JSON.stringify(initialWarning.body)).toBe(409);
    expect(initialWarning.body.packageFactorChanges.map((change: any) => change.supplierOrderLineId))
      .toEqual([firstOrderLine.id, secondOrderLine.id]);

    const incompleteAcknowledgement = await request(app)
      .post(`/prejemnice/${receipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: [initialWarning.body.packageFactorChanges[0]] });
    expect(incompleteAcknowledgement.status, JSON.stringify(incompleteAcknowledgement.body)).toBe(409);
    expect(incompleteAcknowledgement.body.packageFactorChanges.map((change: any) => change.supplierOrderLineId))
      .toEqual([firstOrderLine.id, secondOrderLine.id]);
    const reviewsAfterIncompleteAcknowledgement = await db.select()
      .from(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.prejemnicaId, receipt.body.id));
    expect(reviewsAfterIncompleteAcknowledgement).toHaveLength(0);

    // One line changes again after review: the old acknowledgement set must be rejected as a whole.
    await db.update(artikelDobaviteljTable)
      .set({ enotVPaketu: "7", nazivPaketa: "drugi paket 7" })
      .where(eq(artikelDobaviteljTable.id, secondMapping.id));
    const staleAcknowledgement = await request(app)
      .post(`/prejemnice/${receipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: initialWarning.body.packageFactorChanges });
    expect(staleAcknowledgement.status, JSON.stringify(staleAcknowledgement.body)).toBe(409);
    expect(staleAcknowledgement.body.packageFactorChanges).toMatchObject([
      { supplierOrderLineId: firstOrderLine.id, currentFactor: 8 },
      { supplierOrderLineId: secondOrderLine.id, currentFactor: 7 },
    ]);
    const stillDraft = await db.select({ status: prejemniceTable.status })
      .from(prejemniceTable)
      .where(eq(prejemniceTable.id, receipt.body.id));
    expect(stillDraft[0]?.status).toBe("draft");
    const reviewsAfterStaleAcknowledgement = await db.select()
      .from(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.prejemnicaId, receipt.body.id));
    expect(reviewsAfterStaleAcknowledgement).toHaveLength(0);

    const rollbackFunction = `test_package_approval_rollback_${run}`;
    const rollbackTrigger = `test_package_approval_rollback_${run}`;
    await db.execute(sql.raw(`
      CREATE FUNCTION ${rollbackFunction}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = ${receipt.body.id} AND NEW.status = 'confirmed' THEN
          RAISE EXCEPTION 'test-only failure after package review insert';
        END IF;
        RETURN NEW;
      END
      $$
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER ${rollbackTrigger}
      BEFORE UPDATE OF status ON prejemnice
      FOR EACH ROW EXECUTE FUNCTION ${rollbackFunction}()
    `));
    try {
      const failedConfirmation = await request(app)
        .post(`/prejemnice/${receipt.body.id}/confirm`)
        .send({ reviewedPackageFactorChanges: staleAcknowledgement.body.packageFactorChanges });
      expect(failedConfirmation.status).toBe(500);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER ${rollbackTrigger} ON prejemnice`));
      await db.execute(sql.raw(`DROP FUNCTION ${rollbackFunction}()`));
    }
    const statusAfterConfirmationFailure = await db.select({ status: prejemniceTable.status })
      .from(prejemniceTable)
      .where(eq(prejemniceTable.id, receipt.body.id));
    expect(statusAfterConfirmationFailure[0]?.status).toBe("draft");
    const reviewsAfterConfirmationFailure = await db.select()
      .from(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.prejemnicaId, receipt.body.id));
    expect(reviewsAfterConfirmationFailure).toHaveLength(0);

    const confirmed = await request(app)
      .post(`/prejemnice/${receipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: staleAcknowledgement.body.packageFactorChanges });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body).toMatchObject({ id: receipt.body.id, status: "confirmed" });
    const reviewsAfterConfirmation = await db.select()
      .from(posSupplierPackageChangeReviewsTable)
      .where(eq(posSupplierPackageChangeReviewsTable.prejemnicaId, receipt.body.id));
    expect(reviewsAfterConfirmation).toHaveLength(2);
    expect(reviewsAfterConfirmation.map(review => review.supplierOrderLineId).sort((a, b) => a - b))
      .toEqual([firstOrderLine.id, secondOrderLine.id].sort((a: number, b: number) => a - b));
    expect(reviewsAfterConfirmation).toMatchObject([
      {
        prejemnicaId: receipt.body.id,
        supplierOrderLineId: firstOrderLine.id,
        orderPackageName: "prvi paket",
        currentPackageName: "prvi paket 8",
        actorClerkUserId: context.userId,
      },
      {
        prejemnicaId: receipt.body.id,
        supplierOrderLineId: secondOrderLine.id,
        orderPackageName: "drugi paket",
        currentPackageName: "drugi paket 7",
        actorClerkUserId: context.userId,
      },
    ]);
  });

  it("keeps legacy notes internal and preserves supplier instructions for older clients", async () => {
    const created = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      notes: "Stara opomba, shranjena pred ločitvijo.",
      lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: 18 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    orderIds.push(created.body.id);
    expect(created.body).toMatchObject({
      internalNotes: "Stara opomba, shranjena pred ločitvijo.",
      supplierNotes: null,
    });
    expect(created.body).not.toHaveProperty("notes");

    const separated = await request(app).put(`/narocila-dobaviteljem/${created.body.id}`).send({
      supplierId,
      expectedDeliveryDate: null,
      internalNotes: "Samo za zaposlene.",
      supplierNotes: "Prosimo, dostavite pred 10. uro.",
      lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: 30 }],
    });
    expect(separated.status, JSON.stringify(separated.body)).toBe(200);
    expect(separated.body).toMatchObject({
      internalNotes: "Samo za zaposlene.",
      supplierNotes: "Prosimo, dostavite pred 10. uro.",
    });

    const legacyUpdate = await request(app).put(`/narocila-dobaviteljem/${created.body.id}`).send({
      supplierId,
      expectedDeliveryDate: null,
      notes: "Posodobljena interna opomba iz starega odjemalca.",
      lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: 30 }],
    });
    expect(legacyUpdate.status, JSON.stringify(legacyUpdate.body)).toBe(200);
    expect(legacyUpdate.body).toMatchObject({
      internalNotes: "Posodobljena interna opomba iz starega odjemalca.",
      supplierNotes: "Prosimo, dostavite pred 10. uro.",
    });

    const [stored] = await db.select({
      internalNotes: posSupplierOrdersTable.opomba,
      supplierNotes: posSupplierOrdersTable.navodiloDobavitelju,
    }).from(posSupplierOrdersTable).where(eq(posSupplierOrdersTable.id, created.body.id));
    expect(stored).toEqual({
      internalNotes: "Posodobljena interna opomba iz starega odjemalca.",
      supplierNotes: "Prosimo, dostavite pred 10. uro.",
    });

    const listed = await request(app).get("/narocila-dobaviteljem");
    expect(listed.status).toBe(200);
    expect(listed.body.find((order: any) => order.id === created.body.id)).toMatchObject({
      internalNotes: "Posodobljena interna opomba iz starega odjemalca.",
      supplierNotes: "Prosimo, dostavite pred 10. uro.",
    });
  });

  it("accepts exactly 2,000 UTF-16 code units in notes with emoji and multiple line breaks", async () => {
    const note = `🥚\n\n${"x".repeat(1992)}\nend`;
    expect(note.length).toBe(2000);

    const created = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      internalNotes: note,
      supplierNotes: note,
      lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: 18 }],
    });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    orderIds.push(created.body.id);
    expect(created.body.internalNotes).toBe(note);
    expect(created.body.supplierNotes).toBe(note);

    const rejected = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      internalNotes: `${note}x`,
      supplierNotes: `${note}x`,
      lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: 18 }],
    });
    expect(rejected.status).toBe(400);
  });

  it("does not let a non-administrator manage purchase orders", async () => {
    context.role = "uporabnik";
    const denied = await request(app).get("/narocila-dobaviteljem");
    expect(denied.status).toBe(403);

    const deniedPriceHistoryExport = await request(app)
      .get(`/narocila-dobaviteljem/preslikave/${mappingId}/zgodovina.csv`);
    expect(deniedPriceHistoryExport.status).toBe(403);
    context.role = "admin";
  });

  it("scopes supplier-order price sources by company and unit, breaks date ties by ID, and ignores manual receipts", async () => {
    const [articleA] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Unit A source article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(articleA.id);
    await db.insert(zalogeTable).values({ artikelId: articleA.id, kolicina: "0" });

    const [mappingA] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: articleA.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `SUP-A-${run}`,
      nazivDobavitelja: "Unit A pack",
      enotVPaketu: "6",
      nazivPaketa: "paket A",
      zadnjaCenaPaket: "6",
      zadnjaCenaEnota: "1",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(mappingA.id);

    const [supplierASecond] = await db.insert(counterpartiesTable).values({
      companyId,
      type: "supplier",
      name: `Second supplier for shared article ${run}`,
    }).returning({ id: counterpartiesTable.id });
    extraSupplierIds.push(supplierASecond.id);
    const [mappingASecondSupplier] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: articleA.id,
      dobaviteljId: supplierASecond.id,
      sifraDobavitelja: `SUP-A-SECOND-${run}`,
      nazivDobavitelja: "Second supplier pack",
      enotVPaketu: "6",
      nazivPaketa: "paket drugega dobavitelja",
      zadnjaCenaPaket: "6",
      zadnjaCenaEnota: "1",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(mappingASecondSupplier.id);

    const [articleAOther] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Unit A other mapping article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(articleAOther.id);
    await db.insert(zalogeTable).values({ artikelId: articleAOther.id, kolicina: "0" });

    const [mappingAOther] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: articleAOther.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `SUP-A-OTHER-${run}`,
      nazivDobavitelja: "Unit A other pack",
      enotVPaketu: "6",
      nazivPaketa: "drug paket A",
      zadnjaCenaPaket: "6",
      zadnjaCenaEnota: "1",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(mappingAOther.id);

    const [unitB] = await db.insert(enoteTable).values({
      companyId,
      ime: `Supplier order second unit ${run}`,
    }).returning({ id: enoteTable.id });
    unitIds.push(unitB.id);

    const [articleB] = await db.insert(artikliTable).values({
      enotaId: unitB.id,
      ime: `Unit B source article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(articleB.id);
    await db.insert(zalogeTable).values({ artikelId: articleB.id, kolicina: "0" });

    const [mappingB] = await db.insert(artikelDobaviteljTable).values({
      enotaId: unitB.id,
      artikelId: articleB.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `SUP-B-${run}`,
      nazivDobavitelja: "Unit B pack",
      enotVPaketu: "6",
      nazivPaketa: "paket B",
      zadnjaCenaPaket: "6",
      zadnjaCenaEnota: "1",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(mappingB.id);

    const [otherCompany] = await db.insert(companiesTable).values({
      naziv: `Supplier order other company ${run}`,
      podjetjeDavcna: `SI${run}76`,
    }).returning({ id: companiesTable.id });
    extraCompanyIds.push(otherCompany.id);
    const [otherCompanyUnit] = await db.insert(enoteTable).values({
      companyId: otherCompany.id,
      ime: `Supplier order other company unit ${run}`,
    }).returning({ id: enoteTable.id });
    unitIds.push(otherCompanyUnit.id);
    const [otherCompanySupplier] = await db.insert(counterpartiesTable).values({
      companyId: otherCompany.id,
      type: "supplier",
      name: `Other company supplier ${run}`,
    }).returning({ id: counterpartiesTable.id });
    extraSupplierIds.push(otherCompanySupplier.id);
    const [otherCompanyArticle] = await db.insert(artikliTable).values({
      enotaId: otherCompanyUnit.id,
      ime: `Other company price article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(otherCompanyArticle.id);
    await db.insert(zalogeTable).values({ artikelId: otherCompanyArticle.id, kolicina: "0" });
    const [otherCompanyMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId: otherCompanyUnit.id,
      artikelId: otherCompanyArticle.id,
      dobaviteljId: otherCompanySupplier.id,
      sifraDobavitelja: `SUP-OTHER-COMPANY-${run}`,
      nazivDobavitelja: "Other company pack",
      enotVPaketu: "6",
      nazivPaketa: "paket drugega podjetja",
      zadnjaCenaPaket: "7395.36",
      zadnjaCenaEnota: "1232.56",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(otherCompanyMapping.id);

    const createConfirmedSource = async (input: {
      unitId: number;
      articleId: number;
      supplierMappingId: number;
      supplierId?: string;
      unitPrice: number;
      date: string;
    }) => {
      context.enotaId = input.unitId;
      const sourceSupplierId = input.supplierId ?? supplierId;
      const order = await request(app).post("/narocila-dobaviteljem").send({
        supplierId: sourceSupplierId,
        lines: [{
          supplierMappingId: input.supplierMappingId,
          packageQuantity: 1,
          unitPrice: input.unitPrice * 6,
        }],
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);
      orderIds.push(order.body.id);

      const sent = await request(app).post(`/narocila-dobaviteljem/${order.body.id}/send`).send({});
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);

      const lineId = order.body.lines[0].id as number;
      const lineAmount = input.unitPrice * 6;
      const receipt = await request(app).post("/prejemnice").send({
        dobaviteljId: sourceSupplierId,
        datum: input.date,
        vrstaCen: "neto",
        vrstaDokumenta: "DOBAVNICA",
        brutoSkupaj: lineAmount,
        postavke: [{
          artikelId: input.articleId,
          supplierOrderLineId: lineId,
          kolicina: 6,
          cenaKos: input.unitPrice,
          skupaj: lineAmount,
          enotVPaketu: 1,
          izvKolicina: 6,
          izvCena: input.unitPrice,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        }],
      });
      expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
      receiptIds.push(receipt.body.id);

      const confirmed = await request(app).post(`/prejemnice/${receipt.body.id}/confirm`).send({});
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      const detail = await request(app).get(`/prejemnice/${receipt.body.id}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body.stevilka).toBeTruthy();

      return {
        receiptId: receipt.body.id as number,
        receiptNumber: detail.body.stevilka as string,
        date: input.date,
        packagePrice: lineAmount,
        unitPrice: input.unitPrice,
      };
    };

    try {
      const sourceA = await createConfirmedSource({
        unitId: enotaId,
        articleId: articleA.id,
        supplierMappingId: mappingA.id,
        unitPrice: 2,
        date: "2026-10-19",
      });
      const sourceASecondSupplier = await createConfirmedSource({
        unitId: enotaId,
        articleId: articleA.id,
        supplierMappingId: mappingASecondSupplier.id,
        supplierId: supplierASecond.id,
        unitPrice: 99.9,
        date: "2026-10-23",
      });
      const sameDateHigherIdSourceA = await createConfirmedSource({
        unitId: enotaId,
        articleId: articleA.id,
        supplierMappingId: mappingA.id,
        unitPrice: 2.5,
        date: "2026-10-19",
      });
      expect(sameDateHigherIdSourceA.date).toBe(sourceA.date);
      expect(sameDateHigherIdSourceA.receiptId).toBeGreaterThan(sourceA.receiptId);

      const laterInsertedOlderSourceA = await createConfirmedSource({
        unitId: enotaId,
        articleId: articleA.id,
        supplierMappingId: mappingA.id,
        unitPrice: 1.5,
        date: "2026-10-18",
      });
      expect(laterInsertedOlderSourceA.receiptId).toBeGreaterThan(sourceA.receiptId);
      expect(laterInsertedOlderSourceA.date).toBe("2026-10-18");

      const olderHistorySourcesA: Awaited<ReturnType<typeof createConfirmedSource>>[] = [];
      for (const [date, unitPrice] of [
        ["2026-10-17", 1.25],
        ["2026-10-16", 1],
        ["2026-10-15", 0.75],
      ] as const) {
        olderHistorySourcesA.push(await createConfirmedSource({
          unitId: enotaId,
          articleId: articleA.id,
          supplierMappingId: mappingA.id,
          unitPrice,
          date,
        }));
      }
      const sameDateOlderHistorySourceA = await createConfirmedSource({
        unitId: enotaId,
        articleId: articleA.id,
        supplierMappingId: mappingA.id,
        unitPrice: 0.9,
        date: "2026-10-16",
      });
      const sourceB = await createConfirmedSource({
        unitId: unitB.id,
        articleId: articleB.id,
        supplierMappingId: mappingB.id,
        unitPrice: 7,
        date: "2026-10-20",
      });
      let otherCompanySource: Awaited<ReturnType<typeof createConfirmedSource>>;
      context.companyId = otherCompany.id;
      try {
        otherCompanySource = await createConfirmedSource({
          unitId: otherCompanyUnit.id,
          articleId: otherCompanyArticle.id,
          supplierMappingId: otherCompanyMapping.id,
          supplierId: otherCompanySupplier.id,
          unitPrice: 9876.54,
          date: "2026-10-21",
        });
      } finally {
        context.companyId = companyId;
        context.enotaId = enotaId;
      }
      const sourceAOther = await createConfirmedSource({
        unitId: enotaId,
        articleId: articleAOther.id,
        supplierMappingId: mappingAOther.id,
        unitPrice: 4,
        date: "2026-10-20",
      });

      context.enotaId = enotaId;
      const manualReceipt = await request(app).post("/prejemnice").send({
        dobaviteljId: supplierId,
        datum: "2026-10-20",
        vrstaCen: "neto",
        vrstaDokumenta: "DOBAVNICA",
        brutoSkupaj: 600,
        postavke: [{
          artikelId: articleA.id,
          kolicina: 6,
          cenaKos: 100,
          skupaj: 600,
          enotVPaketu: 1,
          izvKolicina: 6,
          izvCena: 100,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        }],
      });
      expect(manualReceipt.status, JSON.stringify(manualReceipt.body)).toBe(201);
      receiptIds.push(manualReceipt.body.id);
      const manualReceiptConfirmed = await request(app)
        .post(`/prejemnice/${manualReceipt.body.id}/confirm`)
        .send({});
      expect(manualReceiptConfirmed.status, JSON.stringify(manualReceiptConfirmed.body)).toBe(200);
      const manualReceiptDetails = await request(app).get(`/prejemnice/${manualReceipt.body.id}`);
      expect(manualReceiptDetails.status, JSON.stringify(manualReceiptDetails.body)).toBe(200);
      expect(manualReceiptDetails.body).toMatchObject({
        id: manualReceipt.body.id,
        dobaviteljId: supplierId,
        prejemnoPodjetjeNaziv: `Supplier order ${run}`,
        status: "confirmed",
      });
      expect(manualReceiptDetails.body.postavke).toEqual(expect.arrayContaining([
        expect.objectContaining({
          artikelId: articleA.id,
          supplierOrderLineId: null,
          cenaKos: 100,
        }),
      ]));
      const manualReceiptId = manualReceipt.body.id as number;

      const receiptListWithoutUnit = await request(app).get("/prejemnice");
      expect(receiptListWithoutUnit.status).toBe(400);
      expect(receiptListWithoutUnit.body).toMatchObject({ koda: "ENOTA_OBVEZNA" });
      expect(Array.isArray(receiptListWithoutUnit.body)).toBe(false);

      const receiptListWithInvalidUnit = await request(app)
        .get("/prejemnice")
        .set("X-Enota-Id", "not-a-unit");
      expect(receiptListWithInvalidUnit.status).toBe(400);
      expect(receiptListWithInvalidUnit.body).toMatchObject({ koda: "ENOTA_OBVEZNA" });

      const receiptListA = await request(app)
        .get("/prejemnice")
        .set("X-Enota-Id", String(enotaId));
      expect(receiptListA.status, JSON.stringify(receiptListA.body)).toBe(200);
      const receiptIdsForA = receiptListA.body.map((receipt: any) => receipt.id);
      expect(receiptIdsForA).toContain(sourceA.receiptId);
      expect(receiptIdsForA).toContain(laterInsertedOlderSourceA.receiptId);
      expect(receiptIdsForA).toContain(manualReceiptId);
      expect(receiptIdsForA).not.toContain(sourceB.receiptId);

      context.enotaId = unitB.id;
      const receiptListB = await request(app)
        .get("/prejemnice")
        .set("X-Enota-Id", String(unitB.id));
      expect(receiptListB.status, JSON.stringify(receiptListB.body)).toBe(200);
      const receiptIdsForB = receiptListB.body.map((receipt: any) => receipt.id);
      expect(receiptIdsForB).toContain(sourceB.receiptId);
      expect(receiptIdsForB).not.toContain(sourceA.receiptId);
      expect(receiptIdsForB).not.toContain(laterInsertedOlderSourceA.receiptId);
      expect(receiptIdsForB).not.toContain(manualReceiptId);

      context.enotaId = unitB.id;
      const inaccessibleReceiptA = await request(app).get(`/prejemnice/${sourceA.receiptId}`);
      expect(inaccessibleReceiptA.status).toBe(404);
      expect(JSON.stringify(inaccessibleReceiptA.body)).not.toContain(sourceA.receiptNumber);
      expect(JSON.stringify(inaccessibleReceiptA.body)).not.toContain(`Unit A source article ${run}`);

      const receiptDetailsB = await request(app).get(`/prejemnice/${sourceB.receiptId}`);
      expect(receiptDetailsB.status, JSON.stringify(receiptDetailsB.body)).toBe(200);
      expect(receiptDetailsB.body).toMatchObject({
        id: sourceB.receiptId,
        stevilka: sourceB.receiptNumber,
      });
      expect(receiptDetailsB.body.postavke.map((line: any) => line.artikelId)).toEqual([articleB.id]);
      expect(JSON.stringify(receiptDetailsB.body)).not.toContain(`Unit A source article ${run}`);

      context.enotaId = enotaId;
      const receiptDetailsA = await request(app).get(`/prejemnice/${sourceA.receiptId}`);
      expect(receiptDetailsA.status, JSON.stringify(receiptDetailsA.body)).toBe(200);
      expect(receiptDetailsA.body).toMatchObject({
        id: sourceA.receiptId,
        stevilka: sourceA.receiptNumber,
      });
      expect(receiptDetailsA.body.postavke.map((line: any) => line.artikelId)).toEqual([articleA.id]);
      expect(JSON.stringify(receiptDetailsA.body)).not.toContain(`Unit B source article ${run}`);

      const sourcesForA = await getLatestSupplierPriceReceipts(db, enotaId, [mappingA.id, mappingAOther.id, mappingB.id]);
      expect(sourcesForA.get(mappingA.id)).toEqual({
        receiptId: sameDateHigherIdSourceA.receiptId,
        date: sameDateHigherIdSourceA.date,
        receiptNumber: sameDateHigherIdSourceA.receiptNumber,
      });
      expect(sourcesForA.get(mappingAOther.id)).toEqual({
        receiptId: sourceAOther.receiptId,
        date: sourceAOther.date,
        receiptNumber: sourceAOther.receiptNumber,
      });
      expect(sourcesForA.has(mappingB.id)).toBe(false);

      const sourcesForB = await getLatestSupplierPriceReceipts(db, unitB.id, [mappingA.id, mappingB.id]);
      expect(sourcesForB.get(mappingB.id)).toEqual({
        receiptId: sourceB.receiptId,
        date: sourceB.date,
        receiptNumber: sourceB.receiptNumber,
      });
      expect(sourcesForB.has(mappingA.id)).toBe(false);

      context.enotaId = unitB.id;
      const inaccessiblePriceHistoryExport = await request(app)
        .get(`/narocila-dobaviteljem/preslikave/${mappingA.id}/zgodovina.csv`);
      expect(inaccessiblePriceHistoryExport.status).toBe(404);
      const dashboardB = await request(app).get("/narocila-dobaviteljem/pregled");
      expect(dashboardB.status, JSON.stringify(dashboardB.body)).toBe(200);
      expect(dashboardB.body.articles.map((row: any) => row.articleId)).toContain(articleB.id);
      expect(dashboardB.body.articles.map((row: any) => row.articleId)).not.toContain(articleA.id);
      expect(dashboardB.body.articles.map((row: any) => row.articleId)).not.toContain(articleAOther.id);
      const mappingInB = dashboardB.body.articles
        .find((row: any) => row.articleId === articleB.id).mappings
        .find((mapping: any) => mapping.id === mappingB.id);
      expect(mappingInB).toMatchObject({
        lastPackagePrice: sourceB.packagePrice,
        lastPriceReceipt: {
          receiptId: sourceB.receiptId,
          date: sourceB.date,
          receiptNumber: sourceB.receiptNumber,
        },
        priceHistory: [{
          receiptId: sourceB.receiptId,
          date: sourceB.date,
          receiptNumber: sourceB.receiptNumber,
          unitPrice: sourceB.unitPrice,
        }],
      });

      context.enotaId = enotaId;
      const dashboardA = await request(app).get("/narocila-dobaviteljem/pregled");
      expect(dashboardA.status, JSON.stringify(dashboardA.body)).toBe(200);
      const dashboardAReceiptIds = dashboardA.body.articles.flatMap((article: any) =>
        article.mappings.flatMap((mapping: any) => [
          mapping.lastPriceReceipt?.receiptId,
          ...mapping.priceHistory.map((entry: any) => entry.receiptId),
        ]));
      expect(dashboardAReceiptIds).not.toContain(otherCompanySource.receiptId);
      expect(JSON.stringify(dashboardA.body)).not.toContain(`Other company price article ${run}`);
      expect(JSON.stringify(dashboardA.body)).not.toContain(`Other price history supplier ${run}`);
      expect(JSON.stringify(dashboardA.body)).not.toContain("9876.54");
      expect(dashboardA.body.articles.map((row: any) => row.articleId)).toContain(articleA.id);
      expect(dashboardA.body.articles.map((row: any) => row.articleId)).toContain(articleAOther.id);
      expect(dashboardA.body.articles.map((row: any) => row.articleId)).not.toContain(articleB.id);
      expect(dashboardA.body.articles.map((row: any) => row.articleId)).not.toContain(otherCompanyArticle.id);
      const mappingInA = dashboardA.body.articles
        .find((row: any) => row.articleId === articleA.id).mappings
        .find((mapping: any) => mapping.id === mappingA.id);

      const olderPageA = await request(app)
        .get(`/narocila-dobaviteljem/povezave/${mappingA.id}/cene`)
        .query({
          beforeDate: mappingInA.priceHistory[4].date,
          beforeReceiptId: mappingInA.priceHistory[4].receiptId,
          limit: 5,
        });
      expect(olderPageA.status, JSON.stringify(olderPageA.body)).toBe(200);
      expect(olderPageA.body).toMatchObject({ hasMore: false, nextCursor: null });
      expect(olderPageA.body.entries.map((entry: any) => entry.receiptId)).toEqual([
        olderHistorySourcesA[1]!.receiptId,
        olderHistorySourcesA[2]!.receiptId,
      ]);
      expect(olderPageA.body.entries.map((entry: any) => entry.receiptId))
        .not.toContain(manualReceiptId);
      expect(olderPageA.body.entries.map((entry: any) => entry.receiptId))
        .not.toContain(sourceASecondSupplier.receiptId);
      expect(olderPageA.body.entries.map((entry: any) => entry.receiptId))
        .not.toContain(sourceAOther.receiptId);

      const firstOlderSlice = await request(app)
        .get(`/narocila-dobaviteljem/povezave/${mappingA.id}/cene`)
        .query({
          beforeDate: mappingInA.priceHistory[4].date,
          beforeReceiptId: mappingInA.priceHistory[4].receiptId,
          limit: 1,
        });
      expect(firstOlderSlice.status, JSON.stringify(firstOlderSlice.body)).toBe(200);
      expect(firstOlderSlice.body.entries.map((entry: any) => entry.receiptId))
        .toEqual([olderHistorySourcesA[1]!.receiptId]);
      expect(firstOlderSlice.body).toMatchObject({
        hasMore: true,
        nextCursor: {
          date: olderHistorySourcesA[1]!.date,
          receiptId: olderHistorySourcesA[1]!.receiptId,
        },
      });
      const continuedOlderPage = await request(app)
        .get(`/narocila-dobaviteljem/povezave/${mappingA.id}/cene`)
        .query({
          beforeDate: firstOlderSlice.body.nextCursor.date,
          beforeReceiptId: firstOlderSlice.body.nextCursor.receiptId,
          limit: 5,
        });
      expect(continuedOlderPage.status, JSON.stringify(continuedOlderPage.body)).toBe(200);
      expect(continuedOlderPage.body.entries.map((entry: any) => entry.receiptId))
        .toEqual([olderHistorySourcesA[2]!.receiptId]);
      expect(continuedOlderPage.body).toMatchObject({ hasMore: false, nextCursor: null });

      const invalidHistoryCursor = await request(app)
        .get(`/narocila-dobaviteljem/povezave/${mappingA.id}/cene`)
        .query({ beforeDate: "2026-02-30", beforeReceiptId: sourceA.receiptId });
      expect(invalidHistoryCursor.status).toBe(400);

      const priceHistoryExportA = await request(app)
        .get(`/narocila-dobaviteljem/preslikave/${mappingA.id}/zgodovina.csv`);
      expect(priceHistoryExportA.status, JSON.stringify(priceHistoryExportA.body)).toBe(200);
      expect(priceHistoryExportA.headers["content-type"]).toContain("text/csv");
      expect(priceHistoryExportA.headers["content-disposition"])
        .toContain(`dobaviteljske-cene-${mappingA.id}.csv`);
      const exportedHistory = priceHistoryExportA.text.replace(/^\uFEFF/, "").trim();
      const exportedRows = exportedHistory.split("\r\n");
      expect(exportedRows).toHaveLength(8);
      expect(exportedRows[0]).toBe('"Številka prejemnice";"Datum";"Cena na osnovno enoto (KOS)"');
      for (const source of [
        sourceA,
        sameDateHigherIdSourceA,
        laterInsertedOlderSourceA,
        sameDateOlderHistorySourceA,
        ...olderHistorySourcesA,
      ]) {
        const price = source.unitPrice.toFixed(6).replace(".", ",");
        expect(exportedRows).toContain(
          `"${source.receiptNumber}";"${source.date}";"${price}"`,
        );
      }
      expect(exportedHistory).not.toContain(manualReceiptDetails.body.stevilka);
      expect(exportedHistory).not.toContain(sourceB.receiptNumber);
      expect(exportedHistory).not.toContain(otherCompanySource.receiptNumber);
      expect(exportedHistory).not.toContain(sourceAOther.receiptNumber);
      expect(exportedHistory).not.toContain(sourceASecondSupplier.receiptNumber);

      expect(mappingInA).toMatchObject({
        lastPackagePrice: sameDateHigherIdSourceA.packagePrice,
        lastPriceReceipt: {
          receiptId: sameDateHigherIdSourceA.receiptId,
          date: sameDateHigherIdSourceA.date,
          receiptNumber: sameDateHigherIdSourceA.receiptNumber,
        },
      });
      expect(mappingInA.priceHistory).toEqual([
        {
            receiptId: sameDateHigherIdSourceA.receiptId,
            date: sameDateHigherIdSourceA.date,
            receiptNumber: sameDateHigherIdSourceA.receiptNumber,
            unitPrice: sameDateHigherIdSourceA.unitPrice,
        },
        {
          receiptId: sourceA.receiptId,
          date: sourceA.date,
          receiptNumber: sourceA.receiptNumber,
          unitPrice: sourceA.unitPrice,
        },
        {
          receiptId: laterInsertedOlderSourceA.receiptId,
          date: laterInsertedOlderSourceA.date,
          receiptNumber: laterInsertedOlderSourceA.receiptNumber,
          unitPrice: laterInsertedOlderSourceA.unitPrice,
        },
        {
          receiptId: olderHistorySourcesA[0]!.receiptId,
          date: olderHistorySourcesA[0]!.date,
          receiptNumber: olderHistorySourcesA[0]!.receiptNumber,
          unitPrice: olderHistorySourcesA[0]!.unitPrice,
        },
        {
          receiptId: sameDateOlderHistorySourceA.receiptId,
          date: sameDateOlderHistorySourceA.date,
          receiptNumber: sameDateOlderHistorySourceA.receiptNumber,
          unitPrice: sameDateOlderHistorySourceA.unitPrice,
        },
      ]);
      expect(mappingInA.priceHistory).toHaveLength(5);
      expect(mappingInA.hasOlderPriceHistory).toBe(true);
      expect(mappingInA.priceHistory.map((entry: any) => entry.receiptId)).not.toContain(manualReceiptId);
      expect(mappingInA.priceHistory.map((entry: any) => entry.receiptId))
        .not.toContain(olderHistorySourcesA[1]!.receiptId);
      expect(mappingInA.priceHistory.map((entry: any) => entry.receiptId))
        .not.toContain(olderHistorySourcesA[2]!.receiptId);
      expect(mappingInA.priceHistory.map((entry: any) => entry.receiptId))
        .not.toContain(sourceASecondSupplier.receiptId);
      expect(mappingInA.lastPriceReceipt.receiptId).not.toBe(sourceASecondSupplier.receiptId);

      const mappingASecondSupplierInDashboard = dashboardA.body.articles
        .find((row: any) => row.articleId === articleA.id).mappings
        .find((mapping: any) => mapping.id === mappingASecondSupplier.id);
      expect(mappingASecondSupplierInDashboard.lastPackagePrice)
        .toBeCloseTo(sourceASecondSupplier.packagePrice, 6);
      expect(mappingASecondSupplierInDashboard).toMatchObject({
        lastPriceReceipt: {
          receiptId: sourceASecondSupplier.receiptId,
          date: sourceASecondSupplier.date,
          receiptNumber: sourceASecondSupplier.receiptNumber,
        },
        priceHistory: [{
          receiptId: sourceASecondSupplier.receiptId,
          date: sourceASecondSupplier.date,
          receiptNumber: sourceASecondSupplier.receiptNumber,
          unitPrice: sourceASecondSupplier.unitPrice,
        }],
      });
      expect(mappingASecondSupplierInDashboard.priceHistory.map((entry: any) => entry.receiptId))
        .not.toContain(sourceA.receiptId);

      const mappingAOtherInDashboard = dashboardA.body.articles
        .find((row: any) => row.articleId === articleAOther.id).mappings
        .find((mapping: any) => mapping.id === mappingAOther.id);
      expect(mappingAOtherInDashboard).toMatchObject({
        lastPackagePrice: sourceAOther.packagePrice,
        lastPriceReceipt: {
          receiptId: sourceAOther.receiptId,
          date: sourceAOther.date,
          receiptNumber: sourceAOther.receiptNumber,
        },
        priceHistory: [{
          receiptId: sourceAOther.receiptId,
          date: sourceAOther.date,
          receiptNumber: sourceAOther.receiptNumber,
          unitPrice: sourceAOther.unitPrice,
        }],
      });

      const mappingBFromUnitA = await request(app)
        .get(`/narocila-dobaviteljem/povezave/${mappingB.id}/cene`)
        .query({ beforeDate: sourceB.date, beforeReceiptId: sourceB.receiptId });
      expect(mappingBFromUnitA.status).toBe(404);

      context.enotaId = unitB.id;
      const mappingAFromUnitB = await request(app)
        .get(`/narocila-dobaviteljem/povezave/${mappingA.id}/cene`)
        .query({ beforeDate: sourceA.date, beforeReceiptId: sourceA.receiptId });
      expect(mappingAFromUnitB.status).toBe(404);
    } finally {
      context.enotaId = enotaId;
    }
  });

  it("does not expose a receipt belonging to another company by direct ID", async () => {
    const [foreignCompany] = await db.insert(companiesTable).values({
      naziv: `Foreign supplier order ${run}`,
      podjetjeDavcna: `SI${run}99`,
    }).returning({ id: companiesTable.id });
    extraCompanyIds.push(foreignCompany.id);

    const [foreignUnit] = await db.insert(enoteTable).values({
      companyId: foreignCompany.id,
      ime: `Foreign supplier order unit ${run}`,
    }).returning({ id: enoteTable.id });
    unitIds.push(foreignUnit.id);

    const [foreignSupplier] = await db.insert(counterpartiesTable).values({
      companyId: foreignCompany.id,
      type: "supplier",
      name: `FOREIGN-RECEIPT-SUPPLIER-${run}`,
    }).returning({ id: counterpartiesTable.id });
    extraSupplierIds.push(foreignSupplier.id);

    const [foreignArticle] = await db.insert(artikliTable).values({
      enotaId: foreignUnit.id,
      ime: `FOREIGN-RECEIPT-ARTICLE-${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(foreignArticle.id);

    let foreignReceiptId = 0;
    let foreignReceiptNumber = "";
    context.companyId = foreignCompany.id;
    context.enotaId = foreignUnit.id;
    try {
      const createdForeignReceipt = await request(app).post("/prejemnice").send({
        dobaviteljId: foreignSupplier.id,
        datum: "2026-10-20",
        vrstaCen: "neto",
        vrstaDokumenta: "DOBAVNICA",
        brutoSkupaj: 9876.54,
        opomba: `FOREIGN-RECEIPT-NOTE-${run}`,
        postavke: [{
          artikelId: foreignArticle.id,
          kolicina: 3,
          cenaKos: 1234.56,
          skupaj: 3703.68,
          enotVPaketu: 1,
          izvKolicina: 3,
          izvCena: 1234.56,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        }],
      });
      expect(createdForeignReceipt.status, JSON.stringify(createdForeignReceipt.body)).toBe(201);
      foreignReceiptId = createdForeignReceipt.body.id as number;
      foreignReceiptNumber = createdForeignReceipt.body.stevilka as string;
      expect(foreignReceiptNumber).toBeTruthy();
      receiptIds.push(foreignReceiptId);
    } finally {
      context.companyId = companyId;
      context.enotaId = enotaId;
    }

    const ownReceipt = await request(app).post("/prejemnice").send({
      dobaviteljId: supplierId,
      datum: "2026-10-20",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 10,
      postavke: [{
        artikelId: articleId,
        kolicina: 2,
        cenaKos: 5,
        skupaj: 10,
        enotVPaketu: 1,
        izvKolicina: 2,
        izvCena: 5,
        izvEnota: "KOS",
        izvCenaVrsta: "neto",
        ddvStopnja: 0,
      }],
    });
    expect(ownReceipt.status, JSON.stringify(ownReceipt.body)).toBe(201);
    receiptIds.push(ownReceipt.body.id);

    const ownReceiptList = await request(app)
      .get("/prejemnice")
      .set("X-Enota-Id", String(enotaId));
    expect(ownReceiptList.status, JSON.stringify(ownReceiptList.body)).toBe(200);
    expect(ownReceiptList.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: ownReceipt.body.id,
        dobaviteljId: supplierId,
        dobaviteljNaziv: `Supplier ${run}`,
        skupajVrednost: 10,
      }),
    ]));
    expect(ownReceiptList.body.map((receipt: any) => receipt.id)).not.toContain(foreignReceiptId);
    const ownReceiptListJson = JSON.stringify(ownReceiptList.body);
    for (const foreignValue of [`FOREIGN-RECEIPT-SUPPLIER-${run}`, "3703.68", "9876.54"]) {
      expect(ownReceiptListJson).not.toContain(foreignValue);
    }

    context.companyId = foreignCompany.id;
    context.enotaId = foreignUnit.id;
    try {
      const foreignReceiptList = await request(app)
        .get("/prejemnice")
        .set("X-Enota-Id", String(foreignUnit.id));
      expect(foreignReceiptList.status, JSON.stringify(foreignReceiptList.body)).toBe(200);
      expect(foreignReceiptList.body).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: foreignReceiptId,
          dobaviteljNaziv: `FOREIGN-RECEIPT-SUPPLIER-${run}`,
          skupajVrednost: 3703.68,
        }),
      ]));
      expect(foreignReceiptList.body.map((receipt: any) => receipt.id)).not.toContain(ownReceipt.body.id);
    } finally {
      context.companyId = companyId;
      context.enotaId = enotaId;
    }

    const accessibleOwnReceipt = await request(app).get(`/prejemnice/${ownReceipt.body.id}`);
    expect(accessibleOwnReceipt.status, JSON.stringify(accessibleOwnReceipt.body)).toBe(200);
    expect(accessibleOwnReceipt.body).toMatchObject({
      id: ownReceipt.body.id,
      dobaviteljNaziv: `Supplier ${run}`,
      skupajVrednost: 10,
      postavke: [{ artikelIme: `Order article ${run}`, skupaj: 10 }],
    });
    const ownBookingPreview = await request(app).get(`/prejemnice/${ownReceipt.body.id}/booking-preview`);
    expect(ownBookingPreview.status, JSON.stringify(ownBookingPreview.body)).toBe(200);
    const editedOwnReceipt = await request(app).put(`/prejemnice/${ownReceipt.body.id}`).send({
      opomba: `OWN-RECEIPT-EDIT-${run}`,
    });
    expect(editedOwnReceipt.status, JSON.stringify(editedOwnReceipt.body)).toBe(200);
    const updatedOwnReceipt = await request(app).get(`/prejemnice/${ownReceipt.body.id}`);
    expect(updatedOwnReceipt.status).toBe(200);
    expect(updatedOwnReceipt.body.opomba).toBe(`OWN-RECEIPT-EDIT-${run}`);

    const foreignReceiptBefore = await db.select().from(prejemniceTable)
      .where(eq(prejemniceTable.id, foreignReceiptId));
    const foreignLinesBefore = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, foreignReceiptId));
    const foreignMovementsBefore = await db.select().from(zalogaGibiTable)
      .where(and(
        eq(zalogaGibiTable.artikelId, foreignArticle.id),
        eq(zalogaGibiTable.referencaId, foreignReceiptId),
      ));

    const foreignReceipt = await request(app).get(`/prejemnice/${foreignReceiptId}`);
    expect(foreignReceipt.status).toBe(404);
    const foreignBookingPreview = await request(app).get(`/prejemnice/${foreignReceiptId}/booking-preview`);
    expect(foreignBookingPreview.status).toBe(404);
    const foreignBookingDraft = await request(app)
      .post(`/prejemnice/${foreignReceiptId}/booking-draft`)
      .send({ previewHash: "foreign-preview-hash" });
    expect(foreignBookingDraft.status).toBe(404);
    const foreignConfirmation = await request(app).post(`/prejemnice/${foreignReceiptId}/confirm`).send({});
    expect(foreignConfirmation.status).toBe(404);
    const foreignEdit = await request(app).put(`/prejemnice/${foreignReceiptId}`).send({
      opomba: `FOREIGN-RECEIPT-EDIT-ATTEMPT-${run}`,
    });
    expect(foreignEdit.status).toBe(404);
    const foreignDelete = await request(app).delete(`/prejemnice/${foreignReceiptId}`);
    expect(foreignDelete.status).toBe(404);

    const foreignResponses = [
      foreignReceipt,
      foreignBookingPreview,
      foreignBookingDraft,
      foreignConfirmation,
      foreignEdit,
      foreignDelete,
    ].map(response => JSON.stringify(response.body));

    const foreignReceiptAfter = await db.select().from(prejemniceTable)
      .where(eq(prejemniceTable.id, foreignReceiptId));
    const foreignLinesAfter = await db.select().from(prejemnicePostavkeTable)
      .where(eq(prejemnicePostavkeTable.prejemnicaId, foreignReceiptId));
    const foreignMovementsAfter = await db.select().from(zalogaGibiTable)
      .where(and(
        eq(zalogaGibiTable.artikelId, foreignArticle.id),
        eq(zalogaGibiTable.referencaId, foreignReceiptId),
      ));
    expect(foreignReceiptAfter).toEqual(foreignReceiptBefore);
    expect(foreignLinesAfter).toEqual(foreignLinesBefore);
    expect(foreignMovementsAfter).toEqual(foreignMovementsBefore);

    for (const foreignResponse of foreignResponses) {
      for (const secret of [
        foreignReceiptNumber,
        `FOREIGN-RECEIPT-SUPPLIER-${run}`,
        `FOREIGN-RECEIPT-ARTICLE-${run}`,
        `FOREIGN-RECEIPT-NOTE-${run}`,
        `FOREIGN-RECEIPT-EDIT-ATTEMPT-${run}`,
        "9876.54",
        "3703.68",
        "1234.56",
      ]) {
        expect(foreignResponse).not.toContain(secret);
      }
    }
  });

  it("preserves zero prices and omits invalid or non-finite package comparisons", async () => {
    context.enotaId = enotaId;
    const [comparisonArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Comparable purchase article ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "L",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(comparisonArticle.id);
    await db.insert(zalogeTable).values({ artikelId: comparisonArticle.id, kolicina: "0" });

    const [comparisonSupplier] = await db.insert(counterpartiesTable).values({
      companyId,
      type: "supplier",
      name: `Comparison supplier ${run}`,
    }).returning({ id: counterpartiesTable.id });
    const localMappingIds: number[] = [];
    const addMapping = async (input: {
      supplierId: string;
      code: string;
      packageFactor: string;
      packagePrice: string | null;
      unitPrice: string | null;
    }) => {
      const [mapping] = await db.insert(artikelDobaviteljTable).values({
        enotaId,
        artikelId: comparisonArticle.id,
        dobaviteljId: input.supplierId,
        sifraDobavitelja: `CMP-${input.code}-${run}`,
        nazivDobavitelja: `Primerjava ${input.code}`,
        enotVPaketu: input.packageFactor,
        nazivPaketa: `${input.code} pakiranje`,
        zadnjaCenaPaket: input.packagePrice,
        zadnjaCenaEnota: input.unitPrice,
        aktivno: true,
      }).returning({ id: artikelDobaviteljTable.id });
      localMappingIds.push(mapping.id);
      return mapping.id;
    };

    try {
      const sixUnitMappingId = await addMapping({
        supplierId,
        code: "SIX",
        packageFactor: "6",
        packagePrice: "24",
        unitPrice: "4",
      });
      const eightUnitMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "EIGHT",
        packageFactor: "8",
        packagePrice: "20",
        unitPrice: "2.5",
      });
      const zeroPriceMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "FREE",
        packageFactor: "6",
        packagePrice: "0",
        unitPrice: "0",
      });
      const invalidFactorMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "ZERO",
        packageFactor: "0",
        packagePrice: "10",
        unitPrice: "10",
      });
      const missingPriceMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "NO-PRICE",
        packageFactor: "4",
        packagePrice: null,
        unitPrice: null,
      });
      const nonFinitePackagePriceMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "NAN-PACKAGE",
        packageFactor: "6",
        packagePrice: "NaN",
        unitPrice: "4",
      });
      const nonFiniteUnitPriceMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "NAN-UNIT",
        packageFactor: "6",
        packagePrice: "24",
        unitPrice: "NaN",
      });

      const negativePackagePriceMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "NEGATIVE-PACKAGE",
        packageFactor: "6",
        packagePrice: "-1",
        unitPrice: "4",
      });
      const negativeUnitPriceMappingId = await addMapping({
        supplierId: comparisonSupplier.id,
        code: "NEGATIVE-UNIT",
        packageFactor: "6",
        packagePrice: "24",
        unitPrice: "-0.5",
      });
      const response = await request(app).get("/narocila-dobaviteljem/pregled");
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const article = response.body.articles.find((row: any) => row.articleId === comparisonArticle.id);
      expect(article.baseUnit).toBe("L");

      const comparablePriceByMappingId = new Map(
        article.mappings.map((mapping: any) => [mapping.id, mapping.lastUnitPrice]),
      );
      expect(comparablePriceByMappingId.get(negativePackagePriceMappingId)).toBeNull();
      expect(comparablePriceByMappingId.get(negativeUnitPriceMappingId)).toBeNull();
      const mappings = new Map(article.mappings.map((mapping: any) => [mapping.id, mapping]));
      expect(mappings.get(sixUnitMappingId)).toMatchObject({
        packageFactor: 6,
        lastPackagePrice: 24,
        lastUnitPrice: 4,
      });
      expect(mappings.get(eightUnitMappingId)).toMatchObject({
        packageFactor: 8,
        lastPackagePrice: 20,
        lastUnitPrice: 2.5,
      });
      expect(mappings.get(zeroPriceMappingId)).toMatchObject({
        packageFactor: 6,
        lastPackagePrice: 0,
        lastUnitPrice: 0,
      });
      expect(mappings.get(invalidFactorMappingId)).toMatchObject({
        packageFactor: 0,
        lastPackagePrice: 10,
        lastUnitPrice: null,
      });
      expect(mappings.get(missingPriceMappingId)).toMatchObject({
        packageFactor: 4,
        lastPackagePrice: null,
        lastUnitPrice: null,
      });
      expect(mappings.get(nonFinitePackagePriceMappingId)).toMatchObject({
        packageFactor: 6,
        lastPackagePrice: null,
        lastUnitPrice: null,
      });
      expect(mappings.get(nonFiniteUnitPriceMappingId)).toMatchObject({
        packageFactor: 6,
        lastPackagePrice: 24,
        lastUnitPrice: null,
      });
    } finally {
      if (localMappingIds.length) {
        await db.delete(artikelDobaviteljTable).where(inArray(artikelDobaviteljTable.id, localMappingIds));
      }
      await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, comparisonSupplier.id));
    }
  });

  it("serializes simultaneous receipt confirmations against the order's remaining quantity", async () => {
    const [raceArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Concurrent receipt ${run}`,
      cena: "5",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(raceArticle.id);
    await db.insert(zalogeTable).values({ artikelId: raceArticle.id, kolicina: "0" });

    const [raceMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: raceArticle.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `RACE-${run}`,
      nazivDobavitelja: `Concurrent pack ${run}`,
      enotVPaketu: "6",
      nazivPaketa: "zaboj",
      zadnjaCenaPaket: "18",
      zadnjaCenaEnota: "3",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(raceMapping.id);

    const createdOrder = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      expectedDeliveryDate: "2026-11-07",
      lines: [{ supplierMappingId: raceMapping.id, packageQuantity: 2, unitPrice: 18 }],
    });
    expect(createdOrder.status, JSON.stringify(createdOrder.body)).toBe(201);
    orderIds.push(createdOrder.body.id);
    const orderLineId = createdOrder.body.lines[0].id as number;
    const sentOrder = await request(app).post(`/narocila-dobaviteljem/${createdOrder.body.id}/send`).send({});
    expect(sentOrder.status, JSON.stringify(sentOrder.body)).toBe(200);

    const linkedReceiptPayload = (quantity: number) => ({
      dobaviteljId: supplierId,
      datum: "2026-10-17",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: quantity * 5,
      postavke: [{
        artikelId: raceArticle.id,
        supplierOrderLineId: orderLineId,
        kolicina: quantity,
        cenaKos: 5,
        skupaj: quantity * 5,
        enotVPaketu: 1,
        izvKolicina: quantity,
        izvCena: 5,
        izvEnota: "KOS",
        izvCenaVrsta: "neto",
        ddvStopnja: 0,
      }],
    });
    const createLinkedReceipt = async (quantity: number) => {
      const response = await request(app).post("/prejemnice").send(linkedReceiptPayload(quantity));
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      receiptIds.push(response.body.id);
      return response.body.id as number;
    };

    // Two base units have already arrived; two six-unit drafts now compete for the
    // remaining ten, leaving the order partially received after either one wins.
    const priorReceiptId = await createLinkedReceipt(2);
    const priorConfirmation = await request(app).post(`/prejemnice/${priorReceiptId}/confirm`).send({});
    expect(priorConfirmation.status, JSON.stringify(priorConfirmation.body)).toBe(200);
    const orderAfterPriorReceipt = await request(app).get(`/narocila-dobaviteljem/${createdOrder.body.id}`);
    expect(orderAfterPriorReceipt.body).toMatchObject({
      status: "partially_received",
      lines: [{ orderedBaseQuantity: 12, receivedBaseQuantity: 2, openBaseQuantity: 10 }],
    });

    const competingCreations = await Promise.all([
      request(app).post("/prejemnice").send(linkedReceiptPayload(6)),
      request(app).post("/prejemnice").send(linkedReceiptPayload(6)),
    ]);
    expect(competingCreations.map(response => response.status).sort()).toEqual([201, 409]);
    const rejectedCreation = competingCreations.find(response => response.status === 409);
    expect(rejectedCreation?.body).toMatchObject({ code: "SUPPLIER_ORDER_RECEIPT_CONFLICT" });
    expect(rejectedCreation?.body.error).toContain("že obstaja druga odprta prejemnica");
    const firstRaceReceiptId = competingCreations.find(response => response.status === 201)!.body.id as number;
    receiptIds.push(firstRaceReceiptId);

    const orderBeforeConfirmation = await request(app).get(`/narocila-dobaviteljem/${createdOrder.body.id}`);
    expect(orderBeforeConfirmation.body).toMatchObject({
      status: "partially_received",
      lines: [{ orderedBaseQuantity: 12, receivedBaseQuantity: 2, openBaseQuantity: 10 }],
    });
    const [stockBeforeConfirmation] = await db.select().from(zalogeTable)
      .where(eq(zalogeTable.artikelId, raceArticle.id));
    expect(Number(stockBeforeConfirmation.kolicina)).toBe(2);
    const draftMovementsBeforeConfirmation = await db.select({ id: zalogaGibiTable.id })
      .from(zalogaGibiTable).where(and(
        eq(zalogaGibiTable.artikelId, raceArticle.id),
        eq(zalogaGibiTable.tip, "prejemnica"),
        eq(zalogaGibiTable.referencaId, firstRaceReceiptId),
      ));
    expect(draftMovementsBeforeConfirmation).toHaveLength(0);

    const [firstDraftHeader] = await db.select().from(prejemniceTable)
      .where(eq(prejemniceTable.id, firstRaceReceiptId));
    const [secondDraft] = await db.insert(prejemniceTable).values({
      enotaId: firstDraftHeader.enotaId,
      dobaviteljId: firstDraftHeader.dobaviteljId,
      datum: firstDraftHeader.datum,
      vrstaCen: firstDraftHeader.vrstaCen,
      valuta: firstDraftHeader.valuta,
      vrstaDokumenta: firstDraftHeader.vrstaDokumenta,
      brutoSkupaj: firstDraftHeader.brutoSkupaj,
      status: "draft",
    }).returning({ id: prejemniceTable.id });
    receiptIds.push(secondDraft.id);
    await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: secondDraft.id,
      supplierOrderLineId: orderLineId,
      artikelId: raceArticle.id,
      kolicina: "6",
      cenaKos: "5",
      skupaj: "30",
      enotVPaketu: "1",
      izvKolicina: "6",
      izvCena: "5",
      izvEnota: "KOS",
      izvCenaVrsta: "neto",
      ddvStopnja: "0",
    });
    const raceReceiptIds = [firstRaceReceiptId, secondDraft.id];
    const draftsBeforeConfirmation = await db.select({
      id: prejemniceTable.id,
      status: prejemniceTable.status,
    }).from(prejemniceTable).where(inArray(prejemniceTable.id, raceReceiptIds));
    expect(draftsBeforeConfirmation).toEqual(raceReceiptIds.map(id => ({ id, status: "draft" })));

    const confirmations = await Promise.all(raceReceiptIds.map(receiptId =>
      request(app).post(`/prejemnice/${receiptId}/confirm`).send({}),
    ));
    expect(confirmations.map(response => response.status).sort()).toEqual([200, 409]);
    const successfulIndex = confirmations.findIndex(response => response.status === 200);
    const rejectedIndex = confirmations.findIndex(response => response.status === 409);
    const rejectedConfirmation = confirmations.find(response => response.status === 409);
    expect(rejectedConfirmation?.body).toMatchObject({ code: "SUPPLIER_ORDER_RECEIPT_CONFLICT" });
    expect(rejectedConfirmation?.body.error).toContain("neprejeto količino naročila");

    const statesAfterConfirmation = await db.select({
      id: prejemniceTable.id,
      status: prejemniceTable.status,
    }).from(prejemniceTable).where(inArray(prejemniceTable.id, raceReceiptIds));
    const winningReceipt = statesAfterConfirmation.find(receipt => receipt.status === "confirmed");
    const losingReceipt = statesAfterConfirmation.find(receipt => receipt.status === "draft");
    expect(winningReceipt?.id).toBe(raceReceiptIds[successfulIndex]);
    expect(losingReceipt?.id).toBe(raceReceiptIds[rejectedIndex]);

    const movements = await db.select({
      receiptId: zalogaGibiTable.referencaId,
      quantity: zalogaGibiTable.kolicina,
    }).from(zalogaGibiTable).where(and(
      eq(zalogaGibiTable.artikelId, raceArticle.id),
      eq(zalogaGibiTable.tip, "prejemnica"),
      inArray(zalogaGibiTable.referencaId, raceReceiptIds),
    ));
    expect(movements).toHaveLength(1);
    expect(movements[0].receiptId).toBe(winningReceipt?.id);
    expect(Number(movements[0].quantity)).toBe(6);

    const [stockAfterRace] = await db.select().from(zalogeTable)
      .where(eq(zalogeTable.artikelId, raceArticle.id));
    expect(Number(stockAfterRace.kolicina)).toBe(8);
    const orderAfterRace = await request(app).get(`/narocila-dobaviteljem/${createdOrder.body.id}`);
    expect(orderAfterRace.body).toMatchObject({
      status: "partially_received",
      lines: [{ orderedBaseQuantity: 12, receivedBaseQuantity: 8, openBaseQuantity: 4 }],
    });
  });

  it("includes older orders in the server-side missing-instructions review and stays unit-scoped", async () => {
    const recentCreatedAt = new Date();
    const recentOrders = Array.from({ length: 201 }, (_, index) => ({
      enotaId,
      dobaviteljId: supplierId,
      dobaviteljNaziv: `Supplier ${run}`,
      stevilka: `HISTORY-${run}-${index}`,
      status: "draft",
      opomba: `Opomba brez navodila ${index}`,
      navodiloDobavitelju: null,
      ustvaril: context.userId,
      ustvarjeno: recentCreatedAt,
      posodobljeno: recentCreatedAt,
    }));
    const recentRows = await db.insert(posSupplierOrdersTable)
      .values(recentOrders)
      .returning({ id: posSupplierOrdersTable.id });
    orderIds.push(...recentRows.map(order => order.id));

    const oldCreatedAt = new Date("2020-01-01T00:00:00.000Z");
    const [oldSentOrder] = await db.insert(posSupplierOrdersTable).values({
      enotaId,
      dobaviteljId: supplierId,
      dobaviteljNaziv: `Supplier ${run}`,
      stevilka: `HISTORY-${run}-old-sent`,
      status: "sent",
      opomba: "Starejša interna opomba.",
      navodiloDobavitelju: " \n ",
      ustvaril: context.userId,
      ustvarjeno: oldCreatedAt,
      posodobljeno: oldCreatedAt,
    }).returning({ id: posSupplierOrdersTable.id });
    orderIds.push(oldSentOrder.id);

    const [oldDraftOrder] = await db.insert(posSupplierOrdersTable).values({
      enotaId,
      dobaviteljId: supplierId,
      dobaviteljNaziv: `Supplier ${run}`,
      stevilka: `HISTORY-${run}-old-draft`,
      status: "draft",
      opomba: "Starejša interna opomba za osnutek.",
      navodiloDobavitelju: null,
      ustvaril: context.userId,
      ustvarjeno: oldCreatedAt,
      posodobljeno: oldCreatedAt,
    }).returning({ id: posSupplierOrdersTable.id });
    orderIds.push(oldDraftOrder.id);

    const [otherUnit] = await db.insert(enoteTable).values({
      companyId,
      ime: `Manual link different unit ${run}`,
    }).returning({ id: enoteTable.id });
    unitIds.push(otherUnit.id);
    const [otherUnitOrder] = await db.insert(posSupplierOrdersTable).values({
      enotaId: otherUnit.id,
      dobaviteljId: supplierId,
      dobaviteljNaziv: `Supplier ${run}`,
      stevilka: `HISTORY-${run}-other-unit`,
      status: "sent",
      opomba: "Opomba iz druge enote.",
      navodiloDobavitelju: null,
      ustvaril: context.userId,
      ustvarjeno: oldCreatedAt,
      posodobljeno: oldCreatedAt,
    }).returning({ id: posSupplierOrdersTable.id });
    orderIds.push(otherUnitOrder.id);

    const [otherCompany] = await db.insert(companiesTable).values({
      naziv: `Supplier order other company ${run}`,
      podjetjeDavcna: `SI${run}77`,
    }).returning({ id: companiesTable.id });
    extraCompanyIds.push(otherCompany.id);
    const [otherCompanyUnit] = await db.insert(enoteTable).values({
      companyId: otherCompany.id,
      ime: `Supplier order other company unit ${run}`,
    }).returning({ id: enoteTable.id });
    unitIds.push(otherCompanyUnit.id);
    const [otherCompanySupplier] = await db.insert(counterpartiesTable).values({
      companyId: otherCompany.id,
      type: "supplier",
      name: `Other company supplier ${run}`,
    }).returning({ id: counterpartiesTable.id });
    extraSupplierIds.push(otherCompanySupplier.id);
    const [otherCompanyOrder] = await db.insert(posSupplierOrdersTable).values({
      enotaId: otherCompanyUnit.id,
      dobaviteljId: otherCompanySupplier.id,
      dobaviteljNaziv: `Other company supplier ${run}`,
      stevilka: `HISTORY-${run}-other-company`,
      status: "sent",
      opomba: "Opomba iz drugega podjetja.",
      navodiloDobavitelju: null,
      ustvaril: context.userId,
      ustvarjeno: oldCreatedAt,
      posodobljeno: oldCreatedAt,
    }).returning({ id: posSupplierOrdersTable.id });
    orderIds.push(otherCompanyOrder.id);

    const latestOrders = await request(app).get("/narocila-dobaviteljem");
    expect(latestOrders.status).toBe(200);
    expect(latestOrders.body).toHaveLength(200);
    expect(latestOrders.body.some((order: any) => order.id === oldSentOrder.id)).toBe(false);

    const missingInstructionOrders = await request(app)
      .get("/narocila-dobaviteljem")
      .query({ missingSupplierInstructionsOnly: true });
    expect(missingInstructionOrders.status, JSON.stringify(missingInstructionOrders.body)).toBe(200);
    expect(missingInstructionOrders.body.map((order: any) => order.id)).toContain(oldSentOrder.id);
    expect(missingInstructionOrders.body.map((order: any) => order.id)).toContain(oldDraftOrder.id);
    expect(missingInstructionOrders.body.map((order: any) => order.id)).not.toContain(otherUnitOrder.id);
    expect(missingInstructionOrders.body.map((order: any) => order.id)).not.toContain(otherCompanyOrder.id);

    const sentMissingInstructionOrders = await request(app)
      .get("/narocila-dobaviteljem")
      .query({ status: "sent", missingSupplierInstructionsOnly: true });
    expect(sentMissingInstructionOrders.status, JSON.stringify(sentMissingInstructionOrders.body)).toBe(200);
    expect(sentMissingInstructionOrders.body.map((order: any) => order.id)).toContain(oldSentOrder.id);
    expect(sentMissingInstructionOrders.body.map((order: any) => order.id)).not.toContain(oldDraftOrder.id);
    expect(sentMissingInstructionOrders.body.map((order: any) => order.id)).not.toContain(otherUnitOrder.id);
    expect(sentMissingInstructionOrders.body.map((order: any) => order.id)).not.toContain(otherCompanyOrder.id);

    const firstPage = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ page: 1, pageSize: 100, search: `HISTORY-${run}` });
    expect(firstPage.status, JSON.stringify(firstPage.body)).toBe(200);
    expect(firstPage.body).toMatchObject({ page: 1, pageSize: 100, total: 203 });
    expect(firstPage.body.orders).toHaveLength(100);
    expect(firstPage.body.orders.map((order: any) => order.id)).not.toContain(oldSentOrder.id);

    const secondPage = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ page: 2, pageSize: 100, search: `HISTORY-${run}` });
    expect(secondPage.status, JSON.stringify(secondPage.body)).toBe(200);
    expect(secondPage.body).toMatchObject({ page: 2, pageSize: 100, total: 203 });
    expect(secondPage.body.orders).toHaveLength(100);
    expect(secondPage.body.orders.map((order: any) => order.id)).not.toContain(oldSentOrder.id);

    const thirdPage = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ page: 3, pageSize: 100, search: `HISTORY-${run}` });
    expect(thirdPage.status, JSON.stringify(thirdPage.body)).toBe(200);
    expect(thirdPage.body).toMatchObject({ page: 3, pageSize: 100, total: 203 });
    expect(thirdPage.body.orders.map((order: any) => order.id)).toContain(oldSentOrder.id);
    expect(thirdPage.body.orders.map((order: any) => order.id)).toContain(oldDraftOrder.id);
    expect(thirdPage.body.orders.map((order: any) => order.id)).not.toContain(otherUnitOrder.id);
    expect(thirdPage.body.orders.map((order: any) => order.id)).not.toContain(otherCompanyOrder.id);

    const emptyLastPage = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ page: 4, pageSize: 100, search: `HISTORY-${run}` });
    expect(emptyLastPage.status, JSON.stringify(emptyLastPage.body)).toBe(200);
    expect(emptyLastPage.body).toMatchObject({ page: 4, pageSize: 100, total: 203, orders: [] });

    const sentPage = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ status: "sent", page: 1, pageSize: 1, search: `HISTORY-${run}` });
    expect(sentPage.status, JSON.stringify(sentPage.body)).toBe(200);
    expect(sentPage.body).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(sentPage.body.orders.map((order: any) => order.id)).toEqual([oldSentOrder.id]);
    const emptySentPage = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ status: "sent", page: 2, pageSize: 1, search: `HISTORY-${run}` });
    expect(emptySentPage.status, JSON.stringify(emptySentPage.body)).toBe(200);
    expect(emptySentPage.body).toMatchObject({ page: 2, pageSize: 1, total: 1, orders: [] });

    const searchedPage = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ search: "old-draft", page: 1, pageSize: 50 });
    expect(searchedPage.status, JSON.stringify(searchedPage.body)).toBe(200);
    expect(searchedPage.body).toMatchObject({ total: 1 });
    expect(searchedPage.body.orders.map((order: any) => order.id)).toEqual([oldDraftOrder.id]);

    const updatedOldDraft = await request(app)
      .put(`/narocila-dobaviteljem/${oldDraftOrder.id}`)
      .send({
        supplierId,
        expectedDeliveryDate: null,
        internalNotes: "Starejša interna opomba za osnutek.",
        supplierNotes: "Dostavite pred 10. uro.",
        lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: 18 }],
      });
    expect(updatedOldDraft.status, JSON.stringify(updatedOldDraft.body)).toBe(200);
    expect(updatedOldDraft.body.supplierNotes).toBe("Dostavite pred 10. uro.");

    const missingInstructionsAfterEdit = await request(app)
      .get("/narocila-dobaviteljem")
      .query({ missingSupplierInstructionsOnly: true });
    expect(missingInstructionsAfterEdit.status, JSON.stringify(missingInstructionsAfterEdit.body)).toBe(200);
    expect(missingInstructionsAfterEdit.body.map((order: any) => order.id)).not.toContain(oldDraftOrder.id);
    expect(missingInstructionsAfterEdit.body.map((order: any) => order.id)).toContain(oldSentOrder.id);

    const historyAfterEdit = await request(app)
      .get("/narocila-dobaviteljem/brez-navodil")
      .query({ page: 3, pageSize: 100, search: `HISTORY-${run}` });
    expect(historyAfterEdit.status, JSON.stringify(historyAfterEdit.body)).toBe(200);
    expect(historyAfterEdit.body).toMatchObject({ page: 3, pageSize: 100, total: 202 });
    expect(historyAfterEdit.body.orders.map((order: any) => order.id)).not.toContain(oldDraftOrder.id);
    expect(historyAfterEdit.body.orders.map((order: any) => order.id)).toContain(oldSentOrder.id);
  });

  it("uses a quantity-weighted price when one confirmed receipt has two prices for the same supplier mapping", async () => {
    context.companyId = companyId;
    context.enotaId = enotaId;

    const createSentOrderLine = async (unitPrice: number) => {
      const created = await request(app).post("/narocila-dobaviteljem").send({
        supplierId,
        lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: unitPrice * 6 }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      orderIds.push(created.body.id);

      const sent = await request(app)
        .post(`/narocila-dobaviteljem/${created.body.id}/send`)
        .send({});
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      return created.body.lines[0].id as number;
    };

    const lowerPriceLineId = await createSentOrderLine(2);
    const higherPriceLineId = await createSentOrderLine(4);
    const receipt = await request(app).post("/prejemnice").send({
      dobaviteljId: supplierId,
      datum: "2026-10-30",
      vrstaCen: "neto",
      vrstaDokumenta: "DOBAVNICA",
      brutoSkupaj: 20,
      postavke: [
        {
          artikelId: articleId,
          supplierOrderLineId: lowerPriceLineId,
          kolicina: 2,
          cenaKos: 2,
          skupaj: 4,
          enotVPaketu: 1,
          izvKolicina: 2,
          izvCena: 2,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        },
        {
          artikelId: articleId,
          supplierOrderLineId: higherPriceLineId,
          kolicina: 4,
          cenaKos: 4,
          skupaj: 16,
          enotVPaketu: 1,
          izvKolicina: 4,
          izvCena: 4,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        },
      ],
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    receiptIds.push(receipt.body.id);

    const confirmed = await request(app).post(`/prejemnice/${receipt.body.id}/confirm`).send({});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const receiptDetails = await request(app).get(`/prejemnice/${receipt.body.id}`);
    expect(receiptDetails.status, JSON.stringify(receiptDetails.body)).toBe(200);

    const dashboard = await request(app).get("/narocila-dobaviteljem/pregled");
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200);
    const mapping = dashboard.body.articles
      .find((article: any) => article.articleId === articleId).mappings
      .find((item: any) => item.id === mappingId);
    expect(mapping.lastPriceReceipt).toEqual({
      receiptId: receipt.body.id,
      date: "2026-10-30",
      receiptNumber: receiptDetails.body.stevilka,
    });
    expect(mapping.lastUnitPrice).toBeCloseTo(10 / 3, 5);
    expect(mapping.lastPackagePrice).toBeCloseTo(
      mapping.lastUnitPrice * mapping.packageFactor,
      5,
    );
    expect(mapping.priceHistory[0]).toMatchObject({
      receiptId: receipt.body.id,
      date: "2026-10-30",
      receiptNumber: receiptDetails.body.stevilka,
    });
    expect(mapping.priceHistory[0].unitPrice).toBeCloseTo(10 / 3, 5);
    const latestReceipts = await getLatestSupplierPriceReceipts(db, enotaId, [mappingId]);
    expect(latestReceipts.get(mappingId)).toMatchObject({
      receiptId: receipt.body.id,
      receiptNumber: receiptDetails.body.stevilka,
    });
  });

  it("explicitly links eligible manual receipt lines and includes only confirmed linked receipts in price history", async () => {
    const [linkedArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Manual link article ${run}`,
      cena: "4",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(linkedArticle.id);
    await db.insert(zalogeTable).values({ artikelId: linkedArticle.id, kolicina: "0" });

    const [linkedMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: linkedArticle.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `MANUAL-LINK-${run}`,
      nazivDobavitelja: `Manual link pack ${run}`,
      enotVPaketu: "1",
      nazivPaketa: "kos",
      zadnjaCenaPaket: "10",
      zadnjaCenaEnota: "10",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(linkedMapping.id);

    const [otherSupplier] = await db.insert(counterpartiesTable).values({
      companyId,
      type: "supplier",
      name: `Manual link other supplier ${run}`,
    }).returning({ id: counterpartiesTable.id });
    extraSupplierIds.push(otherSupplier.id);
    const [otherSupplierMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: linkedArticle.id,
      dobaviteljId: otherSupplier.id,
      sifraDobavitelja: `OTHER-MANUAL-LINK-${run}`,
      nazivDobavitelja: `Other supplier pack ${run}`,
      enotVPaketu: "1",
      nazivPaketa: "kos",
      zadnjaCenaPaket: "12",
      zadnjaCenaEnota: "12",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(otherSupplierMapping.id);

    const [otherArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Manual link different article ${run}`,
      cena: "4",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(otherArticle.id);
    await db.insert(zalogeTable).values({ artikelId: otherArticle.id, kolicina: "0" });
    const [otherArticleMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId,
      artikelId: otherArticle.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `DIFFERENT-ARTICLE-${run}`,
      nazivDobavitelja: `Different article pack ${run}`,
      enotVPaketu: "1",
      nazivPaketa: "kos",
      zadnjaCenaPaket: "10",
      zadnjaCenaEnota: "10",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(otherArticleMapping.id);

    const [otherUnit] = await db.insert(enoteTable).values({
      companyId,
      ime: `Manual link different unit ${run}`,
    }).returning({ id: enoteTable.id });
    unitIds.push(otherUnit.id);
    const [otherUnitArticle] = await db.insert(artikliTable).values({
      enotaId: otherUnit.id,
      ime: `Manual link different unit article ${run}`,
      cena: "4",
      davek: "22",
      enotaMere: "KOS",
      nabavniArtikel: true,
      prodajniArtikel: false,
      aktiven: true,
    }).returning({ id: artikliTable.id });
    articleIds.push(otherUnitArticle.id);
    await db.insert(zalogeTable).values({ artikelId: otherUnitArticle.id, kolicina: "0" });
    const [otherUnitMapping] = await db.insert(artikelDobaviteljTable).values({
      enotaId: otherUnit.id,
      artikelId: otherUnitArticle.id,
      dobaviteljId: supplierId,
      sifraDobavitelja: `DIFFERENT-UNIT-${run}`,
      nazivDobavitelja: `Different unit pack ${run}`,
      enotVPaketu: "1",
      nazivPaketa: "kos",
      zadnjaCenaPaket: "10",
      zadnjaCenaEnota: "10",
      aktivno: true,
    }).returning({ id: artikelDobaviteljTable.id });
    mappingIds.push(otherUnitMapping.id);

    const createSentOrder = async (unitId: number, orderSupplierId: string, supplierMappingId: number) => {
      context.enotaId = unitId;
      const created = await request(app).post("/narocila-dobaviteljem").send({
        supplierId: orderSupplierId,
        expectedDeliveryDate: "2026-11-20",
        lines: [{ supplierMappingId, packageQuantity: 10, unitPrice: 10 }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      orderIds.push(created.body.id);
      const sent = await request(app).post(`/narocila-dobaviteljem/${created.body.id}/send`).send({});
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      return created.body.lines[0].id as number;
    };
    const correctOrderLineId = await createSentOrder(enotaId, supplierId, linkedMapping.id);
    const otherSupplierOrderLineId = await createSentOrder(enotaId, otherSupplier.id, otherSupplierMapping.id);
    const otherArticleOrderLineId = await createSentOrder(enotaId, supplierId, otherArticleMapping.id);
    const otherUnitOrderLineId = await createSentOrder(otherUnit.id, supplierId, otherUnitMapping.id);

    const createManualReceipt = async (quantity: number) => {
      context.enotaId = enotaId;
      const response = await request(app).post("/prejemnice").send({
        dobaviteljId: supplierId,
        datum: "2026-10-18",
        vrstaCen: "neto",
        vrstaDokumenta: "DOBAVNICA",
        brutoSkupaj: quantity * 4,
        postavke: [{
          artikelId: linkedArticle.id,
          kolicina: quantity,
          cenaKos: 4,
          skupaj: quantity * 4,
          enotVPaketu: 1,
          izvKolicina: quantity,
          izvCena: 4,
          izvEnota: "KOS",
          izvCenaVrsta: "neto",
          ddvStopnja: 0,
        }],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      receiptIds.push(response.body.id);
      return {
        id: response.body.id as number,
        lineId: response.body.postavke[0].id as number,
      };
    };
    const eligibleReceipt = await createManualReceipt(4);
    const tooLargeReceipt = await createManualReceipt(11);

    const options = await request(app)
      .get(`/prejemnice/${eligibleReceipt.id}/postavke/${eligibleReceipt.lineId}/supplier-order-lines`);
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    expect(options.body.map((option: any) => option.id)).toEqual([correctOrderLineId]);
    const tooLargeOptions = await request(app)
      .get(`/prejemnice/${tooLargeReceipt.id}/postavke/${tooLargeReceipt.lineId}/supplier-order-lines`);
    expect(tooLargeOptions.status, JSON.stringify(tooLargeOptions.body)).toBe(200);
    expect(tooLargeOptions.body).toEqual([]);

    const tooLargeLink = await request(app)
      .post(`/prejemnice/${tooLargeReceipt.id}/postavke/${tooLargeReceipt.lineId}/supplier-order-link`)
      .send({ supplierOrderLineId: correctOrderLineId });
    expect(tooLargeLink.status).toBe(409);
    expect(tooLargeLink.body.error).toContain("neprejeto količino naročila");

    for (const supplierOrderLineId of [
      otherSupplierOrderLineId,
      otherArticleOrderLineId,
      otherUnitOrderLineId,
    ]) {
      const invalidLink = await request(app)
        .post(`/prejemnice/${eligibleReceipt.id}/postavke/${eligibleReceipt.lineId}/supplier-order-link`)
        .send({ supplierOrderLineId });
      expect(invalidLink.status, JSON.stringify(invalidLink.body)).toBe(409);
    }

    const detailsBeforeLink = await request(app).get(`/prejemnice/${eligibleReceipt.id}`);
    expect(detailsBeforeLink.status).toBe(200);
    expect(detailsBeforeLink.body.isManualEntry).toBe(true);
    expect(detailsBeforeLink.body.postavke[0].supplierOrderLineId).toBeNull();
    expect((await getLatestSupplierPriceReceipts(db, enotaId, [linkedMapping.id])).has(linkedMapping.id)).toBe(false);

    const confirmed = await request(app).post(`/prejemnice/${eligibleReceipt.id}/confirm`).send({});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((await getLatestSupplierPriceReceipts(db, enotaId, [linkedMapping.id])).has(linkedMapping.id)).toBe(false);

    // Ordinary POS-entered stock lines may have no recorded source quantity.
    await db.update(prejemnicePostavkeTable)
      .set({ izvKolicina: null })
      .where(eq(prejemnicePostavkeTable.id, eligibleReceipt.lineId));
    const linked = await request(app)
      .post(`/prejemnice/${eligibleReceipt.id}/postavke/${eligibleReceipt.lineId}/supplier-order-link`)
      .send({ supplierOrderLineId: correctOrderLineId });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    const detailsAfterLink = await request(app).get(`/prejemnice/${eligibleReceipt.id}`);
    expect(detailsAfterLink.body.postavke[0].supplierOrderLineId).toBe(correctOrderLineId);
    const sources = await getLatestSupplierPriceReceipts(db, enotaId, [linkedMapping.id]);
    expect(sources.get(linkedMapping.id)).toMatchObject({
      receiptId: eligibleReceipt.id,
      receiptNumber: detailsAfterLink.body.stevilka,
    });
  });
});

