import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, pool, companiesTable, systemSettingsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";

const router: IRouter = Router({ mergeParams: true });
const CompanyIdParams = z.object({ id: z.string().uuid() });

type TableColumnRow = { table_name: string; column_name: string };
type ForeignKeyRow = {
  table_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

router.use(requireAuth, requireSuperAdmin);

router.get("/preflight", async (req, res): Promise<void> => {
  const params = CompanyIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "A valid company UUID is required." });
    return;
  }
  const companyId = params.data.id;

  const [ownerSetting] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "erp_owner_company_id"))
    .limit(1);
  if (ownerSetting?.value === companyId) {
    res.status(409).json({
      error: "The ERP owner company is protected from offboarding.",
      code: "PROTECTED_ERP_OWNER",
    });
    return;
  }

  const [company] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) {
    res.status(404).json({ error: "Company not found.", code: "COMPANY_NOT_FOUND" });
    return;
  }

  try {
    const { rows: columnRows } = await pool.query<TableColumnRow>(
      `SELECT c.table_name, c.column_name
       FROM information_schema.tables t
       JOIN information_schema.columns c
         ON c.table_schema = t.table_schema AND c.table_name = t.table_name
       WHERE t.table_schema = 'public'
         AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name, c.ordinal_position`,
    );
    const { rows: foreignKeyRows } = await pool.query<ForeignKeyRow>(
      `SELECT child.relname AS table_name,
              child_column.attname AS column_name,
              parent.relname AS referenced_table,
              parent_column.attname AS referenced_column
       FROM pg_constraint constraint_row
       JOIN pg_class child ON child.oid = constraint_row.conrelid
       JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
       JOIN pg_class parent ON parent.oid = constraint_row.confrelid
       JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
         AS child_key(attnum, ordinal) ON TRUE
       JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY
         AS parent_key(attnum, ordinal) ON parent_key.ordinal = child_key.ordinal
       JOIN pg_attribute child_column
         ON child_column.attrelid = child.oid AND child_column.attnum = child_key.attnum
       JOIN pg_attribute parent_column
         ON parent_column.attrelid = parent.oid AND parent_column.attnum = parent_key.attnum
       WHERE constraint_row.contype = 'f'
         AND child_schema.nspname = 'public'
       ORDER BY child.relname, child_column.attname`,
    );

    const tableColumns = new Map<string, Set<string>>();
    for (const row of columnRows) {
      const columns = tableColumns.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      tableColumns.set(row.table_name, columns);
    }

    const directCompanyTables = [...tableColumns.entries()]
      .filter(([, columns]) => columns.has("company_id") || columns.has("companyId"))
      .map(([table]) => table)
      .sort();

    const tableInventory = await Promise.all(
      directCompanyTables.map(async (table) => {
        const companyColumn = tableColumns.get(table)!.has("company_id") ? "company_id" : "companyId";
        const countQuery = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "public".${quoteIdentifier(table)} WHERE ${quoteIdentifier(companyColumn)} = $1`,
          [companyId],
        );
        return { table, rowCount: Number(countQuery.rows[0]?.count ?? 0) };
      }),
    );

    const blockers = [...tableColumns.keys()]
      .filter((table) => !directCompanyTables.includes(table))
      .sort()
      .map((table) => ({
        code: "TENANT_SCOPE_UNPROVEN",
        table,
        reason: "No direct companyId column identifies this table's tenant ownership.",
      }));

    res.json({
      companyId,
      eligible: false,
      readyForDeletion: false,
      schemaOnly: true,
      blockers,
      inventory: { directlyCompanyScopedTables: tableInventory },
      foreignKeys: foreignKeyRows.map((foreignKey) => ({
        table: foreignKey.table_name,
        column: foreignKey.column_name,
        referencesTable: foreignKey.referenced_table,
        referencesColumn: foreignKey.referenced_column,
      })),
      limitations: [
        "Read-only schema and row-count inspection only; this endpoint does not export, archive, or delete data.",
        "Tables without a direct companyId column remain blockers even when foreign-key relationships exist.",
        "This schema-only preflight never marks a company eligible or ready for deletion; export, archive, and storage completeness are not proven.",
      ],
    });
  } catch {
    res.status(503).json({
      companyId,
      eligible: false,
      readyForDeletion: false,
      schemaOnly: true,
      blockers: [{
        code: "PREFLIGHT_INSPECTION_FAILED",
        reason: "Database schema or tenant row inventory could not be inspected.",
      }],
      limitations: [
        "This schema-only preflight never marks a company eligible or ready for deletion; export, archive, and storage completeness are not proven.",
      ],
      error: "Offboarding preflight could not safely complete.",
    });
  }
});

export default router;