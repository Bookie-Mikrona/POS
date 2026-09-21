import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.header("x-test-user") ?? null }),
}));

import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  normativiTable,
  posNormativeChangeAuditTable,
  posUporabnikiTable,
} from "@workspace/db";
import { signNormativeProposal, type NormativeProposalPayload } from "../../lib/normative-comparison";
import posRouter from "./index";

const run = `web-access-${Math.random().toString(36).slice(2)}`;
const secretBefore = process.env.POS_NORMATIVE_PROPOSAL_SECRET;
const generatedAt = new Date().toISOString();
const users = {
  admin: `${run}-admin`,
  unitAdmin: `${run}-unit-admin`,
  user: `${run}-user`,
};

let companyId = "";
let enotaA = 0;
let enotaB = 0;
let adminParent = 0;
let adminRow = 0;
let unitAdminParent = 0;
let unitAdminRow = 0;
let protectedParent = 0;
let protectedRow = 0;
let protectedIngredient = 0;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
  next();
});
app.use(posRouter);
app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: error.message });
});

function proposalToken(input: {
  artikelId: number;
  normativRowId: number;
  ingredientId: number;
  proposedQuantity: string;
}) {
  return signNormativeProposal({
    v: 1,
    artikelId: input.artikelId,
    expectedRevision: 1,
    normativRowId: input.normativRowId,
    ingredientId: input.ingredientId,
    expectedQuantity: "10",
    localUnit: "g",
    proposedQuantity: input.proposedQuantity,
    sourceUrl: "https://allrecipes.com/normative-access-test",
    sourceTitle: run,
    generatedAt,
  } satisfies NormativeProposalPayload)!;
}

function postProposal(userId: string, artikelId: number, token: string, enotaId?: number) {
  let request = supertest(app)
    .post(`/artikli/${artikelId}/normativi/spletni-predlogi`)
    .set("x-test-user", userId)
    .set("x-company-id", companyId);
  if (enotaId !== undefined) request = request.set("x-enota-id", String(enotaId));
  return request.send({ selections: [{ proposalToken: token, confirmed: true }] });
}

async function protectedState() {
  const [row] = await db.select({ quantity: normativiTable.kolicina })
    .from(normativiTable).where(eq(normativiTable.id, protectedRow));
  const [article] = await db.select({ revision: artikliTable.normativRevision })
    .from(artikliTable).where(eq(artikliTable.id, protectedParent));
  const audit = await db.select({ id: posNormativeChangeAuditTable.id })
    .from(posNormativeChangeAuditTable)
    .where(and(
      eq(posNormativeChangeAuditTable.sourceTitle, run),
      eq(posNormativeChangeAuditTable.normativRowId, protectedRow),
    ));
  return { quantity: row?.quantity, revision: article?.revision, auditCount: audit.length };
}

