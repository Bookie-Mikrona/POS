/**
 * API testi uporabljajo razvojno PostgreSQL bazo. Ročne SQL migracije, ki
 * definirajo integritetne omejitve zunaj Drizzle sheme, zato preverimo pred
 * vsakim zagonom testov, da testna baza ne more neopazno zaostati.
 *
 * Vse naštete migracije morajo ostati varne za ponovno izvajanje.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import {
  buildValidatedTestMigrationPlan,
  testMigrationManifest,
} from "../src/lib/testMigrationManifest";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(scriptsDir, "../../../lib/db/src/migrations");

try {
  const migrationFiles = await Promise.all(
    (await readdir(migrationsDir))
      .filter(file => file.endsWith(".sql"))
      .map(async file => ({ file, content: await readFile(path.join(migrationsDir, file), "utf8") })),
  );
  const migrationPlan = buildValidatedTestMigrationPlan(testMigrationManifest, migrationFiles);

  for (const migration of migrationPlan) {
    const sql = migrationFiles.find(file => file.file === migration.file)!.content;
    await pool.query(sql);
    console.log(`Preverjena testna migracija [${migration.classification}]: ${migration.file}`);
  }
} finally {
  await pool.end();
}
