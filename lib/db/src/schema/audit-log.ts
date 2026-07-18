import { pgTable, text, uuid, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Nespremenljivi revizijski dnevnik.
 * Vsak vnos je zapisan ob vsaki spremembi finančnih podatkov.
 * Brisanje ni dovoljeno — samo dodajanje novih vnosov.
 */
export const auditLogTable = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Za hitro filtriranje po podjetju */
  companyId: uuid("company_id").notNull(),
  /** Tip entitete: "journal_entry", "account", "period", "company" itd. */
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  /** Dejanje: "create", "update", "post", "reverse", "lock", "seed" */
  action: text("action").notNull(),
  /** Clerk user ID */
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Posnetk podatkov pred/po spremembi */
  payload: jsonb("payload"),
});

export type AuditLogEntry = typeof auditLogTable.$inferSelect;
