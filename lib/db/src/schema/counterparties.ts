import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const counterpartyTypeEnum = pgEnum("counterparty_type", [
  "customer",
  "supplier",
  "both",
]);

/**
 * Poslovni partnerji — kupci in dobavitelji.
 * Tip "both" pomeni, da je partner hkrati kupec in dobavitelj.
 */
export const counterpartiesTable = pgTable("counterparties", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  type: counterpartyTypeEnum("type").notNull(),
  name: text("name").notNull(),
  /** Davčna številka (SI12345678 ali tuja) */
  taxId: text("tax_id"),
  /** Matična številka podjetja (8-mestna, AJPES register) */
  registrationNumber: text("registration_number"),
  /** Zavezanec za DDV */
  vatPayer: boolean("vat_payer").notNull().default(false),
  address: text("address"),
  postCode: text("post_code"),
  city: text("city"),
  country: text("country").default("SI"),
  email: text("email"),
  phone: text("phone"),
  iban: text("iban"),
  /** Plačilni rok v dnevih (privzeto 30) */
  paymentTermsDays: integer("payment_terms_days").default(30),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Counterparty = typeof counterpartiesTable.$inferSelect;
