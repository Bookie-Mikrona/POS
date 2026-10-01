import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const FULL_NAME_USER = "test-document-full-name-user";
const EMAIL_USER = "test-document-email-user";
let currentUserId = FULL_NAME_USER;

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = currentUserId;
    next();
  },
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: {
      getUser: vi.fn(async (userId: string) => {
        if (userId === FULL_NAME_USER) {
          return {
            firstName: "Janez",
            lastName: "Novak",
            primaryEmailAddressId: "full-name-email",
            emailAddresses: [{ id: "full-name-email", emailAddress: "janez@example.com" }],
          };
        }
        return {
          firstName: null,
          lastName: null,
          primaryEmailAddressId: "primary-email",
          emailAddresses: [{ id: "primary-email", emailAddress: "racunovodstvo@example.com" }],
        };
      }),
    },
  },
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  accountingRolesTable,
  accountsTable,
  companiesTable,
  db,
  documentsTable,
  vatCodeTable,
  pool,
} from "@workspace/db";
import type { OcrResult } from "@workspace/db";
import documentsRouter from "./documents";

const app = express();
app.use(express.json());
app.use(documentsRouter);

const run = Math.random().toString(36).slice(2, 8);
let companyId = "";
let accountId = "";

async function createReviewableDocument(fileName: string, ocrResult?: OcrResult): Promise<string> {
  const [document] = await db
    .insert(documentsTable)
    .values({
      companyId,
      fileName,
      mimeType: "application/pdf",
      objectPath: `/objects/tests/${run}/${fileName}`,
      status: "done",
      ocrResult: ocrResult ?? { rawText: "", confidence: 1, lines: [] },
    })
    .returning({ id: documentsTable.id });
  return document.id;
}

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ podjetjeDavcna: `DOC-ACTOR-${run}`, naziv: "Test izvajalca dokumenta" })
    .returning({ id: companiesTable.id });
  companyId = company.id;

  await db.insert(accountingRolesTable).values([
    { companyId, clerkUserId: FULL_NAME_USER, role: "owner" },
    { companyId, clerkUserId: EMAIL_USER, role: "accountant" },
  ]);

  const [account] = await db
    .insert(accountsTable)
    .values({
      companyId,
      code: `4${run}`,
      name: "Testni stroškovni konto",
      type: "expense",
      isActive: true,
      allowsPosting: true,
    })
    .returning({ id: accountsTable.id });
  accountId = account.id;
});

afterAll(async () => {
  await db.delete(documentsTable).where(eq(documentsTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("izvajalec potrditve ali zavrnitve dokumenta", () => {
  it("zavrne potrditev dokumenta brez vrstic", async () => {
    currentUserId = FULL_NAME_USER;
    const documentId = await createReviewableDocument("prazne-vrstice.pdf");

    const response = await supertest(app)
      .post(`/companies/${companyId}/documents/${documentId}/confirm`)
      .send({ lines: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Dokument nima vrstic za kontiranje — dodajte vsaj eno vrstico.",
    );
  });

  it("shrani polno ime uporabnika ob potrditvi in ga vrne v podrobnostih", async () => {
    currentUserId = FULL_NAME_USER;
    const documentId = await createReviewableDocument("potrditev.pdf");

    const response = await supertest(app)
      .post(`/companies/${companyId}/documents/${documentId}/confirm`)
      .send({
        lines: [
          {
            description: "Testna storitev",
            quantity: 1,
            unitPrice: 10,
            vatRate: 22,
            vatBase: 10,
            vatAmount: 2.2,
            accountId,
            accountCode: "4000",
            confidence: 1,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "confirmed", confirmedBy: "Janez Novak" });

    const detail = await supertest(app).get(`/companies/${companyId}/documents/${documentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.confirmedBy).toBe("Janez Novak");
  });

  it("zavrne FURS kodo brez tenant povezave pred transakcijo in pusti dokument done/unlinked", async () => {
    currentUserId = FULL_NAME_USER;
    const [fursCode] = await db.select({
      id: vatCodeTable.id,
      code: vatCodeTable.code,
    }).from(vatCodeTable)
      .where(eq(vatCodeTable.code, "S22"))
      .limit(1);
    expect(fursCode).toBeTruthy();

    const documentId = await createReviewableDocument("nepovezana-ddv-koda.pdf", {
      rawText: "",
      confidence: 1,
      suggestedDocumentType: "invoice_issued",
      invoiceDate: "2026-01-10",
      lines: [{
        description: "Izdana storitev",
        quantity: 1,
        unitPrice: 10,
        vatRate: 22,
        vatBase: 10,
        vatAmount: 2.2,
        accountId,
        vatCodeId: fursCode.id,
        confidence: 1,
      }],
    });

    const response = await supertest(app)
      .post(`/companies/${companyId}/documents/${documentId}/confirm`)
      .send({
        documentType: "invoice_issued",
        createInvoice: true,
        invoiceDate: "2026-01-10",
        lines: [{
          description: "Izdana storitev",
          quantity: 1,
          unitPrice: 10,
          vatRate: 22,
          vatBase: 10,
          vatAmount: 2.2,
          accountId,
          vatCodeId: fursCode.id,
        }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(fursCode.code);
    expect(response.body.error).toContain("Nastavitve > DDV kode");
    const [stored] = await db.select({
      status: documentsTable.status,
      linkedInvoiceId: documentsTable.linkedInvoiceId,
    }).from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
    expect(stored).toEqual({ status: "done", linkedInvoiceId: null });
  });

  it("ne shrani zneska valute USD kot EUR in dokument pusti done/unlinked", async () => {
    currentUserId = FULL_NAME_USER;
    const documentId = await createReviewableDocument("usd-vir.pdf", {
      rawText: "USD 20.00 + USD 4.40 VAT",
      confidence: 1,
      currency: "USD",
      lines: [{
        description: "Service",
        quantity: 1,
        unitPrice: 20,
        vatRate: 22,
        vatBase: 20,
        vatAmount: 4.4,
        accountId,
        confidence: 1,
      }],
    });

    const response = await supertest(app)
      .post(`/companies/${companyId}/documents/${documentId}/confirm`)
      .send({
        createInvoice: true,
        lines: [{
          description: "Service",
          quantity: 1,
          unitPrice: 20,
          vatRate: 22,
          vatBase: 20,
          vatAmount: 4.4,
          accountId,
        }],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("USD");
    expect(response.body.error).toContain("Samodejna pretvorba v EUR ni podprta");
    const [stored] = await db.select({
      status: documentsTable.status,
      linkedInvoiceId: documentsTable.linkedInvoiceId,
    }).from(documentsTable).where(eq(documentsTable.id, documentId)).limit(1);
    expect(stored).toEqual({ status: "done", linkedInvoiceId: null });
  });

  it("uporabi primarno e-pošto ob zavrnitvi uporabnika brez imena", async () => {
    currentUserId = EMAIL_USER;
    const documentId = await createReviewableDocument("zavrnitev.pdf");

    const response = await supertest(app)
      .post(`/companies/${companyId}/documents/${documentId}/reject`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "rejected",
      rejectedBy: "racunovodstvo@example.com",
    });

    const detail = await supertest(app).get(`/companies/${companyId}/documents/${documentId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rejectedBy).toBe("racunovodstvo@example.com");
  });
});