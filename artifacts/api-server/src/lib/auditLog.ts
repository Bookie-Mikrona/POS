import { db, auditLogTable } from "@workspace/db";

/**
 * §75 — Standardizirani tipi revizijskih ereignisov.
 * Vsak računovodsko relevanten dogodek mora imeti znan action.
 */
export const AuditAction = {
  // Temeljnice
  CREATE: "create",
  CREATE_AND_POST: "create_and_post",
  POST: "post",
  REVERSE: "reverse",
  // Dokumenti / OCR
  DOCUMENT_UPLOAD: "document_upload",
  DOCUMENT_APPROVE: "document_approve",
  DOCUMENT_REJECT: "document_reject",
  // AI
  AI_SUGGEST: "ai_suggest",
  AI_ACCEPT: "ai_accept",
  AI_REJECT: "ai_reject",
  // Bančni uvoz
  IMPORT: "import",
  // Periode
  PERIOD_CLOSE: "period_close",
  PERIOD_REOPEN: "period_reopen",
  // Splošno
  UPDATE: "update",
} as const;

export type AuditActionType = typeof AuditAction[keyof typeof AuditAction];

interface AuditParams {
  companyId: string;
  entityType: string;
  entityId: string;
  action: AuditActionType | string;
  changedBy: string;
  payload?: unknown;
}

/**
 * Zapiše nespremenljiv revizijski dnevnik.
 * §100 — Kliče se po vsaki spremembi finančnih podatkov.
 * Napake pri pisanju se logirajo ampak ne prekinejo zahteve.
 */
export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      companyId: params.companyId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      changedBy: params.changedBy,
      payload: params.payload ? (params.payload as Record<string, unknown>) : null,
    });
  } catch (err) {
    // Revizijski dnevnik nikoli ne sme prekiniti operacije
    console.error("[audit] Failed to write audit log:", err);
  }
}
