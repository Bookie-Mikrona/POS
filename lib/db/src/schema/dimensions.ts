import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Stroškovna mesta — analitična dimenzija za razporejanje stroškov.
 */
export const costCentersTable = pgTable("cost_centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  /** direktna | indirektna | projektna */
  tip: text("tip"),
  /** FK na samo sebe — hierarhija nadrejenega SM */
  parentId: uuid("parent_id"),
  /** Odgovorna oseba / vodja */
  odgovornaOseba: text("odgovorna_oseba"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Projekti — analitična dimenzija za projektno sledenje.
 */
export const projectsTable = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Oddelki — analitična dimenzija za organizacijske enote.
 */
export const departmentsTable = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CostCenter = typeof costCentersTable.$inferSelect;
export type Project = typeof projectsTable.$inferSelect;
export type Department = typeof departmentsTable.$inferSelect;
