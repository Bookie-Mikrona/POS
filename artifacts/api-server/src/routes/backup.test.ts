import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getFiles = vi.hoisted(() => vi.fn());

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request & { clerkUserId?: string }, res: express.Response, next: express.NextFunction) => {
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
  requireSuperAdmin: (req: express.Request & { clerkUserId?: string }, res: express.Response, next: express.NextFunction) => {
    if (req.clerkUserId !== "superadmin") {
      res.status(403).json({ error: "Dostop samo za administratorje sistema" });
      return;
    }
    next();
  },
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
  ObjectStorageService: class ObjectStorageService {
    getPrivateObjectDir(): string {
      return "/bookie-private/backups";
    }
    async getObjectEntityFile(): Promise<never> {
      throw new Error("Not used by these tests");
    }
  },
  objectStorageClient: {
    bucket: () => ({ getFiles }),
  },
}));

import backupRouter, {
  type BackupManifest,
  assertBackupCountersRestored,
  assertBackupManifestCompatible,
  assertBackupStructureRestored,
  createBackupHeader,
  isBackupFileName,
  verifyBackupHeader,
} from "./backup";
import { assertSemanticObjectsRestored } from "../lib/backupSemanticManifest";

function makeApp() {
  const app = express();
  app.use(backupRouter);
  return app;
}

describe("backup filename validation", () => {
  it("zavrne tudi pravilno podpisano staro kopijo brez semantičnega manifesta", () => {
    const previous = process.env.BACKUP_SIGNING_KEY;
    process.env.BACKUP_SIGNING_KEY = "legacy-manifest-test";
    try {
      const legacy = {
        version: 1, database: "bookie", serverVersion: "16",
        schemaFingerprint: "a".repeat(64), tables: [], foreignKeys: [], sequences: [],
      } as unknown as BackupManifest;
      const header = createBackupHeader("2026-08-22T10:30:00.000Z", "a".repeat(64), legacy);
      expect(() => verifyBackupHeader(header)).toThrow("starejše kopije");
      expect(() => assertBackupStructureRestored(legacy, legacy)).toThrow("različice 2");
    } finally {
      if (previous === undefined) delete process.env.BACKUP_SIGNING_KEY;
      else process.env.BACKUP_SIGNING_KEY = previous;
    }
  });

  it.each(["indexes", "constraints", "types", "views", "functions", "triggers", "eventTriggers", "rls", "policies", "extensions"])(
    "zazna izgubo, spremembo in dodatek objekta %s",
    (category) => {
      const object = { category, identity: ["public", "example"], properties: { definition: "original" } };
      expect(() => assertSemanticObjectsRestored([object], [])).toThrow(category);
      expect(() => assertSemanticObjectsRestored([], [object])).toThrow(category);
      expect(() => assertSemanticObjectsRestored([object], [{
        ...object, properties: { definition: "changed" },
      }])).toThrow(category);
    },
  );

  it("primerjava ni odvisna od vrstnega reda objektov ali JSON ključev", () => {
    const first = { category: "indexes", identity: ["public", "i"], properties: { a: 1, b: " x  y " } };
    const second = { category: "types", identity: ["public", "t"], properties: { labels: ["a", "b"] } };
    expect(() => assertSemanticObjectsRestored([first, second], [
      second, { ...first, properties: { b: " x  y ", a: 1 } },
    ])).not.toThrow();
    expect(() => assertSemanticObjectsRestored([first], [
      { ...first, properties: { a: 1, b: " x y " } },
    ])).toThrow();
  });

  it("sprejme samo Bookie SQL gzip kopije", () => {
    expect(
      isBackupFileName(
        "bookie-backup-2026-08-22T10-30-00-000Z-5d2e5b0c-541a-4c4e-a2f5-d267326aa3f2.sql.gz",
      ),
    ).toBe(true);
    expect(isBackupFileName("../bookie-backup.sql.gz")).toBe(false);
    expect(isBackupFileName("bookie-backup.json.gz")).toBe(false);
    expect(isBackupFileName("arbitrary.sql.gz")).toBe(false);
  });

  it("zavrne spremenjeno podpisno glavo kopije", () => {
    const previousSigningKey = process.env.BACKUP_SIGNING_KEY;
    process.env.BACKUP_SIGNING_KEY = "test-backup-signing-key";
    try {
      const manifest = {
        version: 2 as const,
        semanticObjects: [],
        database: "bookie",
        serverVersion: "16",
        schemaFingerprint: "a".repeat(64),
        tables: [],
        foreignKeys: [],
        sequences: [],
      };
      const header = createBackupHeader(
        "2026-08-22T10:30:00.000Z",
        "a".repeat(64),
        manifest,
      );
      expect(verifyBackupHeader(header)).toMatchObject({
        headerBytes: Buffer.byteLength(header),
        manifest,
      });
      expect(() =>
        verifyBackupHeader(
          header.replace(
            /manifest-base64: [A-Za-z0-9_-]+/,
            "manifest-base64: invalid",
          ),
        ),
      ).toThrow("Manifest");
    } finally {
      if (previousSigningKey === undefined) delete process.env.BACKUP_SIGNING_KEY;
      else process.env.BACKUP_SIGNING_KEY = previousSigningKey;
    }
  });

  it("prepozna razliko v shemi pred obnovo", () => {
    const base = {
      version: 2 as const,
      semanticObjects: [],
      database: "bookie",
      serverVersion: "16",
      schemaFingerprint: "a".repeat(64),
      tables: [{
        schema: "public",
        name: "companies",
        kind: "r",
        columns: [{ name: "id", type: "uuid", nullable: false }],
        rows: 2,
      }],
      foreignKeys: [],
      sequences: [],
    };
    expect(() => assertBackupManifestCompatible(base, base)).not.toThrow();
    expect(() => assertBackupManifestCompatible(
      base,
      {
        ...base,
        tables: [{
          ...base.tables[0],
          columns: [
            ...base.tables[0].columns,
            { name: "name", type: "text", nullable: true },
          ],
        }],
      },
    )).toThrow("shemo baze");
    expect(() => assertBackupManifestCompatible(
      base,
      { ...base, schemaFingerprint: "b".repeat(64) },
    )).toThrow("celotno shemo");
  });

  it("po obnovi sprejme le tekstovno drugačen fingerprint iste strukture", () => {
    const base = {
      version: 2 as const,
      semanticObjects: [],
      database: "bookie",
      serverVersion: "16",
      schemaFingerprint: "a".repeat(64),
      tables: [{
        schema: "public",
        name: "companies",
        kind: "r",
        columns: [{ name: "id", type: "uuid", nullable: false }],
        rows: 2,
      }],
      foreignKeys: [],
      sequences: [],
    };
    expect(() => assertBackupStructureRestored(
      base,
      { ...base, schemaFingerprint: "b".repeat(64) },
    )).not.toThrow();
    expect(() => assertBackupStructureRestored(
      base,
      {
        ...base,
        schemaFingerprint: "b".repeat(64),
        tables: [{
          ...base.tables[0],
          columns: [
            ...base.tables[0].columns,
            { name: "naziv", type: "text", nullable: false },
          ],
        }],
      },
    )).toThrow("pričakovane strukture");
  });

  it("prepozna zamaknjen števec zaporedja po obnovi", () => {
    const base = {
      version: 2 as const,
      semanticObjects: [],
      database: "bookie",
      serverVersion: "16",
      schemaFingerprint: "a".repeat(64),
      tables: [],
      foreignKeys: [],
      sequences: [{
        schema: "public",
        name: "racuni_id_seq",
        type: "integer",
        lastValue: "42",
      }],
    };
    expect(() => assertBackupCountersRestored(base, base)).not.toThrow();
    expect(() => assertBackupCountersRestored(
      base,
      {
        ...base,
        sequences: [{ ...base.sequences[0], lastValue: "41" }],
      },
    )).toThrow("racuni_id_seq");
  });
});

