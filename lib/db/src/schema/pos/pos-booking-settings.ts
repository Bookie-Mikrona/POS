import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";
import { accountsTable } from "../accounts";

/**
 * Nastavitve POS → ERP knjiženja za dano podjetje.
 * En zapis na podjetje. Null = konto še ni nastavljen.
 *
 * Analitika po shemi: vrsta artikla (material/blago/storitev) × DDV stopnja
 * Konvencija: KKK-PP-VV (3 SIR + 2 poslovni prostor + 2 vrsta/kategorija)
 */
export const posBookingSettingsTable = pgTable("pos_booking_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .unique()
    .references(() => companiesTable.id, { onDelete: "cascade" }),

  // ── Temeljnica 1: Prodaja — DEBET (plačilni načini) ────────────────────────
  /** Blagajna gotovina — debet (npr. 1000110) */
  cashAccountId: uuid("cash_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prehodni konto POS terminal / kartice — debet (npr. 1000120) */
  cardAccountId: uuid("card_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Darilni boni — razknjiženje predujma — debet (npr. 2300110) */
  voucherAccountId: uuid("voucher_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Ostala negotovinska plačila (Sodexo, TRR kupci…) — debet */
  otherPaymentAccountId: uuid("other_payment_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Temeljnica 1: Prodaja — KREDIT (prihodki po vrsti × DDV) ───────────────
  /** Prihodki — material 9,5 % (hrana kuhinja) — kredit (npr. 7620110) */
  revenueMaterial95AccountId: uuid("revenue_material_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — material 22 % (točene alkohol. pijače) — kredit (npr. 7620210) */
  revenueMaterial22AccountId: uuid("revenue_material_22_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — blago 22 % (steklenice alkohol) — kredit (npr. 7620310) */
  revenueGoods22AccountId: uuid("revenue_goods_22_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — blago 9,5 % (steklenice brezalkohol) — kredit (npr. 7620320) */
  revenueGoods95AccountId: uuid("revenue_goods_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — storitev (postrežba 22 %) — kredit (npr. 7600110) */
  revenueServiceAccountId: uuid("revenue_service_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** [Zastarelo] Splošni prihodki — fallback, če analitika ni nastavljena */
  revenueAccountId: uuid("revenue_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Temeljnica 1: Prodaja — KREDIT (DDV po stopnji) ────────────────────────
  /** Obveznost DDV 9,5 % — kredit (npr. 2600195) */
  vat95AccountId: uuid("vat_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Obveznost DDV 22 % — kredit (npr. 2600122) */
  vat22AccountId: uuid("vat_22_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** [Zastarelo] Splošni izhodni DDV — fallback */
  vatLiabilityAccountId: uuid("vat_liability_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Temeljnica 2: Prejemnice — DEBET (zaloge po vrsti) ─────────────────────
  /** Zaloga materiala (razred 3) — debet/kredit (npr. 3100110) */
  inventoryMaterialAccountId: uuid("inventory_material_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Zaloga blaga (razred 6) — debet/kredit (npr. 6600110) */
  inventoryGoodsAccountId: uuid("inventory_goods_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** [Zastarelo] Splošna zaloga — fallback */
  inventoryAccountId: uuid("inventory_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Obveznosti do dobaviteljev — kredit (npr. 2200110) */
  payablesAccountId: uuid("payables_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Temeljnica 3: Poraba (COGS) — DEBET ────────────────────────────────────
  /** Stroški materiala po normativih/izdajnicah — debet (npr. 4000110) */
  cogsMaterialAccountId: uuid("cogs_material_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Nabavna vrednost prodanega blaga — debet (npr. 7020110) */
  cogsGoodsAccountId: uuid("cogs_goods_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** [Zastarelo] Splošni COGS — fallback */
  cogsAccountId: uuid("cogs_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PosBookingSettings = typeof posBookingSettingsTable.$inferSelect;
export type InsertPosBookingSettings = typeof posBookingSettingsTable.$inferInsert;
