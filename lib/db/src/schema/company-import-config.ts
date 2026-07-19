import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Nastavitve uvoza bančnega izpiska po podjetju.
 * Shranjuje privzete konte za uvoz, da so dostopni na vseh napravah.
 */
export const companyImportConfigTable = pgTable("company_import_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .unique()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  bankAccountId: text("bank_account_id"),
  arAccountId: text("ar_account_id"),
  apAccountId: text("ap_account_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
