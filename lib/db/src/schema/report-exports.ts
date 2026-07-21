import { pgTable, uuid, text, timestamp, jsonb, customType } from "drizzle-orm/pg-core";

// bytea custom type for storing PDF binary data
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Revizijska sled izvoženih PDF poročil.
 * Vsak izvoz (prenos ali pošiljanje po e-pošti) se zabeleži z vsemi parametri
 * in shranjenim PDF-om, ki ga je mogoče znova prenesti brez ponovnega generiranja.
 */
export const reportExportsTable = pgTable("report_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  /** Vrsta poročila: "balance-sheet", "income-statement", "trial-balance" */
  reportType: text("report_type").notNull(),
  /** Parametri poizvedbe (datumi, primerjalni datumi) */
  params: jsonb("params").notNull(),
  /** Ime datoteke */
  filename: text("filename").notNull(),
  /** Clerk user ID izvoznika */
  exportedBy: text("exported_by").notNull(),
  exportedAt: timestamp("exported_at", { withTimezone: true }).notNull().defaultNow(),
  /** Nastavljen samo pri pošiljanju po e-pošti */
  emailSentTo: text("email_sent_to"),
  /** Shranjeni PDF za ponovni prenos */
  pdfData: bytea("pdf_data").notNull(),
});

export type ReportExport = typeof reportExportsTable.$inferSelect;
