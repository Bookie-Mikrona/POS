/**
 * Varnostne kopije celotne Bookie PostgreSQL baze.
 *
 * Kopije so PostgreSQL plain-SQL dumpi, stisnjeni z gzip in shranjeni v
 * zasebnem Replit App Storage. Zaradi formata jih lahko superadmin tudi prenese
 * ter kasneje uporabi za obnovitev iste Bookie instance.
 */
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import multer from "multer";
import { Router, type IRouter, type Request, type Response } from "express";

import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import {
  acquireBackupLock,
  acquireRestoreLock,
  drainApplicationDatabaseWriters,
  isDatabaseRestoreInProgress,
} from "../lib/databaseRestoreGuard";
import {
  ObjectNotFoundError,
  ObjectStorageService,
  objectStorageClient,
} from "../lib/objectStorage";

const router: IRouter = Router();
const superAdminStack = [requireAuth, requireSuperAdmin] as const;
const objectStorage = new ObjectStorageService();

const BACKUP_DIRECTORY = "bookie-backups";
const MAX_BACKUP_BYTES = Number.parseInt(
  process.env.BACKUP_MAX_BYTES ?? String(512 * 1024 * 1024),
  10,
);
const MAX_RESTORE_SQL_BYTES = Number.parseInt(
  process.env.BACKUP_MAX_RESTORE_SQL_BYTES ?? String(MAX_BACKUP_BYTES),
  10,
);
const DUMP_MARKER = "PostgreSQL database dump";
const BOOKIE_DUMP_MARKER = "-- Bookie backup format: 1";
const BACKUP_MANIFEST_MARKER = "-- Bookie backup manifest-base64: ";
const MAX_BACKUP_HEADER_BYTES = 4 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1_000;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tmpdir()),
    filename: (_req, _file, callback) =>
      callback(null, `bookie-restore-${randomUUID()}.upload`),
  }),
  limits: { fileSize: MAX_BACKUP_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase();
    callback(
      null,
      name.endsWith(".sql") || name.endsWith(".sql.gz"),
    );
  },
});

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isBackupFileName(name: string): boolean {
  return (
    basename(name) === name &&
    /^bookie-backup-[0-9A-Za-z-]+-[0-9a-f-]{36}\.sql\.gz$/i.test(name)
  );
}

function splitStoragePath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const parts = normalized.split("/");
  const bucketName = parts[1];
  const objectName = parts.slice(2).join("/");
  if (!bucketName || !objectName) {
    throw new Error("Neveljavna konfiguracija zasebnega App Storage prostora.");
  }
  return { bucketName, objectName };
}

function backupStoragePrefix(): { bucketName: string; objectPrefix: string } {
  const privateDir = objectStorage.getPrivateObjectDir().replace(/\/+$/, "");
  const { bucketName, objectName } = splitStoragePath(
    `${privateDir}/${BACKUP_DIRECTORY}`,
  );
  return { bucketName, objectPrefix: `${objectName}/` };
}

function backupObjectPath(fileName: string): string {
  return `/objects/${BACKUP_DIRECTORY}/${fileName}`;
}

