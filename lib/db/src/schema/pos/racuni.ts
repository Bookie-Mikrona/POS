import { pgTable, text, serial, integer, numeric, timestamp, boolean, uuid, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { counterpartiesTable } from "../counterparties";
import { relations, sql } from "drizzle-orm";
import { enoteTable } from "./enote";
import { narocilaTable } from "./narocila";
import { izmeneTable } from "./izmene";
import { tipPoliciesTable } from "./tip-ledger";
import { posKarticnaPlacilaAttemptTable } from "./karticna-placila-attempts";

export const racuniTable = pgTable("racuni", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id),
  izmenaId: integer("izmena_id").references(() => izmeneTable.id),
  stevilkaRacuna: text("stevilka_racuna").notNull(),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull(),
  ddv: numeric("ddv", { precision: 10, scale: 2 }).notNull(),
  osnova: numeric("osnova", { precision: 10, scale: 2 }),
  placilnaNacin: text("placilna_nacin", { enum: ["gotovina", "kartica", "bon", "bon_pica", "negotovinsko", "reprezentanca", "lastna_poraba"] }).notNull(),
  status: text("status", { enum: ["poslan", "napaka", "testni", "storniran"] }).notNull().default("testni"),
  zoi: text("zoi"),
  eor: text("eor"),
  fursOdgovor: text("furs_odgovor"),
  fursState: text("furs_state", { enum: ["pending", "sending", "confirmed", "failed", "unknown"] }).notNull().default("pending"),
  fursAttemptCount: integer("furs_attempt_count").notNull().default(0),
  fursLastAttemptAt: timestamp("furs_last_attempt_at", { withTimezone: true }),
  fursLastError: text("furs_last_error"),
  fursConfirmedAt: timestamp("furs_confirmed_at", { withTimezone: true }),
  fursClaimedAt: timestamp("furs_claimed_at", { withTimezone: true }),
  fursClaimedBy: text("furs_claimed_by"),
  fursClaimBatchId: uuid("furs_claim_batch_id"),
  fursClaimLeaseUntil: timestamp("furs_claim_lease_until", { withTimezone: true }),
  requestHash: text("request_hash"),
  /** Set only by the controlled offline import CAS; unique prevents a second normal receipt. */
  offlineReceiptId: uuid("offline_receipt_id"),
  /** Stable cross-platform identity; distinct from the server-only integer primary key. */
  localReceiptId: uuid("local_receipt_id"),
  natakarIme: text("natakar_ime"),
  natakarDavcna: text("natakar_davcna"),
  datumCas: timestamp("datum_cas", { withTimezone: true }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  steviloPrintov: integer("stevilo_printov").notNull().default(0),
  opomba: text("opomba"),
  znesekGotovina: numeric("znesek_gotovina", { precision: 10, scale: 2 }),
  znesekKartica: numeric("znesek_kartica", { precision: 10, scale: 2 }),
  /** Prostovoljna napitnina, obračunana samo na kartici in vodena ločeno od prodajnih postavk. */
  znesekNapitnina: numeric("znesek_napitnina", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Immutable channel which captured the tip; NULL is an unreviewed legacy receipt. */
  tipPaymentMethod: text("tip_payment_method", { enum: ["cash", "card"] }),
  /** Immutable legal/tax snapshot selected at receipt issuance. */
  tipPolicyId: uuid("tip_policy_id").references(() => tipPoliciesTable.id, { onDelete: "set null" }),
  tipPolicyMode: text("tip_policy_mode", { enum: ["direct_employee", "independent_pool", "employer_controlled"] }),
  tipCardFeeTreatment: text("tip_card_fee_treatment", { enum: ["employer_expense", "deduct_from_tip"] }),
  tipCardFeeKind: text("tip_card_fee_kind", { enum: ["none", "percentage", "flat"] }),
  tipCardFeeTaxTreatment: text("tip_card_fee_tax_treatment", {
    enum: ["not_applicable", "private_nondeductible", "business_deductible", "withheld_from_employee"],
  }),
  tipVatAmount: numeric("tip_vat_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Only the percentage fee attributable to the tip; a nominal flat fee is never allocated to the tip. */
  tipCardFeeAmount: numeric("tip_card_fee_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  tipCardFeeFlatAmount: numeric("tip_card_fee_flat_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  znesekBon: numeric("znesek_bon", { precision: 10, scale: 2 }),
  steviloBonov: integer("stevilo_bonov"),
  znesekBonPica: numeric("znesek_bon_pica", { precision: 10, scale: 2 }),
  /** SŠP subvencionirani del prodaje; ni popust in ne zmanjšuje DDV osnove. */
  znesekSubvencija: numeric("znesek_subvencija", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Lokalna referenca/NFC koda; Margento TransID pride v kasnejši fazi. */
  sspReferenca: text("ssp_referenca"),
  znesekNegotovinsko: numeric("znesek_negotovinsko", { precision: 10, scale: 2 }),
  dniOdloga: integer("dni_odloga"),
  izdaniKuponi: integer("izdani_kuponi"),
  /** Samostojna, neobdavčena izdaja večnamenskega darilnega bona (predplačilo). */
  jeDarilniBonIzdaja: boolean("je_darilni_bon_izdaja").notNull().default(false),
  jeDelni: boolean("je_delni").notNull().default(false),
  jeStorno: boolean("je_storno").notNull().default(false),
  izvorniRacunId: integer("izvorni_racun_id"),
  /** Set exactly once after all confirmed-storno side effects commit. */
  stornoFinalizedAt: timestamp("storno_finalized_at", { withTimezone: true }),
  businessFinalizedAt: timestamp("business_finalized_at", { withTimezone: true }),
  kupecDavcnaStevilka: text("kupec_davcna_stevilka"),
  kupecNaziv: text("kupec_naziv"),
  kupecNaslov: text("kupec_naslov"),
  kupecZavezanecDdv: boolean("kupec_zavezanec_ddv"),
  sumupCheckoutId: text("sumup_checkout_id"),
  vivaTerminalSessionId: text("viva_terminal_session_id"),
  vivaTransactionId: text("viva_transaction_id"),
  vivaOrderCode: text("viva_order_code"),
  /** Authoritative completed terminal payment consumed by this receipt. */
  cardPaymentAttemptId: uuid("card_payment_attempt_id").references(() => posKarticnaPlacilaAttemptTable.id, { onDelete: "restrict" }),
  kupecId: integer("kupec_id"),
  /** UUID referencu na skupen šifrant partnerjev (counterparties) */
  kupecCpId: uuid("kupec_cp_id").references(() => counterpartiesTable.id, { onDelete: "set null" }),
  eRacunXml: text("e_racun_xml"),
  /** base64-encoded PDF računa, generiran ob XML generiranju (ne vsakič znova) */
  eRacunPdf: text("e_racun_pdf"),
  /** e-Račun status: null = ni generirano, pripravljen = XML generiran,
   *  poslano = uspešno oddano prek bizBox, poslano_email = uspešno poslano po e-pošti,
   *  napaka = generiranje/pošiljanje spodletelo */
  eRacunStatus: text("e_racun_status", {
    enum: ["pripravljen", "poslan", "poslano", "poslano_email", "napaka"],
  }),
  eRacunDatum: timestamp("e_racun_datum", { withTimezone: true }),
  eRacunNapaka: text("e_racun_napaka"),
  /** Datum in čas uspešne oddaje prek bizBox ali e-pošte */
  eRacunPoslanoDne: timestamp("e_racun_poslano_dne", { withTimezone: true }),
  /** Sled: status koda + telo odgovora bizBox oddaje (za diagnostiko) */
  eRacunBizboxOdgovor: text("e_racun_bizbox_odgovor"),
  /** Sled e-poštnega pošiljanja: "OK: jan@firma.si" ali "NAPAKA: <msg>" */
  eRacunEmailOdgovor: text("e_racun_email_odgovor"),
  /**
   * bizBox document ID iz odgovora POST /documents (result = int64).
   * Shranjen kot text, ker int64 vrednosti presegajo JS Number.MAX_SAFE_INTEGER.
   * Potreben za GET /documents/{docId}/metaData (status preverjanje).
   */
  eRacunBizboxId: text("e_racun_bizbox_id"),
  /**
   * Status dostave dokumenta v bizBox omrežje.
   *   oddano      = ZIP uspešno oddan, docId shranjen
   *   v_obdelavi  = bizBox ga ima, dostava v teku
   *   dostavljeno = prejemnik potrdil prejem
   *   zavrnjeno   = bizBox ali prejemnik zavrnil
   *   napaka      = napaka pri preverjanju statusa
   */
  eRacunBizboxStatus: text("e_racun_bizbox_status", {
    enum: ["oddano", "v_obdelavi", "dostavljeno", "zavrnjeno", "napaka"],
  }),
}, (table) => [
  // PostgreSQL pri UNIQUE dovoli več NULL vrednosti, zato navadni (ne-kartični)
  // računi ostanejo neomejeni, ista ponudnikova kartična referenca pa ne.
  uniqueIndex("racuni_sumup_checkout_id_unique").on(table.sumupCheckoutId),
  uniqueIndex("racuni_viva_terminal_session_id_unique").on(table.vivaTerminalSessionId),
  uniqueIndex("racuni_card_payment_attempt_id_unique").on(table.cardPaymentAttemptId),
  uniqueIndex("racuni_enota_stevilka_unique").on(table.enotaId, table.stevilkaRacuna),
  uniqueIndex("racuni_offline_receipt_id_unique").on(table.offlineReceiptId),
  uniqueIndex("racuni_local_receipt_id_unique").on(table.localReceiptId),
  uniqueIndex("racuni_izvorni_storno_unique")
    .on(table.izvorniRacunId)
    .where(sql`${table.jeStorno} = true`),
]);

/** Atomski števec številk računov po enoti, poslovnem prostoru in blagajni. */
export const racunStevilkeTable = pgTable("pos_racun_stevilke", {
  id: uuid("id").primaryKey().defaultRandom(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  poslovniProstor: text("poslovni_prostor").notNull(),
  blagajnaId: text("blagajna_id").notNull(),
  lastValue: integer("last_value").notNull(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pos_racun_stevilke_scope_unique")
    .on(table.enotaId, table.poslovniProstor, table.blagajnaId),
]);

/**
 * Trajna rezervacija izdaje računa. Zapis nastane pred FURS klicem, zato
 * ponovljen ali sočasen HTTP zahtevek ne more sprožiti druge fiskalizacije.
 */
export const racunIzdajaZahteveTable = pgTable("pos_racun_izdaja_zahteve", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "restrict" }),
  blagajnaKljuc: text("blagajna_kljuc").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  /** Pre-FURS reservation of the completed card attempt. */
  cardPaymentAttemptId: uuid("card_payment_attempt_id").references(() => posKarticnaPlacilaAttemptTable.id, { onDelete: "restrict" }),
  status: text("status", { enum: ["processing", "completed", "unknown"] }).notNull().default("processing"),
  racunId: integer("racun_id").references(() => racuniTable.id, { onDelete: "restrict" }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pos_racun_izdaja_idempotency_unique")
    .on(table.companyId, table.enotaId, table.idempotencyKey),
  uniqueIndex("pos_racun_izdaja_card_payment_attempt_unique")
    .on(table.cardPaymentAttemptId),
  uniqueIndex("pos_racun_izdaja_blagajna_processing_unique")
    .on(table.enotaId, table.blagajnaKljuc)
    .where(sql`${table.status} = 'processing'`),
]);

/** Append-only audit trail for every FURS transmission attempt. */
export const fursAttemptsTable = pgTable("furs_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  racunId: integer("racun_id").notNull().references(() => racuniTable.id, { onDelete: "restrict" }),
  attemptId: uuid("attempt_id").notNull(),
  requestHash: text("request_hash").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  outcome: text("outcome", { enum: ["confirmed", "failed", "unknown"] }),
  rawResponse: text("raw_response"),
  rawError: text("raw_error"),
  actor: text("actor").notNull(),
}, (table) => [
  uniqueIndex("furs_attempts_attempt_id_unique").on(table.attemptId),
]);

/**
 * Canonical, immutable business input for a FURS transmission. Certificates
 * and transport credentials are deliberately absent and are resolved anew.
 */
export const fursPayloadSnapshotsTable = pgTable("furs_payload_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  operationKey: text("operation_key").notNull(),
  issueReservationId: uuid("issue_reservation_id").references(() => racunIzdajaZahteveTable.id, { onDelete: "restrict" }),
  giftReservationId: uuid("gift_reservation_id"),
  racunId: integer("racun_id").references(() => racuniTable.id, { onDelete: "restrict" }),
  payload: jsonb("payload").notNull(),
  requestHash: text("request_hash").notNull(),
  fursNacin: text("furs_nacin", { enum: ["simulacija", "testno", "produkcija"] }).notNull(),
  preskociPreverjanje: boolean("preskoci_preverjanje").notNull().default(false),
  splosnaStopnja: numeric("splosna_stopnja", { precision: 5, scale: 2 }).notNull(),
  signingContextFingerprint: text("signing_context_fingerprint").notNull().default("legacy-manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("furs_payload_snapshots_operation_unique").on(table.companyId, table.operationKey),
  uniqueIndex("furs_payload_snapshots_issue_unique").on(table.issueReservationId),
  uniqueIndex("furs_payload_snapshots_gift_unique").on(table.giftReservationId),
  uniqueIndex("furs_payload_snapshots_racun_unique").on(table.racunId),
]);

/** Immutable, pre-FURS plan for idempotent standard-receipt finalization. */
export const racunFinalizationPlansTable = pgTable("pos_racun_finalization_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  racunId: integer("racun_id").notNull().references(() => racuniTable.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").notNull(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  sourceOperationId: text("source_operation_id").notNull(),
  localReceiptId: uuid("local_receipt_id").notNull(),
  plan: jsonb("plan").notNull(),
  planHash: text("plan_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pos_racun_finalization_plans_racun_unique").on(table.racunId),
  uniqueIndex("pos_racun_finalization_plans_source_operation_unique").on(table.companyId, table.sourceOperationId),
  uniqueIndex("pos_racun_finalization_plans_local_receipt_unique").on(table.localReceiptId),
]);

export const racuniRelations = relations(racuniTable, ({ one }) => ({
  narocilo: one(narocilaTable, { fields: [racuniTable.narociloId], references: [narocilaTable.id] }),
  izmena: one(izmeneTable, { fields: [racuniTable.izmenaId], references: [izmeneTable.id] }),
}));

export type Racun = typeof racuniTable.$inferSelect;
export type InsertRacun = typeof racuniTable.$inferInsert;
