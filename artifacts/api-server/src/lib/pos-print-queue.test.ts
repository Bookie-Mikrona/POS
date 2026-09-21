import { describe, expect, it } from "vitest";
import { ackDisposition, failureTransition, firstClaimable, PRINT_MAX_ATTEMPTS, receiptPrintIdempotencyKey, retryDelaySeconds, type QueueJob } from "./pos-print-queue";

const at = new Date("2026-01-01T10:00:00Z");
const job = (overrides: Partial<QueueJob> = {}): QueueJob => ({
  id: 1, enotaId: 10, destination: "agent", printerKey: null, status: "queued",
  availableAt: at, leaseUntil: null, claimedBy: null, ...overrides,
});

describe("durable POS print queue rules", () => {
  it("uses the same unique key when an enqueue operation is replayed", () => {
    const first = receiptPrintIdempotencyKey(44, "payload-sha");
    expect(receiptPrintIdempotencyKey(44, "payload-sha")).toBe(first);
    expect(receiptPrintIdempotencyKey(44, "changed-payload", "checkout-try-9"))
      .toBe(receiptPrintIdempotencyKey(44, "payload-sha", "checkout-try-9"));
  });

  it("selects one deterministic candidate, including an expired lease", () => {
    const jobs = [job({ id: 2, availableAt: new Date(at.getTime() + 1) }),
      job({ id: 1, status: "running", leaseUntil: new Date(at.getTime() - 1), claimedBy: "dead" })];
    // Concurrent SQL callers lock this one candidate; no caller may receive two jobs.
    expect(firstClaimable(jobs, 10, "", at)?.id).toBe(1);
    expect(firstClaimable([job({ status: "running", leaseUntil: new Date(at.getTime() + 1) })], 10, "", at)).toBeUndefined();
  });

  it("isolates unit and printer-specific work while accepting unbound legacy rows", () => {
    const jobs = [job({ id: 1, enotaId: 11 }), job({ id: 2, printerKey: "bar" }), job({ id: 3 })];
    expect(firstClaimable(jobs, 10, "kitchen", at)?.id).toBe(3);
    expect(firstClaimable(jobs, 10, "bar", at)?.id).toBe(2);
    expect(firstClaimable(jobs, 11, "bar", at)?.id).toBe(1);
  });

  it("backs off exponentially and eventually requires manual review", () => {
    expect(retryDelaySeconds(1)).toBe(5);
    expect(retryDelaySeconds(2)).toBe(10);
    expect(retryDelaySeconds(20)).toBe(300);
    expect(failureTransition(2, at)).toEqual({ status: "queued", availableAt: new Date(at.getTime() + 10_000) });
    expect(failureTransition(PRINT_MAX_ATTEMPTS, at).status).toBe("needs_review");
  });

  it("makes printed ACK replay harmless and rejects late lease ACK", () => {
    expect(ackDisposition(job({ status: "running", claimedBy: "lease-a" }), "lease-a")).toBe("apply");
    expect(ackDisposition(job({ status: "printed", claimedBy: "lease-a" }), "lease-a")).toBe("duplicate");
    expect(ackDisposition(job({ status: "running", claimedBy: "lease-b" }), "lease-a")).toBe("late");
  });
});