import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Globalne nastavitve sistema (key-value store).
 * Ključ `erp_owner_company_id` — UUID podjetja, ki je lastnik ERP paketa.
 */
export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type SystemSetting = typeof systemSettingsTable.$inferSelect;