describe("spletni predlogi normativa skozi produkcijski POS mount", () => {
  beforeAll(async () => {
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = "test-normative-access-secret";
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: run,
      naziv: run,
    }).returning({ id: companiesTable.id });
    companyId = company!.id;
    const units = await db.insert(enoteTable).values([
      { companyId, ime: `${run}-a` },
      { companyId, ime: `${run}-b` },
    ]).returning({ id: enoteTable.id });
    enotaA = units[0]!.id;
    enotaB = units[1]!.id;
    await db.insert(posUporabnikiTable).values([
      { clerkUserId: users.admin, companyId, vloga: "admin", ime: "Admin", priimek: run },
      { clerkUserId: users.unitAdmin, companyId, enotaId: enotaA, vloga: "admin_enote", ime: "Unit", priimek: run },
      { clerkUserId: users.user, companyId, enotaId: enotaA, vloga: "uporabnik", ime: "User", priimek: run },
    ]);
    const articles = await db.insert(artikliTable).values([
      { enotaId: enotaA, ime: `${run}-admin-parent`, cena: "1", davek: "9.5" },
      { enotaId: enotaA, ime: `${run}-admin-ingredient`, cena: "1", davek: "9.5", enotaMere: "g" },
      { enotaId: enotaA, ime: `${run}-unit-parent`, cena: "1", davek: "9.5" },
      { enotaId: enotaA, ime: `${run}-unit-ingredient`, cena: "1", davek: "9.5", enotaMere: "g" },
      { enotaId: enotaA, ime: `${run}-protected-parent`, cena: "1", davek: "9.5" },
      { enotaId: enotaA, ime: `${run}-protected-ingredient`, cena: "1", davek: "9.5", enotaMere: "g" },
    ]).returning({ id: artikliTable.id });
    [adminParent, , unitAdminParent, , protectedParent, protectedIngredient] = articles.map(row => row.id);
    const rows = await db.insert(normativiTable).values([
      { artikelId: adminParent, vhodniArtikelId: articles[1]!.id, kolicina: "10" },
      { artikelId: unitAdminParent, vhodniArtikelId: articles[3]!.id, kolicina: "10" },
      { artikelId: protectedParent, vhodniArtikelId: protectedIngredient, kolicina: "10" },
    ]).returning({ id: normativiTable.id });
    [adminRow, unitAdminRow, protectedRow] = rows.map(row => row.id);
  });

  afterAll(async () => {
    await db.execute(sql.raw("ALTER TABLE pos_normative_change_audit DISABLE TRIGGER pos_normative_change_audit_append_only"));
    await db.delete(posNormativeChangeAuditTable).where(eq(posNormativeChangeAuditTable.sourceTitle, run));
    await db.execute(sql.raw("ALTER TABLE pos_normative_change_audit ENABLE TRIGGER pos_normative_change_audit_append_only"));
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    if (secretBefore === undefined) delete process.env.POS_NORMATIVE_PROPOSAL_SECRET;
    else process.env.POS_NORMATIVE_PROPOSAL_SECRET = secretBefore;
  });

  it("dovoli adminu in adminu enote v pravi enoti", async () => {
    const [adminIngredient] = await db.select({ id: normativiTable.vhodniArtikelId })
      .from(normativiTable).where(eq(normativiTable.id, adminRow));
    const adminResponse = await postProposal(users.admin, adminParent, proposalToken({
      artikelId: adminParent, normativRowId: adminRow, ingredientId: adminIngredient!.id, proposedQuantity: "11",
    }), enotaA);
    expect(adminResponse.status, JSON.stringify(adminResponse.body)).toBe(200);

    const [unitIngredient] = await db.select({ id: normativiTable.vhodniArtikelId })
      .from(normativiTable).where(eq(normativiTable.id, unitAdminRow));
    const unitResponse = await postProposal(users.unitAdmin, unitAdminParent, proposalToken({
      artikelId: unitAdminParent, normativRowId: unitAdminRow, ingredientId: unitIngredient!.id, proposedQuantity: "12",
    }), enotaA);
    expect(unitResponse.status, JSON.stringify(unitResponse.body)).toBe(200);
  });

  it("managerju vrne samo zgodovino iz izbrane enote, uporabniku pa jo zavrne brez spremembe audita", async () => {
    const [adminIngredient] = await db.select({ id: normativiTable.vhodniArtikelId })
      .from(normativiTable).where(eq(normativiTable.id, adminRow));
    const [inserted] = await db.insert(posNormativeChangeAuditTable).values({
      enotaId: enotaA,
      artikelId: adminParent,
      normativRowId: adminRow,
      ingredientId: adminIngredient!.id,
      actorClerkUserId: users.unitAdmin,
      actorNatakarId: null,
      oldQuantity: "10",
      newQuantity: "12.5",
      unit: "g",
      sourceUrl: "https://allrecipes.com/normative-access-test",
      sourceTitle: run,
      comparisonGeneratedAt: new Date(generatedAt),
    }).returning({ id: posNormativeChangeAuditTable.id });
    const before = await db.select({ id: posNormativeChangeAuditTable.id })
      .from(posNormativeChangeAuditTable)
      .where(eq(posNormativeChangeAuditTable.sourceTitle, run));

    const managerResponse = await supertest(app)
      .get(`/artikli/${adminParent}/normativi/spletne-spremembe`)
      .set("x-test-user", users.unitAdmin)
      .set("x-company-id", companyId)
      .set("x-enota-id", String(enotaA));
    expect(managerResponse.status, JSON.stringify(managerResponse.body)).toBe(200);
    expect(managerResponse.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: inserted!.id,
        actorClerkUserId: users.unitAdmin,
        ingredientId: adminIngredient!.id,
        ingredientName: `${run}-admin-ingredient`,
        oldQuantity: 10,
        newQuantity: 12.5,
        unit: "g",
        sourceUrl: "https://allrecipes.com/normative-access-test",
        sourceTitle: run,
      }),
    ]));

    const ordinaryUserResponse = await supertest(app)
      .get(`/artikli/${adminParent}/normativi/spletne-spremembe`)
      .set("x-test-user", users.user)
      .set("x-company-id", companyId)
      .set("x-enota-id", String(enotaA));
    expect(ordinaryUserResponse.status).toBe(403);

    const wrongUnitResponse = await supertest(app)
      .get(`/artikli/${adminParent}/normativi/spletne-spremembe`)
      .set("x-test-user", users.admin)
      .set("x-company-id", companyId)
      .set("x-enota-id", String(enotaB));
    expect(wrongUnitResponse.status).toBe(404);

    const after = await db.select({ id: posNormativeChangeAuditTable.id })
      .from(posNormativeChangeAuditTable)
      .where(eq(posNormativeChangeAuditTable.sourceTitle, run));
    expect(after).toEqual(before);
  });

  it("zavrne uporabnika, manjkajočo enoto in drugo enoto brez spremembe ali audita", async () => {
    const token = proposalToken({
      artikelId: protectedParent,
      normativRowId: protectedRow,
      ingredientId: protectedIngredient,
      proposedQuantity: "99",
    });
    const attempts = [
      await postProposal(users.user, protectedParent, token, enotaA),
      await postProposal(users.unitAdmin, protectedParent, token),
      await postProposal(users.unitAdmin, protectedParent, token, enotaB),
      await supertest(app)
        .post(`/artikli/${protectedParent}/normativi/spletni-predlogi`)
        .set("x-test-user", users.unitAdmin)
        .set("x-company-id", companyId)
        .set("x-enota-id", `0x${enotaA.toString(16)}`)
        .send({ selections: [{ proposalToken: token, confirmed: true }] }),
      await supertest(app)
        .post(`/artikli/${protectedParent}/normativi/spletni-predlogi`)
        .set("x-test-user", users.unitAdmin)
        .set("x-company-id", companyId)
        .set("x-enota-id", `${enotaA}e0`)
        .send({ selections: [{ proposalToken: token, confirmed: true }] }),
      await supertest(app)
        .post(`/artikli/${protectedParent}/normativi/spletni-predlogi?enota_id=${enotaA}`)
        .set("x-test-user", users.unitAdmin)
        .set("x-company-id", companyId)
        .send({ selections: [{ proposalToken: token, confirmed: true }] }),
    ];

    expect(attempts.map(response => response.status)).toEqual([403, 400, 403, 400, 400, 400]);
    expect(await protectedState()).toEqual({ quantity: "10.0000", revision: 1, auditCount: 0 });
  });
});