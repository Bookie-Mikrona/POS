import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const periodStatusEnum = pgEnum("period_status", ["open", "locked"]);

export const accountingPeriodsTable = pgTable("accounting_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  /** Ime obdobja, npr. "Januar 2026" ali "Poslovno leto 2026" */
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  status: periodStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertAccountingPeriodSchema = createInsertSchema(
  accountingPeriodsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const selectAccountingPeriodSchema =
  createSelectSchema(accountingPeriodsTable);
export type InsertAccountingPeriod = z.infer<
  typeof insertAccountingPeriodSchema
>;
export type AccountingPeriod = typeof accountingPeriodsTable.$inferSelect;
