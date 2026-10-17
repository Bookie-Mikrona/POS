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
import { getLatestSupplierPriceReceipts } from "../../lib/pos-supplier-orders";

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
      notes: "Prvo naročilo",
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

    const sentOrder = await request(app)
      .post(`/narocila-dobaviteljem/${createdOrder.body.id}/send`)
      .send({});
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
    await db.update(artikliTable)
      .set({ enotaMere: "L" })
      .where(eq(artikliTable.id, openArticle.id));

    const unitChangeWarning = await request(app)
      .post(`/prejemnice/${unitChangeReceipt.body.id}/confirm`)
      .send({});
    expect(unitChangeWarning.status).toBe(409);
    expect(unitChangeWarning.body.packageFactorChanges).toMatchObject([{
      supplierOrderLineId: unitChangeLine.id,
      orderPackageName: "transportni zaboj 7 - nova oznaka",
      orderFactor: 7,
      orderBaseUnit: "KOS",
      currentPackageName: "transportni zaboj 7 - nova oznaka",
      currentFactor: 7,
      currentBaseUnit: "L",
    }]);

    await db.update(artikliTable)
      .set({ enotaMere: "ML" })
      .where(eq(artikliTable.id, openArticle.id));
    const latestUnitWarning = await request(app)
      .post(`/prejemnice/${unitChangeReceipt.body.id}/confirm`)
      .send({ reviewedPackageFactorChanges: unitChangeWarning.body.packageFactorChanges });
    expect(latestUnitWarning.status).toBe(409);
    expect(latestUnitWarning.body.packageFactorChanges).toMatchObject([{
      orderBaseUnit: "KOS",
      currentBaseUnit: "ML",
    }]);
  });

  it("keeps legacy notes internal and preserves supplier instructions for older clients", async () => {
    const created = await request(app).post("/narocila-dobaviteljem").send({
      supplierId,
      notes: "Stara opomba, shranjena pred ločitvijo.",
      lines: [{ supplierMappingId: mappingId, packageQuantity: 1, unitPrice: 30 }],
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

  it("does not let a non-administrator manage purchase orders", async () => {
    context.role = "uporabnik";
    const denied = await request(app).get("/narocila-dobaviteljem");
    expect(denied.status).toBe(403);
    context.role = "admin";
  });

  it("scopes supplier-order price sources by unit, breaks date ties by ID, and ignores manual receipts", async () => {
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

    const createConfirmedSource = async (input: {
      unitId: number;
      articleId: number;
      supplierMappingId: number;
      unitPrice: number;
      date: string;
    }) => {
      context.enotaId = input.unitId;
      const order = await request(app).post("/narocila-dobaviteljem").send({
        supplierId,
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
        dobaviteljId: supplierId,
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

      const sourceB = await createConfirmedSource({
        unitId: unitB.id,
        articleId: articleB.id,
        supplierMappingId: mappingB.id,
        unitPrice: 7,
        date: "2026-10-20",
      });
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

      const receiptListA = await request(app).get("/prejemnice");
      expect(receiptListA.status, JSON.stringify(receiptListA.body)).toBe(200);
      const receiptIdsForA = receiptListA.body.map((receipt: any) => receipt.id);
      expect(receiptIdsForA).toContain(sourceA.receiptId);
      expect(receiptIdsForA).toContain(laterInsertedOlderSourceA.receiptId);
      expect(receiptIdsForA).toContain(manualReceiptId);
      expect(receiptIdsForA).not.toContain(sourceB.receiptId);

      context.enotaId = unitB.id;
      const receiptListB = await request(app).get("/prejemnice");
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
      expect(dashboardA.body.articles.map((row: any) => row.articleId)).toContain(articleA.id);
      expect(dashboardA.body.articles.map((row: any) => row.articleId)).toContain(articleAOther.id);
      expect(dashboardA.body.articles.map((row: any) => row.articleId)).not.toContain(articleB.id);
      const mappingInA = dashboardA.body.articles
        .find((row: any) => row.articleId === articleA.id).mappings
        .find((mapping: any) => mapping.id === mappingA.id);
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
          receiptId: olderHistorySourcesA[1]!.receiptId,
          date: olderHistorySourcesA[1]!.date,
          receiptNumber: olderHistorySourcesA[1]!.receiptNumber,
          unitPrice: olderHistorySourcesA[1]!.unitPrice,
        },
      ]);
      expect(mappingInA.priceHistory).toHaveLength(5);
      expect(mappingInA.priceHistory.map((entry: any) => entry.receiptId)).not.toContain(manualReceiptId);
      expect(mappingInA.priceHistory.map((entry: any) => entry.receiptId))
        .not.toContain(olderHistorySourcesA[2]!.receiptId);

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

    const accessibleOwnReceipt = await request(app).get(`/prejemnice/${ownReceipt.body.id}`);
    expect(accessibleOwnReceipt.status, JSON.stringify(accessibleOwnReceipt.body)).toBe(200);
    expect(accessibleOwnReceipt.body).toMatchObject({
      id: ownReceipt.body.id,
      dobaviteljNaziv: `Supplier ${run}`,
      skupajVrednost: 10,
      postavke: [{ artikelIme: `Order article ${run}`, skupaj: 10 }],
    });

    const foreignReceipt = await request(app).get(`/prejemnice/${foreignReceiptId}`);
    expect(foreignReceipt.status).toBe(404);
    const foreignResponse = JSON.stringify(foreignReceipt.body);
    for (const secret of [
      foreignReceiptNumber,
      `FOREIGN-RECEIPT-SUPPLIER-${run}`,
      `FOREIGN-RECEIPT-ARTICLE-${run}`,
      `FOREIGN-RECEIPT-NOTE-${run}`,
      "9876.54",
      "3703.68",
      "1234.56",
    ]) {
      expect(foreignResponse).not.toContain(secret);
    }
  });

  it("preserves zero prices and omits invalid package comparisons", async () => {
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

      const response = await request(app).get("/narocila-dobaviteljem/pregled");
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const article = response.body.articles.find((row: any) => row.articleId === comparisonArticle.id);
      expect(article.baseUnit).toBe("L");
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
    } finally {
      if (localMappingIds.length) {
        await db.delete(artikelDobaviteljTable).where(inArray(artikelDobaviteljTable.id, localMappingIds));
      }
      await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, comparisonSupplier.id));
    }
  });
});
