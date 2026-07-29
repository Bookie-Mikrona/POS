import { pgTable, text, serial, integer, numeric, boolean } from "drizzle-orm/pg-core";

/**
 * vat_rule — DDV pravila za razreševanje stopnje glede na kontekst.
 * supply_kind: 'eat_in' | 'to_go' | NULL (=katerokoli)
 * tax_category: 'food' | 'hot_beverage' | 'cold_beverage' | 'alcoholic' | NULL (=katerokoli)
 * added_sugar: true/false/NULL (=katerokoli)
 * priority: nižja številka = višja prioriteta
 * configurable: true = pravilo velja le ob nastavitvi toGoTopliNapitekStopnja=liberalno
 */
export const vatRuleTable = pgTable("vat_rule", {
  id: serial("id").primaryKey(),
  priority: integer("priority").notNull().default(100),
  supplyKind: text("supply_kind"),
  taxCategory: text("tax_category"),
  addedSugar: boolean("added_sugar"),
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
  configurable: boolean("configurable").notNull().default(false),
  label: text("label").notNull(),
});

export type VatRule = typeof vatRuleTable.$inferSelect;
