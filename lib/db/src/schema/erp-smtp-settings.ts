import { pgTable, uuid, text, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { companiesTable } from "./companies";

export const erpSmtpSettingsTable = pgTable("erp_smtp_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companiesTable.id, { onDelete: "cascade" }),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  user: text("smtp_user").notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  from: text("smtp_from").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("erp_smtp_settings_port_check", sql`${t.port} IN (465, 587)`)]);

export const insertErpSmtpSettingsSchema = createInsertSchema(erpSmtpSettingsTable);
export type ErpSmtpSettings = typeof erpSmtpSettingsTable.$inferSelect;
