import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { artikliTable, companiesTable, db, enoteTable, normativiTable, pool } from "@workspace/db";
import { researchNormative } from "../routes/pos/glasovni-ukaz";
import { loadTenantNormative } from "./normative-comparison";

const run = `NORM-${Math.random().toString(36).slice(2, 10)}`;
let companyId = ""; let enotaA = 0; let enotaB = 0; let targetA = 0; let targetB = 0;

describe("normative comparison tenant loader is read-only (PostgreSQL)", () => {
  beforeAll(async () => {
    const [company] = await db.insert(companiesTable).values({ podjetjeDavcna: run, naziv: run }).returning({ id: companiesTable.id });
    companyId = company.id;
    const units = await db.insert(enoteTable).values([{ companyId, ime: `${run}-A` }, { companyId, ime: `${run}-B` }]).returning({ id: enoteTable.id });
    enotaA = units[0].id; enotaB = units[1].id;
    const articles = await db.insert(artikliTable).values([
      { enotaId: enotaA, ime: "Golaž A", cena: "10", davek: "9.5" },
      { enotaId: enotaA, ime: "Meso A", cena: "1", davek: "9.5", enotaMere: "g", nabavniArtikel: true },
      { enotaId: enotaA, ime: "Juha A", cena: "1", davek: "9.5", enotaMere: "ml", nabavniArtikel: true },
      { enotaId: enotaB, ime: "Golaž B", cena: "10", davek: "9.5" },
      { enotaId: enotaB, ime: "Meso B", cena: "1", davek: "9.5", enotaMere: "g", nabavniArtikel: true },
    ]).returning({ id: artikliTable.id, ime: artikliTable.ime });
    targetA = articles[0].id; targetB = articles[3].id;
    await db.insert(normativiTable).values([
      { artikelId: targetA, vhodniArtikelId: articles[1].id, kolicina: "100" },
      { artikelId: targetA, vhodniArtikelId: articles[2].id, kolicina: "200" },
      { artikelId: targetB, vhodniArtikelId: articles[4].id, kolicina: "120" },
    ]);
  });
  afterAll(async () => {
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await pool.end();
  });
  it("does not leak tenants or mutate normative rows during loader and injected research", async () => {
    const before = await db.select().from(normativiTable).orderBy(normativiTable.id);
    const local = await loadTenantNormative(targetA, enotaA);
    expect(local?.rows.map(row => row.ingredientName)).toEqual(["Meso A", "Juha A"]);
    expect(await loadTenantNormative(targetB, enotaA)).toBeNull();
    expect(await loadTenantNormative(targetA, enotaB)).toBeNull();
    const create = async () => ({ content: [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://allrecipes.com/golaz", title: "A", page_age: "2024-01-01" }] },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://bbcgoodfood.com/golaz", title: "B", page_age: "2024-01-02" }] },
      { type: "text", text: '{"findings":[{"ingredient":"Meso A","quantity":400,"unit":"g","servings":4,"sourceUrl":"https://allrecipes.com/golaz"},{"ingredient":"Meso A","quantity":480,"unit":"g","servings":4,"sourceUrl":"https://bbcgoodfood.com/golaz"}]}' },
    ] });
    const output = await researchNormative(local!, create as never);
    expect(output.sources).toHaveLength(2);
    expect(await db.select().from(normativiTable).orderBy(normativiTable.id)).toEqual(before);
  });
});