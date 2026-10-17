import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const USER = "credit-note-integration-owner";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = USER; next(); },
}));
vi.mock("../middlewares/pos", () => ({
  requireEnota: (req: any, _res: any, next: any) => { req.clerkUserId = USER; req.companyId = currentCompanyId; req.enotaId = currentEnotaId; req.log = { warn: () => {} }; next(); },
}));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: USER }) }));
import express from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  accountingRolesTable, companiesTable, counterpartiesTable, db, enoteTable, artikliTable,
  prejemniceTable, prejemnicePostavkeTable, purchaseSourceDocumentsTable, embalazniPrometiTable,
  posCreditNoteAllocationsTable, journalEntriesTable, zalogaGibiTable, accountingPeriodsTable,
  posReceiptBookingSourcesTable,
} from "@workspace/db";
import creditNotePackagingRouter from "./creditNotePackaging";
import prejemniceRouter from "./pos/prejemnice";
import { knjizalogaGibiZaUvozPrejemnico } from "../lib/uvoz/uvoz-service";

const app = express();
app.use(express.json());
app.use(creditNotePackagingRouter);
app.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));
const run = Math.random().toString(36).slice(2, 9);
let companyId: string, supplierId: string, enotaId: number, articleId: number, ordinaryArticleId: number, receiptId: number, lineId: number, movementId: number, sourceId: string, periodId: string;
let currentCompanyId: string, currentEnotaId: number;

