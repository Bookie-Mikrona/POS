/**
 * Durable, versioned queue for mutations which do not create a payment,
 * invoice, or fiscal document.  The snapshot is deliberately retained: a
 * later edit must never silently change the intent that is replayed.
 */
export type OrderOutboxStatus = "pending" | "syncing" | "applied" | "rejected" | "needs_review";
export type OrderMutationKind = "add_item" | "update_item" | "remove_item" | "order_note";

export interface OrderOutboxOperation {
  operationId: string;
  version: 1;
  kind: OrderMutationKind;
  orderId: number;
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  payload: unknown;
  checksum: string;
  status: OrderOutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError?: string;
}

const DB = "pos-order-outbox";
const STORE = "operations";
const encoder = new TextEncoder();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE, { keyPath: "operationId" });
      store.createIndex("status", "status");
      store.createIndex("nextAttemptAt", "nextAttemptAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB ni na voljo."));
  });
}

async function digest(value: unknown): Promise<string> {
  const canonical = JSON.stringify(value);
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(canonical));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function put(operation: OrderOutboxOperation): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(operation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function queueOrderMutation(input: Omit<OrderOutboxOperation, "operationId" | "version" | "checksum" | "status" | "attempts" | "nextAttemptAt" | "createdAt">): Promise<OrderOutboxOperation> {
  const snapshot = { kind: input.kind, orderId: input.orderId, method: input.method, path: input.path, payload: input.payload };
  const operation: OrderOutboxOperation = {
    ...input, ...snapshot, operationId: crypto.randomUUID(), version: 1,
    checksum: await digest(snapshot), status: "pending", attempts: 0,
    nextAttemptAt: Date.now(), createdAt: Date.now(),
  };
  await put(operation);
  return operation;
}

export async function listOrderOutbox(): Promise<OrderOutboxOperation[]> {
  const db = await openDb();
  const rows = await new Promise<OrderOutboxOperation[]>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

/** Per-operation replay is intentional: it enters the same protected route as
 * an online edit, preserving KDS/reservation/availability invariants. */
export async function replayOrderOutbox(headers: Record<string, string>): Promise<OrderOutboxOperation[]> {
  const operations = await listOrderOutbox();
  const now = Date.now();
  for (const op of operations.filter(x => (x.status === "pending" || x.status === "syncing") && x.nextAttemptAt <= now)) {
    const verified = await digest({ kind: op.kind, orderId: op.orderId, method: op.method, path: op.path, payload: op.payload });
    if (verified !== op.checksum) {
      op.status = "needs_review"; op.lastError = "Kontrolna vsota shranjenega ukaza se ne ujema.";
      await put(op); continue;
    }
    op.status = "syncing"; await put(op);
    try {
      const response = await fetch(op.path, {
        method: op.method, credentials: "include",
        headers: { ...headers, "Content-Type": "application/json", "X-POS-Operation-Id": op.operationId, "X-POS-Operation-Checksum": op.checksum },
        body: op.method === "DELETE" ? undefined : JSON.stringify(op.payload),
      });
      if (response.ok) { op.status = "applied"; op.lastError = undefined; }
      else if (response.status === 202) {
        op.status = "needs_review"; op.lastError = "Strežnik ne more varno potrditi prejšnjega poskusa.";
      }
      else if (response.status === 409 || response.status === 412) {
        op.status = "needs_review"; op.lastError = await response.text();
      } else if (response.status >= 400 && response.status < 500) {
        op.status = "rejected"; op.lastError = await response.text();
      } else throw new Error(`Strežnik ni dosegljiv (${response.status}).`);
    } catch (error) {
      op.status = "pending"; op.attempts += 1;
      op.nextAttemptAt = Date.now() + Math.min(300_000, 1_000 * 2 ** Math.min(op.attempts, 8));
      op.lastError = error instanceof Error ? error.message : "Povezava ni dosegljiva.";
    }
    await put(op);
  }
  return listOrderOutbox();
}