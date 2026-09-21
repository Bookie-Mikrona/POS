import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { artikliTable, companiesTable, db, enoteTable, normativiTable, pool, posNormativeChangeAuditTable } from "@workspace/db";
import { signNormativeProposal, type NormativeProposalPayload } from "../../lib/normative-comparison";

vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: any, _res: unknown, next: () => void) => {
    req.enotaId = Number(req.header("x-test-enota"));
    req.vloga = req.header("x-test-role");
    req.clerkUserId = req.header("x-test-clerk") ?? "clerk-test";
    req.posActorNatakarId = req.header("x-test-natakar") ? Number(req.header("x-test-natakar")) : undefined;
    next();
  },
}));
import router from "./artikli";

const run = `web-norm-${Math.random().toString(36).slice(2)}`;
const generatedAt = new Date().toISOString();
let companyId = ""; let enotaA = 0; let enotaB = 0; let parentA = 0; let parentB = 0; let rowA = 0; let rowB = 0;
const headers = () => ({
  "x-enota-id": String(enotaA),
  "x-test-enota": String(enotaA),
  "x-test-role": "admin_enote",
  "x-test-clerk": "clerk-web-apply",
  "x-test-natakar": "91",
});
const app = () => { const value = express(); value.use(express.json()); value.use(router); return value; };
const token = (row: number, ingredient: number, expected: string, proposed: string, article = parentA) =>
  signNormativeProposal({ v: 1, artikelId: article, expectedRevision: 1, normativRowId: row, ingredientId: ingredient, expectedQuantity: expected,
    localUnit: "g", proposedQuantity: proposed, sourceUrl: "https://allrecipes.com/web-norm", sourceTitle: run, generatedAt } satisfies NormativeProposalPayload)!;

