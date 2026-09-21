import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const osRoleEnum = pgEnum("os_role", [
  "os_admin",
  "os_user",
  "os_viewer",
]);

/** Dostop do modula Osnovna sredstva — neodvisen od ERP/POS */
export const osRolesTable = pgTable(
  "os_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    /** os_admin = polno urejanje; os_user = vnos/urejanje; os_viewer = samo branje */
    role: osRoleEnum("role").notNull().default("os_viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("unique_os_user_company").on(t.clerkUserId, t.companyId)],
);

export type OsRoleRecord = typeof osRolesTable.$inferSelect;
export type OsRoleValue = "os_admin" | "os_user" | "os_viewer";
