import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";
import { accountsTable } from "../accounts";

/**
 * Nastavitve POS → ERP knjiženja za dano podjetje.
 * En zapis na podjetje. Null = konto še ni nastavljen.
 *
 * Vsak dan se avtomatsko generirajo do 3 osnutki temeljnic:
 *   1. Prodaja  (Z-poročilo)       — ref POS:PRODAJA:YYYY-MM-DD
 *   2. Prejemnice (blago od dobaviteljev) — ref POS:PREJEMNICA:YYYY-MM-DD
 *   3. Poraba blaga (COGS / razknjižba) — ref POS:PORABA:YYYY-MM-DD
 */
export const posBookingSettingsTable = pgTable("pos_booking_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .unique()
    .references(() => companiesTable.id, { onDelete: "cascade" }),

  // ── Temeljnica 1: Prodaja ────────────────────────────────────────────────
  /** Prihodki od prodaje — kredit (npr. 760) */
  revenueAccountId: uuid("revenue_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Blagajna — gotovina — debet (npr. 100) */
  cashAccountId: uuid("cash_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Terjatve do kartičnega processorja — debet (npr. 120) */
  cardAccountId: uuid("card_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Ostala plačila (boni, negotovinsko…) — debet (npr. 120 ali 165) */
  otherPaymentAccountId: uuid("other_payment_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Izhodni DDV — kredit (npr. 260) */
  vatLiabilityAccountId: uuid("vat_liability_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Temeljnica 2: Prejemnice ─────────────────────────────────────────────
  /** Zaloge blaga — debet/kredit (npr. 310) */
  inventoryAccountId: uuid("inventory_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Obveznosti do dobaviteljev — kredit (npr. 220) */
  payablesAccountId: uuid("payables_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Temeljnica 3: Poraba blaga ───────────────────────────────────────────
  /** Stroški prodanega blaga — debet (npr. 400/402) */
  cogsAccountId: uuid("cogs_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PosBookingSettings = typeof posBookingSettingsTable.$inferSelect;
export type InsertPosBookingSettings = typeof posBookingSettingsTable.$inferInsert;
