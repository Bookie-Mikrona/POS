import { sql } from "drizzle-orm";
import {
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";

export const purchaseSourceDocumentKinds = [
  "invoice",
  "delivery_note",
  "credit_note",
  "debit_note",
] as const;
export type PurchaseSourceDocumentKind = (typeof purchaseSourceDocumentKinds)[number];

/**
 * Kanonična identiteta ene dobaviteljeve listine, ne glede na to, ali je bila
 * zajeta skozi POS uvoz, ERP OCR ali ERP prejem blaga.
 */
export const purchaseSourceDocumentsTable = pgTable(
  "purchase_source_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => counterpartiesTable.id, { onDelete: "restrict" }),
    kind: text("kind").$type<PurchaseSourceDocumentKind>().notNull(),
    normalizedNumber: text("normalized_number"),
    displayNumber: text("display_number"),
    documentDate: date("document_date", { mode: "string" }),
    currency: text("currency").notNull().default("EUR"),
    contentSha256: text("content_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("purchase_source_documents_business_unique")
      .on(t.companyId, t.counterpartyId, t.normalizedNumber)
      .where(sql`${t.normalizedNumber} IS NOT NULL`),
    uniqueIndex("purchase_source_documents_hash_unique")
      .on(t.companyId, t.contentSha256)
      .where(sql`${t.contentSha256} IS NOT NULL`),
    index("purchase_source_documents_company_idx").on(t.companyId),
    index("purchase_source_documents_counterparty_idx").on(t.counterpartyId),
  ],
);

export type PurchaseSourceDocument = typeof purchaseSourceDocumentsTable.$inferSelect;