/**
 * A lock/visibility race requires a real COMMIT. Never run these tests against
 * business data: copy schema only, and drop only the database created here.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pool } from "@workspace/db";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const source = new URL(process.env.DATABASE_URL);
const databaseName = `bookie_${randomUUID().replaceAll("-", "")}_amort_test`;
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
try {
  const dump = spawnSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges"], {
    env: postgresEnv(source), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (dump.error || dump.status !== 0) throw new Error("Could not export amortization test schema.");
  await pool.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
  created = true;
  const env = postgresEnv(target);
  const verify = spawnSync("psql", ["-X", "-Atc", "SELECT current_database()"], {
    env, encoding: "utf8",
  });
  if (verify.error || verify.status !== 0 || verify.stdout.trim() !== databaseName) {
    throw new Error("Refused restore: isolated amortization database was not verified.");
  }
  const restore = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
    env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    input: `${/^CREATE SCHEMA public;/m.test(dump.stdout) ? "DROP SCHEMA public CASCADE;\n" : ""}${dump.stdout}`,
  });
  if (restore.error || restore.status !== 0) throw new Error("Could not restore isolated amortization schema.");
  console.log("Amortization tests: verified isolated database, schema only.");
  const result = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.amortization-concurrency.config.ts"], {
    stdio: "inherit",
    timeout: 90_000,
    env: { ...process.env, DATABASE_URL: target.toString(), AMORTIZATION_TEST_DATABASE_NAME: databaseName },
  });
  if (result.error || result.status !== 0) process.exitCode = 1;
} finally {
  try {
    if (created) {
      await pool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      console.log("Amortization tests: removed isolated database.");
    }
  } finally {
    await pool.end();
  }
}