async function readPrefix(filePath: string, length: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath: string, start = 0): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath, { start })) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function schemaFingerprintFromDump(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let inCopyData = false;

  for await (const line of lines) {
    if (inCopyData) {
      if (line === "\\.") inCopyData = false;
      continue;
    }
    if (line.startsWith("COPY ") && line.endsWith(" FROM stdin;")) {
      inCopyData = true;
      continue;
    }
    if (
      line.startsWith("--") ||
      line.startsWith("\\restrict ") ||
      line.startsWith("\\unrestrict ") ||
      line.startsWith("SELECT pg_catalog.setval(")
    ) {
      continue;
    }
    const normalizedLine = line.trimEnd();
    if (!normalizedLine) continue;
    hash.update(normalizedLine);
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function sequenceValuesFromDump(filePath: string): Promise<Map<string, string | null>> {
  const values = new Map<string, string | null>();
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const match = line.match(
      /^SELECT pg_catalog\.setval\('([^']+)', ([^,]+), (true|false)\);$/,
    );
    if (!match) continue;
    const [, relation, value, isCalled] = match;
    values.set(relation.replace(/"/g, ""), isCalled === "false" ? null : value);
  }
  return values;
}

function getBackupSigningKey(): Buffer {
  const rootSecret =
    process.env.BACKUP_SIGNING_KEY ??
    process.env.SESSION_SECRET ??
    process.env.BIZBOX_ENC_KEY;
  if (!rootSecret) {
    throw new Error("Za podpis varnostnih kopij manjka trajna strežniška skrivnost.");
  }
  return createHmac("sha256", rootSecret)
    .update("bookie-backup-signing-key-v1")
    .digest();
}

export type BackupManifest = {
  version: 1;
  database: string;
  serverVersion: string;
  schemaFingerprint: string;
  tables: Array<{
    schema: string;
    name: string;
    kind: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
    rows: number;
  }>;
  foreignKeys: Array<{ schema: string; table: string; name: string; definition: string }>;
  sequences: Array<{
    schema: string;
    name: string;
    type: string;
    lastValue: string | null;
  }>;
};

function manifestBase64(manifest: BackupManifest): string {
  return Buffer.from(JSON.stringify(manifest), "utf8").toString("base64url");
}

function parseManifestBase64(encoded: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Manifest varnostne kopije ni veljaven JSON.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { schemaFingerprint?: unknown }).schemaFingerprint !== "string" ||
    !Array.isArray((parsed as { tables?: unknown }).tables) ||
    !Array.isArray((parsed as { foreignKeys?: unknown }).foreignKeys) ||
    !Array.isArray((parsed as { sequences?: unknown }).sequences)
  ) {
    throw new Error("Manifest varnostne kopije je nepopoln ali nezdružljiv.");
  }
  return parsed as BackupManifest;
}

function signBackupPayload(
  createdAt: string,
  payloadSha256: string,
  manifestSha256: string,
): string {
  return createHmac("sha256", getBackupSigningKey())
    .update(`bookie-backup-v1|${createdAt}|${payloadSha256}|${manifestSha256}`)
    .digest("hex");
}

function createBackupHeader(
  createdAt: string,
  payloadSha256: string,
  manifest: BackupManifest = {
    version: 1,
    database: "",
    serverVersion: "",
    schemaFingerprint: "",
    tables: [],
    foreignKeys: [],
    sequences: [],
  },
): string {
  const encodedManifest = manifestBase64(manifest);
  const manifestSha256 = createHash("sha256").update(encodedManifest).digest("hex");
  const signature = signBackupPayload(createdAt, payloadSha256, manifestSha256);
  return [
    BOOKIE_DUMP_MARKER,
    `-- Bookie backup created-at: ${createdAt}`,
    `-- Bookie backup payload-sha256: ${payloadSha256}`,
    `${BACKUP_MANIFEST_MARKER}${encodedManifest}`,
    `-- Bookie backup manifest-sha256: ${manifestSha256}`,
    `-- Bookie backup signature: ${signature}`,
    "",
    "",
  ].join("\n");
}

function verifyBackupHeader(preview: string): {
  headerBytes: number;
  payloadSha256: string;
  manifest: BackupManifest;
} {
  const match = preview.match(
    /^-- Bookie backup format: 1\n-- Bookie backup created-at: ([^\n]+)\n-- Bookie backup payload-sha256: ([a-f0-9]{64})\n-- Bookie backup manifest-base64: ([A-Za-z0-9_-]+)\n-- Bookie backup manifest-sha256: ([a-f0-9]{64})\n-- Bookie backup signature: ([a-f0-9]{64})\n\n/,
  );
  if (!match) {
    throw new Error("Datoteka nima veljavne Bookie podpisne glave.");
  }

  const [, createdAt, payloadSha256, encodedManifest, manifestSha256, signature] = match;
  const actualManifestSha256 = createHash("sha256").update(encodedManifest).digest("hex");
  if (actualManifestSha256 !== manifestSha256) {
    throw new Error("Manifest varnostne kopije se ne ujema s svojim kontrolnim seštevkom.");
  }
  const manifest = parseManifestBase64(encodedManifest);
  const expected = Buffer.from(
    signBackupPayload(createdAt, payloadSha256, manifestSha256),
    "hex",
  );
  const supplied = Buffer.from(signature, "hex");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("Podpis varnostne kopije ni veljaven.");
  }
  return {
    headerBytes: Buffer.byteLength(match[0], "utf8"),
    payloadSha256,
    manifest,
  };
}

