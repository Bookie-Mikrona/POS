import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pool, type PoolClient } from "@workspace/db";
import {
  buildValidatedTestMigrationPlan,
  legacyMigrationExclusions,
  testMigrationManifest,
} from "../../lib/testMigrationManifest";

const migrationsDir = path.resolve(process.cwd(), "../../lib/db/src/migrations");
const migration167 = readFileSync(
  path.join(migrationsDir, "167-qr-gost-order-feedback.sql"),
  "utf8",
);
const migration169 = readFileSync(
  path.join(migrationsDir, "169-qr-feedback-device-privacy.sql"),
  "utf8",
);
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith(".sql"))
  .map(file => ({
    file,
    content: readFileSync(path.join(migrationsDir, file), "utf8"),
  }));

describe("testni manifest ročnih migracij", () => {
  it("zavrne izključeno migracijo brez razloga", () => {
    const undocumentedExclusion = [
      ...migrationFiles,
      {
        file: "999-undocumented-test-exclusion.sql",
        content: "-- test-bootstrap: excluded\nSELECT 1;\n",
      },
    ];

    expect(() => buildValidatedTestMigrationPlan(testMigrationManifest, undocumentedExclusion))
      .toThrow(
        "Izključena migracija 999-undocumented-test-exclusion.sql nima obveznega razloga v glavi -- test-bootstrap-reason: <reason>",
      );
  });

  it("zavrne izključeno migracijo s praznim razlogom", () => {
    const blankExclusionReason = [
      ...migrationFiles,
      {
        file: "999-blank-test-exclusion-reason.sql",
        content: "-- test-bootstrap: excluded\n-- test-bootstrap-reason: \t  \nSELECT 1;\n",
      },
    ];

    expect(() => buildValidatedTestMigrationPlan(testMigrationManifest, blankExclusionReason))
      .toThrow(
        "Izključena migracija 999-blank-test-exclusion-reason.sql nima obveznega razloga v glavi -- test-bootstrap-reason: <reason>",
      );
  });

  it("zavrne razlog izključitve, ki ni neposredno v glavi", () => {
    const misplacedExclusionReason = [
      ...migrationFiles,
      {
        file: "999-misplaced-test-exclusion-reason.sql",
        content: [
          "-- test-bootstrap: excluded",
          "SELECT 1;",
          "-- test-bootstrap-reason: Ta razlog ni del standardizirane glave.",
          "",
        ].join("\n"),
      },
    ];

    expect(() => buildValidatedTestMigrationPlan(testMigrationManifest, misplacedExclusionReason))
      .toThrow(
        "Izključena migracija 999-misplaced-test-exclusion-reason.sql nima obveznega razloga v glavi -- test-bootstrap-reason: <reason>",
      );
  });

  it("sprejme dokumentirano izključitev, ne da bi jo dodal v izvedbeni plan", () => {
    const excludedFile = "999-documented-test-exclusion.sql";
    const documentedExclusion = [
      ...migrationFiles,
      {
        file: excludedFile,
        content: [
          "-- test-bootstrap: excluded",
          "-- test-bootstrap-reason: Migracija zahteva produkcijsko razširitev, ki v testni bazi ni nameščena.",
          "SELECT 1;",
          "",
        ].join("\n"),
      },
    ];

    const plan = buildValidatedTestMigrationPlan(testMigrationManifest, documentedExclusion);

    expect(plan.map(entry => entry.file)).not.toContain(excludedFile);
  });

  it("zavrne klasificirano migracijo, ki manjka v manifestu", () => {
    const incompleteManifest = testMigrationManifest.filter(
      entry => entry.file !== "169-qr-feedback-device-privacy.sql",
    );

    expect(() => buildValidatedTestMigrationPlan(incompleteManifest, migrationFiles))
      .toThrow("Klasificirana testna migracija manjka v manifestu: 169-qr-feedback-device-privacy.sql");
  });

  it("zavrne nepojasnjeno vrzel med izvedenimi legacy migracijami", () => {
    const incompleteLegacyManifest = testMigrationManifest.filter(
      entry => entry.file !== "060-enforce-pos-integrity-constraints.sql",
    );

    expect(() => buildValidatedTestMigrationPlan(incompleteLegacyManifest, migrationFiles))
      .toThrow(
        "Legacy migracija nima pojasnjenega mesta v inventarju: 060-enforce-pos-integrity-constraints.sql",
      );
  });

  it("zavrne nepojasnjeno vrzel med dokumentirano izključenimi legacy migracijami", () => {
    const incompleteLegacyExclusions = legacyMigrationExclusions.filter(
      entry => entry.file !== "077-prepared-food-correction.sql",
    );

    expect(() => buildValidatedTestMigrationPlan(
      testMigrationManifest,
      migrationFiles,
      incompleteLegacyExclusions,
    )).toThrow(
      "Legacy migracija nima pojasnjenega mesta v inventarju: 077-prepared-food-correction.sql",
    );
  });

  it("inventarizira tudi zgodovinske migracije z underscore imenom", () => {
    const incompleteLegacyExclusions = legacyMigrationExclusions.filter(
      entry => entry.file !== "0009_uvoz_prejemnic.sql",
    );

    expect(() => buildValidatedTestMigrationPlan(
      testMigrationManifest,
      migrationFiles,
      incompleteLegacyExclusions,
    )).toThrow(
      "Legacy migracija nima pojasnjenega mesta v inventarju: 0009_uvoz_prejemnic.sql",
    );
  });

  it("zavrne zasebnostno migracijo, ki je pred svojo odvisnostjo", () => {
    const wrongOrderManifest = [...testMigrationManifest];
    const foundationIndex = wrongOrderManifest.findIndex(
      entry => entry.file === "167-qr-gost-order-feedback.sql",
    );
    const privacyIndex = wrongOrderManifest.findIndex(
      entry => entry.file === "169-qr-feedback-device-privacy.sql",
    );
    [wrongOrderManifest[foundationIndex], wrongOrderManifest[privacyIndex]] = [
      wrongOrderManifest[privacyIndex]!,
      wrongOrderManifest[foundationIndex]!,
    ];

    expect(() => buildValidatedTestMigrationPlan(wrongOrderManifest, migrationFiles))
      .toThrow(
        "Migracija 169-qr-feedback-device-privacy.sql mora biti v manifestu za 167-qr-gost-order-feedback.sql",
      );
  });

  it("trenutni manifest je popoln, klasificiran in pravilno razvrščen", () => {
    const plan = buildValidatedTestMigrationPlan(testMigrationManifest, migrationFiles);
    expect(plan.map(entry => entry.file)).toContain("170-pos-course-name-snapshot.sql");
    expect(plan.map(entry => entry.file)).toContain("239-document-fx-source-type.sql");
  });
});

