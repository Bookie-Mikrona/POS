import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  unique,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";
import { accountsTable } from "./accounts";

/**
 * Predloge kontiranja po partnerju — shranjene ob vsaki potrditvi dokumenta.
 *
 * Ko računovodja potrdi dokument, se vsak par (partner + konto vrstice) upserta
 * v to tabelo. Ob naslednjem dokumentu istega partnerja se ti pari predlagajo
 * pred splošnim AI predlogom, kar zagotavlja progresivno izboljšanje natančnosti.
 */
export const counterpartyAccountTemplatesTable = pgTable(
  "counterparty_account_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => counterpartiesTable.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    /** Vrsta dokumenta, iz katerega je bil par potrjen */
    documentType: text("document_type").notNull().default("invoice_received"),
    /** Opis vrstice za prikaz v UI (zadnji potrjeni) */
    lastLineDescription: text("last_line_description"),
    /** Kolikokrat je bil ta par potrjen — za razvrščanje predlogov */
    usageCount: integer("usage_count").notNull().default(1),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uq_cp_account_template").on(
      t.companyId,
      t.counterpartyId,
      t.accountId,
      t.documentType,
    ),
  ],
);

export type CounterpartyAccountTemplate =
  typeof counterpartyAccountTemplatesTable.$inferSelect;
