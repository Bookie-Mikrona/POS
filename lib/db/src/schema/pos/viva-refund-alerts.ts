import { pgTable, uuid, integer, serial, text, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "../companies";
import { vivaVracilaTable } from "./viva-vracila";

export const vivaRefundAlertSettingsTable = pgTable("viva_refund_alert_settings", {
  companyId: uuid("company_id").primaryKey().references(() => companiesTable.id),
  overdueHours: integer("overdue_hours").notNull().default(24),
  criticalHours: integer("critical_hours").notNull().default(72),
}, t => [
  check("viva_refund_alert_thresholds", sql`${t.overdueHours} >= 1 AND ${t.criticalHours} > ${t.overdueHours} AND ${t.criticalHours} <= 8760`),
]);

export const vivaRefundAlertsTable = pgTable("viva_refund_alerts", {
  id: serial("id").primaryKey(),
  refundId: integer("refund_id").notNull().references(() => vivaVracilaTable.id),
  threshold: text("threshold", { enum: ["overdue", "critical"] }).notNull(),
  thresholdHours: integer("threshold_hours").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, t => [
  unique("viva_refund_alert_once_per_threshold").on(t.refundId, t.threshold),
  check("viva_refund_alert_threshold", sql`${t.threshold} IN ('overdue', 'critical')`),
]);
