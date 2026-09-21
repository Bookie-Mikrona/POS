import { createHash, createVerify, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  db, enoteTable, offlineDeviceSyncNoncesTable, offlineFiscalDevicesTable,
  offlineGatewayEventsTable,
  offlineGatewaySyncReviewsTable,
  offlineGatewaySyncCheckpointsTable,
  offlineFiscalReceiptsTable, offlineProvisioningBundlesTable, poslovniProstoriTable,
} from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";
import { ingestOfflineReceipt } from "./offline-fiscal";
import { createProvisioningBundle } from "../../services/pos/offline-provisioning";

const router = Router();
export const gatewayReviewRouter = Router();
const MAX_BODY_BYTES = 65536;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

export type GatewayEventBatch = {
  fromSeq: number;
  toSeq: number;
  events: Array<Record<string, unknown>>;
};

export function validateGatewayEventBatch(input: unknown): GatewayEventBatch {
  const body = input as { fromSeq?: unknown; toSeq?: unknown; events?: unknown };
  const fromSeq = Number(body?.fromSeq), toSeq = Number(body?.toSeq);
  const events = Array.isArray(body?.events) ? body.events as Array<Record<string, unknown>> : [];
  if (!Number.isSafeInteger(fromSeq) || !Number.isSafeInteger(toSeq) ||
      fromSeq < 1 || events.length < 1 || events.length > 200 ||
      toSeq !== fromSeq + events.length - 1 ||
      events.some((event, index) => !Number.isSafeInteger(Number(event.seq)) ||
        Number(event.seq) !== fromSeq + index ||
        typeof event.operationId !== "string" || typeof event.eventType !== "string" ||
        !/^[a-f0-9]{64}$/.test(String(event.payloadHash)) ||
        event.payload == null ||
        createHash("sha256").update(canonicalJson(event.payload)).digest("hex") !== String(event.payloadHash)) ||
      new Set(events.map(event => Number(event.seq))).size !== events.length ||
      new Set(events.map(event => String(event.operationId))).size !== events.length) {
    throw new Error("Neveljaven gateway event batch.");
  }
  return { fromSeq, toSeq, events };
}

export function gatewayEventConflict(
  existing: { gatewaySeq: number; operationId: string; payloadHash: string },
  incoming: { seq: number; operationId: string; payloadHash: string },
): boolean {
  return existing.payloadHash !== incoming.payloadHash ||
    existing.gatewaySeq !== incoming.seq || existing.operationId !== incoming.operationId;
}

