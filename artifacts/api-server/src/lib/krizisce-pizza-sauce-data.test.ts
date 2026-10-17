import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { izracunajVelikostiPic } from "./pica-velikosti";

const recipe = new Map([
  ["Pelati", ["0.0850", "KGM"]],
  ["Olje sončnično", ["0.0030", "LTR"]],
  ["Sol", ["0.0010", "KGM"]],
  ["Suhi origano", ["0.0005", "KGM"]],
]);

describe("razvojni normativi pic Križišče", () => {
  it("17 omak razčleni, obe izjemi ohrani, dodatek pa ne porablja arhivirane omake", async () => {
    const unit = await db.execute(sql`SELECT id FROM enote WHERE id=309 AND ime='Križišče'`);
    if (unit.rows.length === 0) return; // isolated test databases do not carry this development menu

    const pizzas = await db.execute(sql`
      SELECT p.id, p.ime, p.normativ_revision, i.ime AS ingredient, i.enota_mere AS unit, n.kolicina AS quantity
      FROM artikli p
      LEFT JOIN normativi n ON n.artikel_id=p.id
      LEFT JOIN artikli i ON i.id=n.vhodni_artikel_id
      WHERE p.enota_id=309 AND p.je_pica
      ORDER BY p.id
    `);
    const byPizza = new Map<number, { name: string; revision: number; ingredients: Map<string, [string, string]> }>();
    for (const row of pizzas.rows) {
      const id = Number(row.id);
      if (!byPizza.has(id)) byPizza.set(id, {
        name: String(row.ime), revision: Number(row.normativ_revision), ingredients: new Map(),
      });
      if (row.ingredient) byPizza.get(id)!.ingredients.set(String(row.ingredient), [String(row.quantity), String(row.unit)]);
    }
    expect(byPizza.size).toBe(19);
    for (const pizza of byPizza.values()) {
      expect(pizza.ingredients.has("Omaka")).toBe(false);
      if (pizza.name === "Sadna" || pizza.name === "Pičiči") {
        for (const name of recipe.keys()) expect(pizza.ingredients.has(name)).toBe(false);
        expect(pizza.revision).toBeGreaterThanOrEqual(1);
      } else {
        for (const [name, value] of recipe) expect(pizza.ingredients.get(name)).toEqual(value);
        // Later edits legitimately advance the revision; the recipe is the invariant.
        expect(pizza.revision).toBeGreaterThanOrEqual(2);
      }
    }
    const modifier = await db.execute(sql`
      SELECT i.ime AS ingredient, i.enota_mere AS unit, n.kolicina AS quantity
      FROM modifikator_normativi n JOIN artikli i ON i.id=n.vhodni_artikel_id
      WHERE n.modifikator_id=7476
    `);
    expect(new Map(modifier.rows.map(row => [String(row.ingredient), [String(row.quantity), String(row.unit)]]))).toEqual(recipe);
    const sauce = await db.execute(sql`SELECT aktiven,nabavni_artikel FROM artikli WHERE id=25443 AND enota_id=309`);
    expect(sauce.rows).toMatchObject([{ aktiven: false, nabavni_artikel: false }]);
  });

  it("mala pica sorazmerno porabi normalni normativ glede na premera 28 in 32 cm", () => {
    const sizes = izracunajVelikostiPic({ picaPremerMala: "28", picaPremerNormalna: "32" });
    expect(sizes.find(size => size.id === "mala")?.normativFaktor).toBe(0.765625);
    expect(sizes.find(size => size.id === "normalna")?.normativFaktor).toBe(1);
    expect(0.085 * 0.765625).toBeCloseTo(0.065078125);
  });
});