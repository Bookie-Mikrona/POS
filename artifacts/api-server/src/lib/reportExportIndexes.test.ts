import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import { reportExportsTable } from "@workspace/db/schema";
import { describe, expect, it } from "vitest";

describe("report export indexes", () => {
  const cases = [
    {
      file: "267-report-export-retention-index.sql",
      name: "report_exports_retention_idx",
      columns: ["exported_at", "id"],
      sqlColumns: "exported_at, id",
    },
    {
      file: "268-report-export-company-history-index.sql",
      name: "report_exports_company_history_idx",
      columns: ["company_id", "exported_at"],
      sqlColumns: "company_id, exported_at",
    },
  ];

  it.each(cases)("keeps $name aligned with single-statement concurrent migration", async ({
    file, name, columns, sqlColumns,
  }) => {
    const indexes = getTableConfig(reportExportsTable).indexes;
    const index = indexes.find(candidate => candidate.config.name === name);
    expect(index?.config.columns.map(column => "name" in column ? column.name : null)).toEqual(columns);
    expect(index?.config.unique).toBe(false);
    const sql = await readFile(fileURLToPath(new URL(
      `../../../../lib/db/src/migrations/${file}`, import.meta.url,
    )), "utf8");
    const statements = sql.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
    // Multiple statements in one pg query become an implicit transaction, which
    // PostgreSQL rejects for CREATE INDEX CONCURRENTLY.
    expect(statements).toHaveLength(1);
    expect(statements[0].replace(/\s+/g, " ")).toBe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON report_exports (${sqlColumns})`,
    );
  });
});
