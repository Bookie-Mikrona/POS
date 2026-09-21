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
  pool,
} from "@workspace/db";
import documentsRouter from "./documents";

const app = express();
app.use(express.json());
app.use(documentsRouter);

const run = Math.random().toString(36).slice(2, 8);
let companyId = "";
let accountId = "";

async function createReviewableDocument(fileName: string): Promise<string> {
  const [document] = await db
    .insert(documentsTable)
    .values({
      companyId,
      fileName,
      mimeType: "application/pdf",
      objectPath: `/objects/tests/${run}/${fileName}`,
      status: "done",
      ocrResult: { rawText: "", confidence: 1, lines: [] },
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