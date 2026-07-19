import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const accountTypeEnum = pgEnum("account_type", [
  "asset",       // Sredstva
  "liability",   // Obveznosti
  "equity",      // Kapital
  "revenue",     // Prihodki
  "expense",     // Odhodki/Stroški
]);

/** DDV vedenje konta (npr. izstopni DDV, vstopni DDV, brez DDV) */
export const taxBehaviorEnum = pgEnum("tax_behavior", [
  "none",           // Brez DDV
  "output_vat",     // Izstopni DDV (prodaja)
  "input_vat",      // Vstopni DDV (nabava)
  "exempt",         // Oproščeno
]);

export const accountsTable = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    /** Številka konta (npr. "1000", "1100", "020") */
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    /** Nadrejeni konto za hierarhijo */
    parentId: uuid("parent_id"),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),
    /** Ali se lahko na ta konto knjižijo vrstice (false = samo skupinski konto) */
    allowsPosting: boolean("allows_posting").notNull().default(true),
    /** Ali vrstica temeljnice na ta konto zahteva poslovnega partnerja */
    requiresPartner: boolean("requires_partner").notNull().default(false),
    /** Ali vrstica temeljnice na ta konto zahteva stroškovno mesto */
    requiresCostCenter: boolean("requires_cost_center").notNull().default(false),
    /** Ali vrstica temeljnice na ta konto zahteva projekt */
    requiresProject: boolean("requires_project").notNull().default(false),
    /** DDV vedenje tega konta */
    taxBehavior: taxBehaviorEnum("tax_behavior").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("unique_company_account_code").on(t.companyId, t.code)],
);

export const insertAccountSchema = createInsertSchema(accountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectAccountSchema = createSelectSchema(accountsTable);
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
