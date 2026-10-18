import { pgTable, uuid, text, timestamp, jsonb, customType, index } from "drizzle-orm/pg-core";

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
 * Začasna zgodovina, ne trajni arhiv: urni API scheduler briše zapise in PDF-e
 * po REPORT_EXPORT_RETENTION_DAYS (privzeto 365 dni). Izvorne knjižbe ostanejo.
 * Shranjevanje serializira preverjanje kvote po podjetju in atomsko odstrani
 * najstarejše kopije tudi pred iztekom hrambe. REPORT_EXPORT_QUOTA_MB (500 MB)
 * in REPORT_EXPORT_QUOTA_MB_BY_COMPANY določata omejitev dejanskih PDF bajtov.
 * Posamezen PDF nad kvoto je zavrnjen, ne da bi odstranil obstoječe kopije.
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
  /** Prikazna identiteta ob izvozu; null samo pri starejših zapisih. */
  exportedByName: text("exported_by_name"),
  exportedAt: timestamp("exported_at", { withTimezone: true }).notNull().defaultNow(),
  /** Nastavljen samo pri pošiljanju po e-pošti */
  emailSentTo: text("email_sent_to"),
  /** Shranjeni PDF za ponovni prenos */
  pdfData: bytea("pdf_data").notNull(),
}, (table) => [
  // Global oldest-first retention batches, including the stable ID tie-breaker.
  index("report_exports_retention_idx").on(table.exportedAt, table.id),
  // Backward scan serves the company's newest 200 exports without sorting.
  index("report_exports_company_history_idx").on(table.companyId, table.exportedAt),
]);

export type ReportExport = typeof reportExportsTable.$inferSelect;
