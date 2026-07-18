import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const accountingRoleEnum = pgEnum("accounting_role", [
  "owner",
  "accountant",
  "viewer",
]);

export const accountingRolesTable = pgTable(
  "accounting_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    role: accountingRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("unique_user_company").on(t.clerkUserId, t.companyId)],
);

export const insertAccountingRoleSchema = createInsertSchema(
  accountingRolesTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export const selectAccountingRoleSchema =
  createSelectSchema(accountingRolesTable);
export type InsertAccountingRole = z.infer<typeof insertAccountingRoleSchema>;
export type AccountingRole = typeof accountingRolesTable.$inferSelect;