function limitOutputSize(maxBytes: number): Transform {
  let written = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      if (written > maxBytes) {
        callback(
          new Error(
            `Razširjena SQL kopija presega dovoljeno velikost ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

function postgresEnvironment(): NodeJS.ProcessEnv {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ni nastavljen.");
  }

  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, "");
  if (!database) {
    throw new Error("DATABASE_URL ne vsebuje imena baze.");
  }

  return {
    ...process.env,
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(database),
    PGSSLMODE: url.searchParams.get("sslmode") ?? process.env.PGSSLMODE,
  };
}

async function runPostgresCommand(
  command: "pg_dump" | "psql",
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: postgresEnvironment(),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, PROCESS_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          timedOut
            ? `${command} je presegel dovoljeni čas izvajanja.`
            : `${command} se je zaključil z napako${stderr ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

async function currentSchemaFingerprint(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bookie-backup-schema-"));
  const schemaPath = join(directory, "schema.sql");
  try {
    await runPostgresCommand("pg_dump", [
      "--format=plain",
      "--schema-only",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--file",
      schemaPath,
    ]);
    return await schemaFingerprintFromDump(schemaPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readBackupManifest(options: {
  schemaFingerprint?: string;
  sequenceValues?: Map<string, string | null>;
} = {}): Promise<BackupManifest> {
  const [databaseResult, tablesResult, columnsResult, foreignKeysResult, sequencesResult] =
    await Promise.all([
      pool.query<{ database: string; server_version: string }>(
        "SELECT current_database() AS database, current_setting('server_version') AS server_version",
      ),
      pool.query<{
        schema: string;
        name: string;
        kind: string;
        rows: string;
      }>(`
        SELECT
          n.nspname AS schema,
          c.relname AS name,
          c.relkind AS kind,
          COALESCE(s.n_live_tup, 0)::text AS rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s
          ON s.schemaname = n.nspname AND s.relname = c.relname
        WHERE n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'p')
        ORDER BY n.nspname, c.relname
      `),
      pool.query<{
        schema: string;
        table: string;
        name: string;
        type: string;
        nullable: boolean;
      }>(`
        SELECT
          n.nspname AS schema,
          c.relname AS table,
          a.attname AS name,
          format_type(a.atttypid, a.atttypmod) AS type,
          NOT a.attnotnull AS nullable
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attnum > 0
          AND NOT a.attisdropped
          AND n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'p')
        ORDER BY n.nspname, c.relname, a.attnum
      `),
      pool.query<{
        schema: string;
        table: string;
        name: string;
        definition: string;
      }>(`
        SELECT
          n.nspname AS schema,
          c.relname AS table,
          con.conname AS name,
          pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'f'
          AND n.nspname NOT LIKE 'pg_%'
          AND n.nspname <> 'information_schema'
        ORDER BY n.nspname, c.relname, con.conname
      `),
      pool.query<{
        schema: string;
        name: string;
        type: string;
        last_value: string | null;
      }>(`
        SELECT
          schemaname AS schema,
          sequencename AS name,
          data_type AS type,
          last_value::text AS last_value
        FROM pg_sequences
        WHERE schemaname NOT LIKE 'pg_%'
          AND schemaname <> 'information_schema'
        ORDER BY schemaname, sequencename
      `),
    ]);

  const columnsByTable = new Map<string, BackupManifest["tables"][number]["columns"]>();
  for (const column of columnsResult.rows) {
    const key = `${column.schema}.${column.table}`;
    const columns = columnsByTable.get(key) ?? [];
    columns.push({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
    });
    columnsByTable.set(key, columns);
  }

  const database = databaseResult.rows[0];
  if (!database) throw new Error("Ni bilo mogoče prebrati metapodatkov PostgreSQL baze.");

  return {
    version: 1,
    database: database.database,
    serverVersion: database.server_version,
    schemaFingerprint:
      options.schemaFingerprint ?? await currentSchemaFingerprint(),
    tables: tablesResult.rows.map((table) => ({
      schema: table.schema,
      name: table.name,
      kind: table.kind,
      columns: columnsByTable.get(`${table.schema}.${table.name}`) ?? [],
      rows: Math.max(0, Number.parseInt(table.rows, 10) || 0),
    })),
    foreignKeys: foreignKeysResult.rows.map((key) => ({
      schema: key.schema,
      table: key.table,
      name: key.name,
      definition: key.definition,
    })),
    sequences: sequencesResult.rows.map((sequence) => {
      const key = `${sequence.schema}.${sequence.name}`;
      return {
        schema: sequence.schema,
        name: sequence.name,
        type: sequence.type,
        lastValue: options.sequenceValues?.has(key)
          ? options.sequenceValues.get(key) ?? null
          : sequence.last_value,
      };
    }),
  };
}

function structuralManifest(manifest: BackupManifest) {
  return {
    tables: manifest.tables.map(({ schema, name, kind, columns }) => ({
      schema,
      name,
      kind,
      columns,
    })),
    foreignKeys: manifest.foreignKeys,
    sequences: manifest.sequences.map(({ schema, name, type }) => ({
      schema,
      name,
      type,
    })),
  };
}

export function assertBackupManifestCompatible(
  backup: BackupManifest,
  current: BackupManifest,
): void {
  const backupMajor = backup.serverVersion.match(/\d+/)?.[0];
  const currentMajor = current.serverVersion.match(/\d+/)?.[0];
  if (
    backup.database !== current.database ||
    backupMajor !== currentMajor ||
    backup.schemaFingerprint !== current.schemaFingerprint
  ) {
    throw new Error(
      "Varnostna kopija ni združljiva s trenutno bazo ali njeno celotno shemo.",
    );
  }
  if (
    JSON.stringify(structuralManifest(backup)) !==
    JSON.stringify(structuralManifest(current))
  ) {
    throw new Error(
      "Varnostna kopija ni združljiva s trenutno shemo baze (tabele, stolpci, relacije ali sekvence se razlikujejo).",
    );
  }
}

/**
 * Po uspešnem atomarnem psql restore-u PostgreSQL lahko semantično enak DDL
 * izpiše drugače (npr. prerazporedi ekvivalentne caste v CHECK izrazih).
 * Surov schema fingerprint zato ostane stroga varovalka pred začetkom obnove,
 * po obnovi pa preverimo stabilni strukturni del podpisanega manifesta.
 */
export function assertBackupStructureRestored(
  backup: BackupManifest,
  restored: BackupManifest,
): void {
  const backupMajor = backup.serverVersion.match(/\d+/)?.[0];
  const restoredMajor = restored.serverVersion.match(/\d+/)?.[0];
  if (
    backup.database !== restored.database ||
    backupMajor !== restoredMajor ||
    JSON.stringify(structuralManifest(backup)) !==
      JSON.stringify(structuralManifest(restored))
  ) {
    throw new Error(
      "Obnovljena baza nima pričakovane strukture (tabele, stolpci, relacije ali sekvence se razlikujejo).",
    );
  }
}

export function assertBackupCountersRestored(
  backup: BackupManifest,
  restored: BackupManifest,
): void {
  const restoredSequences = new Map(
    restored.sequences.map((sequence) => [
      `${sequence.schema}.${sequence.name}`,
      sequence.lastValue,
    ]),
  );
  for (const sequence of backup.sequences) {
    const key = `${sequence.schema}.${sequence.name}`;
    if (restoredSequences.get(key) !== sequence.lastValue) {
      throw new Error(
        `Zaporedje ${key} po obnovi nima pričakovanega števca.`,
      );
    }
  }
}

async function uploadBackupFile(
  localPath: string,
  fileName: string,
): Promise<{ size: number; createdAt: string }> {
  const { bucketName, objectPrefix } = backupStoragePrefix();
  const file = objectStorageClient.bucket(bucketName).file(`${objectPrefix}${fileName}`);
  const fileStats = await stat(localPath);

  await new Promise<void>((resolve, reject) => {
    const destination = file.createWriteStream({
      resumable: false,
      metadata: {
        contentType: "application/gzip",
        contentDisposition: `attachment; filename="${fileName}"`,
        cacheControl: "private, no-store",
      },
    });
    destination.on("finish", resolve);
    destination.on("error", reject);
    createReadStream(localPath).on("error", reject).pipe(destination);
  });

  return { size: fileStats.size, createdAt: new Date().toISOString() };
}

async function createBackupArchive(
  reason: "manual" | "pre-restore" = "manual",
  options: { retainLocal?: boolean } = {},
): Promise<{
  ime: string;
  velikost: number;
  ustvarjen: string;
  localPath?: string;
  temporaryDirectory?: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "bookie-backup-"));
  const rawSqlPath = join(directory, "pg_dump.sql");
  const schemaPath = join(directory, "schema.sql");
  const sqlPath = join(directory, "bookie-backup.sql");
  const gzipPath = `${sqlPath}.gz`;
  const fileName = `bookie-backup-${timestampForFileName()}-${randomUUID()}.sql.gz`;

  try {
    await runPostgresCommand("pg_dump", [
      "--format=plain",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--file",
      rawSqlPath,
    ]);

    await runPostgresCommand("pg_dump", [
      "--format=plain",
      "--schema-only",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--file",
      schemaPath,
    ]);

    const [schemaFingerprint, sequenceValues] = await Promise.all([
      schemaFingerprintFromDump(schemaPath),
      sequenceValuesFromDump(rawSqlPath),
    ]);
    const manifest = await readBackupManifest({
      schemaFingerprint,
      sequenceValues,
    });
    const createdAt = new Date().toISOString();
    const payloadSha256 = await hashFile(rawSqlPath);
    await writeFile(sqlPath, createBackupHeader(createdAt, payloadSha256, manifest));
    await pipeline(createReadStream(rawSqlPath), createWriteStream(sqlPath, { flags: "a" }));
    await pipeline(createReadStream(sqlPath), createGzip({ level: 9 }), createWriteStream(gzipPath));
    const uploaded = await uploadBackupFile(gzipPath, fileName);
    return {
      ime: fileName,
      velikost: uploaded.size,
      ustvarjen: uploaded.createdAt,
      ...(options.retainLocal
        ? { localPath: gzipPath, temporaryDirectory: directory }
        : {}),
    };
  } catch (error) {
    throw new Error(
      `Ustvarjanje ${reason === "pre-restore" ? "zaščitne " : ""}kopije ni uspelo: ${
        error instanceof Error ? error.message : "neznana napaka"
      }`,
    );
  } finally {
    if (!options.retainLocal) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function materializeAndValidateDump(
  uploadedPath: string,
  originalName: string,
  options: { checkCompatibility?: boolean } = {},
): Promise<{ directory: string; sqlPath: string; manifest: BackupManifest }> {
  const directory = await mkdtemp(join(tmpdir(), "bookie-restore-"));
  const sqlPath = join(directory, "restore.sql");
  const uploadedPrefix = await readPrefix(uploadedPath, 2);
  const shouldGunzip =
    originalName.toLowerCase().endsWith(".gz") ||
    uploadedPrefix.equals(Buffer.from([0x1f, 0x8b]));

  try {
    if (shouldGunzip) {
      await pipeline(
        createReadStream(uploadedPath),
        createGunzip(),
        limitOutputSize(MAX_RESTORE_SQL_BYTES),
        createWriteStream(sqlPath),
      );
    } else {
      await pipeline(
        createReadStream(uploadedPath),
        limitOutputSize(MAX_RESTORE_SQL_BYTES),
        createWriteStream(sqlPath),
      );
    }

    const preview = (await readPrefix(sqlPath, MAX_BACKUP_HEADER_BYTES)).toString("utf8");
    if (!preview.includes(DUMP_MARKER)) {
      throw new Error("Datoteka ni preverjena PostgreSQL Bookie kopija.");
    }
    const { headerBytes, payloadSha256, manifest } = verifyBackupHeader(preview);
    const actualPayloadSha256 = await hashFile(sqlPath, headerBytes);
    if (actualPayloadSha256 !== payloadSha256) {
      throw new Error("Vsebina varnostne kopije se ne ujema z njenim podpisom.");
    }
    if (options.checkCompatibility !== false) {
      assertBackupManifestCompatible(manifest, await readBackupManifest());
    }
    return { directory, sqlPath, manifest };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function listBackups(): Promise<Array<{ ime: string; velikost: number; ustvarjen: string }>> {
  const { bucketName, objectPrefix } = backupStoragePrefix();
  const [files] = await objectStorageClient.bucket(bucketName).getFiles({ prefix: objectPrefix });

  const backups = await Promise.all(
    files
      .map((file) => ({ file, name: file.name.slice(objectPrefix.length) }))
      .filter(({ name }) => isBackupFileName(name))
      .map(async ({ file, name }) => {
        const [metadata] = await file.getMetadata();
        return {
          ime: name,
          velikost: Number(metadata.size ?? 0),
          ustvarjen: String(metadata.timeCreated ?? metadata.updated ?? new Date(0).toISOString()),
        };
      }),
  );

  return backups.sort(
    (left, right) => new Date(right.ustvarjen).getTime() - new Date(left.ustvarjen).getTime(),
  );
}

// GET /backup/seznam
router.get("/backup/seznam", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  try {
    const kopije = await listBackups();
    res.json({ kopije, storage: "replit-app-storage" });
  } catch (error) {
    req.log.error({ err: error }, "Reading backup list failed");
    res.status(500).json({ error: "Seznama varnostnih kopij ni bilo mogoče prebrati." });
  }
});

// POST /backup/ustvari?format=sql
router.post("/backup/ustvari", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const format = typeof req.query.format === "string" ? req.query.format : "sql";
  if (format !== "sql") {
    res.status(400).json({
      error: "Na voljo je samo popolna SQL kopija, ker edina zanesljivo shrani celotno bazo.",
    });
    return;
  }
  if (await isDatabaseRestoreInProgress()) {
    res.status(409).json({ error: "Obnova baze je v teku. Kopije trenutno ni mogoče ustvariti." });
    return;
  }
  const releaseBackupLock = await acquireBackupLock();
  if (!releaseBackupLock) {
    res.status(409).json({ error: "V teku je že druga varnostna kopija ali obnova baze." });
    return;
  }

  try {
    const kopija = await createBackupArchive();
    req.log.info({ fileName: kopija.ime, size: kopija.velikost }, "Database backup created");
    res.status(201).json({ kopija });
  } catch (error) {
    req.log.error({ err: error }, "Database backup failed");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Ustvarjanje kopije ni uspelo.",
    });
  } finally {
    await releaseBackupLock();
  }
});

// GET /backup/:ime/prenesi
router.get("/backup/:ime/prenesi", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const ime = getParam(req.params.ime);
  if (!isBackupFileName(ime)) {
    res.status(400).json({ error: "Neveljavno ime varnostne kopije." });
    return;
  }

  try {
    const file = await objectStorage.getObjectEntityFile(backupObjectPath(ime));
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${ime}"`);
    res.setHeader("Cache-Control", "private, no-store");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    file.createReadStream()
      .on("error", (error) => {
        req.log.error({ err: error, fileName: ime }, "Backup download stream failed");
        if (!res.headersSent) res.status(500).json({ error: "Prenos kopije ni uspel." });
        else res.destroy(error);
      })
      .pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Varnostna kopija ni bila najdena." });
      return;
    }
    req.log.error({ err: error, fileName: ime }, "Backup download failed");
    res.status(500).json({ error: "Prenos kopije ni uspel." });
  }
});

// DELETE /backup/:ime
router.delete("/backup/:ime", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const ime = getParam(req.params.ime);
  if (!isBackupFileName(ime)) {
    res.status(400).json({ error: "Neveljavno ime varnostne kopije." });
    return;
  }

  try {
    const file = await objectStorage.getObjectEntityFile(backupObjectPath(ime));
    await file.delete();
    req.log.info({ fileName: ime }, "Database backup deleted");
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Varnostna kopija ni bila najdena." });
      return;
    }
    req.log.error({ err: error, fileName: ime }, "Backup deletion failed");
    res.status(500).json({ error: "Brisanje kopije ni uspelo." });
  }
});

// POST /backup/obnovi
router.post(
  "/backup/obnovi",
  ...superAdminStack,
  upload.fields([
    { name: "backup", maxCount: 1 },
    { name: "datoteka", maxCount: 1 },
  ]),
  async (req: Request, res: Response): Promise<void> => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const file = files?.backup?.[0] ?? files?.datoteka?.[0];
    if (!file) {
      res.status(400).json({ error: "Izberite SQL (.sql ali .sql.gz) varnostno kopijo." });
      return;
    }
    const releaseRestoreLock = await acquireRestoreLock();
    if (!releaseRestoreLock) {
      res.status(409).json({ error: "Obnova baze je že v teku." });
      await rm(file.path, { force: true });
      return;
    }
    const releaseBackupLock = await acquireBackupLock();
    if (!releaseBackupLock) {
      await releaseRestoreLock();
      res.status(409).json({ error: "V teku je že druga varnostna kopija. Obnovo poskusite znova po njenem zaključku." });
      await rm(file.path, { force: true });
      return;
    }

    let restoreDirectory: string | undefined;
    let safetyRestoreDirectory: string | undefined;
    let predObnovo:
      | Awaited<ReturnType<typeof createBackupArchive>>
      | undefined;
    let restoreApplied = false;
    let backupValidated = false;
    try {
      const materialized = await materializeAndValidateDump(file.path, file.originalname);
      restoreDirectory = materialized.directory;
      backupValidated = true;
      await drainApplicationDatabaseWriters();
      predObnovo = await createBackupArchive("pre-restore", { retainLocal: true });

      await runPostgresCommand("psql", [
        "--set",
        "ON_ERROR_STOP=1",
        "--single-transaction",
        "--file",
        materialized.sqlPath,
      ]);
      restoreApplied = true;
      await pool.query("SELECT 1");
      const restoredManifest = await readBackupManifest();
      assertBackupStructureRestored(materialized.manifest, restoredManifest);
      assertBackupCountersRestored(materialized.manifest, restoredManifest);

      req.log.warn(
        { restoredFileName: file.originalname, safetyBackup: predObnovo.ime },
        "Database restored from backup",
      );
      res.json({
        uspeh: true,
        predObnovo: {
          ime: predObnovo.ime,
          velikost: predObnovo.velikost,
          ustvarjen: predObnovo.ustvarjen,
        },
        sporocilo: "Baza je bila obnovljena. Pred obnovitvijo je nastala zaščitna kopija.",
      });
    } catch (error) {
      if (restoreApplied && predObnovo?.localPath) {
        try {
          const safety = await materializeAndValidateDump(
            predObnovo.localPath,
            predObnovo.ime,
            { checkCompatibility: false },
          );
          safetyRestoreDirectory = safety.directory;
          await runPostgresCommand("psql", [
            "--set",
            "ON_ERROR_STOP=1",
            "--single-transaction",
            "--file",
            safety.sqlPath,
          ]);
          await pool.query("SELECT 1");
          const recoveredManifest = await readBackupManifest();
          assertBackupStructureRestored(safety.manifest, recoveredManifest);
          assertBackupCountersRestored(safety.manifest, recoveredManifest);
          req.log.warn(
            { safetyBackup: predObnovo.ime },
            "Database restore rolled back to safety backup",
          );
        } catch (rollbackError) {
          req.log.error(
            { err: rollbackError, safetyBackup: predObnovo.ime },
            "Database restore rollback failed",
          );
        }
      }
      req.log.error({ err: error, fileName: file.originalname }, "Database restore failed");
      res.status(backupValidated ? 500 : 422).json({
        error: backupValidated
          ? "Obnova baze ni bila izvedena ali dokončana. Preverite dnevnik in uporabite zaščitno kopijo, če je bila ustvarjena."
          : error instanceof Error
            ? error.message
            : "Nalaganje ali preverjanje kopije ni uspelo.",
      });
    } finally {
      await releaseBackupLock();
      await releaseRestoreLock();
      await rm(file.path, { force: true });
      if (restoreDirectory) await rm(restoreDirectory, { recursive: true, force: true });
      if (safetyRestoreDirectory) {
        await rm(safetyRestoreDirectory, { recursive: true, force: true });
      }
      if (predObnovo?.temporaryDirectory) {
        await rm(predObnovo.temporaryDirectory, { recursive: true, force: true });
      }
    }
  },
);

router.use(
  (error: unknown, req: Request, res: Response, _next: (error?: unknown) => void): void => {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? `Datoteka je prevelika (največ ${Math.floor(MAX_BACKUP_BYTES / 1024 / 1024)} MB).`
          : "Nalaganje varnostne kopije ni uspelo.";
      res.status(400).json({ error: message });
      return;
    }
    req.log.error({ err: error }, "Backup upload failed");
    res.status(400).json({ error: "Nalaganje varnostne kopije ni uspelo." });
  },
);

export { createBackupHeader, isBackupFileName, verifyBackupHeader };
export default router;