describe("backup routes", () => {
  beforeEach(() => {
    getFiles.mockReset();
    getFiles.mockResolvedValue([[
      {
        name: "backups/bookie-backups/bookie-backup-2026-08-22T10-30-00-000Z-5d2e5b0c-541a-4c4e-a2f5-d267326aa3f2.sql.gz",
        getMetadata: vi.fn().mockResolvedValue([{ size: "1234", timeCreated: "2026-08-22T10:30:00.000Z" }]),
      },
      {
        name: "backups/bookie-backups/not-a-bookie-backup.sql.gz",
        getMetadata: vi.fn(),
      },
    ]]);
  });

  it("zavrne neprijavljen dostop", async () => {
    const response = await request(makeApp()).get("/backup/seznam");
    expect(response.status).toBe(401);
  });

  it("zavrne navadnega uporabnika", async () => {
    const response = await request(makeApp())
      .get("/backup/seznam")
      .set("x-test-user", "racunovodja");
    expect(response.status).toBe(403);
  });

  it("superadminu prikaže samo veljavne zasebne kopije", async () => {
    const response = await request(makeApp())
      .get("/backup/seznam")
      .set("x-test-user", "superadmin");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storage: "replit-app-storage",
      kopije: [{
        ime: "bookie-backup-2026-08-22T10-30-00-000Z-5d2e5b0c-541a-4c4e-a2f5-d267326aa3f2.sql.gz",
        velikost: 1234,
      }],
    });
    expect(response.body.kopije).toHaveLength(1);
  });

  it("zavrne JSON format in traversal imen datotek", async () => {
    const app = makeApp();
    const createResponse = await request(app)
      .post("/backup/ustvari?format=json")
      .set("x-test-user", "superadmin");
    expect(createResponse.status).toBe(400);

    const downloadResponse = await request(app)
      .get("/backup/../neveljavna.sql.gz/prenesi")
      .set("x-test-user", "superadmin");
    expect(downloadResponse.status).toBe(404);
  });
});