describe("QR feedback privacy migrations", () => {
  it("ponovni zagon 167 in 169 ne vrne psevdonima ali zastarelega indeksa ter ohrani en feedback na naročilo", async () => {
    const client = await pool.connect();
    const schema = `qr_feedback_privacy_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    const quotedSchema = `"${schema}"`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${quotedSchema}`);
      await client.query(`SET LOCAL search_path TO ${quotedSchema}, public`);
      await client.query(`
        CREATE TABLE enote (id integer PRIMARY KEY);
        CREATE TABLE narocila (id integer PRIMARY KEY);
        INSERT INTO enote (id) VALUES (1);
        INSERT INTO narocila (id) VALUES (10), (11);
      `);

      await client.query(migration167);
      await client.query(`
        INSERT INTO qr_gost_povratne_informacije (
          enota_id, narocilo_id, qr_naprava_id,
          hrana_ocena, ambient_ocena, storitev_ocena,
          ocene_postavk, komentar, consent_version, consented_at
        ) VALUES (
          1, 10, 'legacy-device-pseudonym',
          5, 4, 3,
          '{"123": 5}'::jsonb, 'legacy comment', '1', now()
        )
      `);
      const beforePrivacy = await client.query<{ row: Record<string, unknown> }>(
        "SELECT to_jsonb(feedback) AS row FROM qr_gost_povratne_informacije feedback WHERE narocilo_id = 10",
      );
      expect(beforePrivacy.rows[0]!.row.qr_naprava_id).toBe("legacy-device-pseudonym");

      await client.query(migration169);
      await expectPrivacyState(client, schema);
      await expectUniqueOrderConstraint(client);

      await client.query(migration167);
      await client.query(migration169);
      await expectPrivacyState(client, schema);
      await expectUniqueOrderConstraint(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

async function expectPrivacyState(
  client: PoolClient,
  schema: string,
): Promise<void> {
  const columns = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = 'qr_gost_povratne_informacije'
    ORDER BY ordinal_position
  `, [schema]);
  expect(columns.rows.map(row => row.column_name)).not.toContain("qr_naprava_id");

  const preserved = await client.query<{ row: Record<string, unknown> }>(
    "SELECT to_jsonb(feedback) AS row FROM qr_gost_povratne_informacije feedback WHERE narocilo_id = 10",
  );
  expect(preserved.rows).toHaveLength(1);
  expect(preserved.rows[0]!.row).toMatchObject({
    enota_id: 1,
    narocilo_id: 10,
    hrana_ocena: 5,
    ambient_ocena: 4,
    storitev_ocena: 3,
  });
  expect(preserved.rows[0]!.row).not.toHaveProperty("qr_naprava_id");
  expect(JSON.stringify(preserved.rows[0]!.row)).not.toContain("legacy-device-pseudonym");

  const indexes = await client.query<{ indexname: string }>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = $1
      AND tablename = 'qr_gost_povratne_informacije'
    ORDER BY indexname
  `, [schema]);
  expect(indexes.rows.map(row => row.indexname)).toContain(
    "ux_qr_gost_povratne_informacije_narocilo",
  );
  expect(indexes.rows.map(row => row.indexname)).not.toContain(
    "ix_qr_gost_povratne_informacije_enota_naprava_created",
  );
}

async function expectUniqueOrderConstraint(
  client: PoolClient,
): Promise<void> {
  await client.query("SAVEPOINT qr_feedback_duplicate_check");
  try {
    await client.query(`
      INSERT INTO qr_gost_povratne_informacije (
        enota_id, narocilo_id,
        hrana_ocena, ambient_ocena, storitev_ocena,
        consent_version, consented_at
      ) VALUES (1, 10, 1, 1, 1, '1', now())
    `);
    throw new Error("UNIQUE(narocilo_id) ni zavrnil podvojene ocene");
  } catch (error) {
    expect((error as { code?: string }).code).toBe("23505");
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT qr_feedback_duplicate_check");
    await client.query("RELEASE SAVEPOINT qr_feedback_duplicate_check");
  }
}