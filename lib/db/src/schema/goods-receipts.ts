import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";
import { accountingPeriodsTable } from "./accounting-periods";
import { accountsTable } from "./accounts";
import { journalEntriesTable } from "./journal-entries";
import { invoicesTable } from "./invoices";

/**
 * ERP Prejemnica brez računa — blago prispe z dobavnico, račun sledi.
 *
 * Tok knjiženja:
 *   1. Ob ustvaritvi prejemnice (status = 'open'):
 *      DR inventoryAccountId (zaloga, npr. 310/660)
 *      CR transitAccountId   (prehodni konto, npr. 221 Neobračunano blago)
 *
 *   2. Ob ujemanju z računom (status = 'matched'):
 *      DR transitAccountId       (zapre 221)
 *      CR invoice.arApAccountId  (prenese na 220 Obveznosti do dobaviteljev)
 *
 * FURS/SRS: konto 221 = Vnaprej vračunani stroški / Neobračunano blago.
 * Spec: ERP 1. del, razdelek Zaloge in prehodni konti.
 */
export const goodsReceiptsTable = pgTable(
  "goods_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),

    /** Dobavitelj — obvezen */
    counterpartyId: uuid("counterparty_id")
      .notNull()
      .references(() => counterpartiesTable.id, { onDelete: "restrict" }),

    /** Računovodsko obdobje */
    periodId: uuid("period_id")
      .notNull()
      .references(() => accountingPeriodsTable.id, { onDelete: "restrict" }),

    /** Datum prejema blaga (datum dobavnice) — KIR/KPR P2 */
    receiptDate: date("receipt_date", { mode: "string" }).notNull(),

    /** Številka dobavnice/CMR/pakliста dobavitelja */
    deliveryNoteNo: text("delivery_note_no").notNull(),

    description: text("description"),

    /**
     * Status:
     *   open    — prejeta dobavnica, račun še ni prišel
     *   matched — račun je prišel in je bil preverjen/ujet
     *   voided  — stornirana (napaka, vrnitev blaga)
     */
    status: text("status").notNull().default("open").$type<"open" | "matched" | "voided">(),

    /**
     * Prehodni konto (npr. 221 Neobračunano blago).
     * CR ob knjiženju prejemnice, DR ob zapiranju z računom.
     */
    transitAccountId: uuid("transit_account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "restrict" }),

    /**
     * Zalogni konto (npr. 310 Material, 660 Blago).
     * DR ob knjiženju prejemnice (povečanje zaloge).
     */
    inventoryAccountId: uuid("inventory_account_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "restrict" }),

    /** Skupni znesek brez DDV (= vsota vrstic) */
    totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),

    /**
     * Avtomatično ustvarjena temeljnica ob knjiženju prejemnice.
     *   DR inventoryAccountId / CR transitAccountId
     */
    linkedEntryId: uuid("linked_entry_id").references(
      () => journalEntriesTable.id,
      { onDelete: "set null" },
    ),

    /**
     * Ujeti račun (prejeti račun iz tabele invoices).
     * Nastavi se ko računovodja poveže prejemnico z računom.
     */
    matchedInvoiceId: uuid("matched_invoice_id").references(
      () => invoicesTable.id,
      { onDelete: "restrict" },
    ),

    /**
     * Temeljnica za zapiranje prehodnega konta ob ujemanju z računom.
     *   DR transitAccountId / CR invoice.arApAccountId (220)
     */
    matchEntryId: uuid("match_entry_id").references(
      () => journalEntriesTable.id,
      { onDelete: "set null" },
    ),

    notes: text("notes"),

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("ix_goods_receipts_company").on(t.companyId),
    index("ix_goods_receipts_company_status").on(t.companyId, t.status),
    index("ix_goods_receipts_counterparty").on(t.counterpartyId),
    check("goods_receipts_status_check", sql`status IN ('open', 'matched', 'voided')`),
  ],
);

/**
 * Vrstice prejemnice.
 * Ena vrstica = ena vrsta blaga/materiala.
 */
export const goodsReceiptLinesTable = pgTable(
  "goods_receipt_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    goodsReceiptId: uuid("goods_receipt_id")
      .notNull()
      .references(() => goodsReceiptsTable.id, { onDelete: "cascade" }),

    description: text("description").notNull(),

    /** Konto za to vrstico (prepiše inventory_account_id na glavi) */
    accountId: uuid("account_id").references(() => accountsTable.id, {
      onDelete: "restrict",
    }),

    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull().default("1"),
    unitPrice: numeric("unit_price", { precision: 15, scale: 4 }).notNull(),

    /** quantity × unitPrice */
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),

    notes: text("notes"),
  },
  (t) => [
    index("ix_goods_receipt_lines_receipt").on(t.goodsReceiptId),
  ],
);
