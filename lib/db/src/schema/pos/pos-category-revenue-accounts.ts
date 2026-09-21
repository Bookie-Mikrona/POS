import { integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { accountsTable } from "../accounts";
import { companiesTable } from "../companies";

/**
 * Prihodkovni konto POS kategorije.
 *
 * categoryId namenoma nima FK-ja na kategorije: potrjena POS postavka hrani
 * zgodovinski posnetek kategorije, zato mora preslikava ostati uporabna tudi,
 * če se kategorija pozneje izbriše iz aktivnega POS šifranta.
 */
export const posCategoryRevenueAccountsTable = pgTable("pos_category_revenue_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pos_category_revenue_accounts_company_category_uq")
    .on(table.companyId, table.categoryId),
]);

export type PosCategoryRevenueAccount = typeof posCategoryRevenueAccountsTable.$inferSelect;
export type InsertPosCategoryRevenueAccount = typeof posCategoryRevenueAccountsTable.$inferInsert;