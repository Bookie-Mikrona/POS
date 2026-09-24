import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool, type PoolClient } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { inspectCompanyOffboardingGraph } from "../lib/companyOffboardingGraph";

const router: IRouter = Router({ mergeParams: true });
const CompanyIdParams = z.object({ id: z.string().uuid() });

router.use(requireAuth, requireSuperAdmin);

router.get("/preflight", async (req, res): Promise<void> => {
  const params = CompanyIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid company UUID is required." });
    return;
  }
  const companyId = params.data.id;

  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    await client.query("SET LOCAL lock_timeout = '1000ms'");

    const { rows: ownerSettings } = await client.query<{ value: string }>(
      `SELECT value FROM "public"."system_settings" WHERE key = $1 LIMIT 1`,
      ["erp_owner_company_id"],
    );
    if (ownerSettings[0]?.value === companyId) {
      res.status(409).json({
        error: "The ERP owner company is protected from offboarding.",
        code: "PROTECTED_ERP_OWNER",
      });
      return;
    }

    const { rows: companies } = await client.query<{ id: string }>(
      `SELECT id FROM "public"."companies" WHERE id = $1 LIMIT 1`,
      [companyId],
    );
    if (!companies.length) {
      res.status(404).json({ error: "Company not found.", code: "COMPANY_NOT_FOUND" });
      return;
    }

    const graph = await inspectCompanyOffboardingGraph(client, companyId, {
      maxSelectedRows: 10_000,
      maxDurationMs: 25_000,
      snapshotConsistent: true,
    });
    await client.query("ROLLBACK");
    transactionOpen = false;
    res.json({
      ...graph,
      eligible: false,
      schemaOnly: true,
      limitations: [
        "Read-only repeatable-read graph inventory only; this endpoint does not export, archive, or delete data.",
        "The inspection is capped at 10,000 selected rows and 25 seconds total, with each SQL statement timing out after five seconds; reaching a limit produces blockers and never indicates deletion readiness.",
        "Unscoped tables and candidate rows without a supported tenant column remain blockers rather than being treated as tenant-owned or global.",
        "Export, archive, storage completeness, and a complete offboarding process are not proven.",
      ],
    });
  } catch {
    if (transactionOpen && client) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch {
        // Release still occurs below; the original inspection error is reported.
      }
    }
    res.status(503).json({
      companyId,
      eligible: false,
      readyForDeletion: false,
      schemaOnly: true,
      blockers: [{
        code: "PREFLIGHT_INSPECTION_FAILED",
        reason: "The read-only company graph inspection could not safely complete.",
      }],
      limitations: [
        "No export, archive, or deletion was performed.",
      ],
      error: "Offboarding preflight could not safely complete.",
    });
  } finally {
    if (client) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the route response while ensuring the client is released.
        }
      }
      client.release();
    }
  }
});

export default router;