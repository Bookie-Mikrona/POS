import { createHash, createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import {
  companiesTable,
  db,
  enoteTable,
  offlineFiscalDevicesTable,
  pool,
  poslovniProstoriTable,
} from "@workspace/db";
import { requireDeviceSync, deviceSyncSignatureInput } from "./offline-fiscal-sync";

const PATH = "/offline-fiscal/sync/config";
const EMPTY_BODY_HASH = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: wrongPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const keyFingerprintSha256 = createHash("sha256")
  .update(publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");

let companyId: string;
let enotaId: number;
let activeDeviceId: string;
let inactiveDeviceId: string;
let nonProductionDeviceId: string;

function nonce(): string {
  return randomBytes(16).toString("base64url");
}

function signedHeaders(input: {
  deviceId?: string;
  timestamp?: string;
  nonce?: string;
  bodyHash?: string;
  wrongKey?: boolean;
} = {}) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const requestNonce = input.nonce ?? nonce();
  const bodyHash = input.bodyHash ?? EMPTY_BODY_HASH;
  const signer = createSign("RSA-SHA256");
  signer.update(deviceSyncSignatureInput("GET", PATH, timestamp, requestNonce, bodyHash));
  signer.end();
  return {
    "X-Bookie-Device-Id": input.deviceId ?? activeDeviceId,
    "X-Bookie-Timestamp": timestamp,
    "X-Bookie-Nonce": requestNonce,
    "X-Bookie-Body-SHA256": bodyHash,
    "X-Bookie-Signature": signer.sign(input.wrongKey ? wrongPrivateKey : privateKey).toString("base64"),
  };
}

const app = express();
app.get(PATH, requireDeviceSync, (req, res) => {
  res.json({
    companyId: (req as any).companyId,
    enotaId: (req as any).enotaId,
    clerkUserId: (req as any).clerkUserId,
    deviceSyncDeviceId: (req as any).deviceSyncDeviceId,
    vloga: (req as any).vloga,
  });
});

beforeAll(async () => {
  const runId = randomUUID();
  const [company] = await db.insert(companiesTable).values({
    naziv: `Offline device sync HTTP ${runId}`,
    podjetjeDavcna: `D${runId.replace(/-/g, "").slice(0, 8)}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId,
    ime: `Offline sync HTTP ${runId}`,
  }).returning({ id: enoteTable.id });
  enotaId = unit!.id;
  const [premise] = await db.insert(poslovniProstoriTable).values({
    enotaId,
    prostorId: `P${runId.slice(0, 8)}`,
  }).returning({ id: poslovniProstoriTable.id });

  activeDeviceId = randomUUID();
  inactiveDeviceId = randomUUID();
  nonProductionDeviceId = randomUUID();
  const common = {
    enotaId,
    poslovniProstorId: premise!.id,
    platform: "android" as const,
    publicKeyPem,
    keyFingerprintSha256,
    expectedFursCertFingerprint: "a".repeat(64),
    contractVersion: "furs-v2",
    goldenAttestationSha256: "b".repeat(64),
  };
  await db.insert(offlineFiscalDevicesTable).values([
    {
      ...common,
      id: activeDeviceId,
      bIdentifier: `ACTIVE-${runId}`,
      status: "active",
      productionEnabled: true,
      activatedAt: new Date(),
    },
    {
      ...common,
      id: inactiveDeviceId,
      bIdentifier: `REVOKED-${runId}`,
      status: "revoked",
      productionEnabled: true,
      revokedAt: new Date(),
    },
    {
      ...common,
      id: nonProductionDeviceId,
      bIdentifier: `NONPROD-${runId}`,
      status: "active",
      productionEnabled: false,
      activatedAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe("offline fiskalni device-sync na HTTP meji", () => {
  it("zavrne napačen hash telesa", async () => {
    const response = await supertest(app).get(PATH).set(signedHeaders({
      bodyHash: "0".repeat(64),
    }));
    expect(response.status).toBe(400);
  });

  it("zavrne podpis z drugim zasebnim ključem", async () => {
    const response = await supertest(app).get(PATH).set(signedHeaders({ wrongKey: true }));
    expect(response.status).toBe(403);
  });

  it("zavrne timestamp zunaj petminutnega okna", async () => {
    const expired = new Date(Date.now() - 301_000).toISOString();
    const response = await supertest(app).get(PATH).set(signedHeaders({ timestamp: expired }));
    expect(response.status).toBe(401);
  });

  it.each([
    ["neaktivna", () => inactiveDeviceId],
    ["neprodukcijska", () => nonProductionDeviceId],
  ])("zavrne %s napravo", async (_label, getDeviceId) => {
    const response = await supertest(app).get(PATH).set(signedHeaders({
      deviceId: getDeviceId(),
    }));
    expect(response.status).toBe(403);
  });

  it("brez Clerk seje nastavi DB identiteto in isti nonce sprejme samo enkrat", async () => {
    const headers = signedHeaders();
    const first = await supertest(app).get(PATH).set(headers);
    expect(first.status, first.body).toBe(200);
    expect(first.body).toEqual({
      companyId,
      enotaId,
      clerkUserId: `device:${activeDeviceId}`,
      deviceSyncDeviceId: activeDeviceId,
      vloga: "device",
    });

    const replay = await supertest(app).get(PATH).set(headers);
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ code: "SYNC_REPLAY" });
  });
});