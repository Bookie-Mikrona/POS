import { pgTable, uuid, timestamp, integer, text } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { accountsTable } from "./accounts";

/**
 * Nastavitve knjiženja amortizacije (OS Faza 3c/2).
 * En zapis na podjetje.
 *
 * kontoStroskaId  — privzeti konto STROŠKA amortizacije (V BREME, npr. 430x)
 * kontoPopravkaId — privzeti konto POPRAVKA VREDNOSTI (V DOBRO, npr. 019x/029x/039x)
 *
 * Kadar je na glavi sredstva nastavljen lasten konto, se ta prednost pred privzetim.
 * Oba sta NULL ob ustvarjanju — uporabnik mora nastaviti pred prvim knjiženjem.
 */
export const osAmortizacijaNastavitveTable = pgTable("os_amortizacija_nastavitve", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .unique()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  /** Privzeti konto stroška amortizacije → debet pri knjiženju (npr. 4300) */
  kontoStroskaId: uuid("konto_stroska_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Privzeti konto popravka vrednosti OS → kredit pri knjiženju (npr. 0190) */
  kontoPopravkaId: uuid("konto_popravka_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /**
   * Lastno leto amortizacije modula OS (per company).
   * NEODVISNO od accounting_periods glavne knjige.
   * Moduli delajo v različnih letih hkrati — OS ima svoje obdobje, GLK svojega.
   * NULL = ni nastavljeno (privzeto tekoče leto).
   */
  osLeto: integer("os_leto"),
  /**
   * Pravilo prvega meseca amortizacije (po računovodskem aktu podjetja):
   *   'naslednji_dan'   → prvi mesec = mesec, v katerega pade (datum_aktivacije + 1 dan)
   *   'naslednji_mesec' → prvi mesec = mesec_aktivacije + 1 (ne glede na dan)
   * Privzeto: 'naslednji_dan'.
   */
  praviloZacetkaAmortizacije: text("pravilo_zacetka_amortizacije")
    .notNull()
    .default("naslednji_dan"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type OsAmortizacijaNastavitve = typeof osAmortizacijaNastavitveTable.$inferSelect;