describe("credit note packaging transactional routes", () => {
  beforeAll(async () => {
    const [company] = await db.insert(companiesTable).values({ naziv: `Credit note route ${run}`, podjetjeDavcna: `SI${run}99` }).returning({ id: companiesTable.id });
    companyId = company.id;
    currentCompanyId = companyId;
    await db.insert(accountingRolesTable).values({ companyId, clerkUserId: USER, role: "owner" });
    const [supplier] = await db.insert(counterpartiesTable).values({ companyId, type: "supplier", name: `Supplier ${run}` }).returning({ id: counterpartiesTable.id });
    supplierId = supplier.id;
    const [unit] = await db.insert(enoteTable).values({ companyId, ime: `Unit ${run}` }).returning({ id: enoteTable.id });
    enotaId = unit.id;
    currentEnotaId = enotaId;
    const [article] = await db.insert(artikliTable).values({ enotaId, ime: "Returnable keg", cena: "1", povratnaEmbalaza: true, prodajniArtikel: false, nabavniArtikel: true }).returning({ id: artikliTable.id });
    articleId = article.id;
    const [ordinaryArticle] = await db.insert(artikliTable).values({ enotaId, ime: "Ordinary ingredient", cena: "1", povratnaEmbalaza: false, prodajniArtikel: false, nabavniArtikel: true }).returning({ id: artikliTable.id });
    ordinaryArticleId = ordinaryArticle.id;
    const [period] = await db.insert(accountingPeriodsTable).values({
      companyId, name: `2026 ${run}`, startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    }).returning({ id: accountingPeriodsTable.id });
    periodId = period.id;
    const [returnEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId: period.id, entryDate: "2026-02-01", documentDate: "2026-02-01",
      description: "Fizično vračilo embalaže", reference: `POS:EMBALAZA:VRACILO:${run}`,
      status: "draft", sourceType: "document", createdBy: USER,
    }).returning({ id: journalEntriesTable.id });
    const [source] = await db.insert(purchaseSourceDocumentsTable).values({ companyId, counterpartyId: supplierId, kind: "credit_note", normalizedNumber: `CN${run}` }).returning({ id: purchaseSourceDocumentsTable.id });
    sourceId = source.id;
    const [receipt] = await db.insert(prejemniceTable).values({ enotaId, dobaviteljId: supplierId, vrstaDokumenta: "DOBROPIS", sourceDocumentId: sourceId, stevilka: `CN-${run}`, skupajVrednost: "-10" }).returning({ id: prejemniceTable.id });
    receiptId = receipt.id;
    const [line] = await db.insert(prejemnicePostavkeTable).values({ prejemnicaId: receiptId, artikelId: articleId, kolicina: "-10", skupaj: "-10", ddvOsnova: "-10", netoZnesek: "-10" }).returning({ id: prejemnicePostavkeTable.id });
    lineId = line.id;
    const [movement] = await db.insert(embalazniPrometiTable).values({
      enotaId, artikelId: articleId, dobaviteljId: supplierId, kolicina: "-20", depozitnaVrednost: "5",
      vrsta: "vracilo", operationKey: crypto.randomUUID(), journalEntryId: returnEntry.id,
    }).returning({ id: embalazniPrometiTable.id });
    movementId = movement.id;
  });
  afterAll(async () => {
    await db.delete(posCreditNoteAllocationsTable).where(eq(posCreditNoteAllocationsTable.companyId, companyId));
    await db.delete(embalazniPrometiTable).where(eq(embalazniPrometiTable.enotaId, enotaId));
    await db.execute(sql.raw("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_history_append_only"));
    try {
      await db.delete(zalogaGibiTable).where(inArray(zalogaGibiTable.artikelId, [articleId, ordinaryArticleId]));
    } finally {
      await db.execute(sql.raw("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_history_append_only"));
    }
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("viewer cannot mutate, concurrent confirms cannot over-allocate, and confirmation creates no rows", async () => {
    await db.update(accountingRolesTable).set({ role: "viewer" }).where(and(eq(accountingRolesTable.companyId, companyId), eq(accountingRolesTable.clerkUserId, USER)));
    const denied = await request(app).post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/confirm`).send({ operationKey: crypto.randomUUID(), prejemnicaPostavkaId: lineId, embalazniPrometId: movementId, quantity: 1 });
    expect(denied.status).toBe(403);
    await db.update(accountingRolesTable).set({ role: "owner" }).where(and(eq(accountingRolesTable.companyId, companyId), eq(accountingRolesTable.clerkUserId, USER)));
    const beforeJournals = (await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).length;
    const beforeStock = (await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId))).length;
    const [a, b] = await Promise.all([1, 2].map(() => request(app).post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/confirm`).send({ operationKey: crypto.randomUUID(), prejemnicaPostavkaId: lineId, embalazniPrometId: movementId, quantity: 6 })));
    expect([a.status, b.status].filter(status => status === 200)).toHaveLength(1);
    expect([a.status, b.status].some(status => status === 409)).toBe(true);
    expect((await db.select().from(posCreditNoteAllocationsTable).where(eq(posCreditNoteAllocationsTable.companyId, companyId))).length).toBe(1);
    expect((await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).length).toBe(beforeJournals);
  });

  it("replays an operation key, rejects payload mismatch, and permits only one reversal", async () => {
    const operationKey = crypto.randomUUID();
    const payload = { operationKey, prejemnicaPostavkaId: lineId, embalazniPrometId: movementId, quantity: 1 };
    const first = await request(app).post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/confirm`).send(payload);
    expect(first.status).toBe(200);
    const replay = await request(app).post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/confirm`).send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    const mismatch = await request(app).post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/confirm`).send({ ...payload, quantity: 0.5 });
    expect(mismatch.status).toBe(409);
    const reversed = await request(app).post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/${first.body.id}/reverse`).send({ operationKey: crypto.randomUUID() });
    expect(reversed.status).toBe(200);
    const secondReverse = await request(app).post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/${first.body.id}/reverse`).send({ operationKey: crypto.randomUUID() });
    expect(secondReverse.status).toBe(409);
  });

  it("rejects synthetic packaging reversals as reconciliation candidates", async () => {
    const [synthetic] = await db.insert(embalazniPrometiTable).values({
      enotaId, artikelId: articleId, dobaviteljId: supplierId, kolicina: "-1",
      depozitnaVrednost: "5", vrsta: "vracilo", actorSnapshot: USER,
    }).returning({ id: embalazniPrometiTable.id });
    const details = await request(app).get(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging`);
    expect(details.status).toBe(200);
    expect(details.body.candidates.some((candidate: any) => candidate.id === synthetic.id)).toBe(false);
    const confirmation = await request(app)
      .post(`/companies/${companyId}/prejemnice/${receiptId}/credit-note-packaging/confirm`)
      .send({
        operationKey: crypto.randomUUID(),
        prejemnicaPostavkaId: lineId,
        embalazniPrometId: synthetic.id,
        quantity: 1,
      });
    expect(confirmation.status).toBe(409);
  });

  it("pri uvozu evidentira nič-vrednostni prejem in vračilo embalaže brez podvajanja", async () => {
    const [receipt] = await db.insert(prejemniceTable).values({
      enotaId, dobaviteljId: supplierId, vrstaDokumenta: "DOBAVNICA",
      stevilka: `ZERO-PACK-${run}`, skupajVrednost: "0",
    }).returning({ id: prejemniceTable.id });
    const [line] = await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: receipt.id, artikelId: articleId,
      kolicina: "20", cenaKos: "0", skupaj: "0", ddvOsnova: "0", netoZnesek: "0",
    }).returning({ id: prejemnicePostavkeTable.id });
    const [returnLine] = await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: receipt.id, artikelId: articleId,
      kolicina: "-20", cenaKos: "0", skupaj: "0", ddvOsnova: "0", netoZnesek: "0",
    }).returning({ id: prejemnicePostavkeTable.id });

    await db.transaction(async (tx) => {
      await knjizalogaGibiZaUvozPrejemnico(tx as any, receipt.id, USER);
    });

    const firstMovements = await db.select().from(embalazniPrometiTable)
      .where(inArray(embalazniPrometiTable.prejemnicaPostavkaId, [line.id, returnLine.id]));
    expect(firstMovements).toHaveLength(2);
    const firstReceipt = firstMovements.find(movement => movement.prejemnicaPostavkaId === line.id);
    expect(firstReceipt).toMatchObject({
      enotaId, artikelId: articleId, dobaviteljId: supplierId,
      kolicina: "20.0000", vrsta: "prejem", prejemnicaPostavkaId: line.id,
    });
    expect(firstMovements).toContainEqual(expect.objectContaining({
      enotaId, artikelId: articleId, dobaviteljId: supplierId,
      kolicina: "-20.0000", vrsta: "vracilo", prejemnicaPostavkaId: returnLine.id,
    }));

    await db.transaction(async (tx) => {
      await knjizalogaGibiZaUvozPrejemnico(tx as any, receipt.id, USER);
    });

    const movements = await db.select().from(embalazniPrometiTable)
      .where(inArray(embalazniPrometiTable.prejemnicaPostavkaId, [line.id, returnLine.id]));
    expect(movements).toHaveLength(6);
    const reversal = movements.find(movement => movement.reversalOfId === firstReceipt?.id);
    expect(reversal).toMatchObject({ vrsta: "vracilo", kolicina: "-20.0000" });
    expect(movements).toContainEqual(expect.objectContaining({
      vrsta: "prejem", kolicina: "20.0000", reversalOfId: reversal?.id,
    }));
    const firstReturn = firstMovements.find(movement => movement.prejemnicaPostavkaId === returnLine.id);
    const returnReversal = movements.find(movement => movement.reversalOfId === firstReturn?.id);
    expect(returnReversal).toMatchObject({ vrsta: "prejem", kolicina: "20.0000" });
    expect(movements).toContainEqual(expect.objectContaining({
      vrsta: "vracilo", kolicina: "-20.0000", reversalOfId: returnReversal?.id,
    }));

    const stockMovements = await db.select().from(zalogaGibiTable)
      .where(and(
        eq(zalogaGibiTable.referencaId, receipt.id),
        eq(zalogaGibiTable.artikelId, articleId),
      ));
    expect(stockMovements).toHaveLength(6);
  });

  it("allows safe mixed-credit booking sources in either order and rejects historical unsafe sources", async () => {
    const createMixedCredit = async (suffix: string) => {
      const [source] = await db.insert(purchaseSourceDocumentsTable).values({
        companyId, counterpartyId: supplierId, kind: "credit_note", normalizedNumber: `MX${run}${suffix}`,
      }).returning({ id: purchaseSourceDocumentsTable.id });
      const [receipt] = await db.insert(prejemniceTable).values({
        enotaId, dobaviteljId: supplierId, vrstaDokumenta: "DOBROPIS", sourceDocumentId: source.id,
        stevilka: `MX-${run}-${suffix}`, skupajVrednost: "-3",
      }).returning({ id: prejemniceTable.id });
      const [packagingLine] = await db.insert(prejemnicePostavkeTable).values({
        prejemnicaId: receipt.id, artikelId: articleId, kolicina: "-1", skupaj: "-1",
        ddvOsnova: "-1", netoZnesek: "-1",
      }).returning({ id: prejemnicePostavkeTable.id });
      await db.insert(prejemnicePostavkeTable).values({
        prejemnicaId: receipt.id, artikelId: ordinaryArticleId, kolicina: "-1", skupaj: "-2",
        ddvOsnova: "-2", netoZnesek: "-2",
      });
      return { receiptId: receipt.id, lineId: packagingLine.id };
    };
    const addBookingSource = async (targetReceiptId: number, safe: boolean, status: "draft" | "posted") => {
      const [entry] = await db.insert(journalEntriesTable).values({
        companyId, periodId, entryDate: "2026-02-10", documentDate: "2026-02-10",
        description: "Mešan dobropis brez embalažnih vrstic", reference: `POS:NABAVA:${targetReceiptId}`,
        status, sourceType: "document", createdBy: "pos-receipt-booking",
      }).returning({ id: journalEntriesTable.id });
      await db.insert(posReceiptBookingSourcesTable).values({
        prejemnicaId: targetReceiptId, journalEntryId: entry.id, netAmount: "-2",
        packagingReconciliationSafe: safe,
      });
    };
    const confirm = (targetReceiptId: number, targetLineId: number) => request(app)
      .post(`/companies/${companyId}/prejemnice/${targetReceiptId}/credit-note-packaging/confirm`)
      .send({
        operationKey: crypto.randomUUID(), prejemnicaPostavkaId: targetLineId,
        embalazniPrometId: movementId, quantity: 1,
      });

    const bookingFirst = await createMixedCredit("booking-first");
    await addBookingSource(bookingFirst.receiptId, true, "posted");
    expect((await confirm(bookingFirst.receiptId, bookingFirst.lineId)).status).toBe(200);

    const allocationFirst = await createMixedCredit("allocation-first");
    expect((await confirm(allocationFirst.receiptId, allocationFirst.lineId)).status).toBe(200);
    await addBookingSource(allocationFirst.receiptId, true, "draft");
    expect((await db.select().from(posReceiptBookingSourcesTable)
      .where(eq(posReceiptBookingSourcesTable.prejemnicaId, allocationFirst.receiptId))).length).toBe(1);

    const historical = await createMixedCredit("historical");
    await addBookingSource(historical.receiptId, false, "draft");
    expect((await confirm(historical.receiptId, historical.lineId)).status).toBe(409);

    const immutable = await createMixedCredit("immutable-history");
    const immutableConfirmation = await confirm(immutable.receiptId, immutable.lineId);
    expect(immutableConfirmation.status).toBe(200);
    const reversed = await request(app)
      .post(`/companies/${companyId}/prejemnice/${immutable.receiptId}/credit-note-packaging/${immutableConfirmation.body.id}/reverse`)
      .send({ operationKey: crypto.randomUUID() });
    expect(reversed.status).toBe(200);
    const productionApp = express();
    productionApp.use(express.json());
    productionApp.use(prejemniceRouter);
    productionApp.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));
    const blockedEdit = await request(productionApp).put(`/prejemnice/${immutable.receiptId}`).send({
      postavke: [{
        artikelId: articleId, kolicina: -2, cenaKos: 1, alergeni: [], alergeniSledi: [],
        alergeniStatus: "potrjeno_brez", alergeniVir: "etiketa",
      }],
    });
    expect(blockedEdit.status).toBe(409);
    expect(blockedEdit.body.code).toBe("CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED");
    const blockedDelete = await request(productionApp).delete(`/prejemnice/${immutable.receiptId}`);
    expect(blockedDelete.status).toBe(409);
    expect(blockedDelete.body.code).toBe("CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED");
    expect((await db.select().from(posCreditNoteAllocationsTable)
      .where(eq(posCreditNoteAllocationsTable.sourceDocumentId, immutableConfirmation.body.sourceDocumentId))).length).toBe(2);
  });

  it("production prejemnica creation keeps DOBROPIS packaging bookkeeping-neutral", async () => {
    const productionApp = express();
    productionApp.use(express.json());
    productionApp.use(prejemniceRouter);
    productionApp.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));
    const beforeMovement = (await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length;
    const beforeStock = (await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId))).length;
    const beforeJournals = (await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).length;
    const response = await request(productionApp).post("/prejemnice").send({
      datum: "2026-02-20", dobaviteljId: supplierId, vrstaDokumenta: "DOBROPIS",
      stDokumenta: `CN-${run}`, datumDokumenta: "2026-02-20",
      postavke: [{ artikelId: articleId, kolicina: -5, cenaKos: 1, alergeni: [], alergeniSledi: [], alergeniStatus: "potrjeno_brez", alergeniVir: "etiketa" }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect((await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length).toBe(beforeMovement);
    expect((await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId))).length).toBe(beforeStock);
    const sourceLessBefore = (await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length;
    const sourceLessStock = (await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId))).length;
    const sourceLess = await request(productionApp).post("/prejemnice").send({
      datum: "2026-02-22", vrstaDokumenta: "DOBROPIS",
      postavke: [{ artikelId: articleId, kolicina: -2, cenaKos: 1, alergeni: [], alergeniSledi: [], alergeniStatus: "potrjeno_brez", alergeniVir: "etiketa" }],
    });
    expect(sourceLess.status).toBe(201);
    expect((await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length).toBe(sourceLessBefore);
    expect((await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId))).length).toBe(sourceLessStock);
    expect((await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).length).toBe(beforeJournals);
    const createdId = response.body.id;
    const replacement = await request(productionApp).put(`/prejemnice/${createdId}`).send({
      postavke: [{ artikelId: articleId, kolicina: -5, cenaKos: 1, alergeni: [], alergeniSledi: [], alergeniStatus: "potrjeno_brez", alergeniVir: "etiketa" }],
    });
    expect(replacement.status).toBe(200);
    expect((await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length).toBe(beforeMovement);
    expect((await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId))).length).toBe(beforeStock);
    const dateEdit = await request(productionApp).put(`/prejemnice/${createdId}`).send({ datum: "2026-02-21" });
    expect(dateEdit.status).toBe(200);
    expect((await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length).toBe(beforeMovement);
    expect((await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId))).length).toBe(beforeStock);
    const [createdLine] = await db.select({ id: prejemnicePostavkeTable.id })
      .from(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, createdId));
    const confirmed = await request(app)
      .post(`/companies/${companyId}/prejemnice/${createdId}/credit-note-packaging/confirm`)
      .send({
        operationKey: crypto.randomUUID(),
        prejemnicaPostavkaId: createdLine.id,
        embalazniPrometId: movementId,
        quantity: 1,
      });
    expect(confirmed.status).toBe(200);
    const blockedIdentityEdit = await request(productionApp).put(`/prejemnice/${createdId}`).send({
      stDokumenta: `CN-${run}-changed`,
    });
    expect(blockedIdentityEdit.status).toBe(409);
    expect(blockedIdentityEdit.body.code).toBe("CREDIT_NOTE_ALLOCATION_HISTORY_LOCKED");
  });

  it("keeps packaging neutral in mixed credit notes and across repeated document-type transitions", async () => {
    const productionApp = express();
    productionApp.use(express.json());
    productionApp.use(prejemniceRouter);
    productionApp.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));
    const packageRowsBefore = (await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length;
    const ordinaryStockBefore = (await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, ordinaryArticleId))).length;
    const mixed = await request(productionApp).post("/prejemnice").send({
      datum: "2026-03-01", vrstaDokumenta: "DOBROPIS",
      postavke: [
        { artikelId: articleId, kolicina: -2, cenaKos: 1, alergeni: [], alergeniSledi: [], alergeniStatus: "potrjeno_brez", alergeniVir: "etiketa" },
        { artikelId: ordinaryArticleId, kolicina: -3, cenaKos: 2, alergeni: [], alergeniSledi: [], alergeniStatus: "potrjeno_brez", alergeniVir: "etiketa" },
      ],
    });
    expect(mixed.status).toBe(201);
    expect((await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length).toBe(packageRowsBefore);
    // Drafts don't affect inventory. Only explicit receipt confirmation does.
    expect((await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, ordinaryArticleId))).length).toBe(ordinaryStockBefore);
    const confirmedMixed = await request(productionApp).post(`/prejemnice/${mixed.body.id}/confirm`).send({});
    expect(confirmedMixed.status, JSON.stringify(confirmedMixed.body)).toBe(200);
    expect((await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.artikelId, articleId))).length).toBe(packageRowsBefore);
    expect((await db.select().from(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, ordinaryArticleId))).length).toBe(ordinaryStockBefore + 1);

    const packagingNet = async () => (await db.select().from(embalazniPrometiTable)
      .where(eq(embalazniPrometiTable.artikelId, articleId)))
      .reduce((sum, row) => sum + Number(row.kolicina), 0);
    const stockNet = async () => (await db.select().from(zalogaGibiTable)
      .where(eq(zalogaGibiTable.artikelId, articleId)))
      .reduce((sum, row) => sum + Number(row.kolicina), 0);
    const baselinePackagingNet = await packagingNet();
    const baselineStockNet = await stockNet();
    const ordinary = await request(productionApp).post("/prejemnice").send({
      datum: "2026-03-02", dobaviteljId: supplierId, vrstaDokumenta: "DOBAVNICA", stDokumenta: `TR-${run}-1`,
      postavke: [{ artikelId: articleId, kolicina: 3, cenaKos: 1, alergeni: [], alergeniSledi: [], alergeniStatus: "potrjeno_brez", alergeniVir: "etiketa" }],
    });
    expect(ordinary.status).toBe(201);
    expect(await packagingNet()).toBe(baselinePackagingNet);
    expect(await stockNet()).toBe(baselineStockNet);

    const transitions = [
      { vrstaDokumenta: "DOBROPIS", stDokumenta: `TR-${run}-2`, packagingDelta: 0, stockDelta: 0 },
      { vrstaDokumenta: "DOBAVNICA", stDokumenta: `TR-${run}-3`, packagingDelta: 0, stockDelta: 0 },
      { vrstaDokumenta: "DOBROPIS", stDokumenta: `TR-${run}-4`, packagingDelta: 0, stockDelta: 0 },
    ];
    for (const transition of transitions) {
      const response = await request(productionApp).put(`/prejemnice/${ordinary.body.id}`).send({
        vrstaDokumenta: transition.vrstaDokumenta,
        stDokumenta: transition.stDokumenta,
      });
      expect(response.status).toBe(200);
      expect(await packagingNet()).toBe(baselinePackagingNet + transition.packagingDelta);
      expect(await stockNet()).toBe(baselineStockNet + transition.stockDelta);
    }
    const confirmedCreditNote = await request(productionApp).post(`/prejemnice/${ordinary.body.id}/confirm`).send({});
    expect(confirmedCreditNote.status, JSON.stringify(confirmedCreditNote.body)).toBe(200);
    expect(await packagingNet()).toBe(baselinePackagingNet);
    expect(await stockNet()).toBe(baselineStockNet);
  });
});