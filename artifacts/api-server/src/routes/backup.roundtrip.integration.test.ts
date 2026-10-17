import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { Readable, Writable } from "node:stream";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const storageObjects = vi.hoisted(() => new Map<string, Buffer>());
const failNextSelectOne = vi.hoisted(() => ({ value: false }));
const loseNextIndex = vi.hoisted(() => ({ value: false }));
const routeErrors = vi.hoisted(() => [] as unknown[]);

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: express.Request & { clerkUserId?: string },
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const user = req.header("x-test-user");
    if (!user) {
      res.status(401).json({ error: "Neprijavljeni dostop ni dovoljen" });
      return;
    }
    req.clerkUserId = user;
    next();
  },
}));

vi.mock("../middlewares/requireSuperAdmin", () => ({
  requireSuperAdmin: (
    req: express.Request & { clerkUserId?: string },
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (req.clerkUserId !== "superadmin") {
      res.status(403).json({ error: "Dostop samo za administratorje sistema" });
      return;
    }
    next();
  },
}));

vi.mock("../lib/objectStorage", () => {
  class FakeObjectNotFoundError extends Error {}

  class FakeFile {
    constructor(private readonly name: string) {}

    createWriteStream(): Writable {
      const chunks: Buffer[] = [];
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      destination.on("finish", () => {
        storageObjects.set(this.name, Buffer.concat(chunks));
      });
      return destination;
    }

    createReadStream(): Readable {
      const content = storageObjects.get(this.name);
      if (!content) throw new FakeObjectNotFoundError();
      return Readable.from(content);
    }

    async getMetadata(): Promise<[{ size: string; timeCreated: string }]> {
      const content = storageObjects.get(this.name);
      if (!content) throw new FakeObjectNotFoundError();
      return [{
        size: String(content.length),
        timeCreated: "2026-09-01T00:00:00.000Z",
      }];
    }

    async delete(): Promise<void> {
      if (!storageObjects.delete(this.name)) throw new FakeObjectNotFoundError();
    }
  }

  const fileFor = (name: string) => new FakeFile(name);
  return {
    ObjectNotFoundError: FakeObjectNotFoundError,
    ObjectStorageService: class ObjectStorageService {
      getPrivateObjectDir(): string {
        return "/bookie-private";
      }

      async getObjectEntityFile(path: string): Promise<FakeFile> {
        return fileFor(path.replace(/^\/objects\//, ""));
      }
    },
    objectStorageClient: {
      bucket: (bucketName: string) => ({
        file: (name: string) => fileFor(`${bucketName}/${name}`),
        getFiles: async ({ prefix }: { prefix: string }) => [[
          ...Array.from(storageObjects.entries())
            .filter(([name]) => name.startsWith(`${bucketName}/${prefix}`))
            .map(([name]) => ({
              name: name,
              getMetadata: async () => [{
                size: String(storageObjects.get(name)?.length ?? 0),
                timeCreated: "2026-09-01T00:00:00.000Z",
              }],
            })),
        ]],
      }),
    },
  };
});

type IsolatedPostgres = {
  directory: string;
  port: number;
  databaseUrl: string;
};

function runBinary(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} se je zaključil z napako: ${stderr.trim()}`));
      }
    });
  });
}

function runBinaryOutput(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
      } else {
        reject(new Error(
          `${command} se je zaključil z napako: ${Buffer.concat(stderr).toString("utf8").trim()}`,
        ));
      }
    });
  });
}

function normalizedSchemaLines(dump: string): string[] {
  return dump.split(/\r?\n/).filter((line) => (
    line.trim() &&
    !line.startsWith("--") &&
    !line.startsWith("\\restrict ") &&
    !line.startsWith("\\unrestrict ")
  ));
}

function firstSchemaDifference(before: string, after: string): string {
  const beforeLines = normalizedSchemaLines(before);
  const afterLines = normalizedSchemaLines(after);
  const length = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      return JSON.stringify({
        line: index + 1,
        before: beforeLines[index],
        after: afterLines[index],
      });
    }
  }
  return "brez tekstovne razlike";
}

async function schemaDump(databaseUrl: string): Promise<string> {
  return runBinaryOutput("pg_dump", [
    "--dbname", databaseUrl,
    "--format=plain",
    "--schema-only",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
  ]);
}

async function unusedTcpPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Ni bilo mogoče rezervirati lokalnega PostgreSQL porta.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function startIsolatedPostgres(): Promise<IsolatedPostgres> {
  const directory = await mkdtemp(join(tmpdir(), "bookie-backup-roundtrip-"));
  const port = await unusedTcpPort();
  const dataDirectory = join(directory, "data");
  const logPath = join(directory, "postgres.log");
  const databaseName = "bookie_restore_it";
  let serverStarted = false;

  try {
    await runBinary("initdb", [
      "--no-locale",
      "--encoding=UTF8",
      "--auth=trust",
      "--username=postgres",
      dataDirectory,
    ]);
    await runBinary("pg_ctl", [
      "--pgdata", dataDirectory,
      "--log", logPath,
      "--options", `-h 127.0.0.1 -p ${port} -k ${directory}`,
      "--wait",
      "start",
    ]);
    serverStarted = true;

    await runBinary("createdb", [
      "--host", "127.0.0.1",
      "--port", String(port),
      "--username", "postgres",
      databaseName,
    ]);

    return {
      directory,
      port,
      databaseUrl: `postgresql://postgres@127.0.0.1:${port}/${databaseName}`,
    };
  } catch (error) {
    const postgresLog = await readFile(logPath, "utf8").catch(() => "");
    if (serverStarted) {
      await runBinary("pg_ctl", [
        "--pgdata", dataDirectory,
        "--wait",
        "stop",
      ]).catch(() => undefined);
    }
    await rm(directory, { recursive: true, force: true });
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${
        postgresLog ? `\nPostgreSQL log:\n${postgresLog}` : ""
      }`,
    );
  }
}

function assertIsolatedDatabaseTarget(cluster: IsolatedPostgres): void {
  const target = new URL(cluster.databaseUrl);
  const databaseName = target.pathname.replace(/^\//, "");
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== String(cluster.port) ||
    databaseName !== "bookie_restore_it"
  ) {
    throw new Error(
      "Round-trip test sme uporabljati samo lokalno izolirano bazo bookie_restore_it.",
    );
  }
}

async function stopIsolatedPostgres(cluster: IsolatedPostgres): Promise<void> {
  try {
    await runBinary("pg_ctl", [
      "--pgdata", join(cluster.directory, "data"),
      "--wait",
      "stop",
    ]);
  } finally {
    await rm(cluster.directory, { recursive: true, force: true });
  }
}

const seedSql = `
  INSERT INTO companies (id, podjetje_davcna, naziv) VALUES
    ('11111111-1111-4111-8111-111111111111', 'SI11111111', 'Podjetje Ena'),
    ('22222222-2222-4222-8222-222222222222', 'SI22222222', 'Podjetje Dva');

  INSERT INTO enote (company_id, ime) VALUES
    ('11111111-1111-4111-8111-111111111111', 'POS Enota Ena'),
    ('22222222-2222-4222-8222-222222222222', 'POS Enota Dva');

  INSERT INTO narocila (enota_id)
    SELECT id FROM enote ORDER BY id;

  INSERT INTO racuni (
    enota_id, narocilo_id, stevilka_racuna, skupaj, ddv, placilna_nacin
  )
    SELECT
      enote.id,
      narocila.id,
      CASE WHEN companies.id = '11111111-1111-4111-8111-111111111111'
        THEN 'POS-001' ELSE 'POS-002' END,
      CASE WHEN companies.id = '11111111-1111-4111-8111-111111111111'
        THEN 12.50 ELSE 48.00 END,
      CASE WHEN companies.id = '11111111-1111-4111-8111-111111111111'
        THEN 1.09 ELSE 4.18 END,
      'gotovina'
    FROM enote
    JOIN companies ON companies.id = enote.company_id
    JOIN narocila ON narocila.enota_id = enote.id;

  INSERT INTO accounting_periods (id, company_id, name, start_date, end_date) VALUES
    ('11111111-aaaa-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Leto 2026 A', '2026-01-01', '2026-12-31'),
    ('22222222-aaaa-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Leto 2026 B', '2026-01-01', '2026-12-31');

  INSERT INTO accounts (id, company_id, code, name, type) VALUES
    ('11111111-bbbb-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '1000', 'Blagajna A', 'asset'),
    ('11111111-cccc-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '7000', 'Prihodki A', 'revenue'),
    ('22222222-bbbb-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '1000', 'Blagajna B', 'asset'),
    ('22222222-cccc-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '7000', 'Prihodki B', 'revenue');

  INSERT INTO journal_entries (
    id, company_id, period_id, entry_date, description, created_by
  ) VALUES
    ('11111111-dddd-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', '11111111-aaaa-4111-8111-111111111111', '2026-08-31', 'POS promet A', 'backup-test'),
    ('22222222-dddd-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', '22222222-aaaa-4222-8222-222222222222', '2026-08-31', 'POS promet B', 'backup-test');

  INSERT INTO journal_entry_lines (id, entry_id, account_id, side, amount, sequence) VALUES
    ('11111111-eeee-4111-8111-111111111111', '11111111-dddd-4111-8111-111111111111', '11111111-bbbb-4111-8111-111111111111', 'debit', 12.50, 1),
    ('11111111-ffff-4111-8111-111111111111', '11111111-dddd-4111-8111-111111111111', '11111111-cccc-4111-8111-111111111111', 'credit', 12.50, 2),
    ('22222222-eeee-4222-8222-222222222222', '22222222-dddd-4222-8222-222222222222', '22222222-bbbb-4222-8222-222222222222', 'debit', 48.00, 1),
    ('22222222-ffff-4222-8222-222222222222', '22222222-dddd-4222-8222-222222222222', '22222222-cccc-4222-8222-222222222222', 'credit', 48.00, 2);

  INSERT INTO system_settings (key, value) VALUES
    ('erp_owner_company_id', '11111111-1111-4111-8111-111111111111'),
    ('backup_secondary_company_id', '22222222-2222-4222-8222-222222222222');
`;

type TestPool = {
  query: (queryText: string, values?: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
  end: () => Promise<void>;
};

async function tableSnapshot(testPool: TestPool): Promise<unknown> {
  const result = await testPool.query(`
    SELECT
      (SELECT json_agg(t ORDER BY t.id) FROM (
        SELECT id, podjetje_davcna, naziv FROM companies
      ) t) AS companies,
      (SELECT json_agg(t ORDER BY t.id) FROM (
        SELECT id, company_id, ime FROM enote
      ) t) AS enote,
      (SELECT json_agg(t ORDER BY t.id) FROM (
        SELECT id, enota_id, status FROM narocila
      ) t) AS narocila,
      (SELECT json_agg(t ORDER BY t.id) FROM (
        SELECT id, enota_id, narocilo_id, stevilka_racuna, skupaj, ddv
        FROM racuni
      ) t) AS racuni,
      (SELECT json_agg(t ORDER BY t.id) FROM (
        SELECT id, company_id, period_id, entry_date, description
        FROM journal_entries
      ) t) AS journal_entries,
      (SELECT json_agg(t ORDER BY t.id) FROM (
        SELECT id, entry_id, account_id, side, amount, sequence
        FROM journal_entry_lines
      ) t) AS journal_entry_lines,
      (SELECT json_agg(t ORDER BY t.key) FROM (
        SELECT key, value FROM system_settings
      ) t) AS system_settings
  `);
  return result.rows[0];
}

async function sequenceSnapshot(testPool: TestPool): Promise<unknown> {
  const result = await testPool.query(`
    SELECT sequencename, last_value::text AS last_value
    FROM pg_sequences
    WHERE schemaname = 'public'
    ORDER BY sequencename
  `);
  return result.rows;
}

describe("izolirani backup restore round-trip", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSigningKey = process.env.BACKUP_SIGNING_KEY;
  let cluster: IsolatedPostgres;
  let testPool: TestPool;
  let routePool: TestPool;
  let app: express.Express;
  let backupRouter: typeof import("./backup").default;

  beforeAll(async () => {
    cluster = await startIsolatedPostgres();
    assertIsolatedDatabaseTarget(cluster);
    process.env.DATABASE_URL = cluster.databaseUrl;
    process.env.BACKUP_SIGNING_KEY = "isolated-roundtrip-test-key";

    const libDbDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../lib/db",
    );
    await runBinary(
      "node",
      ["--import", "tsx", join(libDbDirectory, "scripts/create-backup-roundtrip-schema.mts")],
      { ...process.env, DATABASE_URL: cluster.databaseUrl },
    );

    ({ default: backupRouter } = await import("./backup"));
    const dbModule = await import("@workspace/db");
    routePool = dbModule.pool as unknown as TestPool;
    testPool = routePool;
    const identity = await testPool.query(`
      SELECT
        current_database() AS database,
        host(inet_server_addr()) AS server_address,
        current_setting('port') AS server_port
    `);
    expect(identity.rows[0]).toEqual({
      database: "bookie_restore_it",
      server_address: "127.0.0.1",
      server_port: String(cluster.port),
    });
    await testPool.query(seedSql);
    await testPool.query(`
      CREATE TYPE backup_test_mood AS ENUM ('new', 'done');
      CREATE DOMAIN backup_test_positive AS integer CHECK (VALUE > 0);
      CREATE TABLE backup_semantic_fixture (
        id integer PRIMARY KEY, label varchar(30),
        amount backup_test_positive, mood backup_test_mood,
        CONSTRAINT backup_fixture_check CHECK (label IN ('one', 'two'))
      );
      CREATE INDEX backup_fixture_index ON backup_semantic_fixture (label);
      CREATE FUNCTION backup_fixture_trigger_fn() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER backup_fixture_trigger BEFORE INSERT ON backup_semantic_fixture
        FOR EACH ROW EXECUTE FUNCTION backup_fixture_trigger_fn();
      CREATE VIEW backup_fixture_view AS SELECT id, label FROM backup_semantic_fixture;
      ALTER TABLE backup_semantic_fixture ENABLE ROW LEVEL SECURITY;
      CREATE POLICY backup_fixture_policy ON backup_semantic_fixture USING (id > 0);
    `);

    app = express();
    app.use((req, _res, next) => {
      (req as unknown as { log: unknown }).log = {
        info() {},
        warn() {},
        error(details: unknown) {
          if (details && typeof details === "object" && "err" in details) {
            const error = (details as { err?: unknown }).err;
            routeErrors.push({
              ...(details as Record<string, unknown>),
              err: error instanceof Error ? error.message : error,
            });
            return;
          }
          routeErrors.push(details);
        },
      };
      next();
    });
    app.use(backupRouter);
  }, 60_000);

  afterAll(async () => {
    try {
      if (routePool) await routePool.end();
    } finally {
      try {
        if (cluster) await stopIsolatedPostgres(cluster);
      } finally {
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
        if (originalSigningKey === undefined) delete process.env.BACKUP_SIGNING_KEY;
        else process.env.BACKUP_SIGNING_KEY = originalSigningKey;
      }
    }
  });

  it("obnovi dve podjetji z vsemi podatki in sekvencami ter po napaki povrne zaščitno kopijo", async () => {
    storageObjects.clear();
    routeErrors.length = 0;
    const initialSchema = await schemaDump(cluster.databaseUrl);
    const initialData = await tableSnapshot(testPool);
    const initialSequences = await sequenceSnapshot(testPool);

    const createResponse = await request(app)
      .post("/backup/ustvari")
      .set("x-test-user", "superadmin");
    expect(createResponse.status, JSON.stringify(routeErrors)).toBe(201);
    const backupName = createResponse.body.kopija.ime as string;
    const backupObject = Array.from(storageObjects.entries())
      .find(([name]) => name.endsWith(`/bookie-backups/${backupName}`))?.[1];
    expect(backupObject).toBeInstanceOf(Buffer);

    await testPool.query(`
      UPDATE companies
        SET naziv = 'Spremenjeno podjetje'
        WHERE id = '11111111-1111-4111-8111-111111111111';
      WITH nova_enota AS (
        INSERT INTO enote (company_id, ime)
        VALUES ('11111111-1111-4111-8111-111111111111', 'Začasna enota')
        RETURNING id
      ), novo_narocilo AS (
        INSERT INTO narocila (enota_id)
        SELECT id FROM nova_enota
        RETURNING id, enota_id
      )
      INSERT INTO racuni (
        enota_id, narocilo_id, stevilka_racuna, skupaj, ddv, placilna_nacin
      )
      SELECT enota_id, id, 'POS-003', 99.99, 9.08, 'gotovina'
      FROM novo_narocilo;
      UPDATE journal_entries
        SET description = 'Nepričakovana knjižba'
        WHERE id = '11111111-dddd-4111-8111-111111111111';
      INSERT INTO system_settings (key, value)
        VALUES ('temporary_flag', 'changed');
    `);
    expect(await tableSnapshot(testPool)).not.toEqual(initialData);

    const restoreResponse = await request(app)
      .post("/backup/obnovi")
      .set("x-test-user", "superadmin")
      .attach("backup", backupObject as Buffer, {
        filename: backupName,
        contentType: "application/gzip",
      });
    const schemaAfterRestore = restoreResponse.status === 200
      ? initialSchema
      : await schemaDump(cluster.databaseUrl);
    expect(
      restoreResponse.status,
      `${JSON.stringify(routeErrors, null, 2)}\nSchema diff: ${
        firstSchemaDifference(initialSchema, schemaAfterRestore)
      }`,
    ).toBe(200);
    expect(restoreResponse.body.uspeh).toBe(true);
    expect(restoreResponse.body.predObnovo.ime).toMatch(/^bookie-backup-/);
    expect(await tableSnapshot(testPool)).toEqual(initialData);
    expect(await sequenceSnapshot(testPool)).toEqual(initialSequences);

    const rollbackSourceResponse = await request(app)
      .post("/backup/ustvari")
      .set("x-test-user", "superadmin");
    expect(rollbackSourceResponse.status).toBe(201);
    const rollbackSourceName = rollbackSourceResponse.body.kopija.ime as string;
    const rollbackSourceObject = Array.from(storageObjects.entries())
      .find(([name]) => name.endsWith(`/bookie-backups/${rollbackSourceName}`))?.[1];
    expect(rollbackSourceObject).toBeInstanceOf(Buffer);

    await testPool.query(
      `UPDATE companies
       SET naziv = 'Stanje pred neuspelim restoreom'
       WHERE id = '11111111-1111-4111-8111-111111111111'`,
    );
    const safetySnapshot = await tableSnapshot(testPool);
    const safetySequences = await sequenceSnapshot(testPool);

    const originalQuery = routePool.query.bind(routePool);
    const mutablePool = routePool as unknown as {
      query: (...args: unknown[]) => Promise<unknown>;
    };
    mutablePool.query = (...args: unknown[]) => {
      const queryText = typeof args[0] === "string" ? args[0] : "";
      if (failNextSelectOne.value && queryText === "SELECT 1") {
        failNextSelectOne.value = false;
        return Promise.reject(new Error("simulirana napaka preverjanja po obnovi"));
      }
      if (loseNextIndex.value && queryText === "SELECT 1") {
        loseNextIndex.value = false;
        return originalQuery("DROP INDEX backup_fixture_index").then(() => originalQuery("SELECT 1"));
      }
      return (originalQuery as (...queryArgs: unknown[]) => Promise<unknown>)(...args);
    };
    failNextSelectOne.value = true;

    const failedRestoreResponse = await request(app)
      .post("/backup/obnovi")
      .set("x-test-user", "superadmin")
      .attach("backup", rollbackSourceObject as Buffer, {
        filename: rollbackSourceName,
        contentType: "application/gzip",
      });
    expect(failedRestoreResponse.status).toBe(500);
    expect(failedRestoreResponse.body.error).toContain("zaščitno kopijo");
    expect(await tableSnapshot(testPool)).toEqual(safetySnapshot);
    expect(await sequenceSnapshot(testPool)).toEqual(safetySequences);

    // Simulate an object lost immediately after SQL restore, not a mocked
    // manifest response: the real catalog validator must initiate recovery.
    loseNextIndex.value = true;
    const missingIndexResponse = await request(app)
      .post("/backup/obnovi")
      .set("x-test-user", "superadmin")
      .attach("backup", rollbackSourceObject as Buffer, {
        filename: rollbackSourceName,
        contentType: "application/gzip",
      });
    expect(missingIndexResponse.status).toBe(500);
    expect(JSON.stringify(routeErrors)).toContain("backup_fixture_index");
    expect(await tableSnapshot(testPool)).toEqual(safetySnapshot);
    expect(await sequenceSnapshot(testPool)).toEqual(safetySequences);
    expect((await testPool.query("SELECT to_regclass('backup_fixture_index') AS name")).rows[0].name)
      .toBe("backup_fixture_index");
  }, 120_000);

  it("po resnični obnovi zazna izgubljen indeks, CHECK in sprožilec ter spremembe ostalih objektov", async () => {
    const { readSemanticObjects, assertSemanticObjectsRestored } =
      await import("../lib/backupSemanticManifest");
    const expected = await readSemanticObjects();
    expect(expected.map((object) => object.category)).toEqual(
      [...expected.map((object) => object.category)].sort(),
    );
    for (const category of ["indexes", "constraints", "types", "views", "functions", "triggers", "rls", "policies", "extensions"]) {
      expect(expected.some((object) => object.category === category), category).toBe(true);
    }
    const directory = await mkdtemp(join(tmpdir(), "bookie-semantic-test-"));
    const dumpPath = join(directory, "snapshot.sql");
    try {
      await runBinary("pg_dump", [
        "--dbname", cluster.databaseUrl, "--clean", "--if-exists",
        "--no-owner", "--no-privileges", "--file", dumpPath,
      ]);
      await runBinary("psql", [
        "--dbname", cluster.databaseUrl, "--single-transaction",
        "--set", "ON_ERROR_STOP=1", "--file", dumpPath,
      ]);
      assertSemanticObjectsRestored(expected, await readSemanticObjects());
      // Explicit cast relocation is the historical pg_dump/restore regression.
      await testPool.query(`ALTER TABLE backup_semantic_fixture DROP CONSTRAINT backup_fixture_check;
        ALTER TABLE backup_semantic_fixture ADD CONSTRAINT backup_fixture_check
          CHECK (label::text = ANY (ARRAY['one', 'two']::varchar[]::text[]));`);
      assertSemanticObjectsRestored(expected, await readSemanticObjects());
      const cases = [
        ["indexes", "DROP INDEX backup_fixture_index",
          "CREATE INDEX backup_fixture_index ON backup_semantic_fixture (label)"],
        ["constraints", "ALTER TABLE backup_semantic_fixture DROP CONSTRAINT backup_fixture_check",
          "ALTER TABLE backup_semantic_fixture ADD CONSTRAINT backup_fixture_check CHECK (label IN ('one', 'two'))"],
        ["triggers", "DROP TRIGGER backup_fixture_trigger ON backup_semantic_fixture",
          "CREATE TRIGGER backup_fixture_trigger BEFORE INSERT ON backup_semantic_fixture FOR EACH ROW EXECUTE FUNCTION backup_fixture_trigger_fn()"],
        ["constraints", "ALTER TABLE backup_semantic_fixture DROP CONSTRAINT backup_fixture_check; ALTER TABLE backup_semantic_fixture ADD CONSTRAINT backup_fixture_check CHECK (label IN ('one', 'three'))",
          "ALTER TABLE backup_semantic_fixture DROP CONSTRAINT backup_fixture_check; ALTER TABLE backup_semantic_fixture ADD CONSTRAINT backup_fixture_check CHECK (label IN ('one', 'two'))"],
        ["functions", "CREATE OR REPLACE FUNCTION backup_fixture_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$",
          "CREATE OR REPLACE FUNCTION backup_fixture_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"],
        ["views", "CREATE OR REPLACE VIEW backup_fixture_view AS SELECT id, label FROM backup_semantic_fixture WHERE id > 0",
          "CREATE OR REPLACE VIEW backup_fixture_view AS SELECT id, label FROM backup_semantic_fixture"],
        ["rls", "ALTER TABLE backup_semantic_fixture DISABLE ROW LEVEL SECURITY",
          "ALTER TABLE backup_semantic_fixture ENABLE ROW LEVEL SECURITY"],
        ["policies", "ALTER POLICY backup_fixture_policy ON backup_semantic_fixture USING (id > 1)",
          "ALTER POLICY backup_fixture_policy ON backup_semantic_fixture USING (id > 0)"],
      ];
      for (const [category, change, repair] of cases) {
        await testPool.query(change);
        try {
          const actual = await readSemanticObjects();
          expect(() => assertSemanticObjectsRestored(expected, actual), change).toThrow(category);
        } finally {
          await testPool.query(repair);
        }
      }
      assertSemanticObjectsRestored(expected, await readSemanticObjects());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});