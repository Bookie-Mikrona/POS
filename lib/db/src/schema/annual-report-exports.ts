import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { companiesTable } from "./companies";

/** Archived bytes live in private App Storage; metadata and snapshot are immutable. */
export const annualReportExportsTable = pgTable("annual_report_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  format: text("format").notNull(),
  purpose: text("purpose").notNull(),
  revision: integer("revision").notNull(),
  fingerprint: text("fingerprint").notNull(),
  rulesVersion: text("rules_version").notNull(),
  publicationReviewed: boolean("publication_reviewed").notNull(),
  snapshot: jsonb("snapshot").notNull().$type<Record<string, unknown>>(),
  objectPath: text("object_path").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("annual_report_exports_scope").on(t.companyId, t.year, t.createdAt),
  unique("annual_report_exports_id_scope").on(t.id, t.companyId, t.year),
  check("annual_report_exports_year", sql`${t.year} BETWEEN 2000 AND 2100`),
  check("annual_report_exports_format", sql`${t.format} IN ('pdf','xlsx','xml','publication-pdf')`),
  check("annual_report_exports_purpose", sql`${t.purpose} IN ('review','statistics','publication','combined')`),
  check("annual_report_exports_size", sql`${t.byteSize} > 0`),
]);
export const insertAnnualReportExportSchema = createInsertSchema(annualReportExportsTable).omit({ id: true, createdAt: true });
export type AnnualReportExportRecord = typeof annualReportExportsTable.$inferSelect;