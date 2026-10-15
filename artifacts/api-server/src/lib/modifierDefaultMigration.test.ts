import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { buildValidatedTestMigrationPlan, testMigrationManifest } from "./testMigrationManifest";

const migrationsDir = path.resolve(__dirname, "../../../../lib/db/src/migrations");

describe("modifier defaults test bootstrap safety", () => {
  it("validates the migration inventory without replaying business settings", async () => {
    const files = await Promise.all(
      (await readdir(migrationsDir)).filter(file => file.endsWith(".sql"))
        .map(async file => ({ file, content: await readFile(path.join(migrationsDir, file), "utf8") })),
    );
    const plan = buildValidatedTestMigrationPlan(testMigrationManifest, files);
    expect(plan.some(entry => entry.file === "256-modifikator-privzet.sql")).toBe(false);
    expect(plan.find(entry => entry.file === "257-modifikator-privzet-schema.sql"))
      .toMatchObject({ classification: "schema" });
  });

  it("only adds a missing column, without writing any existing defaults or groups", async () => {
    const file = await readFile(path.join(migrationsDir, "257-modifikator-privzet-schema.sql"), "utf8");
    const statements = file.replace(/^--.*$/gm, "").trim();
    expect(statements).toMatch(/^ALTER TABLE modifikatorji\s+ADD COLUMN IF NOT EXISTS privzet boolean NOT NULL DEFAULT false;$/);
    expect(statements).not.toMatch(/\b(UPDATE|INSERT|DELETE|DROP|TRUNCATE)\b/i);
  });
});
