/**
 * Development-only, idempotent seed for Križišče pizza dough portions.
 * Run manually only after migration 225 is applied. It never edits existing
 * article data or pizza norms; ingredient norms belong to the dough articles.
 */
import { pool } from "@workspace/db";

const UNIT_ID = 309;
const DOUGH_ARTICLES = [
  { name: "Hlebček testa za pico - normalno", unit: "kos" },
  { name: "Hlebček testa za pico - malo", unit: "kos" },
] as const;
const RAW_ARTICLES = [
  { name: "Moka za pico", unit: "KGM" },
  { name: "Kvas sveži", unit: "KGM" },
] as const;

type Article = {
  id: number;
  ime: string;
  enota_mere: string | null;
  nabavni_artikel: boolean;
  prodajni_artikel: boolean;
  meal_type: string;
  davek: string;
  tax_category: string;
};

if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Sejanje testa za pico je dovoljeno samo v razvojnem okolju.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL ni nastavljen.");
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const ready = await client.query<{ settings_table: string | null; snapshot_column: string | null }>(`
    SELECT to_regclass('public.pizza_dough_settings')::text AS settings_table,
           (SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'postavke'
               AND column_name = 'pizza_dough_article_id') AS snapshot_column
  `);
  if (!ready.rows[0]?.settings_table || !ready.rows[0]?.snapshot_column) {
    throw new Error("Shema ni pripravljena: najprej uporabite migracijo 225-pizza-dough-settings.sql.");
  }

  await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [1_317_091_087, UNIT_ID]);
  const unit = await client.query<{ id: number; ime: string }>(
    "SELECT id, ime FROM enote WHERE id = $1 FOR UPDATE",
    [UNIT_ID],
  );
  if (unit.rows.length !== 1 || unit.rows[0]!.ime !== "Križišče") {
    throw new Error("Enota 309 ne obstaja ali ni Križišče; seed je ustavljen brez sprememb.");
  }

  async function findOrCreateArticle(
    name: string,
    unitOfMeasure: string,
    role: "dough" | "raw",
  ): Promise<Article> {
    const found = await client.query<Article>(
      `SELECT id, ime, enota_mere, nabavni_artikel, prodajni_artikel, meal_type, davek::text, tax_category
         FROM artikli WHERE enota_id = $1 AND ime = $2 ORDER BY id`,
      [UNIT_ID, name],
    );
    if (found.rows.length > 1) {
      throw new Error(`Več artiklov z imenom "${name}" je v enoti; ročno razrešite podvojitev.`);
    }
    if (found.rows[0]) {
      const article = found.rows[0];
      const valid = article.enota_mere === unitOfMeasure &&
        Number(article.davek) === 9.5 && article.tax_category === "food" &&
        (role === "dough"
          ? !article.nabavni_artikel && !article.prodajni_artikel && article.meal_type === "prepared"
          : article.nabavni_artikel && !article.prodajni_artikel);
      if (!valid) throw new Error(`Obstoječi artikel "${name}" nima pričakovanih lastnosti; ni bil spremenjen.`);
      return article;
    }

    const inserted = await client.query<Article>(
      `INSERT INTO artikli
         (enota_id, ime, cena, davek, tax_category, enota_mere, nabavni_artikel,
          prodajni_artikel, meal_type, vrsta_artikla)
       VALUES ($1, $2, 0, 9.5, 'food', $3, $4, false, $5, 'material')
      RETURNING id, ime, enota_mere, nabavni_artikel, prodajni_artikel, meal_type, davek::text, tax_category`,
      [UNIT_ID, name, unitOfMeasure, role === "raw", role === "dough" ? "prepared" : "ala_carte"],
    );
    return inserted.rows[0]!;
  }

  const doughArticles = [];
  for (const article of DOUGH_ARTICLES) {
    doughArticles.push(await findOrCreateArticle(article.name, article.unit, "dough"));
  }

  const ingredients = new Map<string, Article>();
  for (const article of RAW_ARTICLES) {
    ingredients.set(article.name, await findOrCreateArticle(article.name, article.unit, "raw"));
  }
  for (const existingName of ["Sol", "Olje sončnično"] as const) {
    const expectedUnit = existingName === "Sol" ? "KGM" : "LTR";
    const found = await client.query<Article>(
      `SELECT id, ime, enota_mere, nabavni_artikel, prodajni_artikel, meal_type, davek::text, tax_category
         FROM artikli WHERE enota_id = $1 AND ime = $2 ORDER BY id`,
      [UNIT_ID, existingName],
    );
    if (found.rows.length !== 1 || found.rows[0]!.enota_mere !== expectedUnit) {
      throw new Error(`Pričakovani obstoječi artikel "${existingName}" (${expectedUnit}) manjka ali ni enoličen.`);
    }
    ingredients.set(existingName, found.rows[0]!);
  }

  const recipes = [
    { dough: doughArticles[0]!, rows: [
      { ingredient: ingredients.get("Moka za pico")!, quantity: "0.1450" },
      { ingredient: ingredients.get("Sol")!, quantity: "0.0040" },
      { ingredient: ingredients.get("Olje sončnično")!, quantity: "0.0030" },
      { ingredient: ingredients.get("Kvas sveži")!, quantity: "0.0010" },
    ] },
    { dough: doughArticles[1]!, rows: [
      // Operativna predloga: razmerje površin 28 cm / 32 cm, ne teža hlebčka.
      { ingredient: ingredients.get("Moka za pico")!, quantity: "0.1110" },
      { ingredient: ingredients.get("Sol")!, quantity: "0.0031" },
      { ingredient: ingredients.get("Olje sončnično")!, quantity: "0.0023" },
      { ingredient: ingredients.get("Kvas sveži")!, quantity: "0.0008" },
    ] },
  ];

  for (const recipe of recipes) {
    const existing = await client.query<{ vhodni_artikel_id: number; kolicina: string }>(
      "SELECT vhodni_artikel_id, kolicina::text FROM normativi WHERE artikel_id = $1 ORDER BY vhodni_artikel_id",
      [recipe.dough.id],
    );
    const expected = [...recipe.rows].sort((a, b) => a.ingredient.id - b.ingredient.id);
    if (existing.rows.length === 0) {
      for (let index = 0; index < expected.length; index += 1) {
        const row = expected[index]!;
        await client.query(
          "INSERT INTO normativi (artikel_id, vhodni_artikel_id, kolicina, vrstni_red) VALUES ($1, $2, $3, $4)",
          [recipe.dough.id, row.ingredient.id, row.quantity, index],
        );
      }
    } else {
      const matches = existing.rows.length === expected.length && existing.rows.every((row, index) =>
        row.vhodni_artikel_id === expected[index]!.ingredient.id &&
        Number(row.kolicina) === Number(expected[index]!.quantity));
      if (!matches) {
        throw new Error(`Normativ artikla "${recipe.dough.ime}" že obstaja in se razlikuje; ni bil spremenjen.`);
      }
    }
  }

  const settings = await client.query<{ normal_dough_article_id: number; small_dough_article_id: number }>(
    "SELECT normal_dough_article_id, small_dough_article_id FROM pizza_dough_settings WHERE enota_id = $1 FOR UPDATE",
    [UNIT_ID],
  );
  if (settings.rows.length === 0) {
    await client.query(
      `INSERT INTO pizza_dough_settings (enota_id, normal_dough_article_id, small_dough_article_id)
       VALUES ($1, $2, $3)`,
      [UNIT_ID, doughArticles[0]!.id, doughArticles[1]!.id],
    );
  } else if (
    settings.rows[0]!.normal_dough_article_id !== doughArticles[0]!.id ||
    settings.rows[0]!.small_dough_article_id !== doughArticles[1]!.id
  ) {
    throw new Error("Nastavitve testa za enoto že obstajajo z drugimi artikli; niso bile prepisane.");
  }

  await client.query("COMMIT");
  process.stdout.write("Developmentni seed testa za pico je končan.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}