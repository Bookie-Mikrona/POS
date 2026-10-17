import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { deleteExpiredReportExportBatch, REPORT_EXPORT_CLEANUP_BATCH_SIZE } from "./reportExportRetention";

afterAll(async () => { await pool.end(); });

describe("report export retention SQL", () => {
  it("removes only expired PDF copies across tenants, preserves the exact boundary and batches oldest first", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Shadow the real table on this connection; never touch existing exports.
      await client.query(`CREATE TEMP TABLE report_exports (
        id integer PRIMARY KEY, company_id text, exported_at timestamptz, pdf_data bytea
      ) ON COMMIT DROP`);
      const cutoff = new Date("2025-10-17T12:00:00Z");
      await client.query(`INSERT INTO report_exports
        SELECT i, CASE WHEN i % 2 = 0 THEN 'a' ELSE 'b' END,
          $1::timestamptz - i * interval '1 second', decode('25504446', 'hex')
        FROM generate_series(1, $2::integer) i`,
      [cutoff, REPORT_EXPORT_CLEANUP_BATCH_SIZE + 1]);
      await client.query(`INSERT INTO report_exports VALUES
        (1001, 'a', $1, decode('25504446', 'hex')),
        (1002, 'b', $1::timestamptz + interval '1 millisecond', decode('25504446', 'hex'))`,
      [cutoff]);
      expect(await deleteExpiredReportExportBatch(client, cutoff)).toBe(REPORT_EXPORT_CLEANUP_BATCH_SIZE);
      expect((await client.query("SELECT id FROM report_exports ORDER BY id")).rows)
        .toEqual([{ id: 1 }, { id: 1001 }, { id: 1002 }]);
      expect(await deleteExpiredReportExportBatch(client, cutoff)).toBe(1);
      expect(await deleteExpiredReportExportBatch(client, cutoff)).toBe(0);
      expect((await client.query("SELECT id, octet_length(pdf_data) AS bytes FROM report_exports ORDER BY id")).rows)
        .toEqual([{ id: 1001, bytes: 4 }, { id: 1002, bytes: 4 }]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
