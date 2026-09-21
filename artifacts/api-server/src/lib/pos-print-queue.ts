/** Pure rules shared by the durable printer queue and its tests. */
export const PRINT_MAX_ATTEMPTS = 5;
export const PRINT_LEASE_SECONDS = 60;

/** A caller operation wins; otherwise an unchanged receipt payload is one operation. */
export function receiptPrintIdempotencyKey(receiptId: number, payloadHash: string, operationId?: string): string {
  return `agent:${operationId?.trim() || `receipt:${receiptId}:${payloadHash}`}`;
}

export type PrintStatus = "queued" | "running" | "printed" | "failed" | "needs_review";
export type QueueJob = {
  id: number; enotaId: number; destination: string; printerKey: string | null;
  status: PrintStatus; availableAt: Date; leaseUntil: Date | null; claimedBy: string | null;
};

export function retryDelaySeconds(attempts: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, attempts - 1));
}

export function failureTransition(attempts: number, now = new Date()) {
  if (attempts >= PRINT_MAX_ATTEMPTS) return { status: "needs_review" as const, availableAt: now };
  return { status: "queued" as const, availableAt: new Date(now.getTime() + retryDelaySeconds(attempts) * 1000) };
}

/** Mirrors the SQL eligibility predicate; SQL locking supplies the atomicity. */
export function firstClaimable(
  jobs: QueueJob[], enotaId: number, printerKey: string, now = new Date(),
): QueueJob | undefined {
  return jobs.filter((job) => job.enotaId === enotaId && job.destination === "agent"
    && (job.printerKey === null || job.printerKey === printerKey)
    && ((job.status === "queued" && job.availableAt <= now)
      || (job.status === "running" && job.leaseUntil !== null && job.leaseUntil < now)))
    .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime() || a.id - b.id)[0];
}

/** Whether an ACK can mutate a job, is a harmless duplicate, or is stale. */
export function ackDisposition(job: Pick<QueueJob, "status" | "claimedBy"> | undefined, claimToken: string) {
  if (!job) return "missing" as const;
  if (job.status === "printed") return "duplicate" as const;
  return job.status === "running" && job.claimedBy === claimToken ? "apply" as const : "late" as const;
}