export function deviceSyncSignatureInput(method: string, path: string, timestamp: string, nonce: string, bodyHash: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash.toLowerCase()}`;
}

export async function requireDeviceSync(req: Request, res: Response, next: NextFunction) {
  const deviceId = String(req.header("X-Bookie-Device-Id") ?? "");
  const timestamp = String(req.header("X-Bookie-Timestamp") ?? "");
  const nonce = String(req.header("X-Bookie-Nonce") ?? "");
  const suppliedHash = String(req.header("X-Bookie-Body-SHA256") ?? "").toLowerCase();
  const signature = String(req.header("X-Bookie-Signature") ?? "");
  const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  if (raw.length > MAX_BODY_BYTES || !/^[a-f0-9]{64}$/.test(suppliedHash) ||
      createHash("sha256").update(raw).digest("hex") !== suppliedHash ||
      !/^[A-Za-z0-9_-]{22,256}$/.test(nonce)) {
    res.status(400).json({ error: "Neveljavna device-sync zahteva." }); return;
  }
  const instant = new Date(timestamp);
  if (Number.isNaN(+instant) || Math.abs(Date.now() - +instant) > 300_000) {
    res.status(401).json({ error: "Device-sync timestamp je izven dovoljenega okna." }); return;
  }
  const [row] = await db.select({
    device: offlineFiscalDevicesTable, companyId: enoteTable.companyId,
  }).from(offlineFiscalDevicesTable).innerJoin(enoteTable, eq(enoteTable.id, offlineFiscalDevicesTable.enotaId))
    .where(eq(offlineFiscalDevicesTable.id, deviceId)).limit(1);
  if (!row || row.device.status !== "active" || !row.device.productionEnabled) {
    res.status(403).json({ error: "Device ni aktiven za produkcijski sync." }); return;
  }
  if (!req.path.endsWith("/config")) {
    const [config] = await db.select({ id: offlineProvisioningBundlesTable.id }).from(offlineProvisioningBundlesTable).where(and(
      eq(offlineProvisioningBundlesTable.deviceId, deviceId), isNull(offlineProvisioningBundlesTable.revokedAt),
      gt(offlineProvisioningBundlesTable.validUntil, new Date()),
    )).limit(1);
    if (!config) { res.status(410).json({ error: "Provisioning config je potekel ali preklican." }); return; }
  }
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(deviceSyncSignatureInput(req.method, req.originalUrl, timestamp, nonce, suppliedHash)); verifier.end();
    if (!verifier.verify(row.device.publicKeyPem, Buffer.from(signature, "base64"))) throw new Error();
  } catch { res.status(403).json({ error: "Device-sync podpis ni veljaven." }); return; }
  try {
    await db.delete(offlineDeviceSyncNoncesTable).where(lt(offlineDeviceSyncNoncesTable.expiresAt, new Date()));
    await db.insert(offlineDeviceSyncNoncesTable).values({
      deviceId, nonce, requestTimestamp: instant, expiresAt: new Date(Date.now() + 600_000),
    });
  } catch (error: any) {
    if (error?.code === "23505" || error?.cause?.code === "23505") {
      res.status(409).json({ error: "Device-sync nonce je že uporabljen.", code: "SYNC_REPLAY" }); return;
    }
    throw error;
  }
  Object.assign(req, {
    enotaId: row.device.enotaId, companyId: row.companyId, clerkUserId: `device:${deviceId}`,
    vloga: "device", jeDdvZavezanec: false, idZaDdv: null, deviceSyncDeviceId: deviceId,
  } satisfies Partial<PosRequest>);
  next();
}

router.use("/offline-fiscal/sync", requireDeviceSync);
router.post("/offline-fiscal/sync/receipts/ingest", ingestOfflineReceipt);
router.get("/offline-fiscal/sync/receipts/status/:operationId", async (req, res) => {
  const context = req as unknown as PosRequest;
  const [receipt] = await db.select().from(offlineFiscalReceiptsTable).where(and(
    eq(offlineFiscalReceiptsTable.operationId, String(req.params.operationId)),
    eq(offlineFiscalReceiptsTable.deviceId, String(req.header("X-Bookie-Device-Id"))),
    eq(offlineFiscalReceiptsTable.enotaId, context.enotaId),
  )).limit(1);
  if (!receipt) { res.status(404).json({ error: "Operacija ni najdena." }); return; }
  res.json({ operationId: receipt.operationId, localReceiptId: receipt.localReceiptId,
    fursState: receipt.fursState, eor: receipt.eor, receivedAt: receipt.receivedAt });
});

/**
 * Gateway events are an audit/reconciliation stream, not a second fiscal
 * issuance path.  The exact signed request bytes are authenticated by the
 * middleware above; this handler only stores append-only events and never
 * invokes receipt side effects.
 */
router.post("/offline-fiscal/sync/gateway-events/ingest", async (req, res) => {
  const context = req as unknown as PosRequest;
  let batch: GatewayEventBatch;
  try { batch = validateGatewayEventBatch(req.body); } catch {
    res.status(400).json({ error: "Neveljaven gateway event batch." }); return;
  }
  const { fromSeq, toSeq, events } = batch;
  const deviceId = String(req.header("X-Bookie-Device-Id"));
  const [checkpointRow] = await db.select().from(offlineGatewaySyncCheckpointsTable)
    .where(eq(offlineGatewaySyncCheckpointsTable.deviceId, deviceId)).limit(1);
  const existingCheckpoint = checkpointRow?.lastResolvedSeq ?? checkpointRow?.lastAcceptedSeq ?? 0;
  if (fromSeq > existingCheckpoint + 1) {
    res.status(409).json({ error: "Gateway event sequence gap.", code: "SEQUENCE_GAP",
      checkpoint: existingCheckpoint }); return;
  }
  let conflict: { seq: number; operationId: string; incomingHash: string;
    existingHash?: string; reason: string } | undefined;
  try {
    await db.transaction(async tx => {
    const locked = await tx.execute(sql`SELECT last_accepted_seq, last_resolved_seq
      FROM offline_gateway_sync_checkpoints WHERE device_id = ${deviceId} FOR UPDATE`);
    const row = locked.rows[0] as { last_accepted_seq: number; last_resolved_seq: number } | undefined;
    let acceptedSeq = row?.last_accepted_seq ?? row?.last_resolved_seq ?? existingCheckpoint;
    let resolvedSeq = row?.last_resolved_seq ?? row?.last_accepted_seq ?? existingCheckpoint;
    if (!row) await tx.insert(offlineGatewaySyncCheckpointsTable).values({ id: randomUUID(), deviceId });
    let expected = resolvedSeq + 1;
    for (const event of events) {
      const seq = Number(event.seq);
      const operationId = String(event.operationId);
      const payloadHash = String(event.payloadHash);
      const [bySeq] = await tx.select().from(offlineGatewayEventsTable).where(and(
        eq(offlineGatewayEventsTable.deviceId, deviceId),
        eq(offlineGatewayEventsTable.gatewaySeq, seq),
      )).limit(1);
      const [byOperation] = await tx.select().from(offlineGatewayEventsTable).where(and(
        eq(offlineGatewayEventsTable.deviceId, deviceId),
        eq(offlineGatewayEventsTable.operationId, operationId),
      )).limit(1);
      const existing = bySeq ?? byOperation;
      if (seq !== expected && seq > acceptedSeq) {
        throw Object.assign(new Error("Gateway event sequence gap."), { code: "SEQUENCE_GAP", checkpoint: resolvedSeq });
      }
      if (seq <= acceptedSeq) {
        if (seq > expected) {
          conflict = {
            seq, operationId, incomingHash: payloadHash, existingHash: bySeq?.payloadHash,
            reason: "UNRESOLVED_PREFIX_REPLAY",
          };
          const [review] = await tx.select({ id: offlineGatewaySyncReviewsTable.id })
            .from(offlineGatewaySyncReviewsTable).where(and(
              eq(offlineGatewaySyncReviewsTable.deviceId, deviceId),
              eq(offlineGatewaySyncReviewsTable.gatewaySeq, seq),
              eq(offlineGatewaySyncReviewsTable.incomingPayloadHash, payloadHash),
              eq(offlineGatewaySyncReviewsTable.state, "open"),
            )).limit(1);
          if (!review) await tx.insert(offlineGatewaySyncReviewsTable).values({
            id: randomUUID(), deviceId, gatewaySeq: seq, operationId,
            existingPayloadHash: bySeq?.payloadHash, incomingPayloadHash: payloadHash,
            reason: conflict.reason, evidence: { existing: bySeq, incoming: event }, state: "open",
          });
          break;
        }
        if (!bySeq || gatewayEventConflict(bySeq, { seq, operationId, payloadHash })) {
          conflict = {
            seq, operationId, incomingHash: payloadHash,
            existingHash: bySeq?.payloadHash,
            reason: bySeq && byOperation && bySeq.id !== byOperation.id
              ? "SEQUENCE_AND_OPERATION_COLLISION" : "PAYLOAD_OR_SEQUENCE_CONFLICT",
          };
          const [review] = await tx.select({ id: offlineGatewaySyncReviewsTable.id })
            .from(offlineGatewaySyncReviewsTable).where(and(
              eq(offlineGatewaySyncReviewsTable.deviceId, deviceId),
              eq(offlineGatewaySyncReviewsTable.gatewaySeq, seq),
              eq(offlineGatewaySyncReviewsTable.incomingPayloadHash, payloadHash),
              eq(offlineGatewaySyncReviewsTable.state, "open"),
            )).limit(1);
          if (!review) await tx.insert(offlineGatewaySyncReviewsTable).values({
            id: randomUUID(), deviceId, gatewaySeq: seq, operationId,
            existingPayloadHash: existing.payloadHash, incomingPayloadHash: payloadHash,
            reason: conflict.reason,
            evidence: { existing: bySeq ?? byOperation, incoming: event },
            state: "open",
          });
          await tx.update(offlineGatewaySyncCheckpointsTable).set({
            lastAcceptedSeq: acceptedSeq, lastResolvedSeq: resolvedSeq,
            updatedAt: new Date(),
          }).where(eq(offlineGatewaySyncCheckpointsTable.deviceId, deviceId));
          break;
        }
        if (seq === expected) { resolvedSeq = seq; expected++; }
        continue;
      }
      if (seq > acceptedSeq + 1 || (byOperation && !bySeq)) {
        conflict = {
          seq, operationId, incomingHash: payloadHash, existingHash: byOperation?.payloadHash,
          reason: byOperation && !bySeq ? "OPERATION_ID_COLLISION" : "CLOUD_SEQUENCE_GAP",
        };
        const [review] = await tx.select({ id: offlineGatewaySyncReviewsTable.id })
          .from(offlineGatewaySyncReviewsTable).where(and(
            eq(offlineGatewaySyncReviewsTable.deviceId, deviceId),
            eq(offlineGatewaySyncReviewsTable.gatewaySeq, seq),
            eq(offlineGatewaySyncReviewsTable.incomingPayloadHash, payloadHash),
            eq(offlineGatewaySyncReviewsTable.state, "open"),
          )).limit(1);
        if (!review) await tx.insert(offlineGatewaySyncReviewsTable).values({
          id: randomUUID(), deviceId, gatewaySeq: seq, operationId,
          existingPayloadHash: byOperation?.payloadHash, incomingPayloadHash: payloadHash,
          reason: conflict.reason, evidence: { existing: byOperation, incoming: event }, state: "open",
        });
        await tx.update(offlineGatewaySyncCheckpointsTable).set({
          lastAcceptedSeq: acceptedSeq, lastResolvedSeq: resolvedSeq, updatedAt: new Date(),
        }).where(eq(offlineGatewaySyncCheckpointsTable.deviceId, deviceId));
        break;
      }
      await tx.insert(offlineGatewayEventsTable).values({
        id: randomUUID(), deviceId, gatewaySeq: seq, operationId,
        eventType: String(event.eventType), payloadHash,
        payload: event.payload ?? event, state: "accepted",
      });
      acceptedSeq = seq; resolvedSeq = seq; expected++;
    }
    if (!conflict || resolvedSeq !== (row?.last_resolved_seq ?? row?.last_accepted_seq ?? existingCheckpoint)) {
      await tx.update(offlineGatewaySyncCheckpointsTable).set({
        lastAcceptedSeq: acceptedSeq, lastResolvedSeq: resolvedSeq, updatedAt: new Date(),
      }).where(eq(offlineGatewaySyncCheckpointsTable.deviceId, deviceId));
    }
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "SEQUENCE_GAP") {
      res.status(409).json({
        error: "Gateway event sequence gap.", code: "SEQUENCE_GAP",
        checkpoint: (error as { checkpoint?: number }).checkpoint ?? existingCheckpoint,
      });
      return;
    }
    throw error;
  }
  if (conflict) {
    const [checkpointRow] = await db.select().from(offlineGatewaySyncCheckpointsTable)
      .where(eq(offlineGatewaySyncCheckpointsTable.deviceId, deviceId)).limit(1);
    const [reviewRow] = await db.select({ id: offlineGatewaySyncReviewsTable.id })
      .from(offlineGatewaySyncReviewsTable).where(and(
        eq(offlineGatewaySyncReviewsTable.deviceId, deviceId),
        eq(offlineGatewaySyncReviewsTable.gatewaySeq, conflict.seq),
        eq(offlineGatewaySyncReviewsTable.incomingPayloadHash, conflict.incomingHash),
      )).limit(1);
    res.status(409).json({
      error: "Gateway event payload conflict.", code: "NEEDS_REVIEW",
      reviewId: reviewRow?.id, checkpoint: checkpointRow?.lastResolvedSeq ?? 0,
      cloudHighWater: checkpointRow?.lastAcceptedSeq ?? 0,
      review: { operationId: conflict.operationId, seq: conflict.seq,
        existingPayloadHash: conflict.existingHash, incomingPayloadHash: conflict.incomingHash,
        reason: conflict.reason },
    });
    return;
  }
  const [persistedCheckpoint] = await db.select().from(offlineGatewaySyncCheckpointsTable)
    .where(eq(offlineGatewaySyncCheckpointsTable.deviceId, deviceId)).limit(1);
  res.status(202).json({
    deviceId, fromSeq, toSeq, checkpoint: persistedCheckpoint?.lastResolvedSeq ?? 0,
    cloudHighWater: persistedCheckpoint?.lastAcceptedSeq ?? 0,
    accepted: events.length, state: "accepted",
  });
});

router.get("/offline-fiscal/sync/gateway-events/status", async (req, res) => {
  const deviceId = String(req.header("X-Bookie-Device-Id"));
  const [checkpointRow] = await db.select().from(offlineGatewaySyncCheckpointsTable)
    .where(eq(offlineGatewaySyncCheckpointsTable.deviceId, deviceId)).limit(1);
  const checkpoint = checkpointRow?.lastResolvedSeq ?? checkpointRow?.lastAcceptedSeq ?? 0;
  const reviews = await db.select().from(offlineGatewaySyncReviewsTable).where(and(
    eq(offlineGatewaySyncReviewsTable.deviceId, deviceId),
    eq(offlineGatewaySyncReviewsTable.state, "open"),
  ));
  const pendingRows = await db.select({ seq: offlineGatewayEventsTable.gatewaySeq })
    .from(offlineGatewayEventsTable).where(and(
      eq(offlineGatewayEventsTable.deviceId, deviceId), gt(offlineGatewayEventsTable.gatewaySeq, checkpoint),
    ));
  const blockingReviews = reviews.filter(review => review.gatewaySeq <= checkpoint + 1);
  res.json({
    deviceId, checkpoint, cloudHighWater: checkpointRow?.lastAcceptedSeq ?? 0,
    needsReview: blockingReviews.length > 0,
    needsReviewCount: blockingReviews.length,
    reviews,
    pendingEventCount: pendingRows.length,
  });
});

function requireGatewayManager(req: Request, res: Response): boolean {
  const role = (req as unknown as PosRequest).vloga;
  if (role !== "admin_enote" && role !== "admin" && role !== "superadmin") {
    res.status(403).json({ error: "Za razreševanje gateway pregledov je potreben vodja ali skrbnik." });
    return false;
  }
  return true;
}

gatewayReviewRouter.get("/offline-fiscal/gateway-reviews", async (req: Request, res: Response) => {
  if (!requireGatewayManager(req, res)) return;
  const context = req as unknown as PosRequest;
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
  const devices = await db.select({ id: offlineFiscalDevicesTable.id }).from(offlineFiscalDevicesTable)
    .innerJoin(enoteTable, eq(enoteTable.id, offlineFiscalDevicesTable.enotaId))
    .where(and(eq(enoteTable.companyId, context.companyId), eq(offlineFiscalDevicesTable.enotaId, context.enotaId),
      deviceId ? eq(offlineFiscalDevicesTable.id, deviceId) : undefined));
  const reviews = devices.length ? await db.select({
    id: offlineGatewaySyncReviewsTable.id, deviceId: offlineGatewaySyncReviewsTable.deviceId,
    gatewaySeq: offlineGatewaySyncReviewsTable.gatewaySeq, operationId: offlineGatewaySyncReviewsTable.operationId,
    reason: offlineGatewaySyncReviewsTable.reason, createdAt: offlineGatewaySyncReviewsTable.createdAt,
    existingPayloadHash: offlineGatewaySyncReviewsTable.existingPayloadHash,
    incomingPayloadHash: offlineGatewaySyncReviewsTable.incomingPayloadHash,
  }).from(offlineGatewaySyncReviewsTable).where(and(
    eq(offlineGatewaySyncReviewsTable.state, "open"),
    sql`${offlineGatewaySyncReviewsTable.deviceId} IN (${sql.join(devices.map(device => sql`${device.id}`), sql`,`)})`,
  )) : [];
  res.json({ reviews });
});

gatewayReviewRouter.post("/offline-fiscal/gateway-reviews/:reviewId/resolve", async (req: Request, res: Response) => {
  if (!requireGatewayManager(req, res)) return;
  const context = req as unknown as PosRequest;
  const result = await db.transaction(async tx => {
    const locked = await tx.execute(sql`SELECT r.*, c.last_accepted_seq, c.last_resolved_seq
      FROM offline_gateway_sync_reviews r
      JOIN offline_gateway_sync_checkpoints c ON c.device_id = r.device_id
      JOIN offline_fiscal_devices d ON d.id = r.device_id
      JOIN enote e ON e.id = d.enota_id
      WHERE r.id = ${String(req.params.reviewId)} AND r.state = 'open'
        AND d.enota_id = ${context.enotaId} AND e.company_id = ${context.companyId}
      FOR UPDATE`);
    const review = locked.rows[0] as { device_id: string; gateway_seq: number; last_accepted_seq: number; last_resolved_seq: number } | undefined;
    if (!review) throw Object.assign(new Error("Gateway review ni najden."), { status: 404 });
    const earlier = await tx.execute(sql`SELECT 1 FROM offline_gateway_sync_reviews
      WHERE device_id = ${review.device_id} AND state = 'open'
        AND gateway_seq < ${review.gateway_seq} LIMIT 1`);
    if (earlier.rows.length) {
      throw Object.assign(new Error("Gateway review ni mogoče razrešiti izven vrstnega reda."), { status: 409 });
    }
    if (review.gateway_seq > review.last_accepted_seq + 1) {
      throw Object.assign(new Error("Gateway review ni mogoče razrešiti pred manjkajočim dogodkom."), { status: 409 });
    }
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : null;
    await tx.update(offlineGatewaySyncReviewsTable).set({
      state: "resolved", resolution: "KEEP_CLOUD_SKIP_LOCAL",
      resolvedBy: context.clerkUserId, resolvedAt: new Date(), resolutionNote: note,
    }).where(eq(offlineGatewaySyncReviewsTable.id, String(req.params.reviewId)));
    await tx.update(offlineGatewaySyncCheckpointsTable).set({
      lastResolvedSeq: Math.max(review.last_resolved_seq, review.gateway_seq),
      lastAcceptedSeq: Math.max(review.last_accepted_seq, review.gateway_seq), updatedAt: new Date(),
    }).where(eq(offlineGatewaySyncCheckpointsTable.deviceId, review.device_id));
    const [persisted] = await tx.select({ checkpoint: offlineGatewaySyncCheckpointsTable.lastResolvedSeq })
      .from(offlineGatewaySyncCheckpointsTable)
      .where(eq(offlineGatewaySyncCheckpointsTable.deviceId, review.device_id)).limit(1);
    return { checkpoint: persisted?.checkpoint ?? 0 };
  });
  res.json({ resolution: "KEEP_CLOUD_SKIP_LOCAL", ...result });
});

router.get("/offline-fiscal/sync/config", async (req, res) => {
  const deviceId = String(req.header("X-Bookie-Device-Id"));
  const [latest] = await db.select().from(offlineProvisioningBundlesTable)
    .where(eq(offlineProvisioningBundlesTable.deviceId, deviceId))
    .orderBy(desc(offlineProvisioningBundlesTable.version)).limit(1);
  if (latest && !latest.revokedAt && latest.validUntil > new Date(Date.now() + 24 * 60 * 60 * 1000)) {
    res.json({ ...latest.payload as object, payloadSha256: latest.payloadSha256, signatureBase64: latest.signatureBase64 }); return;
  }
  const context = req as PosRequest;
  const [device] = await db.select({
    row: offlineFiscalDevicesTable, oznaka: poslovniProstoriTable.prostorId,
  }).from(offlineFiscalDevicesTable).innerJoin(poslovniProstoriTable,
    eq(poslovniProstoriTable.id, offlineFiscalDevicesTable.poslovniProstorId))
    .where(eq(offlineFiscalDevicesTable.id, deviceId)).limit(1);
  if (!device?.row.expectedFursCertFingerprint || !device.row.goldenAttestationSha256) {
    res.status(409).json({ error: "Device nima popolne attestation konfiguracije." }); return;
  }
  const bundle = await createProvisioningBundle({
    deviceId, companyId: context.companyId, enotaId: context.enotaId,
    poslovniProstorId: device.row.poslovniProstorId, poslovniProstorOznaka: device.oznaka,
    bIdentifier: device.row.bIdentifier, expectedFursCertFingerprint: device.row.expectedFursCertFingerprint,
    devicePublicKeyFingerprintSha256: device.row.keyFingerprintSha256,
    authorityVersion: device.row.authorityVersion, bundleVersion: (latest?.version ?? 0) + 1,
    goldenAttestationSha256: device.row.goldenAttestationSha256,
  });
  res.json(bundle);
});

export default router;