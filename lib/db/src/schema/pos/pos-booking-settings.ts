import { boolean, date, pgTable, uuid, timestamp, varchar } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";
import { accountsTable } from "../accounts";
import { vatCodeTable } from "../vat-code";
import { counterpartiesTable } from "../counterparties";

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
  /** TRR — uporabi se samo kot bančna stopnja prenosa prek 109. */
  bankAccountId: uuid("bank_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /**
   * Denar na poti (npr. 1090000). Vsi prenosi med TRR in blagajno gredo prek tega
   * konta; ni prihodek, odhodek ali DDV dogodek.
   */
  cashInTransitAccountId: uuid("cash_in_transit_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prehodni konto POS terminal / kartice — debet (npr. 1000120) */
  cardAccountId: uuid("card_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Obveznost do osebja iz naslova kartične napitnine — kredit. */
  tipsLiabilityAccountId: uuid("tips_liability_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki od napitnin v režimu, kjer jih obvladuje delodajalec — kredit. */
  tipsRevenueAccountId: uuid("tips_revenue_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Izhodni DDV od napitnin pod nadzorom delodajalca — kredit. */
  tipsVatAccountId: uuid("tips_vat_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Odstotni del kartične provizije, ki je pripisan napitnini — debet stroška. */
  tipsCardFeeExpenseAccountId: uuid("tips_card_fee_expense_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /**
   * Bon za pico — obstoječi plačilni tok. Darilni boni se od Koraka 3a vodijo
   * izključno prek advancePaymentsAccountId.
   */
  voucherAccountId: uuid("voucher_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Darilni boni — predplačila: izdaja kredit, unovčitev debet (npr. 2300110). */
  advancePaymentsAccountId: uuid("advance_payments_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Privzeto samo opozori, kadar unovčitve presežejo skupno izdane bone. */
  warnGiftVoucherNegative: boolean("warn_gift_voucher_negative").notNull().default(true),
  /** Ostala negotovinska plačila (Sodexo, TRR kupci…) — debet */
  otherPaymentAccountId: uuid("other_payment_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /**
   * Pogodbene malice — začasna terjatev do izdaje mesečnega A-računa.
   * Dnevno D ta konto / K prihodki + DDV; mesečno D 120 / K ta konto.
   */
  contractReceivableTransitAccountId: uuid("contract_receivable_transit_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** SŠP terjatev do MDDSZ/ŠOS — debet, praviloma konto 165. */
  subsidyReceivableAccountId: uuid("subsidy_receivable_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Partner za SŠP terjatev, praviloma MDDSZ/ŠOS. */
  subsidyCounterpartyId: uuid("subsidy_counterparty_id")
    .references(() => counterpartiesTable.id, { onDelete: "set null" }),

  // ── Temeljnica 1: Prodaja — KREDIT (prihodki po vrsti × DDV) ───────────────
  /** Prihodki — material 9,5 % (hrana kuhinja) — kredit (npr. 7620110) */
  revenueMaterial95AccountId: uuid("revenue_material_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — material 22 % (točene alkohol. pijače) — kredit (npr. 7620210) */
  revenueMaterial22AccountId: uuid("revenue_material_22_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — material 5 % — kredit. */
  revenueMaterial5AccountId: uuid("revenue_material_5_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — blago 22 % (steklenice alkohol) — kredit (npr. 7620310) */
  revenueGoods22AccountId: uuid("revenue_goods_22_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — blago 9,5 % (steklenice brezalkohol) — kredit (npr. 7620320) */
  revenueGoods95AccountId: uuid("revenue_goods_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — blago 5 % — kredit. */
  revenueGoods5AccountId: uuid("revenue_goods_5_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — storitev 22 % — kredit (npr. 7600110). */
  revenueService22AccountId: uuid("revenue_service_22_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — storitev 9,5 % — kredit. */
  revenueService95AccountId: uuid("revenue_service_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prihodki — storitev 5 % — kredit. */
  revenueService5AccountId: uuid("revenue_service_5_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** [Zastarelo] Skupni prihodki storitev; ohranjen samo za migracijo starih nastavitev. */
  revenueServiceAccountId: uuid("revenue_service_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** [Zastarelo] Splošni prihodki — fallback, če analitika ni nastavljena */
  revenueAccountId: uuid("revenue_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Temeljnica 1: Prodaja — KREDIT (DDV po stopnji) ────────────────────────
  /** Obveznost DDV 9,5 % — kredit (npr. 2600195) */
  vat95AccountId: uuid("vat_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Obveznost DDV 5 % — kredit. */
  vat5AccountId: uuid("vat_5_account_id")
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
  /** Zaloga povratne embalaže — konto 3107000, debet. */
  returnablePackagingAccountId: uuid("returnable_packaging_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Strošek odpisa povratne embalaže — konto razreda 4. */
  returnablePackagingWriteoffAccountId: uuid("returnable_packaging_writeoff_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Prehodni konto obračuna nabave (109) — uporabi ga nabavna temeljnica v naslednjem koraku. */
  nabavaObracunAccountId: uuid("nabava_obracun_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Privzeti vstopni DDV, kadar za stopnjo ni ločenega konta. */
  inputVatAccountId: uuid("input_vat_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Vstopni DDV 22 %. */
  inputVat22AccountId: uuid("input_vat_22_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Vstopni DDV 9,5 %. */
  inputVat95AccountId: uuid("input_vat_95_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Vstopni DDV 5 %. */
  inputVat5AccountId: uuid("input_vat_5_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Strošek, ki ga uporabnik pri prejemnici ne kapitalizira v zalogo. */
  otherCostsAccountId: uuid("other_costs_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Neposredni strošek surovin pri uvozu POS prejemnice. */
  rawMaterialExpenseAccountId: uuid("raw_material_expense_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Neposredne prevozne storitve pri nabavi. */
  inboundFreightExpenseAccountId: uuid("inbound_freight_expense_account_id")
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

  // ── Temeljnica 4: Lastna poraba / Reprezentanca + KIR ─────────────────────
  /**
   * Terjatve do kupcev za KIR (Knjigo izdanih računov) — npr. 1200110.
   * Obvezno za ustvarjanje KIR zapisov v ERP. Če ni nastavljen, se KIR preskoči.
   */
  kirArAccountId: uuid("kir_ar_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /**
   * Odhodki iz naslova lastne porabe — debet v T4 (npr. 4830110).
   * Brezplačni POS računi tipa lastna_poraba: DDV se obračuna na face value.
   */
  lastnaPorabaAccountId: uuid("lastna_poraba_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /**
   * Stroški reprezentance — debet v T4 (npr. 4861000).
   * Brezplačni POS računi tipa reprezentanca: DDV se obračuna na face value.
   */
  reprezentancaAccountId: uuid("reprezentanca_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── DDV kode za KIR vrstice (izhodni DDV) ─────────────────────────────────
  /**
   * FURS DDV koda za izhodni DDV 9,5 % (KIR).
   * Ko je nastavljeno, DDV vrstica v T1/T4 temeljnicah dobi vatCodeId →
   * ob potrditvi se ustvari vat_ledger zapis.
   */
  vat95VatCodeId: uuid("vat95_vat_code_id")
    .references(() => vatCodeTable.id, { onDelete: "set null" }),
  /**
   * FURS DDV koda za izhodni DDV 22 % (KIR).
   */
  vat22VatCodeId: uuid("vat22_vat_code_id")
    .references(() => vatCodeTable.id, { onDelete: "set null" }),
  /**
   * FURS DDV koda za izhodni DDV 5 % (KIR) — npr. S5.
   */
  vat5VatCodeId: uuid("vat5_vat_code_id")
    .references(() => vatCodeTable.id, { onDelete: "set null" }),

  // ── Začetna zaloga — otvoritvena temeljnica ────────────────────────────────
  /**
   * Otvoritveni konto bilance stanja — kredit (npr. 990 ali 900).
   * Debet = inventoryMaterialAccountId / inventoryGoodsAccountId (obstoječa konti zalog).
   * Knjiženje se ustvari ob vnosu začetne zaloge v POS.
   * Referenca: POS:ZZ:{leto}
   */
  openingBalanceAccountId: uuid("opening_balance_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /**
   * Konto kala. Dnevna/mesečna poraba prenese vrednost kala z materialnega
   * stroška na ta konto; zamrznjene pripravljene porcije same ne knjižijo GL.
   */
  wasteAccountId: uuid("waste_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),

  // ── Frekvenca zbirnih temeljnic (company-scope) ───────────────────────────
  salesBookingFrequency: varchar("sales_booking_frequency", { length: 10 })
    .notNull()
    .default("daily"),
  consumptionBookingFrequency: varchar("consumption_booking_frequency", { length: 10 })
    .notNull()
    .default("monthly"),
  frequencyEffectiveFrom: date("frequency_effective_from"),
  // Interni prejšnji vrednosti sta potrebni, da tekoči mesec ostane v starem
  // režimu tudi po shranjeni spremembi za naslednji mesec.
  salesBookingFrequencyPrevious: varchar("sales_booking_frequency_previous", { length: 10 }),
  consumptionBookingFrequencyPrevious: varchar("consumption_booking_frequency_previous", { length: 10 }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PosBookingSettings = typeof posBookingSettingsTable.$inferSelect;
export type InsertPosBookingSettings = typeof posBookingSettingsTable.$inferInsert;
