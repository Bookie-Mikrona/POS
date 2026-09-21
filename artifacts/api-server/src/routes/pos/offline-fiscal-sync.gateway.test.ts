import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deviceSyncSignatureInput, gatewayEventConflict, validateGatewayEventBatch } from "./offline-fiscal-sync";

describe("gateway event ingest contract", () => {
  const event = (seq: number, operationId = `operation-${seq}`, payloadHash?: string) => {
    const payload = { orderId: 42, version: seq };
    return {
      seq, operationId, eventType: "order-updated",
      payloadHash: payloadHash ?? createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      payload,
    };
  };

  it("requires contiguous from/to sequence and bounded event shape", () => {
    expect(validateGatewayEventBatch({
      fromSeq: 3, toSeq: 4, events: [event(3), event(4)],
    }).toSeq).toBe(4);
    expect(() => validateGatewayEventBatch({
      fromSeq: 3, toSeq: 5, events: [event(3), event(4)],
    })).toThrow();
    expect(() => validateGatewayEventBatch({
      fromSeq: 3, toSeq: 4, events: [event(4), event(3)],
    })).toThrow();
    expect(() => validateGatewayEventBatch({
      fromSeq: 3, toSeq: 4, events: [event(3), event(3)],
    })).toThrow();
    expect(() => validateGatewayEventBatch({ fromSeq: 1, toSeq: 0, events: [] })).toThrow();
    expect(() => validateGatewayEventBatch({
      fromSeq: 1, toSeq: 1, events: [event(1, "bad-hash", "not-a-hash")],
    })).toThrow();
  });

  it("binds the gateway body to device scope and exact ingest path", () => {
    const body = JSON.stringify({ fromSeq: 1, toSeq: 1, events: [event(1)] });
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const signed = deviceSyncSignatureInput(
      "POST", "/api/offline-fiscal/sync/gateway-events/ingest",
      "2026-09-06T10:17:00.000Z", "gateway_nonce_128_bits_x", bodyHash,
    );
    expect(signed.split("\n")).toEqual([
      "POST", "/api/offline-fiscal/sync/gateway-events/ingest",
      "2026-09-06T10:17:00.000Z", "gateway_nonce_128_bits_x", bodyHash,
    ]);
    expect(signed).not.toContain("/receipts/ingest");
  });

  it("makes duplicate operation and payload conflicts reviewable", () => {
    const first = validateGatewayEventBatch({ fromSeq: 7, toSeq: 7, events: [event(7, "same-op")] });
    const exactReplay = validateGatewayEventBatch({ fromSeq: 7, toSeq: 7, events: [event(7, "same-op")] });
    expect(exactReplay).toEqual(first);
    const conflicting = { seq: 7, operationId: "same-op", payloadHash: "b".repeat(64) };
    expect(conflicting.payloadHash).not.toBe(first.events[0].payloadHash);
    expect(gatewayEventConflict(
      { gatewaySeq: 7, operationId: "same-op", payloadHash: first.events[0].payloadHash as string },
      conflicting,
    )).toBe(true);
  });

  it("allows checkpoint status to resume after the last accepted sequence", () => {
    const checkpoint = 12;
    const batch = validateGatewayEventBatch({
      fromSeq: checkpoint + 1, toSeq: checkpoint + 2,
      events: [event(checkpoint + 1), event(checkpoint + 2)],
    });
    expect(batch.fromSeq).toBe(checkpoint + 1);
  });

  it("accepts canonical hashes for routing and cancellation audit events", () => {
    const routingPayload = { lineId: "line-1", orderId: "local-order", scope: { companyId: "c", enotaId: "1" } };
    const cancelPayload = { identity: ["line-1", 7, ""], jobId: "job-7", orderId: "local-order" };
    const hash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const batch = validateGatewayEventBatch({
      fromSeq: 20, toSeq: 21,
      events: [
        { seq: 20, operationId: "route-20", eventType: "kds-routing-missing",
          payloadHash: hash(routingPayload), payload: routingPayload },
        { seq: 21, operationId: "cancel-21", eventType: "kds-cancelled",
          payloadHash: hash(cancelPayload), payload: cancelPayload },
      ],
    });
    expect(batch.toSeq).toBe(21);
  });
});