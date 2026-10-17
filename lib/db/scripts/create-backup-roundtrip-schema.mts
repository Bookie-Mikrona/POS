// Native ESM avoids drizzle-kit's CommonJS loader for the workspace schema.
// This helper can only initialize the disposable loopback round-trip database.
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import pg from "pg";
import * as schema from "../src/schema/index.ts";
import { is, SQL, sql } from "drizzle-orm";
import { PgDialect, PgTable, getTableConfig } from "drizzle-orm/pg-core";

const target = new URL(process.env.DATABASE_URL ?? "");
if (target.hostname !== "127.0.0.1" || target.pathname !== "/bookie_restore_it"
  || !target.port || target.username !== "postgres") {
  throw new Error("Schema setup requires the isolated bookie_restore_it database.");
}
const client = new pg.Client({ connectionString: target.toString() });
await client.connect();
try {
  // drizzle-kit cannot serialize parameterized SQL defaults. Render literals
  // with the PostgreSQL dialect, without changing the application's schema.
  const dialect = new PgDialect();
  for (const table of Object.values(schema)) {
    if (!is(table, PgTable)) continue;
    for (const column of getTableConfig(table).columns) {
      if (is(column.default, SQL)) {
        column.default = sql.raw(dialect.sqlToQuery(column.default.inlineParams()).sql);
      }
    }
  }
  // Public barrels also expose backwards-compatible aliases of the same table.
  const uniqueSchema = Object.fromEntries(
    [...new Map(Object.entries(schema).map(([key, value]) => [value, [key, value]])).values()],
  );
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(uniqueSchema));
  await client.query("BEGIN");
  // This sequence is intentionally provisioned by a manual SQL migration.
  await client.query("CREATE SEQUENCE pos_normative_change_audit_id_seq AS bigint");
  for (const statement of statements) await client.query(statement);
  await client.query("COMMIT");
} finally {
  await client.end();
}