describe("POST web normative proposals (HTTP + PostgreSQL)", () => {
  beforeAll(async () => {
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = "test-normative-proposal-secret";
    const [company] = await db.insert(companiesTable).values({ podjetjeDavcna: run, naziv: run }).returning({ id: companiesTable.id }); companyId = company.id;
    const units = await db.insert(enoteTable).values([{ companyId, ime: `${run}-a` }, { companyId, ime: `${run}-b` }]).returning({ id: enoteTable.id }); enotaA = units[0].id; enotaB = units[1].id;
    const articles = await db.insert(artikliTable).values([
      { enotaId: enotaA, ime: `${run}-parent-a`, cena: "1", davek: "9.5" }, { enotaId: enotaA, ime: `${run}-ingredient-a`, cena: "1", davek: "9.5", enotaMere: "g" },
      { enotaId: enotaA, ime: `${run}-ingredient-b`, cena: "1", davek: "9.5", enotaMere: "g" }, { enotaId: enotaB, ime: `${run}-parent-b`, cena: "1", davek: "9.5" },
      { enotaId: enotaB, ime: `${run}-ingredient-c`, cena: "1", davek: "9.5", enotaMere: "g" },
    ]).returning({ id: artikliTable.id });
    parentA = articles[0].id; parentB = articles[3].id;
    const norms = await db.insert(normativiTable).values([
      { artikelId: parentA, vhodniArtikelId: articles[1].id, kolicina: "10" }, { artikelId: parentA, vhodniArtikelId: articles[2].id, kolicina: "20" },
      { artikelId: parentB, vhodniArtikelId: articles[4].id, kolicina: "30" },
    ]).returning({ id: normativiTable.id }); rowA = norms[0].id; rowB = norms[1].id;
  });
  afterAll(async () => {
    // The production append-only trigger stays enabled; only test-owned audit facts are removed while it is temporarily disabled.
    await db.execute(sql.raw(`ALTER TABLE pos_normative_change_audit DISABLE TRIGGER pos_normative_change_audit_append_only`));
    await db.delete(posNormativeChangeAuditTable).where(eq(posNormativeChangeAuditTable.sourceTitle, run));
    await db.execute(sql.raw(`ALTER TABLE pos_normative_change_audit ENABLE TRIGGER pos_normative_change_audit_append_only`));
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await pool.end();
  });
  it("applies two valid admin_enote proposals atomically and records signed provenance", async () => {
    const ingredients = await db.select({ id: artikliTable.id }).from(artikliTable).where(and(eq(artikliTable.enotaId, enotaA), eq(artikliTable.ime, `${run}-ingredient-a`)));
    const ingredientB = await db.select({ id: artikliTable.id }).from(artikliTable).where(and(eq(artikliTable.enotaId, enotaA), eq(artikliTable.ime, `${run}-ingredient-b`)));
    const response = await supertest(app()).post(`/artikli/${parentA}/normativi/spletni-predlogi`).set(headers()).send({ selections: [
      { proposalToken: token(rowA, ingredients[0].id, "10", "11.25"), confirmed: true }, { proposalToken: token(rowB, ingredientB[0].id, "20", "21"), confirmed: true },
    ] });
    expect(response.status).toBe(200); expect(response.body.changed).toBe(2); expect(response.body.revision).toBe(2);
    expect((await db.select().from(normativiTable).where(eq(normativiTable.id, rowA)))[0].kolicina).toBe("11.2500");
    const audit = await db.select().from(posNormativeChangeAuditTable).where(eq(posNormativeChangeAuditTable.sourceTitle, run));
    expect(audit).toHaveLength(2); expect(audit[0]).toMatchObject({ actorClerkUserId: "clerk-web-apply", actorNatakarId: 91, oldQuantity: "10.0000", newQuantity: "11.2500", unit: "g", sourceUrl: "https://allrecipes.com/web-norm", comparisonGeneratedAt: new Date(generatedAt) });
  });
  it("rejects tampering, false confirmation, duplicate rows, wrong parent, and stale batches without audits", async () => {
    const ingredient = (await db.select({ id: artikliTable.id }).from(artikliTable).where(eq(artikliTable.enotaId, enotaA)))[1].id;
    const valid = token(rowA, ingredient, "11.25", "12");
    for (const body of [{ selections: [{ proposalToken: `${valid}x`, confirmed: true }] }, { selections: [{ proposalToken: valid, confirmed: false }] }, { selections: [{ proposalToken: valid, confirmed: true }, { proposalToken: valid, confirmed: true }] }]) {
      expect((await supertest(app()).post(`/artikli/${parentA}/normativi/spletni-predlogi`).set(headers()).send(body)).status).toBe(400);
    }
    expect((await supertest(app()).post(`/artikli/${parentA}/normativi/spletni-predlogi`).set(headers()).send({ selections: [{ proposalToken: token(rowA, ingredient, "11.25", "12", parentB), confirmed: true }] })).status).toBe(400);
    // ABA: the quantity can return to its former value, but a normative writer advances revision.
    await db.update(normativiTable).set({ kolicina: "20" }).where(eq(normativiTable.id, rowB));
    await db.update(artikliTable).set({ normativRevision: 3 }).where(eq(artikliTable.id, parentA));
    const stale = await supertest(app()).post(`/artikli/${parentA}/normativi/spletni-predlogi`).set(headers()).send({ selections: [{ proposalToken: valid, confirmed: true }, { proposalToken: token(rowB, (await db.select({ vhodniArtikelId: normativiTable.vhodniArtikelId }).from(normativiTable).where(eq(normativiTable.id, rowB)))[0].vhodniArtikelId, "20", "25"), confirmed: true }] });
    expect(stale.status).toBe(409); expect(stale.body.code).toBe("NORMATIVE_PROPOSAL_STALE");
    expect((await db.select().from(normativiTable).where(eq(normativiTable.id, rowA)))[0].kolicina).toBe("11.2500");
    expect((await db.select().from(posNormativeChangeAuditTable).where(eq(posNormativeChangeAuditTable.sourceTitle, run))).length).toBe(2);
  });
});