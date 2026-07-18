import { db, auditLogTable } from "@workspace/db";

interface AuditParams {
  companyId: string;
  entityType: string;
  entityId: string;
  action: string;
  changedBy: string;
  payload?: unknown;
}

/**
 * Zapiše nespremenljiv revizijski dnevnik.
 * Kliče se po vsaki spremembi finančnih podatkov.
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
