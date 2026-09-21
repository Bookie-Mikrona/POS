import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companiesTable,
  counterpartiesTable,
  db,
  enoteTable,
  prejemniceTable,
  purchaseSourceDocumentsTable,
} from "@workspace/db";
import { claimPurchaseSourceDocument } from "./purchaseSourceDocuments";

const cleanupCompanyIds: string[] = [];

afterEach(async () => {
  for (const companyId of cleanupCompanyIds.splice(0)) {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
});

describe("purchase source identity (DB)", () => {
  it("sočasna račun in dobavnica z isto normalizirano številko dobita isti vir", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `T${suffix.slice(0, 15)}`,
      naziv: "Test identitete nabavne listine",
    }).returning({ id: companiesTable.id });
    cleanupCompanyIds.push(company.id);

    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId: company.id,
      type: "supplier",
      name: "Testni dobavitelj",
    }).returning({ id: counterpartiesTable.id });

    const [invoiceSourceId, deliverySourceId] = await Promise.all([
      claimPurchaseSourceDocument(db, {
        companyId: company.id,
        counterpartyId: supplier.id,
        kind: "invoice",
        documentNumber: "R-2026 / 00015",
        documentDate: "2026-08-31",
      }),
      claimPurchaseSourceDocument(db, {
        companyId: company.id,
        counterpartyId: supplier.id,
        kind: "delivery_note",
        documentNumber: " r 2026-00015 ",
        documentDate: "2026-08-31",
      }),
    ]);

    expect(deliverySourceId).toBe(invoiceSourceId);
    const rows = await db.select({ id: purchaseSourceDocumentsTable.id })
      .from(purchaseSourceDocumentsTable)
      .where(eq(purchaseSourceDocumentsTable.companyId, company.id));
    expect(rows).toHaveLength(1);
  });

  it("ročna POS prejemnica blokira ponovni ERP zajem iste listine", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `P${suffix.slice(0, 15)}`,
      naziv: "Test POS ERP identitete",
    }).returning({ id: companiesTable.id });
    cleanupCompanyIds.push(company.id);
    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId: company.id,
      type: "supplier",
      name: "POS dobavitelj",
    }).returning({ id: counterpartiesTable.id });
    const [unit] = await db.insert(enoteTable).values({
      companyId: company.id,
      ime: "POS testna enota",
    }).returning({ id: enoteTable.id });

    const posSourceId = await claimPurchaseSourceDocument(db, {
      companyId: company.id,
      counterpartyId: supplier.id,
      kind: "delivery_note",
      documentNumber: "DOB-15/2026",
      documentDate: "2026-08-31",
    });
    await db.insert(prejemniceTable).values({
      enotaId: unit.id,
      dobaviteljId: supplier.id,
      stDokumenta: "DOB-15/2026",
      datumDokumenta: "2026-08-31",
      sourceDocumentId: posSourceId,
    });

    const erpSourceId = await claimPurchaseSourceDocument(db, {
      companyId: company.id,
      counterpartyId: supplier.id,
      kind: "invoice",
      documentNumber: " dob 15 2026 ",
      documentDate: "2026-08-31",
    });
    expect(erpSourceId).toBe(posSourceId);
    const existingPosReceipts = await db.select({ id: prejemniceTable.id })
      .from(prejemniceTable)
      .where(eq(prejemniceTable.sourceDocumentId, erpSourceId));
    expect(existingPosReceipts).toHaveLength(1);
  });

  it("legacy POS prejemnica brez source ID blokira nov ERP claim", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `L${suffix.slice(0, 15)}`,
      naziv: "Test legacy POS ERP identitete",
    }).returning({ id: companiesTable.id });
    cleanupCompanyIds.push(company.id);
    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId: company.id,
      type: "supplier",
      name: "Legacy POS dobavitelj",
    }).returning({ id: counterpartiesTable.id });
    const [unit] = await db.insert(enoteTable).values({
      companyId: company.id,
      ime: "Legacy POS testna enota",
    }).returning({ id: enoteTable.id });
    await db.insert(prejemniceTable).values({
      enotaId: unit.id,
      dobaviteljId: supplier.id,
      stDokumenta: "LEG-15/2026",
      datumDokumenta: "2026-08-31",
      sourceDocumentId: null,
    });

    await expect(db.transaction((tx) => claimPurchaseSourceDocument(tx, {
      companyId: company.id,
      counterpartyId: supplier.id,
      kind: "invoice",
      documentNumber: " leg 15 2026 ",
      documentDate: "2026-08-31",
    }))).rejects.toMatchObject({ code: "LEGACY_PURCHASE_SOURCE_CONFLICT" });
  });
});