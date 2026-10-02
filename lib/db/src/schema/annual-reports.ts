import { pgTable, uuid, integer, jsonb, text, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { createInsertSchema } from "drizzle-zod";

/** Accountant-reviewed reporting inputs, not journal entries or a replacement ledger. */
export const annualReportsTable = pgTable("annual_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  settings: jsonb("settings").notNull().$type<Record<string, unknown>>(),
  revision: integer("revision").notNull().default(1),
  reviewedFingerprint: text("reviewed_fingerprint"),
  reviewedBy: text("reviewed_by"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("annual_reports_company_year_unique").on(t.companyId, t.year),
  check("annual_reports_year_check", sql`${t.year} BETWEEN 2000 AND 2100`),
  check("annual_reports_revision_check", sql`${t.revision} > 0`),
]);

export const insertAnnualReportSchema = createInsertSchema(annualReportsTable).omit({ id: true });
export type AnnualReportRecord = typeof annualReportsTable.$inferSelect;