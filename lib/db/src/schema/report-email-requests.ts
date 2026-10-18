import { pgTable, uuid, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

/** Durable SMTP deduplication, deliberately independent of PDF history retention. */
export const reportEmailRequestsTable = pgTable("report_email_requests", {
  companyId: uuid("company_id").notNull(),
  requestKey: uuid("request_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  exportedBy: text("exported_by").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.companyId, t.requestKey] })]);
