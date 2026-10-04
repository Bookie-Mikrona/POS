import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

describe("new ingredient research outbox", () => {
  it("atomically covers every insert path, skips inventory and rolls back with the ingredient", async () => {
    const client = await pool.connect();
    const ids: number[] = [];
    try {
      await client.query("BEGIN");
      const unit = await client.query("SELECT id FROM enote ORDER BY id LIMIT 1");
      if (!unit.rows[0]) throw new Error("Outbox test needs a development unit.");
      for (const [purchase, inventory, prepared, expected] of [
        [true, false, false, 1],
        [false, false, false, 0],
        [true, true, false, 0],
        [true, false, true, 0],
      ] as const) {
        const article = await client.query(`INSERT INTO artikli
          (enota_id,ime,cena,nabavni_artikel,prodajni_artikel,drobni_inventar,meal_type,vrsta_artikla)
          VALUES($1,$2,0,$3,false,$4,$5,'material') RETURNING id`,
        [unit.rows[0].id, `__allergen_test_${randomUUID()}`, purchase, inventory, prepared ? "prepared" : "ala_carte"]);
        ids.push(article.rows[0].id);
        const job = await client.query("SELECT status,attempts,enota_id FROM pos_allergen_research_jobs WHERE artikel_id=$1", [article.rows[0].id]);
        expect(job.rows).toHaveLength(expected);
        if (expected) expect(job.rows[0]).toEqual({ status: "pending", attempts: 0, enota_id: unit.rows[0].id });
      }
      await client.query("ROLLBACK");
      const jobs = await client.query("SELECT id FROM pos_allergen_research_jobs WHERE artikel_id=ANY($1::int[])", [ids]);
      expect(jobs.rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});