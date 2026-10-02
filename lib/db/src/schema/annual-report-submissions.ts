import { pgTable, uuid, text, integer, timestamp, date, index, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { annualReportExportsTable } from "./annual-report-exports";

/** Reserved upload becomes an append-only manually recorded filing receipt. */
export const annualReportSubmissionsTable = pgTable("annual_report_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  year: integer("year").notNull(),
  exportId: uuid("export_id").notNull(),
  state: text("state").notNull().default("pending"),
  stagingPath: text("staging_path").notNull(),
  objectPath: text("object_path"),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256"),
  outcome: text("outcome"),
  submittedOn: date("submitted_on", { mode: "string" }),
  reference: text("reference"),
  note: text("note"),
  supersedesId: uuid("supersedes_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }),
}, t => [
  index("annual_report_submissions_scope").on(t.companyId, t.year),
  uniqueIndex("annual_report_submissions_id_export").on(t.id, t.exportId),
  uniqueIndex("annual_report_submissions_supersedes").on(t.supersedesId),
  foreignKey({ name: "annual_submission_export_scope", columns: [t.exportId, t.companyId, t.year],
    foreignColumns: [annualReportExportsTable.id, annualReportExportsTable.companyId, annualReportExportsTable.year] }).onDelete("cascade"),
  // Historical rows remain; a correction cannot link to another export/company.
  foreignKey({ name: "annual_submission_correction_scope", columns: [t.supersedesId, t.exportId],
    foreignColumns: [t.id, t.exportId] }),
  check("annual_report_submissions_state", sql`${t.state} IN ('pending','recorded')`),
  check("annual_report_submissions_outcome", sql`${t.outcome} IS NULL OR ${t.outcome} IN ('submitted','accepted','rejected')`),
  check("annual_report_submissions_size", sql`${t.byteSize} BETWEEN 1 AND 10485760`),
  check("annual_report_submissions_complete", sql`${t.state} <> 'recorded' OR (
    ${t.objectPath} IS NOT NULL AND ${t.sha256} IS NOT NULL AND ${t.outcome} IS NOT NULL
    AND ${t.submittedOn} IS NOT NULL AND ${t.reference} IS NOT NULL AND ${t.recordedAt} IS NOT NULL)`),
]);
export const insertAnnualReportSubmissionSchema = createInsertSchema(annualReportSubmissionsTable).omit({ id: true, createdAt: true });
export type AnnualReportSubmissionRecord = typeof annualReportSubmissionsTable.$inferSelect;