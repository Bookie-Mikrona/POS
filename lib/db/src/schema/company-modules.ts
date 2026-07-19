import { pgTable, text, uuid, timestamp, unique } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const AVAILABLE_MODULES = ["erp", "pos"] as const;
export type AppModule = (typeof AVAILABLE_MODULES)[number];

export const companyModulesTable = pgTable(
  "company_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    /** Modul: 'erp' = Glavna knjiga | 'pos' = POS gostinstvo */
    module: text("module").$type<AppModule>().notNull(),
    enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
    /** Clerk user ID super admina, ki je aktiviral modul */
    enabledBy: text("enabled_by").notNull(),
  },
  (t) => [unique("unique_company_module").on(t.companyId, t.module)],
);

export type CompanyModule = typeof companyModulesTable.$inferSelect;
