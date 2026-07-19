import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  numeric,
  date,
  pgEnum,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { accountsTable } from "./accounts";

/**
 * DDV kode (šifranti) — verzionirana konfiguracija stopenj.
 * Vsaka koda ima:
 *   - stopnjo DDV v %
 *   - konto izstopnega DDV (za izdane račune)
 *   - konto vstopnega DDV (za prejete račune)
 *   - veljavnost (valid_from / valid_to) — za historične spremembe stopenj
 *
 * Standard SLO:
 *   S22  — Standardna stopnja 22%
 *   S095 — Znižana stopnja 9,5%
 *   OP   — Oproščeno 0%
 *   RC   — Reverse charge (obratna davčna obveznost)
 */

export const vatBehaviorEnum = pgEnum("vat_behavior", [
  "standard",   // Obračunan DDV
  "exempt",     // Oproščeno — 0% brez odbitka
  "zero_rated", // 0% z odbitkom (izvoz)
  "reverse_charge", // Obratna davčna obveznost
]);

export const vatCodesTable = pgTable("vat_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  /** Kratka koda (npr. S22, S095, OP, RC) */
  code: text("code").notNull(),
  name: text("name").notNull(),
  /** Stopnja DDV v % */
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
  behavior: vatBehaviorEnum("behavior").notNull().default("standard"),
  /** Konto izstopnega DDV (za izdane račune, npr. 260xxx / 450xxx) */
  accountOutputId: uuid("account_output_id").references(() => accountsTable.id),
  /** Konto vstopnega DDV (za prejete račune, npr. 160xxx) */
  accountInputId: uuid("account_input_id").references(() => accountsTable.id),
  /** Veljavno od (null = vedno) */
  validFrom: date("valid_from", { mode: "string" }),
  /** Veljavno do (null = trenutno veljavna) */
  validTo: date("valid_to", { mode: "string" }),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type VatCode = typeof vatCodesTable.$inferSelect;
