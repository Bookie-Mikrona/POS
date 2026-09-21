import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";

const SAFE_ORDER_PATH = /^\/narocila\/\d+\/postavke(?:\/\d+)?$/;
const STALE_MS = 15 * 60_000;

type Stored = { checksum: string; method: string; path: string; status: string; response_status: number | null; response: unknown; created_at: Date };

function operationHeaders(req: Request) {
  const operationId = req.headers["x-pos-operation-id"] ?? req.headers["x-operation-id"];
  const checksum = req.headers["x-pos-operation-checksum"] ?? req.headers["x-operation-checksum"];
  return typeof operationId === "string" && typeof checksum === "string" ? { operationId, checksum } : null;
}

/**
 * Reserve an operation before the existing route handler runs. This does not
 * duplicate business logic: only the reservation owner reaches the handler.
 */
export async function posOrderOperationIdempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = operationHeaders(req);
  if (!header || !["POST", "PATCH", "DELETE"].includes(req.method) || !SAFE_ORDER_PATH.test(req.path)) { next(); return; }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(header.operationId) || !/^[a-f0-9]{64}$/i.test(header.checksum)) {
    res.status(400).json({ error: "Neveljaven operationId ali checksum." }); return;
  }
  const enotaId = (req as any).enotaId as number;
  const inserted = await pool.query(
    `INSERT INTO pos_sync_operations (operation_id,enota_id,checksum,method,path,status,updated_at)
     VALUES ($1,$2,$3,$4,$5,'processing',now()) ON CONFLICT (operation_id) DO NOTHING RETURNING operation_id`,
    [header.operationId, enotaId, header.checksum, req.method, req.path],
  );
  if (inserted.rowCount !== 1) {
    const found = await pool.query<Stored>("SELECT checksum,method,path,status,response_status,response,created_at FROM pos_sync_operations WHERE operation_id=$1 AND enota_id=$2", [header.operationId, enotaId]);
    const stored = found.rows[0];
    if (!stored) { res.status(409).json({ error: "OperationId pripada drugi enoti.", code: "OPERATION_TENANT_MISMATCH" }); return; }
    if (stored.checksum !== header.checksum || stored.method !== req.method || stored.path !== req.path) {
      res.status(409).json({ error: "OperationId je že uporabljen z drugimi podatki.", code: "OPERATION_MISMATCH" }); return;
    }
    if (stored.status === "applied" || stored.status === "rejected") {
      res.status(stored.response_status ?? (stored.status === "applied" ? 200 : 400)).json(stored.response);
      return;
    }
    const stale = Date.now() - new Date(stored.created_at).getTime() > STALE_MS;
    if (stale && stored.status === "processing") {
      await pool.query("UPDATE pos_sync_operations SET status='needs_review', updated_at=now() WHERE operation_id=$1 AND status='processing'", [header.operationId]);
    }
    res.status(202).json({ status: "needs_review", recoveryRequired: true, error: stale ? "Prejšnji poskus je zastarel in zahteva pregled." : "Poskus še poteka; ne ponavljajte spremembe." });
    return;
  }

  let captured: unknown = undefined;
  let responseStatus = 200;
  let completed = false;
  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const finalize = () => {
    if (completed) return;
    completed = true;
    responseStatus = res.statusCode;
    const status = responseStatus >= 200 && responseStatus < 300 ? "applied"
      : responseStatus >= 400 && responseStatus < 500 ? "rejected" : "needs_review";
    void pool.query(
      "UPDATE pos_sync_operations SET status=$2,response_status=$3,response=$4::jsonb,updated_at=now() WHERE operation_id=$1",
      [header.operationId, status, responseStatus, JSON.stringify(captured ?? null)],
    ).catch(error => req.log.error({ err: error, operationId: header.operationId }, "Could not finalize POS operation ledger"));
  };
  res.status = ((code: number) => { responseStatus = code; return originalStatus(code); }) as Response["status"];
  res.json = ((body: unknown) => { captured = body; return originalJson(body); }) as Response["json"];
  res.send = ((body: unknown) => { if (captured === undefined) captured = body; return originalSend(body); }) as Response["send"];
  res.on("finish", finalize);
  next();
}