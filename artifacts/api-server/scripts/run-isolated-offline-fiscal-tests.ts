/**
 * Offline reconciliation exercises a global worker and must never use the
 * development/business database. Copy schema ONLY into a newly created,
 * uniquely named database, then remove only that database in finally.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pool } from "@workspace/db";

const allowed = new Set([
  "src/routes/pos/offline-fiscal-sync.native.integration.test.ts",
  "src/routes/pos/offline-fiscal-sync.cloud-offline.integration.test.ts",
]);
const suites = process.argv.slice(2);
if (!suites.length || suites.some(suite => !allowed.has(suite))) {
  throw new Error("Specify only the isolated offline fiscal integration suites.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const source = new URL(process.env.DATABASE_URL);
const databaseName = `bookie_${randomUUID().replaceAll("-", "")}_offline_fiscal_test`;
if (!/^[a-z0-9_]+$/.test(databaseName)) throw new Error("Invalid test database name.");
const target = new URL(source);
target.pathname = `/${databaseName}`;

function postgresEnv(url: URL): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
    PGCONNECT_TIMEOUT: "15",
  };
}

let created = false;
let failed = false;
try {
  // Neither this export nor the restore transfers any business rows.
  const dump = spawnSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges"], {
    env: postgresEnv(source), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (dump.error || dump.status !== 0) throw new Error("Could not export test schema.");
  await pool.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  created = true;
  const targetEnv = postgresEnv(target);
  const verify = spawnSync("psql", ["-X", "-Atc", "SELECT current_database()"], {
    env: targetEnv, encoding: "utf8",
  });
  if (verify.status !== 0 || verify.stdout.trim() !== databaseName) {
    throw new Error("Refused schema restore: isolated database was not verified.");
  }
  const restore = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    env: targetEnv,
    input: `${/^CREATE SCHEMA public;/m.test(dump.stdout) ? "DROP SCHEMA public CASCADE;\n" : ""}${dump.stdout}`,
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (restore.error || restore.status !== 0) throw new Error("Could not restore isolated test schema.");
  console.log("Offline fiscal tests: verified isolated database, schema only.");
  for (const suite of suites) {
    const result = spawnSync("pnpm", ["exec", "vitest", "run", suite], {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: target.toString(),
        OFFLINE_FISCAL_TEST_DATABASE_NAME: databaseName,
      },
    });
    if (result.error || result.status !== 0) {
      failed = true;
      break;
    }
  }
} finally {
  try {
    // Only a database whose CREATE succeeded in THIS invocation can be removed.
    if (created) await pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  } finally {
    await pool.end();
  }
}
if (failed) process.exitCode = 1;