import {
  pgTable,
  uuid,
  varchar,
  char,
  smallint,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";

/**
 * Repozitorij oddanih KIR/KPR XML datotek za FURS.
 *
 * Vsak `POST /companies/:id/vat-submissions` ustvari en zapis z XML vsebino.
 * Status sledi životnemu ciklu: draft → submitted → accepted/rejected.
 *
 * XML je shranjen v object storage; `xmlStoragePath` je relativna pot oblike
 * `/objects/vat-xml/<companyId>/<period>/<id>.xml`.
 * Ker FURS eDavki SOAP integracija še ni implementirana, ostane status pri
 * `draft` in računovodja XML prenese ročno.
 */
export const vatSubmissionsTable = pgTable(
  "vat_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ── Kateri zavezanec / obdobje ──────────────────────────────────────────
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),

    /** Leto DDV obdobja (npr. 2026) */
    periodYear: smallint("period_year").notNull(),

    /** FURS koda obdobja: `MMMM` (npr. `0707` julij, `0709` Q3) */
    period: char("period", { length: 4 }).notNull(),

    /**
     * Vsebina evidence:
     *   KIR  — samo izdana stran
     *   KPR  — samo prejeta stran
     *   BOTH — obe
     */
    kind: varchar("kind", { length: 4 })
      .notNull()
      .$type<"KIR" | "KPR" | "BOTH">(),

    /**
     * Životni cikel oddaje:
     *   draft     — XML je generiran, ni bil še poslan
     *   submitted — poslan prek eDavki (za prihodnjo integracijo)
     *   accepted  — FURS sprejel
     *   rejected  — FURS zavrnil
     */
    status: varchar("status", { length: 10 })
      .notNull()
      .default("draft")
      .$type<"draft" | "submitted" | "accepted" | "rejected">(),

    /** Verzija FURS XML sheme (npr. `DDV_KIR_KPR_1.xsd`) */
    schemaVersion: varchar("schema_version", { length: 30 })
      .notNull()
      .default("DDV_KIR_KPR_1.xsd"),

    /**
     * Pot XML v object storage: `/objects/vat-xml/...`
     * NULL kadar object storage ni konfiguriran (fallback: inline XML v `xmlInline`).
     */
    xmlStoragePath: text("xml_storage_path"),

    /**
     * Inline XML fallback — shranjen ko object storage ni dosegljiv.
     * Omejen na ~4 MB (PostgreSQL TEXT).
     */
    xmlInline: text("xml_inline"),

    /** Število KIR vrstic v oddani datoteki (0 kadar KIR=false) */
    kirCount: smallint("kir_count").notNull().default(0),

    /** Število KPR vrstic v oddani datoteki (0 kadar KPR=false) */
    kprCount: smallint("kpr_count").notNull().default(0),

    /** Kdaj je bil XML generiran/ustvarjen */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Kdaj je bil poslan prek eDavki */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    /** Kdaj je FURS sprejel / zavrnil */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    /** Sporočilo FURS ob zavrnitvi */
    rejectionReason: text("rejection_reason"),

    /** Clerk userId računovodje ki je sprožil generacijo */
    createdBy: varchar("created_by", { length: 128 }).notNull(),
  },
  (t) => [
    index("ix_vat_submissions_company_period").on(
      t.companyId,
      t.periodYear,
      t.period,
    ),
    check("vat_submissions_kind_check", sql`kind IN ('KIR', 'KPR', 'BOTH')`),
    check("vat_submissions_status_check", sql`status IN ('draft', 'submitted', 'accepted', 'rejected')`),
  ],
);
