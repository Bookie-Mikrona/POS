import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";

const router: IRouter = Router({ mergeParams: true });
const CompanyParams = z.object({ id: z.string().uuid() });
const CaseParams = z.object({ id: z.string().uuid(), caseId: z.string().uuid() });
const CreateCaseBody = z.object({
  sharedBackupRetainUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)"),
}).strict();
const AcknowledgeBody = z.object({
  archiveSha256: z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256 digest"),
  confirmed: z.literal(true),
  acknowledgementText: z.string().trim().min(1).max(2000),
}).strict();

router.use(requireAuth, requireSuperAdmin);

function parseCompanyId(raw: unknown): string | null {
  const parsed = CompanyParams.safeParse({ id: raw });
  return parsed.success ? parsed.data.id : null;
}

function companyIdFromParams(params: unknown): string | null {
  const id = (params as { id?: unknown } | undefined)?.id;
  return parseCompanyId(id);
}

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

router.post("/cases", async (req, res): Promise<void> => {
  const companyId = companyIdFromParams(req.params);
  if (!companyId) {
    res.status(400).json({ error: "A valid company UUID is required." });
    return;
  }
  const body = CreateCaseBody.safeParse(req.body);
  if (!body.success || !isRealDate(body.data.sharedBackupRetainUntil)) {
    res.status(400).json({ error: body.success ? "A valid ISO date is required." : body.error.message });
    return;
  }

  const actorId = (req as AuthenticatedRequest).clerkUserId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ownerResult = await client.query<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = $1 LIMIT 1",
      ["erp_owner_company_id"],
    );
    if (ownerResult.rows[0]?.value === companyId) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "The ERP owner company is protected from offboarding.", code: "PROTECTED_ERP_OWNER" });
      return;
    }

    const companyResult = await client.query<{ id: string; naziv: string }>(
      "SELECT id, naziv FROM companies WHERE id = $1 FOR UPDATE",
      [companyId],
    );
    const company = companyResult.rows[0];
    if (!company) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Company not found.", code: "COMPANY_NOT_FOUND" });
      return;
    }

    const inserted = await client.query(
      `INSERT INTO company_offboarding_cases
         (target_company_id, company_name_snapshot, shared_backup_retain_until, status, created_by_actor_id)
       SELECT $1, $2, $3::date, 'pending_export', $4
       WHERE $3::date >= CURRENT_DATE
       RETURNING id, target_company_id, company_name_snapshot,
                 shared_backup_retain_until, status, created_by_actor_id, created_at, updated_at`,
      [companyId, company.naziv, body.data.sharedBackupRetainUntil, actorId],
    );
    if (!inserted.rows[0]) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Retention deadline must not be in the past.", code: "RETENTION_DEADLINE_PAST" });
      return;
    }

    const createdCase = inserted.rows[0];
    await client.query(
      `INSERT INTO company_offboarding_case_audit_events
         (case_id, event_type, to_status, actor_id, event_data)
       VALUES ($1, 'case_created', 'pending_export', $2, jsonb_build_object('sharedBackupRetainUntil', $3::date))`,
      [createdCase.id, actorId, body.data.sharedBackupRetainUntil],
    );
    await client.query("COMMIT");
    res.status(201).json({ case: createdCase });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/cases", async (req, res): Promise<void> => {
  const companyId = companyIdFromParams(req.params);
  if (!companyId) {
    res.status(400).json({ error: "A valid company UUID is required." });
    return;
  }
  const result = await pool.query(
    `SELECT id, target_company_id, company_name_snapshot,
            shared_backup_retain_until, status, archive_sha256, archive_verified_at,
            receipt_acknowledged_at, created_by_actor_id, created_at, updated_at
     FROM company_offboarding_cases
     WHERE target_company_id = $1
     ORDER BY created_at DESC, id`,
    [companyId],
  );
  res.json({ cases: result.rows });
});

router.get("/cases/:caseId", async (req, res): Promise<void> => {
  const params = CaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Valid company and case UUIDs are required." });
    return;
  }
  const caseResult = await pool.query(
    `SELECT id, target_company_id, company_name_snapshot,
            shared_backup_retain_until, status, archive_sha256, archive_verified_at,
            receipt_acknowledged_at, created_by_actor_id, created_at, updated_at
     FROM company_offboarding_cases
     WHERE target_company_id = $1 AND id = $2`,
    [params.data.id, params.data.caseId],
  );
  const offboardingCase = caseResult.rows[0];
  if (!offboardingCase) {
    res.status(404).json({ error: "Offboarding case not found.", code: "CASE_NOT_FOUND" });
    return;
  }
  const events = await pool.query(
    `SELECT id, event_type, from_status, to_status, actor_id, event_data, created_at
     FROM company_offboarding_case_audit_events
     WHERE case_id = $1
     ORDER BY created_at, id`,
    [params.data.caseId],
  );
  res.json({ case: offboardingCase, auditEvents: events.rows });
});

router.post("/cases/:caseId/acknowledge", async (req, res): Promise<void> => {
  const params = CaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Valid company and case UUIDs are required." });
    return;
  }
  const body = AcknowledgeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await pool.query<{ archive_sha256: string | null; archive_verified_at: string | null }>(
    `SELECT archive_sha256, archive_verified_at
     FROM company_offboarding_cases
     WHERE target_company_id = $1 AND id = $2`,
    [params.data.id, params.data.caseId],
  );
  const archive = result.rows[0];
  if (!archive) {
    res.status(404).json({ error: "Offboarding case not found.", code: "CASE_NOT_FOUND" });
    return;
  }
  if (!archive.archive_sha256 || !archive.archive_verified_at || archive.archive_sha256 !== body.data.archiveSha256) {
    res.status(409).json({
      error: "No matching verified archive is available for receipt acknowledgement.",
      code: "VERIFIED_ARCHIVE_REQUIRED",
    });
    return;
  }

  // There is currently no export/verification integration. Do not treat any
  // manually populated metadata as proof or record a customer receipt.
  res.status(409).json({
    error: "Archive export and verification are not implemented; acknowledgement is unavailable.",
    code: "EXPORT_INTEGRATION_UNAVAILABLE",
  });
});

export default router;