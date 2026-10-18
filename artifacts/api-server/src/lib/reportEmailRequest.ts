import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

type StoredRequest = { payload_hash: string; exported_by: string; status: string };
export type EmailRequestState = "new" | "claimed" | "succeeded" | "pending" | "conflict";

export function reportEmailHash(payload: Record<string, unknown>): string {
  // Fixed, flat route contract; undefined and absent optional parameters are equivalent.
  const canonical = Object.keys(payload).sort().filter((key) => payload[key] !== undefined)
    .map((key) => [key, payload[key]]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function reportEmailRequest(
  companyId: string, key: string, userId: string, hash: string, claim = false,
): Promise<EmailRequestState> {
  if (claim) {
    const inserted = await pool.query(
      `INSERT INTO report_email_requests (company_id, request_key, exported_by, payload_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, request_key) DO NOTHING RETURNING request_key`,
      [companyId, key, userId, hash],
    );
    if (inserted.rowCount === 1) return "claimed";
  }
  const result = await pool.query<StoredRequest>(
    `SELECT payload_hash, exported_by, status FROM report_email_requests WHERE company_id = $1 AND request_key = $2`,
    [companyId, key],
  );
  const row = result.rows[0];
  if (!row) return "new";
  if (row.payload_hash !== hash || row.exported_by !== userId) return "conflict";
  return row.status === "succeeded" ? "succeeded" : "pending";
}

export async function completeReportEmail(companyId: string, key: string): Promise<void> {
  const result = await pool.query(
    `UPDATE report_email_requests SET status = 'succeeded'
     WHERE company_id = $1 AND request_key = $2 AND status = 'pending'`,
    [companyId, key],
  );
  if (result.rowCount !== 1) throw new Error("Report email completion was not persisted");
}
