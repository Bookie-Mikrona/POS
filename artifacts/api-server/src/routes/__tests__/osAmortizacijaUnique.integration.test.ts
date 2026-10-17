import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { describe, expect, it } from "vitest";

describe("amortizacija — aktivne temeljnice v bazi", () => {
  it("blokira draft/posted, po stornu ali izbrisu dovoli nov vnos in ohrani zgodovino", async () => {
    const client = await pool.connect();
    // Transakcijska shema: migracija se izvaja brez dostopa do poslovnih tabel.
    const schema = `test_amort_${randomUUID().replaceAll("-", "")}`;
    const migration = await readFile(new URL(
      "../../../../../lib/db/src/migrations/264-amortizacija-active-entry-unique.sql", import.meta.url,
    ), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(`CREATE TABLE journal_entries (
        id serial PRIMARY KEY, company_id text, reference text, source_type text, status text
      )`);
      await client.query(`CREATE UNIQUE INDEX idx_journal_entries_amortizacija_unique
        ON journal_entries(company_id, reference) WHERE source_type = 'amortizacija'`);
      // Zunanji BEGIN/ROLLBACK lastni test; migracija ostane v isti transakciji.
      const sql = migration.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
      await client.query(sql);
      await client.query(sql); // ponovljivost

      for (const reference of ["AMORT:2024", "AMORT:2024-06"]) {
        const insert = (status: string, company = "company", source = "amortizacija") =>
          client.query(`INSERT INTO journal_entries(company_id, reference, source_type, status)
            VALUES ($1, $2, $3, $4) RETURNING id`, [company, reference, source, status]);
        const expectDuplicate = async () => {
          await client.query("SAVEPOINT duplicate_check");
          await expect(insert("draft")).rejects.toMatchObject({ code: "23505" });
          await client.query("ROLLBACK TO SAVEPOINT duplicate_check");
        };
        await insert("draft");
        await expectDuplicate();
        await client.query("UPDATE journal_entries SET status='posted' WHERE reference=$1 AND company_id='company'", [reference]);
        await expectDuplicate();
        await client.query("UPDATE journal_entries SET status='reversed' WHERE reference=$1 AND company_id='company'", [reference]);
        const draft = await insert("draft");
        await expectDuplicate();
        await client.query("DELETE FROM journal_entries WHERE id=$1", [draft.rows[0].id]);
        await insert("draft");
        await insert("posted", "other-company");
        await insert("posted", "company", "manual");
        const history = await client.query(`SELECT status FROM journal_entries
          WHERE reference=$1 AND company_id='company' AND source_type='amortizacija' ORDER BY id`, [reference]);
        expect(history.rows.map(row => row.status)).toEqual(["reversed", "draft"]);
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
