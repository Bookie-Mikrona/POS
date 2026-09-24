import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * These integration suites exercise a global worker against PostgreSQL. Require
 * an explicitly provisioned, dedicated database before allowing any fixture writes.
 */
export async function assertOfflineFiscalIsolatedTestDatabase(): Promise<void> {
  const expectedDatabaseName = process.env.OFFLINE_FISCAL_TEST_DATABASE_NAME?.trim();
  if (!expectedDatabaseName || !/offline[-_]fiscal[-_]test$/i.test(expectedDatabaseName)) {
    throw new Error(
      "Offline fiscal integration tests require OFFLINE_FISCAL_TEST_DATABASE_NAME naming a dedicated *offline_fiscal_test database.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Offline fiscal integration tests require DATABASE_URL to target the isolated test database.");
  }

  let urlDatabaseName: string;
  try {
    urlDatabaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
  } catch {
    throw new Error("Offline fiscal integration tests could not verify the DATABASE_URL database name.");
  }
  if (urlDatabaseName !== expectedDatabaseName) {
    throw new Error(
      `Offline fiscal integration tests refused DATABASE_URL database "${urlDatabaseName}"; expected isolated database "${expectedDatabaseName}".`,
    );
  }

  const result = await db.execute(sql`SELECT current_database() AS database_name`);
  const actualDatabaseName = result.rows[0]?.database_name;
  if (actualDatabaseName !== expectedDatabaseName) {
    throw new Error(
      `Offline fiscal integration tests refused connected database "${String(actualDatabaseName)}"; expected isolated database "${expectedDatabaseName}".`,
    );
  }
}