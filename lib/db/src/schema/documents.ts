import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  pgEnum,
  numeric,
  integer,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";
import { invoicesTable } from "./invoices";

/**
 * Dokumenti za AI/OCR obdelavo.
 *
 * Tok: nalaganje → OCR (pending→processing→done) → predlog kontiranja (proposed) →
 *      računovodja potrdi (confirmed) → avtomatičen draft račun (linked)
 */

export const documentStatusEnum = pgEnum("document_status", [
  "pending",      // Naložen, čaka na obdelavo
  "processing",   // OCR se izvaja
  "done",         // OCR zaključen, predlog pripravljen
  "confirmed",    // Računovodja potrdil predlog
  "rejected",     // Računovodja zavrnil
  "error",        // OCR napaka
]);

export const documentTypeEnum = pgEnum("document_type", [
  "invoice_received",  // Prejet račun (dobaviteljev)
  "invoice_issued",    // Izdan račun (kopija lastnega)
  "other",             // Drugo
]);

/**
 * Predlagana vrstica računa iz OCR.
 * Shranjeno kot JSONB v documents.proposed_lines.
 */
export interface ProposedLine {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;          // % (npr. 22, 9.5, 0)
  vatBase: number;
  vatAmount: number;
  accountCode?: string;     // Predlagana koda konta
  accountId?: string;       // Predlagan ID konta (fuzzy match)
  confidence: number;       // 0-1 zaupnost predloga
  /** Vir predloga konta */
  suggestionSource?: "history" | "pattern";
  /** Število preteklih potrditev tega konta za istega partnerja (samo za "history") */
  suggestionCount?: number;
}

/**
 * Strukturirani izkupiček OCR za celoten dokument.
 */
export interface OcrResult {
  rawText: string;
  confidence: number;       // Skupna zaupnost 0-1
  /** Prepoznane metapodatke dokumenta */
  counterpartyName?: string;
  counterpartyTaxId?: string;
  counterpartyAddress?: string;
  invoiceNumber?: string;
  invoiceDate?: string;     // ISO date string
  dueDate?: string;
  totalNet?: number;        // Skupaj brez DDV
  totalVat?: number;        // Skupaj DDV
  totalGross?: number;      // Skupaj z DDV
  currency?: string;        // Privzeto EUR
  lines: ProposedLine[];
  /** Predlagani partner (fuzzy match) */
  suggestedCounterpartyId?: string;
  suggestedCounterpartyName?: string;
  /** Predlagana vrsta dokumenta */
  suggestedDocumentType?: "invoice_received" | "invoice_issued";
  /** Predlagano obdobje */
  suggestedPeriodId?: string;
  /** Napaka OCR */
  error?: string;
}

export const documentsTable = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  /** Originalno ime datoteke */
  fileName: text("file_name").notNull(),
  /** MIME tip (application/pdf, image/jpeg, image/png) */
  mimeType: text("mime_type").notNull(),
  /** Velikost v bajtih */
  fileSizeBytes: integer("file_size_bytes"),
  /** Object storage pot (npr. /objects/uploads/uuid) */
  objectPath: text("object_path").notNull(),
  status: documentStatusEnum("status").notNull().default("pending"),
  documentType: documentTypeEnum("document_type"),
  /** Napaka OCR (status = error) */
  errorMessage: text("error_message"),
  /** Surov OCR izkupiček + predlogi (JSON) */
  ocrResult: jsonb("ocr_result").$type<OcrResult>(),
  /** Računovodjeve popravke (JSON — iste polje kot ocrResult) */
  confirmedData: jsonb("confirmed_data").$type<OcrResult>(),
  /**
   * Ustvarjeni račun (po potrditvi).
   *
   * INVARIANT: ta FK kaže IZ dokumenta NA račun — ne obratno.
   * Ker ni onDelete: "cascade", brisanje dokumenta ne izbriše računa ali njegovih vrstic.
   * Račun in knjižbe ostanejo neodvisni od dokumenta ter se uporabljajo
   * kot učni kontekst za prihodnje predloge kontiranja.
   * Prav tako ni obratnega FK (invoice → document), zato brisanje
   * računa ne vpliva na dokument.
   */
  linkedInvoiceId: uuid("linked_invoice_id").references(() => invoicesTable.id),
  /** Naložil (Clerk userId) */
  uploadedByClerkId: text("uploaded_by_clerk_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Document = typeof documentsTable.$inferSelect;
